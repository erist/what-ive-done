import { escapeHtml, formatDateTime } from "../lib/dom";
import type { SnapshotSummary } from "../lib/types";

export function renderSnapshotList(snapshots: SnapshotSummary[], container: HTMLElement): void {
  if (!snapshots || snapshots.length === 0) {
    container.innerHTML = '<div class="empty-state">No stored snapshots yet.</div>';
    return;
  }

  container.innerHTML = snapshots
    .map(
      (snapshot) => `
      <article class="snapshot-card">
        <h3>${escapeHtml(snapshot.window.toUpperCase())} snapshot</h3>
        <p>${escapeHtml(snapshot.reportDate)} in ${escapeHtml(snapshot.timezone)}</p>
        <p>${escapeHtml(String(snapshot.totalSessions))} sessions, ${escapeHtml(String(snapshot.workflowCount))} confirmed workflows, ${escapeHtml(String(snapshot.emergingWorkflowCount))} emerging</p>
        <p class="muted">Generated ${escapeHtml(formatDateTime(snapshot.generatedAt))}</p>
      </article>
    `,
    )
    .join("");
}
