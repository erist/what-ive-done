import type { NormalizedEvent, RawEvent, Session, WorkflowCluster } from "../domain/types.js";
import { clusterSessions } from "./cluster.js";
import { normalizeRawEvents } from "./normalize.js";
import { sessionizeNormalizedEvents } from "./sessionize.js";

export interface AnalysisResult {
  normalizedEvents: NormalizedEvent[];
  sessions: Session[];
  workflowClusters: WorkflowCluster[];
}

export interface AnalyzeOptions {
  inactivityThresholdMs?: number;
  contextShiftThresholdMs?: number;
  similarityThreshold?: number;
  minSessionDurationSeconds?: number;
  minimumWorkflowFrequency?: number;
}

export function analyzeRawEvents(rawEvents: RawEvent[], options: AnalyzeOptions = {}): AnalysisResult {
  const normalizedEvents = normalizeRawEvents(rawEvents);
  const sessionizeOptions = {
    ...(options.inactivityThresholdMs !== undefined
      ? { inactivityThresholdMs: options.inactivityThresholdMs }
      : {}),
    ...(options.contextShiftThresholdMs !== undefined
      ? { contextShiftThresholdMs: options.contextShiftThresholdMs }
      : {}),
  };
  const clusterOptions = {
    ...(options.similarityThreshold !== undefined
      ? { similarityThreshold: options.similarityThreshold }
      : {}),
    ...(options.minSessionDurationSeconds !== undefined
      ? { minSessionDurationSeconds: options.minSessionDurationSeconds }
      : {}),
    ...(options.minimumWorkflowFrequency !== undefined
      ? { minimumWorkflowFrequency: options.minimumWorkflowFrequency }
      : {}),
  };
  const sessions = sessionizeNormalizedEvents(normalizedEvents, sessionizeOptions);
  const workflowClusters = clusterSessions(sessions, clusterOptions);

  return {
    normalizedEvents,
    sessions,
    workflowClusters,
  };
}
