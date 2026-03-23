import { escapeHtml, formatDateTime, formatDuration } from "../lib/dom";
import { state, syncUrl } from "../lib/state";
import { submitAnalysisRun as apiSubmitAnalysis } from "../lib/api";
import type { DashboardData, AnalysisStatus, AnalysisResults, WorkflowSummary } from "../lib/types";

export function renderAnalysisReadyList(workflows: WorkflowSummary[], container: HTMLElement): void {
  if (!workflows || workflows.length === 0) {
    container.innerHTML =
      '<div class="empty-state">No confirmed workflows are ready for interpretation in this window yet.</div>';
    return;
  }

  container.innerHTML = workflows
    .slice(0, 6)
    .map(
      (workflow) => `
      <article class="analysis-ready-card">
        <div>
          <p class="panel-label">Analysis Candidate</p>
          <h3>${escapeHtml(workflow.workflowName)}</h3>
        </div>
        <div class="analysis-meta">
          <span class="workflow-chip subtle">${escapeHtml(
            workflow.detectionMode === "short_form" ? "short form" : "standard",
          )}</span>
          <span class="workflow-chip subtle">${escapeHtml(String(workflow.frequency))} repeats</span>
          <span class="workflow-chip subtle">${escapeHtml(formatDuration(workflow.totalDurationSeconds))} total</span>
          <span class="workflow-chip subtle">confidence ${escapeHtml(String(workflow.confidenceScore))}</span>
        </div>
        <div class="step-preview">
          ${(workflow.representativeSteps || [])
            .slice(0, 4)
            .map((step) => `<span class="step-pill">${escapeHtml(step)}</span>`)
            .join("")}
        </div>
        <p class="analysis-copy">${escapeHtml(workflow.recommendedApproach || "Pending automation guidance")}</p>
      </article>
    `,
    )
    .join("");
}

export function renderAnalysisResults(
  analyses: AnalysisResults["analyses"],
  latestRun: AnalysisResults["latestRun"],
  container: HTMLElement,
): void {
  if (!analyses || analyses.length === 0) {
    const emptyMessage =
      latestRun && latestRun.status === "failed"
        ? latestRun.summary && latestRun.summary.error
          ? latestRun.summary.error
          : "The last analysis run failed before it could store workflow interpretations."
        : "No stored analysis results yet. Start a manual run from this tab.";

    container.innerHTML = `<div class="empty-state">${escapeHtml(emptyMessage)}</div>`;
    return;
  }

  container.innerHTML = analyses
    .slice(0, 8)
    .map(
      (analysis) => `
      <article class="analysis-result-card">
        <div>
          <p class="panel-label">Workflow Interpretation</p>
          <h3>${escapeHtml(analysis.workflowName)}</h3>
        </div>
        <p class="analysis-result-summary">${escapeHtml(analysis.workflowSummary)}</p>
        <div class="analysis-meta">
          <span class="workflow-chip subtle">${escapeHtml(analysis.provider)}</span>
          <span class="workflow-chip subtle">${escapeHtml(analysis.model)}</span>
          <span class="workflow-chip">${escapeHtml(analysis.automationSuitability)} fit</span>
        </div>
        <p class="analysis-copy">${escapeHtml(analysis.recommendedApproach)}</p>
        <p class="analysis-result-summary">${escapeHtml(analysis.rationale)}</p>
      </article>
    `,
    )
    .join("");
}

