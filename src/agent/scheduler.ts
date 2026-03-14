import type { ReportSnapshot, ReportWindow } from "../domain/types.js";
import { runReportSchedulerCycle } from "../reporting/service.js";
import { AppDatabase } from "../storage/database.js";
import { resolveAppPaths } from "../app-paths.js";
import type { AgentSnapshotSchedulerState } from "./types.js";

export interface StartSnapshotSchedulerOptions {
  dataDir?: string | undefined;
  windows?: ReportWindow[] | undefined;
  intervalMs?: number | undefined;
  runImmediately?: boolean | undefined;
  nowFactory?: (() => Date) | undefined;
  onStateChange?: ((state: AgentSnapshotSchedulerState) => void) | undefined;
  runCycle?:
    | ((database: AppDatabase, options: { windows: ReportWindow[]; now: Date }) => ReportSnapshot[])
    | undefined;
}

export interface RunningSnapshotScheduler {
  getState: () => AgentSnapshotSchedulerState;
  runOnce: () => Promise<AgentSnapshotSchedulerState>;
  stop: () => Promise<void>;
}

export async function startSnapshotScheduler(
  options: StartSnapshotSchedulerOptions,
): Promise<RunningSnapshotScheduler> {
  const windows = options.windows ?? ["day", "week"];
  const intervalMs = options.intervalMs ?? 300_000;
  const nowFactory = options.nowFactory ?? (() => new Date());
  const runCycle = options.runCycle ?? ((database: AppDatabase, runOptions) =>
    runReportSchedulerCycle(database, runOptions));
  let state: AgentSnapshotSchedulerState = {
    status: "starting",
    windows,
    intervalMs,
    lastGeneratedSnapshots: [],
  };
  let timer: NodeJS.Timeout | undefined;
  let stopping = false;
  let currentRun: Promise<void> | undefined;

  const emitState = (): void => {
    options.onStateChange?.(state);
  };

  const scheduleNext = (): void => {
    if (stopping) {
      return;
    }

    const nextRunAt = new Date(nowFactory().getTime() + intervalMs).toISOString();
    state = {
      ...state,
      nextRunAt,
    };
    emitState();

    timer = setTimeout(() => {
      void runOnce();
    }, intervalMs);
  };

  const executeRun = async (): Promise<void> => {
    const runStartedAt = nowFactory();

    state = {
      ...state,
      status: "running",
      lastRunAt: runStartedAt.toISOString(),
      nextRunAt: undefined,
    };
    emitState();

    const database = new AppDatabase(resolveAppPaths(options.dataDir));
    database.initialize();

    try {
      const snapshots = runCycle(database, {
        windows,
        now: runStartedAt,
      });

      state = {
        ...state,
        status: "running",
        lastSuccessAt: nowFactory().toISOString(),
        lastError: undefined,
        lastGeneratedSnapshots: snapshots.map((snapshot) => ({
          window: snapshot.timeWindow.window,
          reportDate: snapshot.timeWindow.reportDate,
          generatedAt: snapshot.generatedAt,
        })),
      };
      emitState();
    } catch (error) {
      state = {
        ...state,
        status: "failed",
        lastError: error instanceof Error ? error.message : String(error),
      };
      emitState();
    } finally {
      database.close();
    }

    scheduleNext();
  };

  const runOnce = async (): Promise<AgentSnapshotSchedulerState> => {
    if (stopping) {
      return state;
    }

    if (!currentRun) {
      currentRun = executeRun().finally(() => {
        currentRun = undefined;
      });
    }

    await currentRun;
    return state;
  };

  if (options.runImmediately !== false) {
    await runOnce();
  } else {
    state = {
      ...state,
      status: "running",
    };
    emitState();
    scheduleNext();
  }

  return {
    getState: () => state,
    runOnce,
    stop: async () => {
      stopping = true;

      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }

      if (currentRun) {
        await currentRun;
      }

      state = {
        ...state,
        status: "stopping",
        nextRunAt: undefined,
      };
      emitState();

      state = {
        ...state,
        status: "stopped",
      };
      emitState();
    },
  };
}
