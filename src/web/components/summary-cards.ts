import { escapeHtml, formatDuration, formatDateTime } from "../lib/dom";
import type { DashboardData } from "../lib/types";

export function renderSummaryCards(data: DashboardData, container: HTMLElement): void {
  const cards = [
    {
      label: "Tracked Sessions",
      value: String(data.report.totalSessions),
      note: `${data.sessionSummaries.length} sessions listed in this live view`,
    },
    {
      label: "Tracked Time",
      value: formatDuration(data.report.totalTrackedDurationSeconds),
      note: `Window: ${data.timeWindow.window} on ${data.timeWindow.reportDate}`,
    },
    {
      label: "Confirmed Workflows",
      value: String(data.report.workflows.length),
      note: "Repeated workflows above the current threshold",
    },
    {
      label: "Emerging Workflows",
      value: String(data.report.emergingWorkflows.length),
      note: "Early patterns that still need more repetition",
    },
    {
      label: "Raw Events",
      value: String(data.rawEventCount),
      note: data.latestEventAt
        ? `Latest event at ${formatDateTime(data.latestEventAt)}`
        : "No raw events yet",
    },
  ];

  container.innerHTML = cards
    .map(
      (card) => `
      <article class="summary-card">
        <p class="panel-label">${escapeHtml(card.label)}</p>
        <p class="value">${escapeHtml(card.value)}</p>
        <p class="note">${escapeHtml(card.note)}</p>
      </article>
    `,
    )
    .join("");
}
