import { escapeHtml, formatSignedNumber, formatSignedDuration } from "../lib/dom";
import type { ComparisonData, ComparisonEntry } from "../lib/types";

function renderComparisonEntries(entries: ComparisonEntry[] | undefined, emptyMessage: string): string {
  if (!entries || entries.length === 0) {
    return `<div class="empty-state">${escapeHtml(emptyMessage)}</div>`;
  }

  return `
    <div class="comparison-entry-list">
      ${entries
        .map((entry) => {
          const previousName = entry.previousWorkflowName
            ? `<p class="muted">Previously: ${escapeHtml(entry.previousWorkflowName)}</p>`
            : "";

          return `
          <article class="comparison-entry">
            <strong>${escapeHtml(entry.workflowName)}</strong>
            ${previousName}
            <p class="muted">
              repeats ${escapeHtml(formatSignedNumber(entry.frequencyDelta))} |
              time ${escapeHtml(formatSignedDuration(entry.totalDurationDeltaSeconds))}
            </p>
          </article>
        `;
        })
        .join("")}
    </div>
  `;
}

export function renderComparisonView(comparison: ComparisonData | undefined, container: HTMLElement): void {
  if (!comparison) {
    container.innerHTML =
      '<div class="empty-state">Comparison is available only for day and week windows.</div>';
    return;
  }

  const summaryCards = [
    {
      label: "Compared Against",
      value: comparison.previousTimeWindow.reportDate,
      note: `${comparison.previousTimeWindow.window} window in ${comparison.previousTimeWindow.timezone}`,
    },
    {
      label: "Sessions Delta",
      value: formatSignedNumber(comparison.summary.sessionDelta),
      note: "Current window sessions minus previous window sessions",
    },
    {
      label: "Tracked Time Delta",
      value: formatSignedDuration(comparison.summary.trackedDurationDeltaSeconds),
      note: "Change in total tracked time across matching windows",
    },
    {
      label: "Approved Candidate Time",
      value: formatSignedDuration(comparison.summary.approvedCandidateTimeDeltaSeconds),
      note: "Shift in time spent on approved automation candidates",
    },
  ];

  container.innerHTML = `
    <div class="comparison-summary-grid">
      ${summaryCards
        .map(
          (card) => `
          <article class="comparison-summary-card">
            <p class="panel-label">${escapeHtml(card.label)}</p>
            <p class="value">${escapeHtml(card.value)}</p>
            <p class="note">${escapeHtml(card.note)}</p>
          </article>
        `,
        )
        .join("")}
    </div>
    <div class="comparison-columns">
      <section class="comparison-column">
        <p class="panel-label">Newly Appeared</p>
        <h3>Confirmed workflows that were not present before</h3>
        ${renderComparisonEntries(comparison.newlyAppearedWorkflows, "No newly appeared confirmed workflows in this comparison window.")}
      </section>
      <section class="comparison-column">
        <p class="panel-label">Disappeared</p>
        <h3>Confirmed workflows that dropped out of the previous set</h3>
        ${renderComparisonEntries(comparison.disappearedWorkflows, "No confirmed workflows disappeared in this comparison window.")}
      </section>
      <section class="comparison-column">
        <p class="panel-label">Automation Effect</p>
        <h3>Approved candidate workflows with time shifts</h3>
        ${renderComparisonEntries(comparison.approvedCandidateChanges, "No approved automation candidate changes yet.")}
      </section>
    </div>
  `;
}