export function renderAnalysisSurface(
  dashboardData: DashboardData,
  statusData: AnalysisStatus,
  resultsData: AnalysisResults,
  container: HTMLElement,
  onRefreshAnalysis: () => Promise<void>,
): void {
  const selectedProvider = (statusData.credentialStatus.providers || []).find((p) => p.selected);
  const currentModel =
    (statusData.credentialStatus.configuration && statusData.credentialStatus.configuration.model) ||
    (selectedProvider ? selectedProvider.defaultModel : "default");
  const credentialReady = selectedProvider
    ? selectedProvider.hasApiKey || selectedProvider.hasOAuthCredentials || selectedProvider.envApiKeyAvailable
    : false;
  const latestRun = statusData.latestRun || resultsData.latestRun || null;
  const latestResultCount = Array.isArray(resultsData.analyses)
    ? resultsData.analyses.length
    : statusData.latestResultCount || 0;
  const runDisabled = statusData.running || statusData.payloadCount === 0;
  const runButtonLabel = statusData.running
    ? "Running..."
    : statusData.payloadCount === 0
      ? "Nothing To Analyze"
      : "Run Analysis";
  const latestRunCopy = !latestRun
    ? "No manual analysis run has been started from the viewer yet."
    : latestRun.status === "running"
      ? "The local console has sent summarized workflow payloads and is waiting for the provider response."
      : latestRun.status === "failed"
        ? latestRun.summary && latestRun.summary.error
          ? latestRun.summary.error
          : "The latest analysis run failed."
        : "Stored interpretation results are available below and will stay visible after refresh.";
  const credentialCopy = !selectedProvider
    ? "No provider is selected in the saved CLI configuration."
    : credentialReady
      ? "Viewer analysis can use the same provider configuration that is already available to the CLI."
      : "The selected provider is missing credentials. Configure auth from the CLI before starting a viewer run.";

  container.innerHTML = `
    <article class="analysis-card accent">
      <div>
        <p class="panel-label">Run Manual Analysis</p>
        <h3>${escapeHtml(dashboardData.timeWindow.reportDate)}</h3>
      </div>
      <p class="analysis-copy">
        Send only summarized workflow payloads for the current ${escapeHtml(dashboardData.timeWindow.window)} window. Raw events, raw URLs, and window titles stay local.
      </p>
      <div class="analysis-meta">
        <span class="workflow-chip">${escapeHtml(String(statusData.workflowCount))} confirmed workflows</span>
        <span class="workflow-chip subtle">${escapeHtml(String(statusData.payloadCount))} summarized payloads</span>
        ${
          !statusData.includeShortForm && statusData.shortFormExcludedCount > 0
            ? `<span class="workflow-chip subtle">${escapeHtml(String(statusData.shortFormExcludedCount))} short-form excluded by default</span>`
            : statusData.includeShortForm
              ? '<span class="workflow-chip subtle">Short-form included</span>'
              : ""
        }
      </div>
      <div class="analysis-action-row">
        <button id="analysis-run-button" class="${runDisabled ? "button-secondary" : ""}" type="button" ${runDisabled ? "disabled" : ""}>${escapeHtml(runButtonLabel)}</button>
        <label class="analysis-toggle" for="analysis-apply-names">
          <input id="analysis-apply-names" type="checkbox" ${state.analysisApplyNames ? "checked" : ""} />
          <span>Apply suggested names</span>
        </label>
        <label class="analysis-toggle" for="analysis-include-short-form">
          <input id="analysis-include-short-form" type="checkbox" ${state.analysisIncludeShortForm ? "checked" : ""} />
          <span>Include short-form workflows</span>
        </label>
      </div>
      <p class="analysis-status-copy">${escapeHtml(state.analysisActionMessage || latestRunCopy)}</p>
    </article>
    <article class="analysis-card">
      <div>
        <p class="panel-label">Provider Status</p>
        <h3>${escapeHtml(selectedProvider ? selectedProvider.label : "Not configured")}</h3>
      </div>
      <p class="analysis-copy">${escapeHtml(credentialCopy)}</p>
      <div class="analysis-meta">
        <span class="workflow-chip subtle">${escapeHtml(currentModel)}</span>
        <span class="workflow-chip subtle">${escapeHtml(
          statusData.credentialStatus.configuration && statusData.credentialStatus.configuration.authMethod
            ? statusData.credentialStatus.configuration.authMethod
            : "unknown auth",
        )}</span>
        <span class="workflow-chip subtle">${escapeHtml(statusData.credentialStatus.backend || "unknown backend")}</span>
      </div>
      ${statusData.credentialStatus.warning ? `<p class="analysis-status-copy">${escapeHtml(statusData.credentialStatus.warning)}</p>` : ""}
    </article>
    <article class="analysis-card">
      <div>
        <p class="panel-label">Latest Run</p>
        <h3>${escapeHtml(latestRun ? latestRun.status : "idle")}</h3>
      </div>
      <p class="analysis-copy">${escapeHtml(latestRunCopy)}</p>
      <div class="analysis-meta">
        <span class="workflow-chip subtle">${escapeHtml(String(latestResultCount))} results</span>
        <span class="workflow-chip subtle">${escapeHtml(formatDateTime(latestRun ? latestRun.startedAt : undefined))} started</span>
        ${latestRun && latestRun.completedAt ? `<span class="workflow-chip subtle">${escapeHtml(formatDateTime(latestRun.completedAt))} finished</span>` : ""}
      </div>
    </article>
    <article class="analysis-note">
      <p>Only summarized workflow payloads leave the machine during manual analysis.</p>
      <div class="workflow-chip-row">
        <span class="workflow-chip subtle">No raw event dump</span>
        <span class="workflow-chip subtle">No raw URLs or window titles</span>
        <span class="workflow-chip subtle">No content fields</span>
      </div>
    </article>
  `;

  const applyNamesToggle = document.getElementById("analysis-apply-names") as HTMLInputElement | null;
  const includeShortFormToggle = document.getElementById("analysis-include-short-form") as HTMLInputElement | null;
  const runButton = document.getElementById("analysis-run-button");

  if (applyNamesToggle) {
    applyNamesToggle.addEventListener("change", () => {
      state.analysisApplyNames = Boolean(applyNamesToggle.checked);
    });
  }

  if (includeShortFormToggle) {
    includeShortFormToggle.addEventListener("change", () => {
      state.analysisIncludeShortForm = Boolean(includeShortFormToggle.checked);
      syncUrl();
      void onRefreshAnalysis();
    });
  }

  if (runButton) {
    runButton.addEventListener("click", () => {
      void (async () => {
        try {
          state.analysisActionMessage = "Starting analysis...";
          await onRefreshAnalysis();
          await apiSubmitAnalysis(state.analysisApplyNames, state.analysisIncludeShortForm);
          state.analysisActionMessage = "Analysis run started.";
          await onRefreshAnalysis();
        } catch (error) {
          state.analysisActionMessage =
            error instanceof Error ? error.message : "Unknown viewer analysis error";
          await onRefreshAnalysis();
        }
      })();
    });
  }
}
