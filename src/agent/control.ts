import type { ReportSnapshotSummary, ReportWindow } from "../domain/types.js";
import { runReportSchedulerCycle } from "../reporting/service.js";
import { AppDatabase } from "../storage/database.js";
import { resolveAppPaths } from "../app-paths.js";
import { getAgentStatusSnapshot } from "./state.js";
import type { AgentCollectorState, AgentStatusSnapshot } from "./types.js";

export interface AgentHealthReport {
  status: "healthy" | "degraded" | "stopped" | "stale";
  issues: string[];
  runtime: AgentStatusSnapshot;
  collectors: AgentCollectorState[];
  latestSnapshots: ReportSnapshotSummary[];
}

export interface AgentRunOnceResult {
  generatedAt: string;
  windows: ReportWindow[];
  snapshots: Array<{
    id: string;
    window: ReportWindow;
    reportDate: string;
    generatedAt: string;
    totalSessions: number;
    workflows: number;
    emergingWorkflows: number;
  }>;
}

export function listLatestAgentSnapshots(
  dataDir?: string,
  windows: ReportWindow[] = ["day", "week"],
): ReportSnapshotSummary[] {
  const database = new AppDatabase(resolveAppPaths(dataDir));
  database.initialize();

  try {
    return windows
      .flatMap((window) => database.listReportSnapshots({ window, limit: 1 }))
      .sort((left, right) => left.window.localeCompare(right.window));
  } finally {
    database.close();
  }
}

export function getAgentHealthReport(dataDir?: string): AgentHealthReport {
  const runtime = getAgentStatusSnapshot(dataDir);
  const latestSnapshots = listLatestAgentSnapshots(dataDir);
  const collectors = runtime.state?.collectors ?? [];
  const issues: string[] = [];

  if (runtime.status === "stale") {
    issues.push("agent_runtime_stale");
  }

  if (runtime.status === "running" && runtime.state?.ingestServer?.status !== "running") {
    issues.push("ingest_server_not_running");
  }

  if (runtime.status === "running" && runtime.state?.ingestServer?.authRequired !== true) {
    issues.push("ingest_server_auth_not_enabled");
  }

  if (runtime.status === "running" && runtime.state?.ingestServer?.localOnly !== true) {
    issues.push("ingest_server_not_local_only");
  }

  if (
    runtime.status === "running" &&
    runtime.state?.snapshotScheduler &&
    runtime.state.snapshotScheduler.status !== "running" &&
    runtime.state.snapshotScheduler.status !== "disabled"
  ) {
    issues.push("snapshot_scheduler_not_running");
  }

  if (
    runtime.status === "running" &&
    runtime.state?.snapshotScheduler?.status === "running" &&
    !runtime.state.snapshotScheduler.lastSuccessAt
  ) {
    issues.push("snapshot_scheduler_has_not_completed");
  }

  for (const collector of collectors) {
    if (collector.status !== "running") {
      issues.push(`collector_${collector.id}_${collector.status}`);
    }

    if ((collector.failureStreak ?? 0) >= 3) {
      issues.push(`collector_${collector.id}_flapping`);
    }

    if (collector.nextRestartAt) {
      issues.push(`collector_${collector.id}_backoff_active`);
    }
  }

  return {
    status:
      runtime.status === "stopped"
        ? "stopped"
        : runtime.status === "stale"
          ? "stale"
          : issues.length === 0
            ? "healthy"
            : "degraded",
    issues,
    runtime,
    collectors,
    latestSnapshots,
  };
}

export function runAgentOnce(
  dataDir?: string,
  options: {
    windows?: ReportWindow[] | undefined;
  } = {},
): AgentRunOnceResult {
  const database = new AppDatabase(resolveAppPaths(dataDir));
  database.initialize();

  try {
    const windows = options.windows ?? ["day", "week"];
    const snapshots = runReportSchedulerCycle(database, {
      windows,
    });

    return {
      generatedAt: new Date().toISOString(),
      windows,
      snapshots: snapshots.map((snapshot) => ({
        id: snapshot.id,
        window: snapshot.timeWindow.window,
        reportDate: snapshot.timeWindow.reportDate,
        generatedAt: snapshot.generatedAt,
        totalSessions: snapshot.totalSessions,
        workflows: snapshot.workflows.length,
        emergingWorkflows: snapshot.emergingWorkflows.length,
      })),
    };
  } finally {
    database.close();
  }
}
