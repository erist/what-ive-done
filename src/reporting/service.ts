import type {
  ReportSnapshot,
  ReportWindow,
  WorkflowReport,
  WorkflowReportComparison,
} from "../domain/types.js";
import type { AppDatabase } from "../storage/database.js";
import { buildWorkflowReport, buildWorkflowReportComparison } from "./report.js";
import { resolveReportTimeWindow } from "./windows.js";

export interface BuildStoredWorkflowReportOptions {
  window?: ReportWindow | undefined;
  date?: string | undefined;
  includeExcluded?: boolean | undefined;
  includeHidden?: boolean | undefined;
  timezone?: string | undefined;
  timezoneOffsetMinutes?: number | undefined;
  now?: Date | undefined;
}

export interface GenerateSnapshotOptions extends BuildStoredWorkflowReportOptions {}
export interface BuildStoredWorkflowReportComparisonOptions
  extends BuildStoredWorkflowReportOptions {}

export interface SchedulerCycleOptions {
  windows?: ReportWindow[] | undefined;
  includeExcluded?: boolean | undefined;
  includeHidden?: boolean | undefined;
  timezone?: string | undefined;
  timezoneOffsetMinutes?: number | undefined;
  now?: Date | undefined;
}

export function buildWorkflowReportFromDatabase(
  database: AppDatabase,
  options: BuildStoredWorkflowReportOptions = {},
): WorkflowReport {
  const timeWindow = resolveReportTimeWindow({
    window: options.window,
    reportDate: options.date,
    timezone: options.timezone,
    timezoneOffsetMinutes: options.timezoneOffsetMinutes,
    now: options.now,
  });
  const rawEvents =
    timeWindow.startTime && timeWindow.endTime
      ? database.getRawEventsInRange(timeWindow.startTime, timeWindow.endTime)
      : database.getRawEventsChronological();

  return buildWorkflowReport({
    rawEvents,
    timeWindow,
    options: {
      includeExcluded: options.includeExcluded,
      includeHidden: options.includeHidden,
      feedbackByClusterId: database.listWorkflowFeedbackSummary(),
    },
  });
}

function shiftReportDate(reportDate: string, dayDelta: number): string {
  const [year, month, day] = reportDate.split("-").map((value) => Number.parseInt(value, 10));
  const shiftedDate = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));

  shiftedDate.setUTCDate(shiftedDate.getUTCDate() + dayDelta);

  return shiftedDate.toISOString().slice(0, 10);
}

export function buildWorkflowReportComparisonFromDatabase(
  database: AppDatabase,
  options: BuildStoredWorkflowReportComparisonOptions = {},
): WorkflowReportComparison | undefined {
  const currentReport = buildWorkflowReportFromDatabase(database, options);
  const window = currentReport.timeWindow.window;
  const dayDelta = window === "day" ? -1 : window === "week" ? -7 : undefined;

  if (dayDelta === undefined) {
    return undefined;
  }

  const previousReport = buildWorkflowReportFromDatabase(database, {
    window,
    date: shiftReportDate(currentReport.timeWindow.reportDate, dayDelta),
    includeExcluded: options.includeExcluded,
    includeHidden: options.includeHidden,
    timezone: currentReport.timeWindow.timezone,
    timezoneOffsetMinutes: currentReport.timeWindow.timezoneOffsetMinutes,
  });

  return buildWorkflowReportComparison(currentReport, previousReport);
}

export function generateReportSnapshot(
  database: AppDatabase,
  options: GenerateSnapshotOptions = {},
): ReportSnapshot {
  const report = buildWorkflowReportFromDatabase(database, options);

  return database.upsertReportSnapshot(report);
}

export function runReportSchedulerCycle(
  database: AppDatabase,
  options: SchedulerCycleOptions = {},
): ReportSnapshot[] {
  const windows = options.windows ?? ["day", "week"];

  return windows.map((window) =>
    generateReportSnapshot(database, {
      window,
      includeExcluded: options.includeExcluded,
      includeHidden: options.includeHidden,
      timezone: options.timezone,
      timezoneOffsetMinutes: options.timezoneOffsetMinutes,
      now: options.now,
    }),
  );
}
