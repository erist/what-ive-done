import type {
  EmergingWorkflowEntry,
  RawEvent,
  ReportEntry,
  ReportTimeWindow,
  Session,
  WorkflowCluster,
  WorkflowFeedbackSummary,
  WorkflowReport,
} from "../domain/types.js";
import { clusterSessions } from "../pipeline/cluster.js";
import { analyzeRawEvents } from "../pipeline/analyze.js";

export interface BuildReportOptions {
  includeExcluded?: boolean | undefined;
  includeHidden?: boolean | undefined;
}

export interface BuildWorkflowReportOptions extends BuildReportOptions {
  feedbackByClusterId?: Map<string, WorkflowFeedbackSummary> | undefined;
}

function applyFeedbackToCluster(
  cluster: WorkflowCluster,
  feedbackByClusterId: Map<string, WorkflowFeedbackSummary>,
): WorkflowCluster {
  const feedback = feedbackByClusterId.get(cluster.id);

  if (!feedback) {
    return cluster;
  }

  return {
    ...cluster,
    name: feedback.renameTo ?? cluster.name,
    excluded: feedback.excluded ?? cluster.excluded,
    hidden: feedback.hidden ?? cluster.hidden,
  };
}

function secondsBetween(startTime: string, endTime: string): number {
  return Math.max(0, (new Date(endTime).getTime() - new Date(startTime).getTime()) / 1000);
}

function filterVisibleClusters(
  clusters: WorkflowCluster[],
  options: BuildReportOptions,
): WorkflowCluster[] {
  const includeExcluded = options.includeExcluded ?? false;
  const includeHidden = options.includeHidden ?? false;

  return clusters.filter(
    (cluster) => (includeExcluded || !cluster.excluded) && (includeHidden || !cluster.hidden),
  );
}

function buildEmergingWorkflowEntries(
  sessions: Session[],
  confirmedClusters: WorkflowCluster[],
  options: BuildWorkflowReportOptions,
): EmergingWorkflowEntry[] {
  const feedbackByClusterId = options.feedbackByClusterId ?? new Map<string, WorkflowFeedbackSummary>();
  const confirmedIds = new Set(confirmedClusters.map((cluster) => cluster.id));
  const provisionalClusters = clusterSessions(sessions, {
    minimumWorkflowFrequency: 1,
    minSessionDurationSeconds: 0,
  }).map((cluster) => applyFeedbackToCluster(cluster, feedbackByClusterId));

  return filterVisibleClusters(
    provisionalClusters.filter((cluster) => !confirmedIds.has(cluster.id)),
    options,
  ).map((cluster) => ({
    workflowClusterId: cluster.id,
    workflowName: cluster.name,
    frequency: cluster.frequency,
    averageDurationSeconds: cluster.averageDurationSeconds,
    totalDurationSeconds: cluster.totalDurationSeconds,
    representativeSteps: cluster.representativeSteps,
    confidence: "provisional",
  }));
}

export function buildReportEntries(
  clusters: WorkflowCluster[],
  options: BuildReportOptions = {},
): ReportEntry[] {
  return filterVisibleClusters(clusters, options).map((cluster) => ({
    workflowClusterId: cluster.id,
    workflowName: cluster.name,
    frequency: cluster.frequency,
    averageDurationSeconds: cluster.averageDurationSeconds,
    totalDurationSeconds: cluster.totalDurationSeconds,
    automationSuitability: cluster.automationSuitability,
    recommendedApproach: cluster.recommendedApproach,
  }));
}

export function buildWorkflowReport(args: {
  rawEvents: RawEvent[];
  timeWindow: ReportTimeWindow;
  options?: BuildWorkflowReportOptions | undefined;
}): WorkflowReport {
  const options = args.options ?? {};
  const feedbackByClusterId = options.feedbackByClusterId ?? new Map<string, WorkflowFeedbackSummary>();
  const analysisResult = analyzeRawEvents(args.rawEvents);
  const clusters = analysisResult.workflowClusters.map((cluster) =>
    applyFeedbackToCluster(cluster, feedbackByClusterId),
  );

  return {
    timeWindow: args.timeWindow,
    totalSessions: analysisResult.sessions.length,
    totalTrackedDurationSeconds: analysisResult.sessions.reduce(
      (sum, session) => sum + secondsBetween(session.startTime, session.endTime),
      0,
    ),
    workflows: buildReportEntries(clusters, options),
    emergingWorkflows:
      args.timeWindow.window === "all"
        ? []
        : buildEmergingWorkflowEntries(analysisResult.sessions, clusters, options),
  };
}

export function formatDuration(seconds: number): string {
  const rounded = Math.round(seconds);
  const minutes = Math.floor(rounded / 60);
  const remainingSeconds = rounded % 60;

  if (minutes === 0) {
    return `${remainingSeconds}s`;
  }

  return `${minutes}m ${remainingSeconds}s`;
}
