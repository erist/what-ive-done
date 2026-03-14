export type AgentLifecycleStatus = "starting" | "running" | "stopping" | "stopped";

export interface AgentRuntimeState {
  status: AgentLifecycleStatus;
  pid: number;
  startedAt: string;
  heartbeatAt: string;
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
