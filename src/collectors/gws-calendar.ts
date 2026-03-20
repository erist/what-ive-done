import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { buildCalendarSignalMetadata, type CalendarSignalType } from "../calendar/signals.js";
import type { RawEventInput } from "../domain/types.js";
import { normalizeIsoTimestamp } from "./gws-shared.js";
import type { CollectorInfo } from "./types.js";

export const DEFAULT_GWS_CALENDAR_ID = "primary";
export const DEFAULT_GWS_CALENDAR_POLL_INTERVAL_MS = 60_000;
export const DEFAULT_GWS_CALENDAR_LOOKBACK_MS = 5 * 60 * 1000;
export const DEFAULT_GWS_CALENDAR_LOOKAHEAD_MS = 10 * 60 * 1000;

interface CommandRunnerResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error | undefined;
}

export interface GWSCommandRunner {
  (args: string[]): CommandRunnerResult;
}

export interface GWSAuthStatus {
  auth_method?: string | undefined;
  has_refresh_token?: boolean | undefined;
  project_id?: string | undefined;
  scopes?: string[] | undefined;
  token_valid?: boolean | undefined;
  user?: string | undefined;
}

export interface GWSCalendarCollectorStatus {
  collector: string;
  command: string;
  selectedCalendarId: string;
  installed: boolean;
  ready: boolean;
  status: "available" | "auth_error" | "missing_binary" | "missing_scope";
  detail?: string | undefined;
  authMethod?: string | undefined;
  tokenValid?: boolean | undefined;
  hasRefreshToken?: boolean | undefined;
  user?: string | undefined;
  projectId?: string | undefined;
  calendarScopeGranted?: boolean | undefined;
}

export interface GWSCalendarMeeting {
  id: string;
  summary?: string | undefined;
  startAt: string;
  endAt: string;
  attendeesCount?: number | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function defaultCommandRunner(args: string[]): CommandRunnerResult {
  const result = spawnSync("gws", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ?? undefined,
  };
}

function extractJsonPayload(output: string, failureLabel: string): string {
  const trimmed = output.trim();
  const objectIndex = trimmed.indexOf("{");
  const arrayIndex = trimmed.indexOf("[");
  const indices = [objectIndex, arrayIndex].filter((value) => value >= 0);

  if (indices.length === 0) {
    throw new Error(`gws did not return ${failureLabel} JSON output`);
  }

  return trimmed.slice(Math.min(...indices));
}

function describeCommandFailure(result: CommandRunnerResult, fallback: string): string {
  if (result.error) {
    return result.error.message;
  }

  const detail = [result.stderr, result.stdout].find((value) => value.trim().length > 0);

  return detail?.trim() ?? fallback;
}

function isMissingBinaryError(error: Error | undefined): boolean {
  const candidate = error as NodeJS.ErrnoException | undefined;
  return candidate?.code === "ENOENT";
}

function hasCalendarScope(scopes: string[]): boolean {
  return scopes.some((scope) => scope === "https://www.googleapis.com/auth/calendar" || scope.startsWith("https://www.googleapis.com/auth/calendar."));
}

function parseAuthStatus(output: string): GWSAuthStatus {
  return JSON.parse(extractJsonPayload(output, "auth status")) as GWSAuthStatus;
}

function parseEventTimestamp(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  return normalizeIsoTimestamp(value.dateTime);
}

function toMeeting(value: unknown): GWSCalendarMeeting | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const id = normalizeOptionalString(value.id);
  const status = normalizeOptionalString(value.status);
  const eventType = normalizeOptionalString(value.eventType);
  const startAt = parseEventTimestamp(value.start);
  const endAt = parseEventTimestamp(value.end);

  if (!id || !startAt || !endAt) {
    return undefined;
  }

  if (status === "cancelled") {
    return undefined;
  }

  if (eventType && eventType !== "default") {
    return undefined;
  }

  if (Date.parse(endAt) <= Date.parse(startAt)) {
    return undefined;
  }

  return {
    id,
    summary: normalizeOptionalString(value.summary),
    startAt,
    endAt,
    attendeesCount: Array.isArray(value.attendees) ? value.attendees.length : undefined,
  };
}

export function getGWSCalendarCollectorInfo(): CollectorInfo {
  const currentFilePath = fileURLToPath(import.meta.url);
  const scriptPath = currentFilePath.replace(
    /gws-calendar\.(?:ts|js)$/u,
    `gws-calendar-runner${currentFilePath.endsWith(".ts") ? ".ts" : ".js"}`,
  );

  return {
    id: "gws-calendar",
    name: "gws Calendar Boundary Collector",
    platform: "cross-platform",
    runtime: "node",
    description:
      "Polls Google Calendar through the gws CLI and emits meeting start/end boundary signals to the local ingest server.",
    supportedEventTypes: ["calendar.meeting.start", "calendar.meeting.end"],
    scriptPath,
  };
}

