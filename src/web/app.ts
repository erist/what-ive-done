import { state, initializeStateFromUrl, syncUrl, initializeTheme, toggleTheme } from "./lib/state";
import { initViewerActionToken, fetchDashboard, fetchAnalysisStatus, fetchAnalysisResults, fetchWorkflowDetail } from "./lib/api";
import { escapeHtml, formatDuration } from "./lib/dom";
import type { DashboardData, ViewName } from "./lib/types";

// Components
import { renderStatus } from "./components/status-bar";
import { renderHighlights } from "./components/highlights";
import { renderSnapshotList } from "./components/snapshots";
import { renderComparisonView } from "./components/comparison";
import { renderWorkflowTable, renderEmergingWorkflowList } from "./components/workflow-table";
import { renderFeedbackWorkflowList } from "./components/workflow-list";
import { renderWorkflowDetail } from "./components/workflow-detail";
import { renderSessionList } from "./components/session-list";
import { refreshSessionDetail } from "./components/session-detail";
import {
  renderAnalysisSurface,
  renderAnalysisReadyList,
  renderAnalysisResults,
} from "./components/analysis-surface";

// --- DOM Elements ---

const elements = {
  windowSelect: document.getElementById("window-select") as HTMLSelectElement,
  dateInput: document.getElementById("date-input") as HTMLInputElement,
  refreshButton: document.getElementById("refresh-button") as HTMLButtonElement,
  themeToggle: document.getElementById("theme-toggle") as HTMLButtonElement,
  nextUnreviewedButton: document.getElementById("next-unreviewed-button") as HTMLButtonElement,
  errorBanner: document.getElementById("error-banner")!,
  statusIndicator: document.getElementById("status-indicator")!,
  agentStatusText: document.getElementById("agent-status-text")!,
  agentStatus: document.getElementById("agent-status")!,
  serverStatus: document.getElementById("server-status")!,
  collectorStatus: document.getElementById("collector-status")!,
  generatedAt: document.getElementById("generated-at")!,
  summaryStrip: document.getElementById("summary-strip")!,
  reviewProgress: document.getElementById("review-progress")!,
  highlightsGrid: document.getElementById("highlights-grid")!,
  snapshotList: document.getElementById("snapshot-list")!,
  comparisonView: document.getElementById("comparison-view")!,
  feedbackWorkflowList: document.getElementById("feedback-workflow-list")!,
  workflowDetail: document.getElementById("workflow-detail")!,
  workflowList: document.getElementById("workflow-list")!,
  emergingWorkflowList: document.getElementById("emerging-workflow-list")!,
  sessionList: document.getElementById("session-list")!,
  sessionDetail: document.getElementById("session-detail")!,
  analysisSurface: document.getElementById("analysis-surface")!,
  analysisReadyList: document.getElementById("analysis-ready-list")!,
  analysisResultsList: document.getElementById("analysis-results-list")!,
  viewButtons: Array.from(document.querySelectorAll("[data-view-target]")) as HTMLButtonElement[],
  viewPanels: Array.from(document.querySelectorAll("[data-view-panel]")) as HTMLElement[],
};

// --- Auto-refresh pause on interaction ---

let lastInteractionTime = 0;
const INTERACTION_PAUSE_MS = 60_000;

function markInteraction(): void {
  lastInteractionTime = Date.now();
}

function isUserActive(): boolean {
  return Date.now() - lastInteractionTime < INTERACTION_PAUSE_MS;
}

// --- Error handling ---

function setError(message: string): void {
  if (!message) {
    elements.errorBanner.textContent = "";
    elements.errorBanner.classList.add("hidden");
    return;
  }
  elements.errorBanner.textContent = message;
  elements.errorBanner.classList.remove("hidden");
}

// --- View management ---

