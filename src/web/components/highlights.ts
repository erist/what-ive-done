import { escapeHtml, formatDuration } from "../lib/dom";
import type { ReportSummary, WorkflowHighlight } from "../lib/types";

function highlightMarkup(
  title: string,
  entries: WorkflowHighlight[] | undefined,
  formatter: (entry: WorkflowHighlight) => string,
): string {
  if (!entries || entries.length === 0) {
    return `
      <article class="highlight-card">
        <h3>${escapeHtml(title)}</h3>
        <p>No items yet in this window.</p>
      </article>
    `;
  }

  return `
    <article class="highlight-card">
      <h3>${escapeHtml(title)}</h3>
      ${entries
        .map(
          (entry) =>
            `<p><strong>${escapeHtml(entry.workflowName)}</strong> ${escapeHtml(formatter(entry))}</p>`,
        )
        .join("")}
    </article>
  `;
}

export function renderHighlights(summary: ReportSummary, container: HTMLElement): void {
  container.innerHTML = [
    highlightMarkup("Top Repetitive", summary.topRepetitiveWorkflows, (entry) => {
      return `${entry.frequency} repeats, ${formatDuration(entry.totalDurationSeconds)} total`;
    }),
    highlightMarkup("Time-Heavy", summary.highestTimeConsumingRepetitiveWorkflows, (entry) => {
      return `${formatDuration(entry.totalDurationSeconds)} total, ${entry.frequency} repeats`;
    }),
    highlightMarkup("Quick Wins", summary.quickWinAutomationCandidates, (entry) => {
      return `${entry.automationSuitability} automation fit, confidence ${entry.confidenceScore}`;
    }),
    highlightMarkup("Needs Review", summary.workflowsNeedingHumanJudgment, (entry) => {
      return `confidence ${entry.confidenceScore}, labeled: ${entry.userLabeled ? "yes" : "no"}`;
    }),
  ].join("");
}
