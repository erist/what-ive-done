import { buildQueryString } from "./state";
import type {
  DashboardData,
  AnalysisStatus,
  AnalysisResults,
  SessionDetail,
  WorkflowSummary,
} from "./types";

let viewerActionToken = "";

export function initViewerActionToken(): void {
  const meta = document.querySelector('meta[name="wid-viewer-action-token"]');
  viewerActionToken = meta ? meta.getAttribute("content") || "" : "";
}

function buildViewerActionHeaders(): Record<string, string> {
  return viewerActionToken
    ? { "X-What-Ive-Done-Viewer-Action-Token": viewerActionToken }
    : {};
}

export async function fetchDashboard(): Promise<DashboardData> {
  const response = await fetch(`/api/viewer/dashboard?${buildQueryString()}`);
  if (!response.ok) {
    throw new Error("Failed to load local viewer data.");
  }
  return response.json();
}

export async function fetchAnalysisStatus(): Promise<AnalysisStatus> {
  const response = await fetch(`/api/viewer/analysis/status?${buildQueryString()}`);
  if (!response.ok) {
    throw new Error("Failed to load analysis status.");
  }
  return response.json();
}

export async function fetchAnalysisResults(): Promise<AnalysisResults> {
  const response = await fetch("/api/viewer/analysis/results");
  if (!response.ok) {
    throw new Error("Failed to load analysis results.");
  }
  return response.json();
}

export async function submitAnalysisRun(
  applyNames: boolean,
  includeShortForm: boolean,
): Promise<void> {
  const response = await fetch(`/api/viewer/analysis/runs?${buildQueryString()}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...buildViewerActionHeaders(),
    },
    body: JSON.stringify({ applyNames, includeShortForm }),
  });

  if (!response.ok) {
    const errorPayload = await response.json().catch(() => null);
    throw new Error(
      errorPayload && errorPayload.message
        ? errorPayload.message
        : "Failed to start viewer analysis.",
    );
  }
}

export async function fetchSessionDetail(sessionId: string): Promise<SessionDetail> {
  const response = await fetch(
    `/api/viewer/sessions/${encodeURIComponent(sessionId)}?${buildQueryString()}`,
  );
  if (!response.ok) {
    throw new Error("Failed to load session detail.");
  }
  return response.json();
}

export async function fetchWorkflowDetail(workflowId: string): Promise<WorkflowSummary> {
  const response = await fetch(
    `/api/viewer/workflows/${encodeURIComponent(workflowId)}?${buildQueryString()}`,
  );
  if (!response.ok) {
    throw new Error("Failed to load workflow detail.");
  }
  return response.json();
}

export async function submitWorkflowFeedback(
  workflowId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const response = await fetch(
    `/api/viewer/workflows/${encodeURIComponent(workflowId)}?${buildQueryString()}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...buildViewerActionHeaders(),
      },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    const errorPayload = await response.json().catch(() => null);
    throw new Error(
      errorPayload && errorPayload.message
        ? errorPayload.message
        : "Failed to save workflow feedback.",
    );
  }
}
