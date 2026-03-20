import type { AgentHealthReport } from "../agent/control.js";
import { getAgentHealthReport, listLatestAgentSnapshots } from "../agent/control.js";
import { resolveConfiguredAnalyzeOptions } from "../config/workflow-analysis.js";
import type {
  AutomationDifficulty,
  AutomationHint,
  RawEvent,
  ReportSnapshotSummary,
  ReportTimeWindow,
  ReportWindow,
  Session,
  WorkflowSummaryPayloadRecord,
  WorkflowCluster,
  WorkflowFeedbackSummary,
  WorkflowNameSource,
  WorkflowReport,
  WorkflowReportComparison,
} from "../domain/types.js";
import { applyWorkflowFeedbackToClusters } from "../feedback/service.js";
import {
  buildWorkflowSummaryPayload,
  filterWorkflowClustersForPayloads,
} from "../llm/payloads.js";
import type { AnalysisResult } from "../pipeline/analyze.js";
import { analyzeRawEvents } from "../pipeline/analyze.js";
import { buildWorkflowReportFromAnalysis } from "../reporting/report.js";
import { buildWorkflowReportComparisonFromDatabase } from "../reporting/service.js";
import { resolveReportTimeWindow } from "../reporting/windows.js";
import type { AppDatabase } from "../storage/database.js";

export interface ViewerDashboardOptions {
  dataDir?: string | undefined;
  window?: ReportWindow | undefined;
  date?: string | undefined;
  timezone?: string | undefined;
  timezoneOffsetMinutes?: number | undefined;
  now?: Date | undefined;
  includeShortForm?: boolean | undefined;
}

export interface ViewerSessionSummary {
  id: string;
  startTime: string;
  endTime: string;
  durationSeconds: number;
  primaryApplication: string;
  primaryDomain?: string | undefined;
  sessionBoundaryReason: Session["sessionBoundaryReason"];
  stepCount: number;
}

export interface ViewerWorkflowSummary {
  id: string;
  workflowSignature: string;
  detectionMode: WorkflowCluster["detectionMode"];
  workflowName: string;
  baselineWorkflowName: string;
  workflowNameSource: WorkflowNameSource;
  llmSuggestedWorkflowName?: string | undefined;
  businessPurpose?: string | undefined;
  frequency: number;
  averageDurationSeconds: number;
  totalDurationSeconds: number;
  representativeSteps: string[];
  involvedApps: string[];
  confidenceScore: number;
  automationSuitability: WorkflowCluster["automationSuitability"];
  recommendedApproach: string;
  automationHints: AutomationHint[];
  excluded: boolean;
  hidden: boolean;
  userLabeled: boolean;
  repetitive?: boolean | undefined;
  automationCandidate?: boolean | undefined;
  automationDifficulty?: AutomationDifficulty | undefined;
  approvedAutomationCandidate?: boolean | undefined;
  sessionSummaries: ViewerSessionSummary[];
  visibleInReport: boolean;
}

export interface ViewerDashboard {
  generatedAt: string;
  timeWindow: ReportTimeWindow;
  rawEventCount: number;
  latestEventAt?: string | undefined;
  report: WorkflowReport;
  comparison?: WorkflowReportComparison | undefined;
  reviewableWorkflows: ViewerWorkflowSummary[];
  sessionSummaries: ViewerSessionSummary[];
  agentHealth: AgentHealthReport;
  latestSnapshots: ReportSnapshotSummary[];
}

export interface ViewerAnalysisPreparation {
  generatedAt: string;
  timeWindow: ReportTimeWindow;
  rawEventCount: number;
  workflowCount: number;
  shortFormExcludedCount: number;
  includeShortForm: boolean;
  payloadRecords: WorkflowSummaryPayloadRecord[];
}

interface LiveAnalysisState {
  rawEvents: RawEvent[];
  timeWindow: ReportTimeWindow;
  analysisResult: AnalysisResult;
}

function getRawEventsForTimeWindow(
  database: AppDatabase,
  timeWindow: ReportTimeWindow,
): RawEvent[] {
  if (timeWindow.startTime && timeWindow.endTime) {
    return database.getRawEventsInRange(timeWindow.startTime, timeWindow.endTime);
  }

  return database.getRawEventsChronological();
}

function secondsBetween(startTime: string, endTime: string): number {
  return Math.max(0, (new Date(endTime).getTime() - new Date(startTime).getTime()) / 1000);
}

