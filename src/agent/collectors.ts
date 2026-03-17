import { spawn } from "node:child_process";
import { PassThrough } from "node:stream";

import { getMacOSActiveWindowCollectorInfo } from "../collectors/macos.js";
import { getWindowsActiveWindowCollectorInfo } from "../collectors/windows.js";
import type { AgentCollectorState } from "./types.js";

export interface CollectorProcessSpec {
  id: string;
  platform: string;
  runtime: string;
  command: string;
  args: string[];
  ingestUrl: string;
  ingestAuthToken?: string | undefined;
}

export interface CollectorSupervisorOptions {
  ingestUrl: string;
  ingestAuthToken?: string | undefined;
  processPlatform?: NodeJS.Platform | undefined;
  pollIntervalMs?: number | undefined;
  promptAccessibility?: boolean | undefined;
  restartDelayMs?: number | undefined;
  verbose?: boolean | undefined;
  onCollectorStateChange?: ((state: AgentCollectorState) => void) | undefined;
  spawnProcess?: SpawnProcess | undefined;
}

export interface RunningCollectorSupervisor {
  getCollectorStates: () => AgentCollectorState[];
  stop: () => Promise<void>;
}

export interface SpawnedProcess {
  pid?: number | undefined;
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
  kill: (signal?: NodeJS.Signals | number) => boolean;
  once: (
    event: "spawn" | "error" | "exit",
    listener:
      | (() => void)
      | ((error: Error) => void)
      | ((code: number | null, signal: NodeJS.Signals | null) => void),
  ) => this;
}

export interface SpawnProcess {
  (
    command: string,
    args: string[],
    options: {
      stdio: ["ignore", "pipe", "pipe"];
      env: NodeJS.ProcessEnv;
    },
  ): SpawnedProcess;
}

const defaultSpawnProcess: SpawnProcess = (command, args, options) =>
  spawn(command, args, options) as unknown as SpawnedProcess;

export function buildManagedCollectorSpecs(options: {
  ingestUrl: string;
  ingestAuthToken?: string | undefined;
  processPlatform?: NodeJS.Platform | undefined;
  pollIntervalMs?: number | undefined;
  promptAccessibility?: boolean | undefined;
}): CollectorProcessSpec[] {
  const processPlatform = options.processPlatform ?? process.platform;
  const pollIntervalMs = options.pollIntervalMs ?? 1_000;

  if (processPlatform === "darwin") {
    const info = getMacOSActiveWindowCollectorInfo();

    return [
      {
        id: info.id,
        platform: info.platform,
        runtime: info.runtime,
        command: "swift",
        args: [
          info.scriptPath!,
          "--ingest-url",
          options.ingestUrl,
          ...(options.ingestAuthToken ? ["--ingest-auth-token", options.ingestAuthToken] : []),
          "--poll-interval-ms",
          String(pollIntervalMs),
          ...(options.promptAccessibility ? ["--prompt-accessibility"] : []),
        ],
        ingestUrl: options.ingestUrl,
        ingestAuthToken: options.ingestAuthToken,
      },
    ];
  }

  if (processPlatform === "win32") {
    const info = getWindowsActiveWindowCollectorInfo();

    return [
      {
        id: info.id,
        platform: info.platform,
        runtime: info.runtime,
        command: "powershell.exe",
        args: [
          "-File",
          info.scriptPath!,
          "-IngestUrl",
          options.ingestUrl,
          ...(options.ingestAuthToken ? ["-IngestAuthToken", options.ingestAuthToken] : []),
          "-PollIntervalMs",
          String(pollIntervalMs),
        ],
        ingestUrl: options.ingestUrl,
        ingestAuthToken: options.ingestAuthToken,
      },
    ];
  }

  return [];
}

function attachOutputDrain(processHandle: SpawnedProcess): void {
  const stdout = processHandle.stdout ?? new PassThrough();
  const stderr = processHandle.stderr ?? new PassThrough();

  stdout.on("data", () => undefined);
  stderr.on("data", () => undefined);
}

function redactCollectorArgs(args: string[]): string[] {
  return args.map((value, index) => {
    const previous = args[index - 1];

    if (previous === "--ingest-auth-token" || previous === "-IngestAuthToken") {
      return "<redacted>";
    }

    return value;
  });
}

