import type { AgentHealthReport } from "../agent/control.js";
import { getAgentHealthReport, listLatestAgentSnapshots } from "../agent/control.js";
import type {
  RawEvent,
  ReportSnapshotSummary,
  ReportTimeWindow,
  ReportWindow,
  Session,
  WorkflowReport,
} from "../domain/types.js";
import type { AnalysisResult } from "../pipeline/analyze.js";
import { analyzeRawEvents } from "../pipeline/analyze.js";
import { buildWorkflowReportFromAnalysis } from "../reporting/report.js";
import { resolveReportTimeWindow } from "../reporting/windows.js";
import type { AppDatabase } from "../storage/database.js";

export interface ViewerDashboardOptions {
  dataDir?: string | undefined;
  window?: ReportWindow | undefined;
  date?: string | undefined;
  timezone?: string | undefined;
  timezoneOffsetMinutes?: number | undefined;
  now?: Date | undefined;
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

export interface ViewerDashboard {
  generatedAt: string;
  timeWindow: ReportTimeWindow;
  rawEventCount: number;
  latestEventAt?: string | undefined;
  report: WorkflowReport;
  sessionSummaries: ViewerSessionSummary[];
  agentHealth: AgentHealthReport;
  latestSnapshots: ReportSnapshotSummary[];
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

export function buildViewerDashboard(
  database: AppDatabase,
  options: ViewerDashboardOptions = {},
): ViewerDashboard {
  const { rawEvents, timeWindow, analysisResult } = buildLiveAnalysisState(database, options);
  const feedbackByClusterId = database.listWorkflowFeedbackSummary();

  return {
    generatedAt: new Date().toISOString(),
    timeWindow,
    rawEventCount: rawEvents.length,
    latestEventAt: rawEvents[rawEvents.length - 1]?.timestamp,
    report: buildWorkflowReportFromAnalysis({
      rawEvents,
      timeWindow,
      analysisResult,
      options: {
        feedbackByClusterId,
      },
    }),
    sessionSummaries: toSessionSummaries(analysisResult.sessions),
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