function buildLiveAnalysisState(
  database: AppDatabase,
  options: ViewerDashboardOptions = {},
): LiveAnalysisState {
  const timeWindow = resolveReportTimeWindow({
    window: options.window,
    reportDate: options.date,
    timezone: options.timezone,
    timezoneOffsetMinutes: options.timezoneOffsetMinutes,
    now: options.now,
  });
  const rawEvents = getRawEventsForTimeWindow(database, timeWindow);
  const feedbackByClusterId = database.listWorkflowFeedbackSummary();
  const analysisResult = analyzeRawEvents(rawEvents, {
    ...resolveConfiguredAnalyzeOptions(database.paths.dataDir),
    feedbackByWorkflowSignature: feedbackByClusterId,
  });

  return {
    rawEvents,
    timeWindow,
    analysisResult,
  };
}

function toSessionSummaries(sessions: Session[]): ViewerSessionSummary[] {
  return [...sessions]
    .sort((left, right) => right.startTime.localeCompare(left.startTime))
    .map((session) => ({
      id: session.id,
      startTime: session.startTime,
      endTime: session.endTime,
      durationSeconds: secondsBetween(session.startTime, session.endTime),
      primaryApplication: session.primaryApplication,
      primaryDomain: session.primaryDomain,
      sessionBoundaryReason: session.sessionBoundaryReason,
      stepCount: session.steps.length,
    }));
}

function compareWorkflowSummaries(
  left: ViewerWorkflowSummary,
  right: ViewerWorkflowSummary,
): number {
  if (left.detectionMode !== right.detectionMode) {
    return Number(left.detectionMode === "short_form") - Number(right.detectionMode === "short_form");
  }

  if (left.hidden !== right.hidden) {
    return Number(left.hidden) - Number(right.hidden);
  }

  if (left.excluded !== right.excluded) {
    return Number(left.excluded) - Number(right.excluded);
  }

  return (
    right.frequency - left.frequency ||
    right.totalDurationSeconds - left.totalDurationSeconds ||
    left.workflowName.localeCompare(right.workflowName)
  );
}

function toViewerWorkflowSummary(
  workflow: WorkflowCluster,
  sessionSummariesById: Map<string, ViewerSessionSummary>,
  visibleWorkflowIds: Set<string>,
  reportWorkflowsById: Map<string, WorkflowReport["workflows"][number]>,
): ViewerWorkflowSummary {
  const reportWorkflow = reportWorkflowsById.get(workflow.id);

  return {
    id: workflow.id,
    workflowSignature: workflow.workflowSignature,
    detectionMode: workflow.detectionMode,
    workflowName: workflow.name,
    baselineWorkflowName: reportWorkflow?.baselineWorkflowName ?? workflow.name,
    workflowNameSource: reportWorkflow?.workflowNameSource ?? "baseline",
    llmSuggestedWorkflowName: reportWorkflow?.llmSuggestedWorkflowName,
    businessPurpose: workflow.businessPurpose,
    frequency: workflow.frequency,
    averageDurationSeconds: workflow.averageDurationSeconds,
    totalDurationSeconds: workflow.totalDurationSeconds,
    representativeSteps: workflow.representativeSteps,
    involvedApps: workflow.involvedApps,
    confidenceScore: workflow.confidenceScore,
    automationSuitability: workflow.automationSuitability,
    recommendedApproach: workflow.recommendedApproach,
    automationHints: workflow.automationHints,
    excluded: workflow.excluded,
    hidden: workflow.hidden,
    userLabeled: workflow.userLabeled,
    repetitive: workflow.repetitive,
    automationCandidate: workflow.automationCandidate,
    automationDifficulty: workflow.automationDifficulty,
    approvedAutomationCandidate: workflow.approvedAutomationCandidate,
    sessionSummaries: workflow.sessionIds
      .map((sessionId) => sessionSummariesById.get(sessionId))
      .filter((session): session is ViewerSessionSummary => Boolean(session)),
    visibleInReport: visibleWorkflowIds.has(workflow.id),
  };
}

function buildViewerWorkflowSummaries(
  analysisResult: AnalysisResult,
  report: WorkflowReport,
  feedbackByClusterId: Map<string, WorkflowFeedbackSummary>,
): ViewerWorkflowSummary[] {
  const sessionSummaries = toSessionSummaries(analysisResult.sessions);
  const sessionSummariesById = new Map(sessionSummaries.map((session) => [session.id, session]));
  const visibleWorkflowIds = new Set(report.workflows.map((workflow) => workflow.workflowClusterId));
  const reportWorkflowsById = new Map(
    report.workflows.map((workflow) => [workflow.workflowClusterId, workflow]),
  );

  return applyWorkflowFeedbackToClusters(analysisResult.workflowClusters, feedbackByClusterId)
    .map((workflow) =>
      toViewerWorkflowSummary(
        workflow,
        sessionSummariesById,
        visibleWorkflowIds,
        reportWorkflowsById,
      ),
    )
    .sort(compareWorkflowSummaries);
}

