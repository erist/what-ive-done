import { resolveConfiguredAnalyzeOptions } from "../config/workflow-analysis.js";
import { analyzeRawEvents } from "../pipeline/analyze.js";
import type { AppDatabase, StoredAnalysisSummary } from "../storage/database.js";

export interface AnalysisReadiness {
  kind: "empty" | "needs_analysis" | "stale" | "ready";
  snapshot: StoredAnalysisSummary;
}

export interface RefreshStoredAnalysisResult {
  rawEventCount: number;
  normalizedEventCount: number;
  sessionCount: number;
  workflowCount: number;
}

export function getAnalysisReadiness(database: AppDatabase): AnalysisReadiness {
  const snapshot = database.getStoredAnalysisSummary();

  if (snapshot.rawEventCount === 0) {
    return {
      kind: "empty",
      snapshot,
    };
  }

  if (snapshot.normalizedEventCount === 0) {
    return {
      kind: "needs_analysis",
      snapshot,
    };
  }

  if (
    snapshot.rawEventCount !== snapshot.normalizedEventCount ||
    (
      snapshot.latestRawEventAt !== undefined &&
      snapshot.latestNormalizedEventAt !== undefined &&
      Date.parse(snapshot.latestRawEventAt) > Date.parse(snapshot.latestNormalizedEventAt)
    )
  ) {
    return {
      kind: "stale",
      snapshot,
    };
  }

  return {
    kind: "ready",
    snapshot,
  };
}

export function refreshStoredAnalysis(database: AppDatabase): RefreshStoredAnalysisResult {
  const rawEvents = database.getRawEventsChronological();
  const analysisResult = analyzeRawEvents(rawEvents, {
    ...resolveConfiguredAnalyzeOptions(database.paths.dataDir),
    feedbackByWorkflowSignature: database.listWorkflowFeedbackSummary(),
  });

  database.replaceAnalysisArtifacts(analysisResult);

  return {
    rawEventCount: rawEvents.length,
    normalizedEventCount: analysisResult.normalizedEvents.length,
    sessionCount: analysisResult.sessions.length,
    workflowCount: analysisResult.workflowClusters.length,
  };
}
