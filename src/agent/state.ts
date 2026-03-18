import { resolveAppPaths } from "../app-paths.js";
import { ConfigManager } from "../config/manager.js";
import { AppDatabase } from "../storage/database.js";
import { isProcessRunning, readAgentLock } from "./lock.js";
import type { AgentRuntimeState, AgentStatusSnapshot } from "./types.js";

const AGENT_RUNTIME_STATE_KEY = "agent.runtime";

export function readAgentRuntimeState(database: AppDatabase): AgentRuntimeState | undefined {
  return database.getSetting<AgentRuntimeState>(AGENT_RUNTIME_STATE_KEY);
}

export function writeAgentRuntimeState(database: AppDatabase, state: AgentRuntimeState): void {
  database.setSetting(AGENT_RUNTIME_STATE_KEY, state);
}

export function clearAgentRuntimeState(database: AppDatabase): void {
  database.deleteSetting(AGENT_RUNTIME_STATE_KEY);
}

export function getAgentStatusSnapshot(dataDir?: string): AgentStatusSnapshot {
  const paths = resolveAppPaths(ConfigManager.resolveDataDir(dataDir));
  const database = new AppDatabase(paths);
  database.initialize();

  try {
    const state = readAgentRuntimeState(database);
    const lock = readAgentLock(paths.agentLockPath);
    const candidatePid = lock?.pid ?? state?.pid;
    const processActive = candidatePid === undefined ? false : isProcessRunning(candidatePid);
    const hasActiveLifecycleState =
      state?.status === "starting" || state?.status === "running" || state?.status === "stopping";
    const lockStale =
      lock !== undefined && (typeof lock.pid !== "number" || !isProcessRunning(lock.pid));
    const stateStale = hasActiveLifecycleState && !processActive;

    if (processActive && lock) {
      return {
        status: "running",
        pid: candidatePid,
        state,
        lock: {
          path: paths.agentLockPath,
          exists: true,
          pid: lock.pid,
          stale: false,
        },
      };
    }

    if (lockStale || stateStale) {
      return {
        status: "stale",
        pid: candidatePid,
        state,
        lock: {
          path: paths.agentLockPath,
          exists: lock !== undefined,
          pid: lock?.pid,
          stale: lockStale,
        },
      };
    }

    return {
      status: "stopped",
      pid: state?.pid,
      state,
      lock: {
        path: paths.agentLockPath,
        exists: lock !== undefined,
        pid: lock?.pid,
        stale: false,
      },
    };
  } finally {
    database.close();
  }
}
