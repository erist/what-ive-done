import {
  DEFAULT_SESSION_SEGMENTATION_CONFIG,
  type SessionSegmentationConfig,
} from "../config/analysis.js";
import { parseCalendarSignalMetadata, type CalendarSignalMetadata } from "../calendar/signals.js";
import type {
  NormalizedEvent,
  Session,
  SessionBoundaryReason,
  SessionStep,
} from "../domain/types.js";
import { stableId } from "../domain/ids.js";

export interface SessionizeOptions {
  inactivityThresholdMs?: number;
  contextShiftThresholdMs?: number;
  interruptionResetThresholdMs?: number;
  significantContextScore?: number;
  rollingWindowMs?: number;
  rollingMinimumGapMs?: number;
}

interface MutableSession {
  events: NormalizedEvent[];
  sessionBoundaryReason: SessionBoundaryReason;
  sessionBoundaryDetails: Record<string, unknown>;
}

interface BoundaryDecision {
  shouldSplit: boolean;
  reason?: SessionBoundaryReason | undefined;
  details?: Record<string, unknown> | undefined;
}

interface PendingCalendarSignal {
  timestamp: string;
  signal: CalendarSignalMetadata;
}

interface RollingSummaryEntry {
  value?: string | undefined;
  count: number;
}

function toTimestampMs(value: string): number | undefined {
  const timestamp = Date.parse(value);

  return Number.isNaN(timestamp) ? undefined : timestamp;
}

function compareTimestamps(left: string, right: string): number {
  const leftTimestamp = toTimestampMs(left);
  const rightTimestamp = toTimestampMs(right);

  if (leftTimestamp !== undefined && rightTimestamp !== undefined && leftTimestamp !== rightTimestamp) {
    return leftTimestamp - rightTimestamp;
  }

  if (leftTimestamp !== undefined && rightTimestamp === undefined) {
    return -1;
  }

  if (leftTimestamp === undefined && rightTimestamp !== undefined) {
    return 1;
  }

  return left.localeCompare(right);
}

function gapBetweenTimestamps(start: string, end: string): number {
  const startTimestamp = toTimestampMs(start);
  const endTimestamp = toTimestampMs(end);

  if (startTimestamp === undefined || endTimestamp === undefined) {
    return Number.NaN;
  }

  return endTimestamp - startTimestamp;
}

function countMostCommon(values: string[]): string {
  const counts = new Map<string, number>();

  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? values[0] ?? "unknown";
}

function countMostCommonOptional(values: string[]): string | undefined {
  if (values.length === 0) {
    return undefined;
  }

  return countMostCommon(values);
}

function mostCommonEntry(values: string[]): RollingSummaryEntry {
  if (values.length === 0) {
    return {
      count: 0,
    };
  }

  const counts = new Map<string, number>();

  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  const [value, count] =
    [...counts.entries()].sort((left, right) => right[1] - left[1])[0] ?? [];

  return {
    value,
    count: count ?? 0,
  };
}

function contextShift(previous: NormalizedEvent, current: NormalizedEvent): {
  score: number;
  changedFields: string[];
} {
  const changedFields: string[] = [];
  let score = 0;

  if (previous.application !== current.application) {
    changedFields.push("application");
    score += 1;
  }

  if (previous.domain && current.domain && previous.domain !== current.domain) {
    changedFields.push("domain");
    score += 1;
  }

  if (
    previous.routeFamily &&
    current.routeFamily &&
    previous.routeFamily !== current.routeFamily
  ) {
    changedFields.push("route_family");
    score += 1;
  }

  if (previous.pageType && current.pageType && previous.pageType !== current.pageType) {
    changedFields.push("page_type");
    score += 1;
  }

  if (
    previous.resourceHint &&
    current.resourceHint &&
    previous.resourceHint !== current.resourceHint
  ) {
    changedFields.push("resource_hint");
    score += 1;
  }

  if (previous.actionName !== current.actionName && /^(open|search|edit|review|update)_/.test(current.actionName)) {
    changedFields.push("action_reset");
    score += 1;
  }

  return {
    score,
    changedFields,
  };
}

function isResetAction(actionName: string): boolean {
  return /^(open|search|edit|review|update|verify)_/.test(actionName);
}

