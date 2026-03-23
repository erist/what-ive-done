import { escapeHtml, formatDateTime } from "../lib/dom";
import type { AgentHealth } from "../lib/types";

export function renderStatus(
  agentHealth: AgentHealth,
  generatedAt: string,
  elements: {
    agentStatus: HTMLElement;
    serverStatus: HTMLElement;
    collectorStatus: HTMLElement;
    generatedAt: HTMLElement;
  },
): void {
  elements.agentStatus.textContent = agentHealth.status;
  elements.agentStatus.className = "status-pill " + agentHealth.status;

  const ingestServer = agentHealth.runtime.state && agentHealth.runtime.state.ingestServer;
  elements.serverStatus.textContent =
    ingestServer && ingestServer.status === "running"
      ? `${ingestServer.host}:${ingestServer.port}`
      : ingestServer && ingestServer.status
        ? ingestServer.status
        : "stopped";

  const collectors = agentHealth.collectors || [];
  if (collectors.length === 0) {
    elements.collectorStatus.textContent = "No collectors";
  } else {
    elements.collectorStatus.textContent = collectors
      .map((collector) => `${collector.id} (${collector.status})`)
      .join(", ");
  }

  elements.generatedAt.textContent = formatDateTime(generatedAt);
}