export function getGWSCalendarCollectorStatus(
  options: {
    calendarId?: string | undefined;
    commandRunner?: GWSCommandRunner | undefined;
  } = {},
): GWSCalendarCollectorStatus {
  const commandRunner = options.commandRunner ?? defaultCommandRunner;
  const selectedCalendarId = options.calendarId ?? DEFAULT_GWS_CALENDAR_ID;
  const result = commandRunner(["auth", "status"]);

  if (isMissingBinaryError(result.error)) {
    return {
      collector: "gws-calendar",
      command: "gws",
      selectedCalendarId,
      installed: false,
      ready: false,
      status: "missing_binary",
      detail: "gws CLI is not installed or not available on PATH",
    };
  }

  if (result.status !== 0) {
    return {
      collector: "gws-calendar",
      command: "gws",
      selectedCalendarId,
      installed: true,
      ready: false,
      status: "auth_error",
      detail: describeCommandFailure(result, "gws auth status failed"),
    };
  }

  let authStatus: GWSAuthStatus;

  try {
    authStatus = parseAuthStatus(result.stdout);
  } catch (error) {
    return {
      collector: "gws-calendar",
      command: "gws",
      selectedCalendarId,
      installed: true,
      ready: false,
      status: "auth_error",
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  const scopes = Array.isArray(authStatus.scopes)
    ? authStatus.scopes.filter((scope): scope is string => typeof scope === "string")
    : [];
  const calendarScopeGranted = hasCalendarScope(scopes);
  const tokenValid = authStatus.token_valid === true;
  const ready = tokenValid && calendarScopeGranted;

  return {
    collector: "gws-calendar",
    command: "gws",
    selectedCalendarId,
    installed: true,
    ready,
    status: ready ? "available" : calendarScopeGranted ? "auth_error" : "missing_scope",
    detail: ready
      ? undefined
      : calendarScopeGranted
        ? "gws auth is present but the token is not currently valid"
        : "gws auth is missing a Calendar scope",
    authMethod: authStatus.auth_method,
    tokenValid,
    hasRefreshToken: authStatus.has_refresh_token === true,
    user: authStatus.user,
    projectId: authStatus.project_id,
    calendarScopeGranted,
  };
}

export function listGWSCalendarMeetings(
  options: {
    calendarId?: string | undefined;
    timeMin: string;
    timeMax: string;
    maxResults?: number | undefined;
    commandRunner?: GWSCommandRunner | undefined;
  },
): GWSCalendarMeeting[] {
  const commandRunner = options.commandRunner ?? defaultCommandRunner;
  const result = commandRunner([
    "calendar",
    "events",
    "list",
    "--params",
    JSON.stringify({
      calendarId: options.calendarId ?? DEFAULT_GWS_CALENDAR_ID,
      singleEvents: true,
      orderBy: "startTime",
      timeMin: options.timeMin,
      timeMax: options.timeMax,
      maxResults: options.maxResults ?? 100,
      eventTypes: "default",
    }),
  ]);

  if (isMissingBinaryError(result.error)) {
    throw new Error("gws CLI is not installed or not available on PATH");
  }

  if (result.status !== 0) {
    throw new Error(describeCommandFailure(result, "gws calendar events list failed"));
  }

  const payload = JSON.parse(extractJsonPayload(result.stdout, "calendar event list"));
  const items = isRecord(payload) && Array.isArray(payload.items) ? payload.items : [];

  return items
    .map((entry) => toMeeting(entry))
    .filter((entry): entry is GWSCalendarMeeting => Boolean(entry))
    .sort((left, right) => left.startAt.localeCompare(right.startAt));
}

export function filterActiveCalendarMeetings(
  meetings: GWSCalendarMeeting[],
  at: string = new Date().toISOString(),
): GWSCalendarMeeting[] {
  const activeAt = Date.parse(at);

  return meetings.filter((meeting) => {
    const startAt = Date.parse(meeting.startAt);
    const endAt = Date.parse(meeting.endAt);

    return startAt <= activeAt && activeAt < endAt;
  });
}

export function diffActiveCalendarMeetings(
  previous: Map<string, GWSCalendarMeeting>,
  current: Map<string, GWSCalendarMeeting>,
): {
  started: GWSCalendarMeeting[];
  ended: GWSCalendarMeeting[];
} {
  const started = [...current.values()]
    .filter((meeting) => !previous.has(meeting.id))
    .sort((left, right) => left.startAt.localeCompare(right.startAt));
  const ended = [...previous.values()]
    .filter((meeting) => !current.has(meeting.id))
    .sort((left, right) => left.endAt.localeCompare(right.endAt));

  return {
    started,
    ended,
  };
}

export function createCalendarSignalRawEvent(args: {
  signalType: CalendarSignalType;
  meeting: GWSCalendarMeeting;
}): RawEventInput {
  const startAt = normalizeIsoTimestamp(args.meeting.startAt) ?? args.meeting.startAt;
  const endAt = normalizeIsoTimestamp(args.meeting.endAt) ?? args.meeting.endAt;

  return {
    source: "calendar",
    sourceEventType: `calendar.meeting.${args.signalType === "meeting_start" ? "start" : "end"}`,
    timestamp: args.signalType === "meeting_start" ? startAt : endAt,
    application: "gws-calendar",
    action: "calendar_signal",
    target: args.signalType,
    metadata: {
      calendarSignal: buildCalendarSignalMetadata({
        signalType: args.signalType,
        eventId: args.meeting.id,
        summary: args.meeting.summary,
        startAt,
        endAt,
        attendeesCount: args.meeting.attendeesCount,
      }),
    },
  };
}

export function buildCalendarPollingWindow(now = Date.now()): {
  timeMin: string;
  timeMax: string;
} {
  return {
    timeMin: new Date(now - DEFAULT_GWS_CALENDAR_LOOKBACK_MS).toISOString(),
    timeMax: new Date(now + DEFAULT_GWS_CALENDAR_LOOKAHEAD_MS).toISOString(),
  };
}
