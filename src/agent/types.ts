import type { ReportWindow } from "../domain/types.js";

export type AgentLifecycleStatus = "starting" | "running" | "stopping" | "stopped";

export type AgentServiceStatus =
  | "starting"
  | "running"
  | "stopping"
  | "stopped"
  | "failed"
  | "disabled";

export type AgentCollectorStatus =
  | "starting"
  | "running"
  | "restarting"
  | "stopping"
  | "stopped"
  | "failed"
  | "disabled";

export interface AgentIngestServerState {
  status: AgentServiceStatus;
  host: string;
  localOnly?: boolean | undefined;
  authRequired?: boolean | undefined;
  authTokenPreview?: string | undefined;
  rateLimitWindowMs?: number | undefined;
  rateLimitMaxRequests?: number | undefined;
  port?: number | undefined;
  viewerUrl?: string | undefined;
  healthUrl?: string | undefined;
  eventsUrl?: string | undefined;
  startedAt?: string | undefined;
  stoppedAt?: string | undefined;
  error?: string | undefined;
}

export interface AgentCollectorState {
  id: string;
  platform: string;
  runtime: string;
  status: AgentCollectorStatus;
  pid?: number | undefined;
  ingestUrl?: string | undefined;
  startedAt?: string | undefined;
  lastStartAttemptAt?: string | undefined;
  lastTransitionAt?: string | undefined;
  stoppedAt?: string | undefined;
  lastExitCode?: number | undefined;
  lastExitSignal?: NodeJS.Signals | null | undefined;
  restartCount: number;
  failureStreak?: number | undefined;
  currentRestartDelayMs?: number | undefined;
  nextRestartAt?: string | undefined;
  lastError?: string | undefined;
}

export interface AgentSnapshotSchedulerRunSummary {
  window: ReportWindow;
  reportDate: string;
  generatedAt: string;
}

export interface AgentSnapshotSchedulerState {
  status: AgentServiceStatus;
  windows: ReportWindow[];
  intervalMs: number;
  lastRunAt?: string | undefined;
  lastSuccessAt?: string | undefined;
  nextRunAt?: string | undefined;
  lastError?: string | undefined;
  lastGeneratedSnapshots: AgentSnapshotSchedulerRunSummary[];
}

export interface AgentRuntimeState {
  status: AgentLifecycleStatus;
  pid: number;
  startedAt: string;
  heartbeatAt: string;
  ingestServer?: AgentIngestServerState | undefined;
  collectors: AgentCollectorState[];
  snapshotScheduler?: AgentSnapshotSchedulerState | undefined;
  stoppedAt?: string | undefined;
  stopReason?: string | undefined;
}

export interface AgentStatusSnapshot {
  status: "running" | "stopped" | "stale";
  pid?: number | undefined;
  state?: AgentRuntimeState | undefined;
  lock: {
    path: string;
    exists: boolean;
    pid?: number | undefined;
    stale: boolean;
  };
}
