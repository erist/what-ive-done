import { createHash } from "node:crypto";

export type CalendarSignalType = "meeting_start" | "meeting_end";

export interface CalendarSignalMetadata {
  signalType: CalendarSignalType;
  eventIdHash?: string | undefined;
  summaryHash?: string | undefined;
  startAt?: string | undefined;
  endAt?: string | undefined;
  attendeesCount?: number | undefined;
  signalOnly?: true | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeOptionalInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function normalizeIsoTimestamp(value: unknown): string | undefined {
  const normalized = normalizeOptionalString(value);

  if (!normalized || Number.isNaN(Date.parse(normalized))) {
    return undefined;
  }

  return normalized;
}

function normalizeOpaqueHash(value: unknown): string | undefined {
  const normalized = normalizeOptionalString(value)?.toLowerCase();

  if (!normalized || !/^[0-9a-f]{8,64}$/.test(normalized)) {
    return undefined;
  }

  return normalized;
}

export function hashCalendarField(value: string | undefined): string | undefined {
  if (!value || value.trim().length === 0) {
    return undefined;
  }

  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex").slice(0, 16);
}

export function sanitizeCalendarSignal(value: unknown): CalendarSignalMetadata | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const signalType = normalizeOptionalString(value.signalType);

  if (signalType !== "meeting_start" && signalType !== "meeting_end") {
    return undefined;
  }

  return {
    signalType,
    eventIdHash: normalizeOpaqueHash(value.eventIdHash),
    summaryHash: normalizeOpaqueHash(value.summaryHash),
    startAt: normalizeIsoTimestamp(value.startAt),
    endAt: normalizeIsoTimestamp(value.endAt),
    attendeesCount: normalizeOptionalInteger(value.attendeesCount),
    signalOnly: value.signalOnly === true ? true : undefined,
  };
}

export function parseCalendarSignalMetadata(value: unknown): CalendarSignalMetadata | undefined {
  return sanitizeCalendarSignal(value);
}

export function buildCalendarSignalMetadata(args: {
  signalType: CalendarSignalType;
  eventId?: string | undefined;
  summary?: string | undefined;
  startAt?: string | undefined;
  endAt?: string | undefined;
  attendeesCount?: number | undefined;
}): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries({
      signalType: args.signalType,
      eventIdHash: hashCalendarField(args.eventId),
      summaryHash: hashCalendarField(args.summary),
      startAt: args.startAt,
      endAt: args.endAt,
      attendeesCount: args.attendeesCount,
      signalOnly: true,
    }).filter(([, entry]) => entry !== undefined),
  );
}
