import { ensureAppPaths, resolveAppPaths } from "../app-paths.js";
import { AppDatabase } from "../storage/database.js";
import { acquireAgentLock } from "./lock.js";
import { getAgentStatusSnapshot, writeAgentRuntimeState } from "./state.js";
import type { AgentRuntimeState } from "./types.js";

export interface StartAgentRuntimeOptions {
  dataDir?: string | undefined;
  heartbeatIntervalMs?: number | undefined;
  handleSignals?: boolean | undefined;
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
  };
  let stopped = false;
  let resolveStopped!: () => void;
  const stoppedPromise = new Promise<void>((resolve) => {
    resolveStopped = resolve;
  });

  const persistState = (): void => {
    writeAgentRuntimeState(database, state);
  };

  persistState();

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

    state = {
      ...state,
      status: "stopped",
      heartbeatAt: new Date().toISOString(),
      stoppedAt: new Date().toISOString(),
      stopReason: reason,
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
