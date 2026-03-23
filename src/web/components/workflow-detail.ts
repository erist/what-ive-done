import { escapeHtml, formatDuration, fromBooleanChoice } from "../lib/dom";
import { state } from "../lib/state";
import { submitWorkflowFeedback as apiSubmitFeedback } from "../lib/api";
import type { WorkflowSummary, AutomationHint } from "../lib/types";

export function buildWorkflowStatusChips(workflow: WorkflowSummary): string {
  const chips: string[] = [];

  if (workflow.userLabeled) {
    chips.push('<span class="workflow-chip">Labeled</span>');
  }
  if (workflow.excluded) {
    chips.push('<span class="workflow-chip warn">Excluded</span>');
  }
  if (workflow.hidden) {
    chips.push('<span class="workflow-chip hidden-state">Hidden</span>');
  }
  if (workflow.approvedAutomationCandidate) {
    chips.push('<span class="workflow-chip">Approved</span>');
  }

  return chips.join("");
}

function renderAutomationHints(hints: AutomationHint[] | undefined): string {
  if (!hints || hints.length === 0) {
    return '<p class="muted">No automation hints generated yet.</p>';
  }

  return `
    <div class="hint-grid">
      ${hints
        .map(
          (hint) => `
          <article class="hint-card">
            <h4>${escapeHtml(hint.suggestedApproach)}</h4>
            <p>${escapeHtml(hint.whyThisFits)}</p>
            <div class="workflow-chip-row">
              <span class="workflow-chip">${escapeHtml(hint.estimatedDifficulty)} difficulty</span>
              <span class="workflow-chip subtle">${escapeHtml(hint.expectedTimeSavings)}</span>
            </div>
            <ul>
              ${(hint.prerequisites || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
            </ul>
          </article>
        `,
        )
        .join("")}
    </div>
  `;
}

function setWorkflowMessage(message: string): void {
  state.workflowActionMessage = message || "";
  const element = document.getElementById("workflow-feedback-message");
  if (element) {
    element.textContent = state.workflowActionMessage;
  }
}

export function renderWorkflowDetail(
  workflow: WorkflowSummary,
  container: HTMLElement,
  onRefreshDashboard: () => Promise<void>,
): void {
  container.className = "workflow-detail";

  const suitabilityClass =
    workflow.automationSuitability === "high" ? "accent" :
    workflow.automationSuitability === "low" ? "warn" : "subtle";

  container.innerHTML = `
    <div class="workflow-detail-grid">
      <!-- Header: name + key decision -->
      <div class="detail-header">
        <div class="detail-title-area">
          <h3 class="detail-title">${escapeHtml(workflow.workflowName)}</h3>
          <p class="workflow-helper">${escapeHtml(workflow.businessPurpose || workflow.recommendedApproach)}</p>
          <div class="workflow-chip-row">
            ${buildWorkflowStatusChips(workflow)}
            <span class="workflow-chip ${suitabilityClass}">${escapeHtml(workflow.automationSuitability)} automation fit</span>
            <span class="workflow-chip subtle">${escapeHtml(workflow.detectionMode === "short_form" ? "Short form" : "Standard")}</span>
          </div>
        </div>

        <!-- Primary decision: Worth automating? -->
        <div class="decision-area">
          <p class="decision-label">Worth automating?</p>
          <div class="decision-buttons">
            <button class="decision-btn decision-yes ${workflow.approvedAutomationCandidate === true ? "selected" : ""}" type="button" data-decision="yes" title="Approve for automation">Yes</button>
            <button class="decision-btn decision-no ${workflow.approvedAutomationCandidate === false ? "selected" : ""}" type="button" data-decision="no" title="Not worth automating">No</button>
            <button class="decision-btn decision-skip" type="button" data-decision="skip" title="Skip to next (N)">Skip</button>
          </div>
        </div>
      </div>

      <!-- Stats row -->
      <div class="detail-stat-grid">
        <article class="detail-stat">
          <p class="panel-label">Frequency</p>
          <p class="stat-value">${escapeHtml(String(workflow.frequency))}x</p>
        </article>
        <article class="detail-stat">
          <p class="panel-label">Avg Duration</p>
          <p class="stat-value">${escapeHtml(formatDuration(workflow.averageDurationSeconds))}</p>
        </article>
        <article class="detail-stat">
          <p class="panel-label">Total Time</p>
          <p class="stat-value">${escapeHtml(formatDuration(workflow.totalDurationSeconds))}</p>
        </article>
        <article class="detail-stat">
          <p class="panel-label">Confidence</p>
          <p class="stat-value">${escapeHtml(String(workflow.confidenceScore))}</p>
        </article>
      </div>

      <!-- Automation hints ABOVE form (the info you need to decide) -->
      <div>
        <p class="panel-label">Automation Guidance</p>
        ${renderAutomationHints(workflow.automationHints)}
      </div>

      <!-- Steps -->
      <div>
        <p class="panel-label">Representative Steps</p>
        <div class="step-preview">
          ${workflow.representativeSteps.map((step) => `<span class="step-pill">${escapeHtml(step)}</span>`).join("")}
        </div>
      </div>

      <!-- Advanced form (collapsed by default for unlabeled, open for labeled) -->
      <details class="advanced-review" ${workflow.userLabeled ? "open" : ""}>
        <summary class="advanced-trigger">
          <span class="panel-label">Advanced Review Options</span>
          <span class="collapse-icon"></span>
        </summary>
        <form id="workflow-review-form" class="workflow-form">
          <div class="workflow-form-grid">
            <div class="field-stack">
              <label for="workflow-name-input">Display Name</label>
              <input id="workflow-name-input" name="name" type="text" value="${escapeHtml(workflow.workflowName)}" />
            </div>
            <div class="field-stack">
              <label for="workflow-purpose-input">Business Purpose</label>
              <textarea id="workflow-purpose-input" name="purpose">${escapeHtml(workflow.businessPurpose || "")}</textarea>
            </div>
            <div class="field-stack">
              <label for="workflow-difficulty-select">Difficulty</label>
              <select id="workflow-difficulty-select" name="difficulty">
                <option value="" ${!workflow.automationDifficulty ? "selected" : ""}>Auto</option>
                <option value="low" ${workflow.automationDifficulty === "low" ? "selected" : ""}>Low</option>
                <option value="medium" ${workflow.automationDifficulty === "medium" ? "selected" : ""}>Medium</option>
                <option value="high" ${workflow.automationDifficulty === "high" ? "selected" : ""}>High</option>
              </select>
            </div>
            <div class="field-stack">
              <label for="workflow-repetitive-select">Repetitive</label>
              <select id="workflow-repetitive-select" name="repetitive">
                <option value="" ${workflow.repetitive === undefined ? "selected" : ""}>Auto</option>
                <option value="true" ${workflow.repetitive === true ? "selected" : ""}>Yes</option>
                <option value="false" ${workflow.repetitive === false ? "selected" : ""}>No</option>
              </select>
            </div>
          </div>
          <div class="feedback-actions">
            <button id="workflow-save-button" type="submit">Save Details</button>
            <button id="workflow-exclude-button" class="button-secondary" type="button">${workflow.excluded ? "Include" : "Exclude"}</button>
            <button id="workflow-hide-button" class="${workflow.hidden ? "button-secondary" : "button-subtle-danger"}" type="button">${workflow.hidden ? "Show" : "Hide"}</button>
          </div>
        </form>
      </details>

      <p id="workflow-feedback-message" class="feedback-message">${escapeHtml(state.workflowActionMessage)}</p>
    </div>
  `;

  // --- Event bindings ---

  async function submitFeedback(payload: Record<string, unknown>, successMessage: string) {
    if (!state.selectedWorkflowId) return;
    setWorkflowMessage("Saving...");

    try {
      await apiSubmitFeedback(state.selectedWorkflowId, payload);
      state.workflowActionMessage = successMessage;
      await onRefreshDashboard();
    } catch (error) {
      setWorkflowMessage(error instanceof Error ? error.message : "Unknown error");
    }
  }

  // Primary decision buttons
  for (const btn of container.querySelectorAll("[data-decision]")) {
    btn.addEventListener("click", () => {
      const decision = (btn as HTMLElement).getAttribute("data-decision");
      if (decision === "yes") {
        void submitFeedback(
          { approvedAutomationCandidate: true, automationCandidate: true },
          "Approved for automation.",
        );
      } else if (decision === "no") {
        void submitFeedback(
          { approvedAutomationCandidate: false, automationCandidate: false },
          "Marked as not worth automating.",
        );
      } else if (decision === "skip") {
        // Jump to next unreviewed
        const nextBtn = document.getElementById("next-unreviewed-button");
        if (nextBtn) nextBtn.click();
      }
    });
  }

  // Advanced form
  const form = document.getElementById("workflow-review-form") as HTMLFormElement | null;
  const excludeButton = document.getElementById("workflow-exclude-button");
  const hideButton = document.getElementById("workflow-hide-button");

  if (form) {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const formData = new FormData(form);
      const name = String(formData.get("name") || "").trim();
      const purpose = String(formData.get("purpose") || "").trim();

      void submitFeedback(
        {
          name: name || undefined,
          purpose: purpose || undefined,
          repetitive: fromBooleanChoice(String(formData.get("repetitive") || "")),
          difficulty: String(formData.get("difficulty") || "") || undefined,
        },
        "Details saved.",
      );
    });
  }

  if (excludeButton) {
    excludeButton.addEventListener("click", () => {
      void submitFeedback(
        { excluded: !workflow.excluded },
        workflow.excluded ? "Included." : "Excluded.",
      );
    });
  }

  if (hideButton) {
    hideButton.addEventListener("click", () => {
      void submitFeedback(
        { hidden: !workflow.hidden },
        workflow.hidden ? "Visible." : "Hidden.",
      );
    });
  }
}
