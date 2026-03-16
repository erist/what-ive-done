import { startCollectorSupervisor, type RunningCollectorSupervisor } from "./collectors.js";
import { startSnapshotScheduler, type RunningSnapshotScheduler } from "./scheduler.js";
import { ensureAppPaths, resolveAppPaths } from "../app-paths.js";
import { startIngestServer, type IngestServerOptions, type RunningIngestServer } from "../server/ingest-server.js";
import { AppDatabase } from "../storage/database.js";
import { acquireAgentLock } from "./lock.js";
import { getAgentStatusSnapshot, writeAgentRuntimeState } from "./state.js";
import type { ReportWindow } from "../domain/types.js";
import type { AgentCollectorState, AgentRuntimeState, AgentSnapshotSchedulerState } from "./types.js";

export interface StartCollectorSupervisorOptions {
  ingestUrl: string;
  processPlatform?: NodeJS.Platform | undefined;
  pollIntervalMs?: number | undefined;
  promptAccessibility?: boolean | undefined;
  restartDelayMs?: number | undefined;
  onCollectorStateChange?: ((state: AgentCollectorState) => void) | undefined;
}

export interface StartSnapshotSchedulerRuntimeOptions {
  dataDir?: string | undefined;
  windows?: ReportWindow[] | undefined;
  intervalMs?: number | undefined;
  onStateChange?: ((state: AgentSnapshotSchedulerState) => void) | undefined;
}

export interface StartAgentRuntimeOptions {
  dataDir?: string | undefined;
  heartbeatIntervalMs?: number | undefined;
  handleSignals?: boolean | undefined;
  ingestHost?: string | undefined;
  ingestPort?: number | undefined;
  collectorPollIntervalMs?: number | undefined;
  collectorRestartDelayMs?: number | undefined;
  promptAccessibility?: boolean | undefined;
  enableCollectors?: boolean | undefined;
  snapshotWindows?: ReportWindow[] | undefined;
  snapshotIntervalMs?: number | undefined;
  enableSnapshotScheduler?: boolean | undefined;
  ingestServerFactory?: ((options: IngestServerOptions) => Promise<RunningIngestServer>) | undefined;
  collectorSupervisorFactory?:
    | ((options: StartCollectorSupervisorOptions) => Promise<RunningCollectorSupervisor>)
    | undefined;
  snapshotSchedulerFactory?:
    | ((options: StartSnapshotSchedulerRuntimeOptions) => Promise<RunningSnapshotScheduler>)
    | undefined;
}

export interface RunningAgentRuntime {
  readonly pid: number;
  readonly startedAt: string;
  stop: (reason?: string) => Promise<void>;
  waitForStop: () => Promise<void>;
}

