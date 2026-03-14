import type { ReportSnapshot, ReportWindow, WorkflowReport } from "../domain/types.js";
import type { AppDatabase } from "../storage/database.js";
import { buildWorkflowReport } from "./report.js";
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