function shouldStartNewSession(
  previous: NormalizedEvent,
  current: NormalizedEvent,
  options: SessionSegmentationConfig,
): BoundaryDecision {
  const gapMs = gapBetweenTimestamps(previous.timestamp, current.timestamp);
  const shift = contextShift(previous, current);
  const hasSignificantContextShift = shift.score >= options.significantContextScore;

  if (gapMs > options.inactivityThresholdMs) {
    return {
      shouldSplit: true,
      reason: hasSignificantContextShift ? "idle_and_context_shift" : "idle_gap",
      details: {
        gapMs,
        contextShiftScore: shift.score,
        changedFields: shift.changedFields,
        previousActionName: previous.actionName,
        currentActionName: current.actionName,
      },
    };
  }

  if (gapMs > options.contextShiftThresholdMs && hasSignificantContextShift) {
    return {
      shouldSplit: true,
      reason: "context_shift",
      details: {
        gapMs,
        contextShiftScore: shift.score,
        changedFields: shift.changedFields,
        previousActionName: previous.actionName,
        currentActionName: current.actionName,
      },
    };
  }

  if (
    gapMs > options.interruptionResetThresholdMs &&
    shift.score > 0 &&
    isResetAction(current.actionName) &&
    previous.actionName !== current.actionName
  ) {
    return {
      shouldSplit: true,
      reason: "reset_after_interruption",
      details: {
        gapMs,
        contextShiftScore: shift.score,
        changedFields: shift.changedFields,
        previousActionName: previous.actionName,
        currentActionName: current.actionName,
      },
    };
  }

  return {
    shouldSplit: false,
  };
}

function buildRollingSummary(
  currentSessionEvents: NormalizedEvent[],
  current: NormalizedEvent,
  options: SessionSegmentationConfig,
): {
  windowEventCount: number;
  dominantApplication: RollingSummaryEntry;
  dominantDomain: RollingSummaryEntry;
  dominantRouteFamily: RollingSummaryEntry;
} {
  const currentTime = toTimestampMs(current.timestamp);
  const recentEvents =
    currentTime === undefined
      ? currentSessionEvents
      : currentSessionEvents.filter((event) => {
          const eventTime = toTimestampMs(event.timestamp);

          return eventTime !== undefined && currentTime - eventTime <= options.rollingWindowMs;
        });

  return {
    windowEventCount: recentEvents.length,
    dominantApplication: mostCommonEntry(recentEvents.map((event) => event.application)),
    dominantDomain: mostCommonEntry(
      recentEvents.map((event) => event.domain).filter((value): value is string => Boolean(value)),
    ),
    dominantRouteFamily: mostCommonEntry(
      recentEvents.map((event) => event.routeFamily).filter((value): value is string => Boolean(value)),
    ),
  };
}

function shouldSuppressBoundaryWithRollingContext(args: {
  boundary: BoundaryDecision;
  previous: NormalizedEvent;
  current: NormalizedEvent;
  currentSessionEvents: NormalizedEvent[];
  options: SessionSegmentationConfig;
}): boolean {
  if (
    args.boundary.reason !== "context_shift" &&
    args.boundary.reason !== "reset_after_interruption"
  ) {
    return false;
  }

  const gapMs = gapBetweenTimestamps(args.previous.timestamp, args.current.timestamp);

  if (gapMs < args.options.rollingMinimumGapMs) {
    return false;
  }

  const summary = buildRollingSummary(args.currentSessionEvents, args.current, args.options);

  if (summary.windowEventCount < 3) {
    return false;
  }

  const applicationDominance = summary.dominantApplication.count / summary.windowEventCount;
  const domainDominance = summary.dominantDomain.count / summary.windowEventCount;
  const routeFamilyDominance = summary.dominantRouteFamily.count / summary.windowEventCount;
  const matchesDominantApplication =
    summary.dominantApplication.value === args.current.application && applicationDominance >= 0.6;
  const matchesDominantDomain =
    summary.dominantDomain.value !== undefined &&
    summary.dominantDomain.value === args.current.domain &&
    domainDominance >= 0.6;
  const matchesDominantRouteFamily =
    summary.dominantRouteFamily.value !== undefined &&
    summary.dominantRouteFamily.value === args.current.routeFamily &&
    routeFamilyDominance >= 0.6;

  return matchesDominantApplication && (matchesDominantDomain || matchesDominantRouteFamily);
}

function buildCalendarSignalBoundary(args: {
  previous: NormalizedEvent;
  current: NormalizedEvent;
  pendingSignals: PendingCalendarSignal[];
}): BoundaryDecision {
  return {
    shouldSplit: true,
    reason: "calendar_signal",
    details: {
      signalCount: args.pendingSignals.length,
      signalTypes: args.pendingSignals.map((entry) => entry.signal.signalType),
      signals: args.pendingSignals.map((entry) => ({
        timestamp: entry.timestamp,
        signalType: entry.signal.signalType,
        eventIdHash: entry.signal.eventIdHash,
        summaryHash: entry.signal.summaryHash,
        startAt: entry.signal.startAt,
        endAt: entry.signal.endAt,
      })),
      previousActionName: args.previous.actionName,
      currentActionName: args.current.actionName,
    },
  };
}

