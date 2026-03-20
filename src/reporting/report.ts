import type {
  EmergingWorkflowEntry,
  RawEvent,
  ReportEntry,
  ReportTimeWindow,
  Session,
  WorkflowCluster,
  WorkflowReportComparison,
  WorkflowReportComparisonEntry,
  WorkflowFeedbackSummary,
  WorkflowGraph,
  WorkflowLLMAnalysis,
  WorkflowNameSource,
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
  llmAnalysesByWorkflowId?: Map<string, WorkflowLLMAnalysis> | undefined;
  freshness?: WorkflowReport["freshness"] | undefined;
}

interface WorkflowNameMetadata {
  baselineWorkflowName: string;
  workflowNameSource: WorkflowNameSource;
  llmSuggestedWorkflowName?: string | undefined;
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

function latestTimestamp(rawEvents: RawEvent[]): string | undefined {
  return rawEvents[rawEvents.length - 1]?.timestamp;
}

function resolveWorkflowNameMetadata(args: {
  baselineCluster: WorkflowCluster;
  resolvedCluster: WorkflowCluster;
  llmAnalysis?: WorkflowLLMAnalysis | undefined;
}): WorkflowNameMetadata {
  if (args.resolvedCluster.name === args.baselineCluster.name) {
    return {
      baselineWorkflowName: args.baselineCluster.name,
      workflowNameSource: "baseline",
      llmSuggestedWorkflowName: args.llmAnalysis?.workflowName,
    };
  }

  return {
    baselineWorkflowName: args.baselineCluster.name,
    workflowNameSource:
      args.llmAnalysis?.workflowName === args.resolvedCluster.name ? "llm_overlay" : "feedback",
    llmSuggestedWorkflowName: args.llmAnalysis?.workflowName,
  };
}

export function buildReportEntries(
  clusters: WorkflowCluster[],
  timeWindow: ReportTimeWindow,
  rawEvents: RawEvent[],
  options: BuildReportOptions = {},
  nameMetadataByClusterId: Map<string, WorkflowNameMetadata> = new Map(),
): ReportEntry[] {
  const windowDays = estimateWindowDays(rawEvents, timeWindow);

  return filterVisibleClusters(clusters, options)
    .map((cluster) => {
      const nameMetadata = nameMetadataByClusterId.get(cluster.id) ?? {
        baselineWorkflowName: cluster.name,
        workflowNameSource: "baseline" as const,
      };

      return {
        workflowClusterId: cluster.id,
        workflowSignature: cluster.workflowSignature,
        detectionMode: cluster.detectionMode,
        workflowName: cluster.name,
        baselineWorkflowName: nameMetadata.baselineWorkflowName,
        workflowNameSource: nameMetadata.workflowNameSource,
        llmSuggestedWorkflowName: nameMetadata.llmSuggestedWorkflowName,
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
        automationCandidate: cluster.automationCandidate,
        approvedAutomationCandidate: cluster.approvedAutomationCandidate,
      };
    })
    .sort(
      (left, right) =>
        Number(left.detectionMode === "short_form") - Number(right.detectionMode === "short_form") ||
        right.frequency - left.frequency ||
        right.totalDurationSeconds - left.totalDurationSeconds,
    );
}

function buildReportSummary(workflows: ReportEntry[]): WorkflowReport["summary"] {
  const repetitiveCandidates = workflows.filter((workflow) => workflow.frequency >= 2);
  const explicitlyRepetitive = workflows.filter((workflow) => workflow.userLabeled);
  const repetitive = repetitiveCandidates.length > 0 ? repetitiveCandidates : explicitlyRepetitive;
  const automationCandidates = workflows.filter(
    (workflow) =>
      workflow.detectionMode === "standard" &&
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
  const baselineClusters = args.analysisResult.workflowClusters;
  const llmAnalysesByWorkflowId = options.llmAnalysesByWorkflowId ?? new Map<string, WorkflowLLMAnalysis>();
  const clusters = baselineClusters.map((cluster) =>
    applyWorkflowFeedbackToCluster(cluster, feedbackByClusterId),
  );
  const nameMetadataByClusterId = new Map(
    baselineClusters.map((baselineCluster, index) => {
      const resolvedCluster = clusters[index] ?? baselineCluster;

      return [
        resolvedCluster.id,
        resolveWorkflowNameMetadata({
          baselineCluster,
          resolvedCluster,
          llmAnalysis: llmAnalysesByWorkflowId.get(resolvedCluster.id),
        }),
      ];
    }),
  );
  const workflows = buildReportEntries(
    clusters,
    args.timeWindow,
    args.rawEvents,
    options,
    nameMetadataByClusterId,
  );

  return {
    timeWindow: args.timeWindow,
    freshness: options.freshness ?? {
      analysisSource: "live_reanalysis",
      reportGeneratedAt: new Date().toISOString(),
      latestRawEventAt: latestTimestamp(args.rawEvents),
      snapshotStatus: "missing",
    },
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

function toComparisonEntry(
  current: ReportEntry | undefined,
  previous: ReportEntry | undefined,
): WorkflowReportComparisonEntry {
  return {
    workflowClusterId: current?.workflowClusterId ?? previous?.workflowClusterId,
    workflowSignature: current?.workflowSignature ?? previous?.workflowSignature ?? "unknown",
    workflowName: current?.workflowName ?? previous?.workflowName ?? "Unknown workflow",
    previousWorkflowName:
      previous && current && previous.workflowName !== current.workflowName
        ? previous.workflowName
        : undefined,
    currentFrequency: current?.frequency ?? 0,
    previousFrequency: previous?.frequency ?? 0,
    frequencyDelta: (current?.frequency ?? 0) - (previous?.frequency ?? 0),
    currentTotalDurationSeconds: current?.totalDurationSeconds ?? 0,
    previousTotalDurationSeconds: previous?.totalDurationSeconds ?? 0,
    totalDurationDeltaSeconds:
      (current?.totalDurationSeconds ?? 0) - (previous?.totalDurationSeconds ?? 0),
    approvedAutomationCandidate:
      current?.approvedAutomationCandidate ?? previous?.approvedAutomationCandidate,
  };
}

export function buildWorkflowReportComparison(
  currentReport: WorkflowReport,
  previousReport: WorkflowReport,
): WorkflowReportComparison {
  const currentBySignature = new Map(
    currentReport.workflows.map((workflow) => [workflow.workflowSignature, workflow]),
  );
  const previousBySignature = new Map(
    previousReport.workflows.map((workflow) => [workflow.workflowSignature, workflow]),
  );
  const allSignatures = new Set([
    ...currentBySignature.keys(),
    ...previousBySignature.keys(),
  ]);
  const approvedCandidateChanges = [...allSignatures]
    .map((workflowSignature) =>
      toComparisonEntry(
        currentBySignature.get(workflowSignature),
        previousBySignature.get(workflowSignature),
      ),
    )
    .filter(
      (entry) =>
        entry.approvedAutomationCandidate === true &&
        (entry.totalDurationDeltaSeconds !== 0 || entry.frequencyDelta !== 0),
    )
    .sort(
      (left, right) =>
        Math.abs(right.totalDurationDeltaSeconds) - Math.abs(left.totalDurationDeltaSeconds) ||
        Math.abs(right.frequencyDelta) - Math.abs(left.frequencyDelta),
    );
  const currentApprovedCandidates = currentReport.workflows.filter(
    (workflow) => workflow.approvedAutomationCandidate,
  );
  const previousApprovedCandidates = previousReport.workflows.filter(
    (workflow) => workflow.approvedAutomationCandidate,
  );

  return {
    currentTimeWindow: currentReport.timeWindow,
    previousTimeWindow: previousReport.timeWindow,
    summary: {
      sessionDelta: currentReport.totalSessions - previousReport.totalSessions,
      trackedDurationDeltaSeconds:
        currentReport.totalTrackedDurationSeconds - previousReport.totalTrackedDurationSeconds,
      confirmedWorkflowDelta:
        currentReport.workflows.length - previousReport.workflows.length,
      emergingWorkflowDelta:
        currentReport.emergingWorkflows.length - previousReport.emergingWorkflows.length,
      approvedCandidateWorkflowDelta:
        currentApprovedCandidates.length - previousApprovedCandidates.length,
      approvedCandidateTimeDeltaSeconds:
        currentApprovedCandidates.reduce(
          (sum, workflow) => sum + workflow.totalDurationSeconds,
          0,
        ) -
        previousApprovedCandidates.reduce(
          (sum, workflow) => sum + workflow.totalDurationSeconds,
          0,
        ),
    },
    newlyAppearedWorkflows: currentReport.workflows
      .filter((workflow) => !previousBySignature.has(workflow.workflowSignature))
      .map((workflow) => toComparisonEntry(workflow, undefined))
      .sort((left, right) => right.currentTotalDurationSeconds - left.currentTotalDurationSeconds),
    disappearedWorkflows: previousReport.workflows
      .filter((workflow) => !currentBySignature.has(workflow.workflowSignature))
      .map((workflow) => toComparisonEntry(undefined, workflow))
      .sort((left, right) => right.previousTotalDurationSeconds - left.previousTotalDurationSeconds),
    approvedCandidateChanges,
  };
}
