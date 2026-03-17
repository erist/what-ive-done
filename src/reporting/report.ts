import type {
  EmergingWorkflowEntry,
  RawEvent,
  ReportEntry,
  ReportTimeWindow,
  Session,
  WorkflowCluster,
  WorkflowFeedbackSummary,
  WorkflowGraph,
  WorkflowReport,
} from "../domain/types.js";
import { applyWorkflowFeedbackToCluster } from "../feedback/service.js";
import { analyzeRawEvents, type AnalysisResult } from "../pipeline/analyze.js";
import { clusterSessions } from "../pipeline/cluster.js";

export interface BuildReportOptions {
  includeExcluded?: boolean | undefined;
  includeHidden?: boolean | undefined;
}

export interface BuildWorkflowReportOptions extends BuildReportOptions {
  feedbackByClusterId?: Map<string, WorkflowFeedbackSummary> | undefined;
}

function secondsBetween(startTime: string, endTime: string): number {
  return Math.max(0, (new Date(endTime).getTime() - new Date(startTime).getTime()) / 1000);
}

function humanize(value: string): string {
  return value
    .replace(/[._-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
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
  }).map((cluster) => applyWorkflowFeedbackToCluster(cluster, feedbackByClusterId));

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

function estimateWindowDays(rawEvents: RawEvent[], timeWindow: ReportTimeWindow): number {
  if (timeWindow.startTime && timeWindow.endTime) {
    return Math.max(
      1,
      (new Date(timeWindow.endTime).getTime() - new Date(timeWindow.startTime).getTime()) /
        (24 * 60 * 60 * 1000),
    );
  }

  if (rawEvents.length < 2) {
    return 1;
  }

  const first = rawEvents[0]?.timestamp ?? rawEvents[rawEvents.length - 1]?.timestamp;
  const last = rawEvents[rawEvents.length - 1]?.timestamp ?? first;

  if (!first || !last) {
    return 1;
  }

  return Math.max(1, (new Date(last).getTime() - new Date(first).getTime()) / (24 * 60 * 60 * 1000));
}

function automationSuitabilityScore(cluster: WorkflowCluster): number {
  const base =
    cluster.automationSuitability === "high"
      ? 0.9
      : cluster.automationSuitability === "medium"
        ? 0.6
        : 0.3;

  return Math.round((base * 0.7 + cluster.confidenceScore * 0.3) * 100) / 100;
}

function buildWorkflowGraph(cluster: WorkflowCluster): WorkflowGraph {
  const nodes = cluster.representativeSequence.map((step) => humanize(step));
  const edges = nodes.slice(0, -1).map((node, index) => ({
    from: node,
    to: nodes[index + 1] ?? node,
    weight: 1,
  }));

  return {
    nodes,
    edges,
    text: nodes.join(" -> "),
  };
}

export function buildReportEntries(
  clusters: WorkflowCluster[],
  timeWindow: ReportTimeWindow,
  rawEvents: RawEvent[],
  options: BuildReportOptions = {},
): ReportEntry[] {
  const windowDays = estimateWindowDays(rawEvents, timeWindow);

  return filterVisibleClusters(clusters, options).map((cluster) => ({
    workflowClusterId: cluster.id,
    workflowName: cluster.name,
    businessPurpose: cluster.businessPurpose,
    frequency: cluster.frequency,
    frequencyPerWeek: Math.round((cluster.frequency / windowDays) * 7 * 100) / 100,
    averageDurationSeconds: cluster.averageDurationSeconds,
    totalDurationSeconds: cluster.totalDurationSeconds,
    estimatedTotalTimeSpentSeconds: cluster.totalDurationSeconds,
    representativeSequence: cluster.representativeSequence,
    representativeSteps: cluster.representativeSteps,
    involvedApps: cluster.involvedApps,
    automationSuitabilityScore: automationSuitabilityScore(cluster),
    confidenceScore: cluster.confidenceScore,
    userLabeled: cluster.userLabeled,
    graph: buildWorkflowGraph(cluster),
    automationSuitability: cluster.automationSuitability,
    recommendedApproach: cluster.recommendedApproach,
    automationHints: cluster.automationHints,
  }));
}

function buildReportSummary(workflows: ReportEntry[]): WorkflowReport["summary"] {
  const repetitiveCandidates = workflows.filter((workflow) => workflow.frequency >= 2);
  const explicitlyRepetitive = workflows.filter((workflow) => workflow.userLabeled);
  const repetitive = repetitiveCandidates.length > 0 ? repetitiveCandidates : explicitlyRepetitive;
  const automationCandidates = workflows.filter(
    (workflow) =>
      workflow.automationSuitabilityScore >= 0.6 &&
      workflow.confidenceScore >= 0.6,
  );
  const needsHumanJudgment = workflows.filter(
    (workflow) =>
      workflow.confidenceScore < 0.65 ||
      workflow.automationSuitability === "low" ||
      workflow.userLabeled === false,
  );

  return {
    topRepetitiveWorkflows: [...repetitive]
      .sort((left, right) => right.frequency - left.frequency || right.totalDurationSeconds - left.totalDurationSeconds)
      .slice(0, 5),
    highestTimeConsumingRepetitiveWorkflows: [...repetitive]
      .sort((left, right) => right.totalDurationSeconds - left.totalDurationSeconds)
      .slice(0, 5),
    quickWinAutomationCandidates: [...automationCandidates]
      .sort(
        (left, right) =>
          right.automationSuitabilityScore - left.automationSuitabilityScore ||
          right.totalDurationSeconds - left.totalDurationSeconds,
      )
      .slice(0, 5),
    workflowsNeedingHumanJudgment: [...needsHumanJudgment]
      .sort((left, right) => left.confidenceScore - right.confidenceScore)
      .slice(0, 5),
  };
}

export function buildWorkflowReport(args: {
  rawEvents: RawEvent[];
  timeWindow: ReportTimeWindow;
  options?: BuildWorkflowReportOptions | undefined;
}): WorkflowReport {
  const analysisResult = analyzeRawEvents(args.rawEvents, {
    feedbackByWorkflowSignature: args.options?.feedbackByClusterId,
  });

  return buildWorkflowReportFromAnalysis({
    rawEvents: args.rawEvents,
    timeWindow: args.timeWindow,
    analysisResult,
    options: args.options,
  });
}

export function buildWorkflowReportFromAnalysis(args: {
  rawEvents: RawEvent[];
  timeWindow: ReportTimeWindow;
  analysisResult: AnalysisResult;
  options?: BuildWorkflowReportOptions | undefined;
}): WorkflowReport {
  const options = args.options ?? {};
  const feedbackByClusterId = options.feedbackByClusterId ?? new Map<string, WorkflowFeedbackSummary>();
  const clusters = args.analysisResult.workflowClusters.map((cluster) =>
    applyWorkflowFeedbackToCluster(cluster, feedbackByClusterId),
  );
  const workflows = buildReportEntries(clusters, args.timeWindow, args.rawEvents, options);

  return {
    timeWindow: args.timeWindow,
    totalSessions: args.analysisResult.sessions.length,
    totalTrackedDurationSeconds: args.analysisResult.sessions.reduce(
      (sum, session) => sum + secondsBetween(session.startTime, session.endTime),
      0,
    ),
    workflows,
    emergingWorkflows:
      args.timeWindow.window === "all"
        ? []
        : buildEmergingWorkflowEntries(args.analysisResult.sessions, clusters, options),
    summary: buildReportSummary(workflows),
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
