import type { ReportTimeWindow, ReportWindow } from "../domain/types.js";

const REPORT_WINDOWS = new Set<ReportWindow>(["all", "day", "week"]);
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

function parseLocalDateParts(value: string): { year: number; month: number; day: number } {
  if (!DATE_PATTERN.test(value)) {
    throw new Error(`Invalid report date: ${value}. Expected YYYY-MM-DD.`);
  }

  const [yearText, monthText, dayText] = value.split("-");
  const year = Number.parseInt(yearText ?? "", 10);
  const month = Number.parseInt(monthText ?? "", 10);
  const day = Number.parseInt(dayText ?? "", 10);
  const probe = new Date(Date.UTC(year, month - 1, day));

  if (
    Number.isNaN(year) ||
    Number.isNaN(month) ||
    Number.isNaN(day) ||
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    throw new Error(`Invalid report date: ${value}. Expected YYYY-MM-DD.`);
  }

  return { year, month, day };
}

function addDaysToDateString(value: string, days: number): string {
  const { year, month, day } = parseLocalDateParts(value);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));

  return shifted.toISOString().slice(0, 10);
}

function localDateToUtcIso(value: string, timezoneOffsetMinutes: number): string {
  const { year, month, day } = parseLocalDateParts(value);
  const utcTime =
    Date.UTC(year, month - 1, day, 0, 0, 0, 0) - timezoneOffsetMinutes * 60 * 1000;

  return new Date(utcTime).toISOString();
}

function inferLocalDate(now: Date, timezoneOffsetMinutes: number): string {
  return new Date(now.getTime() + timezoneOffsetMinutes * 60 * 1000).toISOString().slice(0, 10);
}

function inferTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
}

function inferLocalTimezoneOffsetMinutes(reportDate?: string, now = new Date()): number {
  if (!reportDate) {
    return -now.getTimezoneOffset();
  }

  const { year, month, day } = parseLocalDateParts(reportDate);

  return -new Date(year, month - 1, day, 12, 0, 0, 0).getTimezoneOffset();
}

export function parseReportWindow(value: string): ReportWindow {
  if (!REPORT_WINDOWS.has(value as ReportWindow)) {
    throw new Error(`Invalid report window: ${value}. Expected one of all, day, week.`);
  }

  return value as ReportWindow;
}

export function parseReportWindowList(value: string): ReportWindow[] {
  const windows = value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => parseReportWindow(entry));

  if (windows.length === 0) {
    throw new Error("At least one report window must be provided.");
  }

  return [...new Set(windows)];
}

export function resolveReportTimeWindow(options: {
  window?: ReportWindow | undefined;
  reportDate?: string | undefined;
  timezone?: string | undefined;
  timezoneOffsetMinutes?: number | undefined;
  now?: Date | undefined;
} = {}): ReportTimeWindow {
  const now = options.now ?? new Date();
  const window = options.window ?? "all";
  const timezoneOffsetMinutes =
    options.timezoneOffsetMinutes ?? inferLocalTimezoneOffsetMinutes(options.reportDate, now);
  const reportDate = options.reportDate ?? inferLocalDate(now, timezoneOffsetMinutes);
  const timezone = options.timezone ?? inferTimezone();

  if (window === "all") {
    return {
      window,
      reportDate,
      timezone,
      timezoneOffsetMinutes,
    };
  }

  if (window === "day") {
    return {
      window,
      reportDate,
      timezone,
      timezoneOffsetMinutes,
      startTime: localDateToUtcIso(reportDate, timezoneOffsetMinutes),
      endTime: localDateToUtcIso(addDaysToDateString(reportDate, 1), timezoneOffsetMinutes),
    };
  }

  return {
    window,
    reportDate,
    timezone,
    timezoneOffsetMinutes,
    startTime: localDateToUtcIso(addDaysToDateString(reportDate, -6), timezoneOffsetMinutes),
    endTime: localDateToUtcIso(addDaysToDateString(reportDate, 1), timezoneOffsetMinutes),
  };
}