export async function startAgentRuntime(
  options: StartAgentRuntimeOptions = {},
): Promise<RunningAgentRuntime> {
  const paths = resolveAppPaths(options.dataDir);
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? 30_000;
  const ingestServerFactory = options.ingestServerFactory ?? startIngestServer;
  const collectorSupervisorFactory = options.collectorSupervisorFactory ?? startCollectorSupervisor;
  const snapshotSchedulerFactory = options.snapshotSchedulerFactory ?? startSnapshotScheduler;
  ensureAppPaths(paths);

  const lock = acquireAgentLock(paths.agentLockPath, {
    pid: process.pid,
    acquiredAt: new Date().toISOString(),
  });
  const database = new AppDatabase(paths);

  try {
    database.initialize();
  } catch (error) {
    lock.release();
    throw error;
  }

  const startedAt = new Date().toISOString();
  let state: AgentRuntimeState = {
    status: "starting",
    pid: process.pid,
    startedAt,
    heartbeatAt: startedAt,
    ingestServer: {
      status: "starting",
      host: options.ingestHost ?? "127.0.0.1",
      port: options.ingestPort,
    },
    collectors: [],
    snapshotScheduler: {
      status: options.enableSnapshotScheduler === false ? "disabled" : "starting",
      windows: options.snapshotWindows ?? ["day", "week"],
      intervalMs: options.snapshotIntervalMs ?? 300_000,
      lastGeneratedSnapshots: [],
    },
  };
  let stopped = false;
  let resolveStopped!: () => void;
  const stoppedPromise = new Promise<void>((resolve) => {
    resolveStopped = resolve;
  });

  const persistState = (): void => {
    writeAgentRuntimeState(database, state);
  };

  const mergeCollectorState = (collectorState: AgentCollectorState): void => {
    state = {
      ...state,
      collectors: [
        ...state.collectors.filter((entry) => entry.id !== collectorState.id),
        collectorState,
      ].sort((left, right) => left.id.localeCompare(right.id)),
    };
    persistState();
  };

  const mergeSnapshotSchedulerState = (snapshotScheduler: AgentSnapshotSchedulerState): void => {
    state = {
      ...state,
      snapshotScheduler,
    };
    persistState();
  };

  persistState();

  let ingestServer: RunningIngestServer | undefined;
  let collectorSupervisor: RunningCollectorSupervisor | undefined;
  let snapshotScheduler: RunningSnapshotScheduler | undefined;

  try {
    ingestServer = await ingestServerFactory({
      dataDir: options.dataDir,
      host: options.ingestHost,
      port: options.ingestPort,
    });

    state = {
      ...state,
      ingestServer: {
        status: "running",
        host: ingestServer.host,
        port: ingestServer.port,
        viewerUrl: ingestServer.viewerUrl,
        healthUrl: `http://${ingestServer.host}:${ingestServer.port}/health`,
        eventsUrl: `http://${ingestServer.host}:${ingestServer.port}/events`,
        startedAt: new Date().toISOString(),
      },
    };
    persistState();

    if (options.enableCollectors !== false) {
      collectorSupervisor = await collectorSupervisorFactory({
        ingestUrl: `http://${ingestServer.host}:${ingestServer.port}/events`,
        processPlatform: process.platform,
        pollIntervalMs: options.collectorPollIntervalMs,
        promptAccessibility: options.promptAccessibility,
        restartDelayMs: options.collectorRestartDelayMs,
        onCollectorStateChange: mergeCollectorState,
      });

      state = {
        ...state,
        collectors: collectorSupervisor.getCollectorStates(),
      };
      persistState();
    }

    if (options.enableSnapshotScheduler !== false) {
      snapshotScheduler = await snapshotSchedulerFactory({
        dataDir: options.dataDir,
        windows: options.snapshotWindows,
        intervalMs: options.snapshotIntervalMs,
        onStateChange: mergeSnapshotSchedulerState,
      });

      state = {
        ...state,
        snapshotScheduler: snapshotScheduler.getState(),
      };
      persistState();
    }
  } catch (error) {
    if (snapshotScheduler) {
      await snapshotScheduler.stop();
      state = {
        ...state,
        snapshotScheduler: snapshotScheduler.getState(),
      };
      persistState();
    }

    if (collectorSupervisor) {
      await collectorSupervisor.stop();
      state = {
        ...state,
        collectors: collectorSupervisor.getCollectorStates(),
      };
      persistState();
    }

    if (ingestServer) {
      await ingestServer.close();
    }

    state = {
      ...state,
      status: "stopped",
      heartbeatAt: new Date().toISOString(),
      stoppedAt: new Date().toISOString(),
      stopReason: "startup_failed",
      ingestServer: {
        status: ingestServer ? "stopped" : "failed",
        host: ingestServer?.host ?? options.ingestHost ?? "127.0.0.1",
        port: ingestServer?.port ?? options.ingestPort,
        error: error instanceof Error ? error.message : String(error),
      },
      snapshotScheduler: state.snapshotScheduler
        ? {
            ...state.snapshotScheduler,
            status: "failed",
            lastError: error instanceof Error ? error.message : String(error),
          }
        : undefined,
    };
    persistState();
    lock.release();
    database.close();
    throw error;
  }

  const heartbeat = setInterval(() => {
    state = {
      ...state,
      status: "running",
      heartbeatAt: new Date().toISOString(),
    };
    persistState();
  }, heartbeatIntervalMs);

  state = {
    ...state,
    status: "running",
  };
  persistState();

  const stop = async (reason = "manual"): Promise<void> => {
    if (stopped) {
      return stoppedPromise;
    }

    stopped = true;
    clearInterval(heartbeat);

    state = {
      ...state,
      status: "stopping",
      heartbeatAt: new Date().toISOString(),
    };
    persistState();

    if (snapshotScheduler) {
      await snapshotScheduler.stop();
    }

    if (collectorSupervisor) {
      await collectorSupervisor.stop();
    }

    if (ingestServer) {
      state = {
        ...state,
        ingestServer: state.ingestServer
          ? {
              ...state.ingestServer,
              status: "stopping",
            }
          : undefined,
      };
      persistState();

      await ingestServer.close();
    }

    state = {
      ...state,
      status: "stopped",
      heartbeatAt: new Date().toISOString(),
      stoppedAt: new Date().toISOString(),
      stopReason: reason,
      ingestServer: state.ingestServer
        ? {
            ...state.ingestServer,
            status: "stopped",
            stoppedAt: new Date().toISOString(),
          }
        : undefined,
    };
    persistState();

    if (options.handleSignals !== false) {
      process.off("SIGINT", handleSignal);
      process.off("SIGTERM", handleSignal);
    }

    lock.release();
    database.close();
    resolveStopped();
  };

  const handleSignal = (): void => {
    void stop("signal");
  };

  if (options.handleSignals !== false) {
    process.on("SIGINT", handleSignal);
    process.on("SIGTERM", handleSignal);
  }

  return {
    pid: process.pid,
    startedAt,
    stop,
    waitForStop: () => stoppedPromise,
  };
}

export function stopAgentRuntime(dataDir?: string): {
  status: "stop_requested" | "not_running";
  pid?: number | undefined;
} {
  const status = getAgentStatusSnapshot(dataDir);

  if (status.status !== "running" || status.pid === undefined) {
    return {
      status: "not_running",
    };
  }

  process.kill(status.pid, "SIGTERM");

  return {
    status: "stop_requested",
    pid: status.pid,
  };
}
