export type AgentLifecycleStatus = "starting" | "running" | "stopping" | "stopped";

export type AgentServiceStatus = "starting" | "running" | "stopping" | "stopped" | "failed";

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
  port?: number | undefined;
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
  stoppedAt?: string | undefined;
  lastExitCode?: number | undefined;
  lastExitSignal?: NodeJS.Signals | null | undefined;
  restartCount: number;
  lastError?: string | undefined;
}

export interface AgentRuntimeState {
  status: AgentLifecycleStatus;
  pid: number;
  startedAt: string;
  heartbeatAt: string;
  ingestServer?: AgentIngestServerState | undefined;
  collectors: AgentCollectorState[];
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
