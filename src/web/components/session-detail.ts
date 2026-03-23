import { escapeHtml, formatDateTime } from "../lib/dom";
import { fetchSessionDetail } from "../lib/api";
import { state } from "../lib/state";

export async function refreshSessionDetail(container: HTMLElement): Promise<void> {
  if (!state.selectedSessionId) {
    container.textContent = "Select a session to inspect the ordered steps.";
    container.className = "session-detail empty-detail";
    return;
  }

  const session = await fetchSessionDetail(state.selectedSessionId);
  const steps = (session.steps || [])
    .map((step) => {
      const target = step.target ? ` -> ${step.target}` : "";
      const context = [step.domain, step.titlePattern].filter(Boolean).join(" | ");

      return `
      <article class="step-card">
        <p><strong>${escapeHtml(String(step.order))}. ${escapeHtml(step.actionName || step.action)}</strong></p>
        <p class="step-meta">${escapeHtml(formatDateTime(step.timestamp))} | ${escapeHtml(step.application)}${target ? " | " + escapeHtml(target) : ""}</p>
        ${context ? `<p class="step-meta">${escapeHtml(context)}</p>` : ""}
      </article>
    `;
    })
    .join("");

  container.className = "session-detail";
  container.innerHTML = `
    <div>
      <p class="panel-label">Session</p>
      <h3>${escapeHtml(session.primaryApplication)}</h3>
      <p class="muted">${escapeHtml(formatDateTime(session.startTime))} to ${escapeHtml(formatDateTime(session.endTime))}</p>
      <p class="muted">Boundary: ${escapeHtml(session.sessionBoundaryReason)} | ${escapeHtml(String((session.steps || []).length))} steps</p>
      <div class="step-list">${steps || '<div class="empty-state">No steps in this session.</div>'}</div>
    </div>
  `;
}