export async function startCollectorSupervisor(
  options: CollectorSupervisorOptions,
): Promise<RunningCollectorSupervisor> {
  const specs = buildManagedCollectorSpecs({
    ingestUrl: options.ingestUrl,
    ingestAuthToken: options.ingestAuthToken,
    processPlatform: options.processPlatform,
    pollIntervalMs: options.pollIntervalMs,
    promptAccessibility: options.promptAccessibility,
  });
  const restartDelayMs = options.restartDelayMs ?? 5_000;
  const spawnProcess = options.spawnProcess ?? defaultSpawnProcess;
  const log = (message: string, payload?: Record<string, unknown>): void => {
    if (!options.verbose) {
      return;
    }

    const suffix = payload ? ` ${JSON.stringify(payload)}` : "";
    console.error(`[collector-supervisor] ${message}${suffix}`);
  };
  const states = new Map<string, AgentCollectorState>();
  const stopHandles: Array<() => Promise<void>> = [];

  const emitState = (state: AgentCollectorState): void => {
    states.set(state.id, state);
    options.onCollectorStateChange?.(state);
  };

  for (const spec of specs) {
    let currentState: AgentCollectorState = {
      id: spec.id,
      platform: spec.platform,
      runtime: spec.runtime,
      status: "starting",
      ingestUrl: spec.ingestUrl,
      restartCount: 0,
    };
    let child: SpawnedProcess | undefined;
    let restartTimer: NodeJS.Timeout | undefined;
    let stopping = false;
    let restartScheduled = false;
    let stopResolver: (() => void) | undefined;

    const stopPromise = new Promise<void>((resolve) => {
      stopResolver = resolve;
    });

    const updateState = (patch: Partial<AgentCollectorState>): void => {
      currentState = {
        ...currentState,
        ...patch,
      };
      emitState(currentState);
    };

    const scheduleRestart = (): void => {
      if (stopping || restartScheduled) {
        return;
      }

      restartScheduled = true;
      updateState({
        status: "restarting",
        pid: undefined,
        restartCount: currentState.restartCount + 1,
      });
      log("collector_restart_scheduled", {
        collectorId: spec.id,
        restartCount: currentState.restartCount + 1,
        restartDelayMs,
      });

      restartTimer = setTimeout(() => {
        restartScheduled = false;
        launch();
      }, restartDelayMs);
    };

    const launch = (): void => {
      if (stopping) {
        return;
      }

      updateState({
        status: currentState.restartCount > 0 ? "restarting" : "starting",
        pid: undefined,
        stoppedAt: undefined,
      });

      try {
        child = spawnProcess(spec.command, spec.args, {
          stdio: ["ignore", "pipe", "pipe"],
          env: process.env,
        });
        log("collector_spawned", {
          collectorId: spec.id,
          command: spec.command,
          args: redactCollectorArgs(spec.args),
        });
      } catch (error) {
        updateState({
          status: "failed",
          lastError: error instanceof Error ? error.message : String(error),
          stoppedAt: new Date().toISOString(),
        });
        scheduleRestart();
        return;
      }

      attachOutputDrain(child);

      child.once("spawn", () => {
        updateState({
          status: "running",
          pid: child?.pid,
          startedAt: new Date().toISOString(),
          stoppedAt: undefined,
          lastError: undefined,
        });
        log("collector_running", {
          collectorId: spec.id,
          pid: child?.pid,
        });
      });

      child.once("error", (error: Error) => {
        updateState({
          status: "failed",
          pid: undefined,
          lastError: error.message,
          stoppedAt: new Date().toISOString(),
        });
        log("collector_error", {
          collectorId: spec.id,
          message: error.message,
        });
      });

      child.once("exit", (code: number | null, signal: NodeJS.Signals | null) => {
        child = undefined;

        if (stopping) {
          updateState({
            status: "stopped",
            pid: undefined,
            stoppedAt: new Date().toISOString(),
            lastExitCode: code ?? undefined,
            lastExitSignal: signal,
          });
          log("collector_stopped", {
            collectorId: spec.id,
          });
          stopResolver?.();
          return;
        }

        updateState({
          status: "failed",
          pid: undefined,
          stoppedAt: new Date().toISOString(),
          lastExitCode: code ?? undefined,
          lastExitSignal: signal,
          lastError:
            code !== null
              ? `Collector exited with code ${String(code)}`
              : `Collector exited with signal ${signal ?? "unknown"}`,
        });
        log("collector_exited", {
          collectorId: spec.id,
          code,
          signal,
        });
        scheduleRestart();
      });
    };

    emitState(currentState);
    launch();

    stopHandles.push(async () => {
      stopping = true;
      log("collector_stop_requested", {
        collectorId: spec.id,
      });

      if (restartTimer) {
        clearTimeout(restartTimer);
        restartTimer = undefined;
      }

      if (!child) {
        updateState({
          status: "stopped",
          stoppedAt: new Date().toISOString(),
        });
        stopResolver?.();
        return stopPromise;
      }

      updateState({
        status: "stopping",
      });
      child.kill("SIGTERM");
      return stopPromise;
    });
  }

  return {
    getCollectorStates: () => [...states.values()],
    stop: async () => {
      await Promise.all(stopHandles.map((stop) => stop()));
    },
  };
}
