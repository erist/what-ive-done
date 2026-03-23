import { escapeHtml, formatDuration } from "../lib/dom";
import { state } from "../lib/state";
import type { WorkflowSummary } from "../lib/types";

function getReviewStateClass(workflow: WorkflowSummary): string {
  if (workflow.approvedAutomationCandidate) return "review-approved";
  if (workflow.userLabeled) return "review-labeled";
  if (workflow.excluded || workflow.hidden) return "review-excluded";
  return "review-pending";
}

function getReviewStateIcon(workflow: WorkflowSummary): string {
  if (workflow.approvedAutomationCandidate) return "&#10003;"; // checkmark
  if (workflow.userLabeled) return "&#9679;"; // filled circle
  if (workflow.excluded || workflow.hidden) return "&#8212;"; // dash
  return ""; // empty
}

// Sort: unreviewed first, then by (frequency * totalDuration) descending
function sortForReview(workflows: WorkflowSummary[]): WorkflowSummary[] {
  return [...workflows].sort((a, b) => {
    const aReviewed = a.userLabeled ? 1 : 0;
    const bReviewed = b.userLabeled ? 1 : 0;
    if (aReviewed !== bReviewed) return aReviewed - bReviewed;
    const aScore = a.frequency * a.totalDurationSeconds;
    const bScore = b.frequency * b.totalDurationSeconds;
    return bScore - aScore;
  });
}

export function renderFeedbackWorkflowList(
  workflows: WorkflowSummary[],
  feedbackListEl: HTMLElement,
  workflowDetailEl: HTMLElement,
  onSelect: (workflowId: string) => void,
): void {
  if (!workflows || workflows.length === 0) {
    state.selectedWorkflowId = null;
    feedbackListEl.innerHTML =
      '<div class="empty-state">No workflows to review yet.<br>Run <code>wid collect</code> to start gathering data.</div>';
    workflowDetailEl.textContent =
      "Select a workflow to review its automation potential and label it.";
    workflowDetailEl.className = "workflow-detail empty-detail";
    return;
  }

  const sorted = sortForReview(workflows);

  if (!state.selectedWorkflowId || !sorted.some((w) => w.id === state.selectedWorkflowId)) {
    state.selectedWorkflowId = sorted[0]!.id;
  }

  feedbackListEl.innerHTML = sorted
    .map((workflow) => {
      const isActive = workflow.id === state.selectedWorkflowId;
      const stateClass = getReviewStateClass(workflow);
      const icon = getReviewStateIcon(workflow);
      return `
      <button class="workflow-review-button ${isActive ? "active" : ""} ${stateClass}" type="button" data-workflow-id="${escapeHtml(workflow.id)}">
        <div class="workflow-review-row">
          <span class="review-indicator">${icon}</span>
          <div class="workflow-review-content">
            <strong>${escapeHtml(workflow.workflowName)}</strong>
            <span class="workflow-review-meta">
              ${escapeHtml(String(workflow.frequency))}x &middot; ${escapeHtml(formatDuration(workflow.totalDurationSeconds))}
            </span>
          </div>
        </div>
      </button>
    `;
    })
    .join("");

  for (const button of feedbackListEl.querySelectorAll("[data-workflow-id]")) {
    button.addEventListener("click", () => {
      const id = (button as HTMLElement).getAttribute("data-workflow-id");
      if (id) {
        state.selectedWorkflowId = id;
        state.workflowActionMessage = "";
        renderFeedbackWorkflowList(workflows, feedbackListEl, workflowDetailEl, onSelect);
        onSelect(id);
      }
    });
  }
}