function syncView(): void {
  for (const button of elements.viewButtons) {
    const viewTarget = button.getAttribute("data-view-target");
    const isActive = viewTarget === state.view;
    button.classList.toggle("active", isActive);
    button.setAttribute("aria-pressed", isActive ? "true" : "false");
  }

  for (const panel of elements.viewPanels) {
    const panelView = panel.getAttribute("data-view-panel");
    panel.classList.toggle("hidden", panelView !== state.view);
  }
}

// --- Summary strip (compact header metrics) ---

function renderSummaryStrip(data: DashboardData): void {
  const reviewed = data.reviewableWorkflows.filter((w) => w.userLabeled).length;
  const total = data.reviewableWorkflows.length;
  const approved = data.reviewableWorkflows.filter((w) => w.approvedAutomationCandidate).length;

  elements.summaryStrip.innerHTML = `
    <span class="strip-item"><strong>${escapeHtml(String(data.report.totalSessions))}</strong> sessions</span>
    <span class="strip-divider"></span>
    <span class="strip-item"><strong>${escapeHtml(formatDuration(data.report.totalTrackedDurationSeconds))}</strong> tracked</span>
    <span class="strip-divider"></span>
    <span class="strip-item"><strong>${escapeHtml(String(total))}</strong> workflows</span>
    <span class="strip-divider"></span>
    <span class="strip-item accent"><strong>${escapeHtml(String(approved))}</strong> approved</span>
  `;
}

// --- Review progress bar ---

function renderReviewProgress(data: DashboardData): void {
  const workflows = data.reviewableWorkflows;
  const total = workflows.length;
  if (total === 0) {
    elements.reviewProgress.innerHTML = '<span class="progress-text muted">No workflows to review</span>';
    return;
  }

  const reviewed = workflows.filter((w) => w.userLabeled).length;
  const approved = workflows.filter((w) => w.approvedAutomationCandidate).length;
  const pct = Math.round((reviewed / total) * 100);

  elements.reviewProgress.innerHTML = `
    <div class="progress-bar-container">
      <div class="progress-bar-fill" style="width: ${pct}%"></div>
    </div>
    <span class="progress-text"><strong>${escapeHtml(String(reviewed))}</strong> of <strong>${escapeHtml(String(total))}</strong> reviewed &middot; <strong>${escapeHtml(String(approved))}</strong> approved for automation</span>
  `;
}

// --- Status indicator (compact) ---

function renderStatusIndicator(data: DashboardData): void {
  const status = data.agentHealth.status;
  elements.statusIndicator.className = `status-indicator status-${status}`;
  elements.agentStatusText.textContent = status;
}

// --- Analysis polling ---

function clearAnalysisPoll(): void {
  if (state.analysisPollTimer) {
    window.clearTimeout(state.analysisPollTimer);
    state.analysisPollTimer = null;
  }
}

function scheduleAnalysisPoll(): void {
  clearAnalysisPoll();
  state.analysisPollTimer = window.setTimeout(() => {
    void refreshAnalysisPanel();
  }, 2000);
}

// --- Analysis panel ---