function buildWorkflowSummaryPayloadRecordsForViewerClusters(
  clusters: WorkflowCluster[],
  sessions: Session[],
  options: { includeShortForm?: boolean | undefined } = {},
): WorkflowSummaryPayloadRecord[] {
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  const eligibleClusters = filterWorkflowClustersForPayloads(clusters, {
    includeExcluded: true,
    includeHidden: true,
    includeShortForm: options.includeShortForm,
  });

  return eligibleClusters.map((cluster) => {
    const applications: string[] = [];
    const domains: string[] = [];

    for (const sessionId of cluster.sessionIds) {
      const session = sessionsById.get(sessionId);

      if (!session) {
        continue;
      }

      applications.push(session.primaryApplication);

      if (session.primaryDomain) {
        domains.push(session.primaryDomain);
      }

      for (const step of session.steps) {
        applications.push(step.application);

        if (step.domain) {
          domains.push(step.domain);
        }
      }
    }

    return {
      workflowClusterId: cluster.id,
      workflowName: cluster.name,
      detectionMode: cluster.detectionMode,
      payload: buildWorkflowSummaryPayload({
        representativeSteps: cluster.representativeSteps,
        frequency: cluster.frequency,
        averageDurationSeconds: cluster.averageDurationSeconds,
        applications,
        domains,
      }),
    };
  });
}

export function buildViewerDashboard(
  database: AppDatabase,
  options: ViewerDashboardOptions = {},
): ViewerDashboard {
  const { rawEvents, timeWindow, analysisResult } = buildLiveAnalysisState(database, options);
  const feedbackByClusterId = database.listWorkflowFeedbackSummary();
  const report = buildWorkflowReportFromAnalysis({
    rawEvents,
    timeWindow,
    analysisResult,
    options: {
      feedbackByClusterId,
    },
  });
  const sessionSummaries = toSessionSummaries(analysisResult.sessions);

  return {
    generatedAt: new Date().toISOString(),
    timeWindow,
    rawEventCount: rawEvents.length,
    latestEventAt: rawEvents[rawEvents.length - 1]?.timestamp,
    report,
    comparison: buildWorkflowReportComparisonFromDatabase(database, options),
    reviewableWorkflows: buildViewerWorkflowSummaries(
      analysisResult,
      report,
      feedbackByClusterId,
    ),
    sessionSummaries,
    agentHealth: getAgentHealthReport(options.dataDir),
    latestSnapshots: listLatestAgentSnapshots(options.dataDir),
  };
}

export function getViewerSessionDetail(
  database: AppDatabase,
  sessionId: string,
  options: ViewerDashboardOptions = {},
): Session | undefined {
  const { analysisResult } = buildLiveAnalysisState(database, options);

  return analysisResult.sessions.find((session) => session.id === sessionId);
}

export function getViewerWorkflowDetail(
  database: AppDatabase,
  workflowId: string,
  options: ViewerDashboardOptions = {},
): ViewerWorkflowSummary | undefined {
  const { rawEvents, timeWindow, analysisResult } = buildLiveAnalysisState(database, options);
  const feedbackByClusterId = database.listWorkflowFeedbackSummary();
  const report = buildWorkflowReportFromAnalysis({
    rawEvents,
    timeWindow,
    analysisResult,
    options: {
      feedbackByClusterId,
    },
  });

  return buildViewerWorkflowSummaries(analysisResult, report, feedbackByClusterId).find(
    (workflow) => workflow.id === workflowId,
  );
}

export function buildViewerAnalysisPreparation(
  database: AppDatabase,
  options: ViewerDashboardOptions = {},
): ViewerAnalysisPreparation {
  const includeShortForm = options.includeShortForm ?? false;
  const { rawEvents, timeWindow, analysisResult } = buildLiveAnalysisState(database, options);
  const feedbackByClusterId = database.listWorkflowFeedbackSummary();
  const report = buildWorkflowReportFromAnalysis({
    rawEvents,
    timeWindow,
    analysisResult,
    options: {
      feedbackByClusterId,
    },
  });
  const visibleWorkflowIds = new Set(report.workflows.map((workflow) => workflow.workflowClusterId));
  const reportWorkflows = applyWorkflowFeedbackToClusters(
    analysisResult.workflowClusters,
    feedbackByClusterId,
  ).filter((workflow) => visibleWorkflowIds.has(workflow.id));
  const shortFormExcludedCount = includeShortForm
    ? 0
    : reportWorkflows.filter((workflow) => workflow.detectionMode === "short_form").length;
  const payloadRecords = buildWorkflowSummaryPayloadRecordsForViewerClusters(
    reportWorkflows,
    analysisResult.sessions,
    {
      includeShortForm,
    },
  );

  return {
    generatedAt: new Date().toISOString(),
    timeWindow,
    rawEventCount: rawEvents.length,
    workflowCount: reportWorkflows.length,
    shortFormExcludedCount,
    includeShortForm,
    payloadRecords,
  };
}
