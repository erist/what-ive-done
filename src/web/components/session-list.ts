import { escapeHtml, formatDuration, formatDateTime } from "../lib/dom";
import { state } from "../lib/state";
import type { SessionSummary } from "../lib/types";

export function renderSessionList(
  sessions: SessionSummary[],
  sessionListEl: HTMLElement,
  sessionDetailEl: HTMLElement,
  onSelect: (sessionId: string) => void,
): void {
  if (!sessions || sessions.length === 0) {
    state.selectedSessionId = null;
    sessionListEl.innerHTML =
      '<div class="empty-state">No sessions detected for this window yet.</div>';
    sessionDetailEl.textContent = "Select a session to inspect the ordered steps.";
    sessionDetailEl.className = "session-detail empty-detail";
    return;
  }

  if (!state.selectedSessionId || !sessions.some((s) => s.id === state.selectedSessionId)) {
    state.selectedSessionId = sessions[0]!.id;
  }

  sessionListEl.innerHTML = sessions
    .map((session) => {
      const isActive = session.id === state.selectedSessionId;
      return `
      <button class="session-button ${isActive ? "active" : ""}" type="button" data-session-id="${escapeHtml(session.id)}">
        <strong>${escapeHtml(session.primaryApplication)}</strong>
        <span class="session-meta">
          <span>${escapeHtml(session.primaryDomain || "No domain")}</span>
          <span>${escapeHtml(formatDuration(session.durationSeconds))}</span>
          <span>${escapeHtml(String(session.stepCount))} steps</span>
        </span>
        <span class="muted">${escapeHtml(formatDateTime(session.startTime))}</span>
      </button>
    `;
    })
    .join("");

  for (const button of sessionListEl.querySelectorAll("[data-session-id]")) {
    button.addEventListener("click", () => {
      const id = (button as HTMLElement).getAttribute("data-session-id");
      if (id) {
        state.selectedSessionId = id;
        renderSessionList(sessions, sessionListEl, sessionDetailEl, onSelect);
        onSelect(id);
      }
    });
  }
}