async function refreshAnalysisPanel(dashboardData: DashboardData | null = state.latestDashboard): Promise<void> {
  if (!dashboardData || state.analysisRefreshing) {
    return;
  }

  state.analysisRefreshing = true;

  try {
    const [statusData, resultsData] = await Promise.all([
      fetchAnalysisStatus(),
      fetchAnalysisResults(),
    ]);

    const latestRun = resultsData.latestRun || statusData.latestRun || null;
    const quickWins =
      dashboardData.report.summary && dashboardData.report.summary.quickWinAutomationCandidates
        ? dashboardData.report.summary.quickWinAutomationCandidates
        : [];
    const analysisReadyWorkflows = (quickWins.length > 0
      ? dashboardData.report.workflows.filter((w) =>
          quickWins.some((qw) => qw.workflowName === w.workflowName),
        )
      : dashboardData.report.workflows
    ).filter(
      (workflow) => state.analysisIncludeShortForm || workflow.detectionMode !== "short_form",
    );

    if (
      !statusData.running &&
      latestRun &&
      latestRun.status === "completed" &&
      state.analysisActionMessage === "Analysis run started."
    ) {
      state.analysisActionMessage = "Analysis run completed.";
    }

    if (
      !statusData.running &&
      latestRun &&
      latestRun.status === "failed" &&
      state.analysisActionMessage === "Analysis run started."
    ) {
      state.analysisActionMessage =
        latestRun.summary && latestRun.summary.error
          ? latestRun.summary.error
          : "Analysis run failed.";
    }

    renderAnalysisReadyList(analysisReadyWorkflows, elements.analysisReadyList);
    renderAnalysisSurface(dashboardData, statusData, resultsData, elements.analysisSurface, refreshAnalysisPanel);
    renderAnalysisResults(resultsData.analyses, latestRun ?? undefined, elements.analysisResultsList);

    if (statusData.running || (statusData.latestRun && statusData.latestRun.status === "running")) {
      scheduleAnalysisPoll();
    } else {
      clearAnalysisPoll();
    }
  } catch (error) {
    clearAnalysisPoll();
    elements.analysisSurface.innerHTML = `<div class="empty-state">${escapeHtml(error instanceof Error ? error.message : "Unknown viewer analysis error")}</div>`;
    elements.analysisResultsList.innerHTML =
      '<div class="empty-state">Analysis results are unavailable right now.</div>';
  } finally {
    state.analysisRefreshing = false;
  }
}

// --- Workflow detail refresh ---

async function refreshWorkflowDetailPanel(): Promise<void> {
  if (!state.selectedWorkflowId) {
    elements.workflowDetail.textContent =
      "Select a workflow to review its automation potential and label it.";
    elements.workflowDetail.className = "workflow-detail empty-detail";
    return;
  }

  const workflow = await fetchWorkflowDetail(state.selectedWorkflowId);
  renderWorkflowDetail(workflow, elements.workflowDetail, refreshDashboard);
}

// --- Next unreviewed ---

function jumpToNextUnreviewed(): void {
  if (!state.latestDashboard) return;
  const workflows = state.latestDashboard.reviewableWorkflows;
  const next = workflows.find((w) => !w.userLabeled && w.id !== state.selectedWorkflowId);
  if (next) {
    state.selectedWorkflowId = next.id;
    state.workflowActionMessage = "";
    renderFeedbackWorkflowList(
      workflows,
      elements.feedbackWorkflowList,
      elements.workflowDetail,
      () => void refreshWorkflowDetailPanel(),
    );
    void refreshWorkflowDetailPanel();
  }
}

// --- Main dashboard refresh ---

async function refreshDashboard(): Promise<void> {
  setError("");
  elements.refreshButton.disabled = true;

  try {
    syncUrl();
    const data = await fetchDashboard();
    state.latestDashboard = data;

    if (!state.date) {
      state.date = data.timeWindow.reportDate;
      elements.dateInput.value = state.date;
      syncUrl();
    }

    // Compact header elements
    renderStatusIndicator(data);
    renderSummaryStrip(data);
    renderReviewProgress(data);

    // Insights tab
    renderStatus(data.agentHealth, data.generatedAt, {
      agentStatus: elements.agentStatus,
      serverStatus: elements.serverStatus,
      collectorStatus: elements.collectorStatus,
      generatedAt: elements.generatedAt,
    });
    renderHighlights(data.report.summary, elements.highlightsGrid);
    renderSnapshotList(data.latestSnapshots, elements.snapshotList);
    renderComparisonView(data.comparison, elements.comparisonView);

    // Review tab
    renderFeedbackWorkflowList(
      data.reviewableWorkflows,
      elements.feedbackWorkflowList,
      elements.workflowDetail,
      () => void refreshWorkflowDetailPanel(),
    );
    renderWorkflowTable(
      elements.workflowList,
      data.report.workflows,
      "No confirmed workflows yet. Keep collecting data or switch to the week window.",
    );
    renderEmergingWorkflowList(
      elements.emergingWorkflowList,
      data.report.emergingWorkflows,
      "No emerging workflows yet for this window.",
    );

    // Analysis tab
    await refreshAnalysisPanel(data);

    // Detail panels
    await refreshWorkflowDetailPanel();
    renderSessionList(data.sessionSummaries, elements.sessionList, elements.sessionDetail, () =>
      void refreshSessionDetail(elements.sessionDetail),
    );
    await refreshSessionDetail(elements.sessionDetail);
  } catch (error) {
    setError(error instanceof Error ? error.message : "Unknown viewer error");
  } finally {
    elements.refreshButton.disabled = false;
  }
}