function toSession(session: MutableSession): Session {
  const orderedEvents = [...session.events].sort((left, right) =>
    compareTimestamps(left.timestamp, right.timestamp),
  );
  const startTime = orderedEvents[0]?.timestamp ?? new Date().toISOString();
  const endTimeCandidate = orderedEvents[orderedEvents.length - 1]?.timestamp ?? startTime;
  const endTime =
    gapBetweenTimestamps(startTime, endTimeCandidate) < 0 ? startTime : endTimeCandidate;
  const seed = orderedEvents.map((event) => event.id).join("|");
  const steps: SessionStep[] = orderedEvents.map((event, index) => ({
    order: index + 1,
    normalizedEventId: event.id,
    timestamp: event.timestamp,
    action: event.action,
    actionName: event.actionName,
    actionConfidence: event.actionConfidence,
    actionSource: event.actionSource,
    application: event.application,
    domain: event.domain,
    titlePattern: event.titlePattern,
    target: event.target,
  }));

  return {
    id: stableId("session", seed),
    startTime,
    endTime,
    primaryApplication: countMostCommon(orderedEvents.map((event) => event.application)),
    primaryDomain: countMostCommonOptional(
      orderedEvents.map((event) => event.domain).filter((value): value is string => Boolean(value)),
    ),
    sessionBoundaryReason: session.sessionBoundaryReason,
    sessionBoundaryDetails: session.sessionBoundaryDetails,
    steps,
  };
}

export function sessionizeNormalizedEvents(
  normalizedEvents: NormalizedEvent[],
  options: SessionizeOptions = {},
): Session[] {
  if (normalizedEvents.length === 0) {
    return [];
  }

  const effectiveOptions: SessionSegmentationConfig = {
    inactivityThresholdMs:
      options.inactivityThresholdMs ?? DEFAULT_SESSION_SEGMENTATION_CONFIG.inactivityThresholdMs,
    contextShiftThresholdMs:
      options.contextShiftThresholdMs ?? DEFAULT_SESSION_SEGMENTATION_CONFIG.contextShiftThresholdMs,
    interruptionResetThresholdMs:
      options.interruptionResetThresholdMs ??
      DEFAULT_SESSION_SEGMENTATION_CONFIG.interruptionResetThresholdMs,
    significantContextScore:
      options.significantContextScore ??
      DEFAULT_SESSION_SEGMENTATION_CONFIG.significantContextScore,
    rollingWindowMs:
      options.rollingWindowMs ?? DEFAULT_SESSION_SEGMENTATION_CONFIG.rollingWindowMs,
    rollingMinimumGapMs:
      options.rollingMinimumGapMs ?? DEFAULT_SESSION_SEGMENTATION_CONFIG.rollingMinimumGapMs,
  };

  const sortedEvents = [...normalizedEvents].sort((left, right) =>
    compareTimestamps(left.timestamp, right.timestamp),
  );
  const sessions: MutableSession[] = [];
  const pendingCalendarSignals: PendingCalendarSignal[] = [];

  for (const event of sortedEvents) {
    const calendarSignal = parseCalendarSignalMetadata(event.metadata.calendarSignal);

    if (calendarSignal?.signalOnly) {
      pendingCalendarSignals.push({
        timestamp: event.timestamp,
        signal: calendarSignal,
      });
      continue;
    }

    if (sessions.length === 0) {
      sessions.push({
        events: [event],
        sessionBoundaryReason: "stream_start",
        sessionBoundaryDetails: {
          reason: "first_event",
        },
      });
      pendingCalendarSignals.length = 0;
      continue;
    }

    const currentSession = sessions[sessions.length - 1];
    const previousEvent = currentSession?.events[currentSession.events.length - 1];

    if (!currentSession || !previousEvent) {
      sessions.push({
        events: [event],
        sessionBoundaryReason: "stream_start",
        sessionBoundaryDetails: {
          reason: "recovered_stream_start",
        },
      });
      continue;
    }

    const boundary =
      pendingCalendarSignals.length > 0
        ? buildCalendarSignalBoundary({
            previous: previousEvent,
            current: event,
            pendingSignals: [...pendingCalendarSignals],
          })
        : shouldStartNewSession(previousEvent, event, effectiveOptions);

    if (
      boundary.shouldSplit &&
      pendingCalendarSignals.length === 0 &&
      shouldSuppressBoundaryWithRollingContext({
        boundary,
        previous: previousEvent,
        current: event,
        currentSessionEvents: currentSession.events,
        options: effectiveOptions,
      })
    ) {
      currentSession.events.push(event);
      continue;
    }

    if (boundary.shouldSplit) {
      sessions.push({
        events: [event],
        sessionBoundaryReason: boundary.reason ?? "context_shift",
        sessionBoundaryDetails: boundary.details ?? {},
      });
      pendingCalendarSignals.length = 0;
      continue;
    }

    currentSession.events.push(event);
    pendingCalendarSignals.length = 0;
  }

  return sessions.map((session) => toSession(session));
}
