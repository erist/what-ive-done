import { escapeHtml, formatDuration } from "../lib/dom";
import type { WorkflowSummary, EmergingWorkflow } from "../lib/types";

export function renderWorkflowTable(
  container: HTMLElement,
  workflows: WorkflowSummary[] | undefined,
  emptyMessage: string,
): void {
  if (!workflows || workflows.length === 0) {
    container.innerHTML = `<div class="empty-state">${escapeHtml(emptyMessage)}</div>`;
    return;
  }

  const rows = workflows
    .map((workflow) => {
      const previewSteps = workflow.representativeSteps.slice(0, 5);
      const remainingStepCount = Math.max(0, workflow.representativeSteps.length - previewSteps.length);

      return `
      <tr>
        <td>
          <strong>${escapeHtml(workflow.workflowName)}</strong>
          <div class="workflow-chip-row"><span class="workflow-chip subtle">${escapeHtml(
            workflow.detectionMode === "short_form" ? "Short form" : "Standard",
          )}</span></div>
          <div class="step-preview">
            ${previewSteps.map((step) => `<span class="step-pill">${escapeHtml(step)}</span>`).join("")}
            ${remainingStepCount > 0 ? `<span class="step-pill more">+${escapeHtml(String(remainingStepCount))} more</span>` : ""}
          </div>
        </td>
        <td>${escapeHtml(String(workflow.frequency))}</td>
        <td>${escapeHtml(formatDuration(workflow.averageDurationSeconds))}</td>
        <td>${escapeHtml(formatDuration(workflow.totalDurationSeconds))}</td>
        <td>${escapeHtml(String(workflow.confidenceScore))}</td>
        <td>${escapeHtml(workflow.recommendedApproach)}</td>
      </tr>
    `;
    })
    .join("");

  container.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Workflow</th>
          <th>Frequency</th>
          <th>Avg Duration</th>
          <th>Total Time</th>
          <th>Confidence</th>
          <th>Recommendation</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

export function renderEmergingWorkflowList(
  container: HTMLElement,
  workflows: EmergingWorkflow[] | undefined,
  emptyMessage: string,
): void {
  if (!workflows || workflows.length === 0) {
    container.innerHTML = `<div class="empty-state">${escapeHtml(emptyMessage)}</div>`;
    return;
  }

  container.innerHTML = `
    <div class="emerging-grid">
      ${workflows
        .map((workflow) => {
          const previewSteps = workflow.representativeSteps.slice(0, 4);
          const remainingCount = Math.max(0, workflow.representativeSteps.length - previewSteps.length);

          return `
          <details class="emerging-card">
            <summary class="emerging-summary">
              <div class="emerging-summary-top">
                <div>
                  <h3>${escapeHtml(workflow.workflowName)}</h3>
                  <div class="emerging-meta">
                    <span class="emerging-stat">${escapeHtml(String(workflow.frequency))} repeat</span>
                    <span class="emerging-stat">avg ${escapeHtml(formatDuration(workflow.averageDurationSeconds))}</span>
                    <span class="emerging-stat">total ${escapeHtml(formatDuration(workflow.totalDurationSeconds))}</span>
                    <span class="emerging-stat">${escapeHtml(workflow.confidence)}</span>
                  </div>
                </div>
                <span class="emerging-toggle">Show steps</span>
              </div>
              <div class="emerging-preview">
                ${previewSteps.map((step) => `<span class="step-pill">${escapeHtml(step)}</span>`).join("")}
                ${remainingCount > 0 ? `<span class="step-pill more">+${escapeHtml(String(remainingCount))} more</span>` : ""}
              </div>
            </summary>
            <div class="emerging-body">
              <p class="emerging-body-copy">
                This pattern is still provisional. It becomes a confirmed workflow after more repeated sessions.
              </p>
              <div class="emerging-step-list">
                ${workflow.representativeSteps
                  .map(
                    (step, index) => `
                    <div class="emerging-step">
                      <span class="emerging-step-index">${escapeHtml(String(index + 1))}</span>
                      <div class="emerging-step-card">
                        <p>${escapeHtml(step)}</p>
                      </div>
                    </div>
                  `,
                  )
                  .join("")}
              </div>
            </div>
          </details>
        `;
        })
        .join("")}
    </div>
  `;
}