// --- Auto-refresh (pauses during interaction) ---

function scheduleRefresh(): void {
  if (state.refreshTimer) {
    window.clearInterval(state.refreshTimer);
  }
  state.refreshTimer = window.setInterval(() => {
    if (!isUserActive()) {
      void refreshDashboard();
    }
  }, 30000);
}

// --- Keyboard navigation ---

function handleKeyboard(event: KeyboardEvent): void {
  if (state.view !== "review" || !state.latestDashboard) return;
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement) return;

  const workflows = state.latestDashboard.reviewableWorkflows;
  if (workflows.length === 0) return;

  const currentIndex = workflows.findIndex((w) => w.id === state.selectedWorkflowId);

  if (event.key === "ArrowDown" || event.key === "j") {
    event.preventDefault();
    const nextIndex = Math.min(currentIndex + 1, workflows.length - 1);
    state.selectedWorkflowId = workflows[nextIndex]!.id;
    state.workflowActionMessage = "";
    renderFeedbackWorkflowList(workflows, elements.feedbackWorkflowList, elements.workflowDetail, () => void refreshWorkflowDetailPanel());
    void refreshWorkflowDetailPanel();
  } else if (event.key === "ArrowUp" || event.key === "k") {
    event.preventDefault();
    const prevIndex = Math.max(currentIndex - 1, 0);
    state.selectedWorkflowId = workflows[prevIndex]!.id;
    state.workflowActionMessage = "";
    renderFeedbackWorkflowList(workflows, elements.feedbackWorkflowList, elements.workflowDetail, () => void refreshWorkflowDetailPanel());
    void refreshWorkflowDetailPanel();
  } else if (event.key === "n") {
    event.preventDefault();
    jumpToNextUnreviewed();
  }
}

// --- Event bindings ---

function bindEvents(): void {
  for (const button of elements.viewButtons) {
    button.addEventListener("click", () => {
      const nextView = button.getAttribute("data-view-target");
      if (nextView !== "insights" && nextView !== "review" && nextView !== "analysis") {
        return;
      }
      state.view = nextView as ViewName;
      syncView();
      syncUrl();

      if (state.view === "analysis" && state.latestDashboard) {
        void refreshAnalysisPanel();
      }
    });
  }

  elements.windowSelect.addEventListener("change", () => {
    state.window = elements.windowSelect.value as "day" | "week" | "all";
    void refreshDashboard();
  });

  elements.dateInput.addEventListener("change", () => {
    state.date = elements.dateInput.value;
    void refreshDashboard();
  });

  elements.refreshButton.addEventListener("click", () => {
    void refreshDashboard();
  });

  elements.themeToggle.addEventListener("click", () => {
    toggleTheme();
  });

  elements.nextUnreviewedButton.addEventListener("click", () => {
    jumpToNextUnreviewed();
  });

  // Pause auto-refresh during interaction
  document.addEventListener("click", markInteraction);
  document.addEventListener("keydown", markInteraction);
  document.addEventListener("focus", markInteraction, true);

  // Keyboard navigation
  document.addEventListener("keydown", handleKeyboard);
}

// --- Init ---

initializeTheme();
initViewerActionToken();
initializeStateFromUrl();
elements.windowSelect.value = state.window;
elements.dateInput.value = state.date;
syncView();
bindEvents();
scheduleRefresh();
void refreshDashboard();
