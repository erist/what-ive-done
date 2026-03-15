import {
  DEFAULT_SESSION_SEGMENTATION_CONFIG,
  type SessionSegmentationConfig,
} from "../config/analysis.js";
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
  const gapMs = new Date(current.timestamp).getTime() - new Date(previous.timestamp).getTime();
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

function toSession(session: MutableSession): Session {
  const { events } = session;
  const startTime = events[0]?.timestamp ?? new Date().toISOString();
  const endTime = events[events.length - 1]?.timestamp ?? startTime;
  const seed = events.map((event) => event.id).join("|");
  const steps: SessionStep[] = events.map((event, index) => ({
    order: index + 1,
    normalizedEventId: event.id,
    timestamp: event.timestamp,
    action: event.action,
    actionName: event.actionName,
    actionConfidence: event.actionConfidence,
    actionSource: event.actionSource,
    application: event.application,
    domain: event.domain,
    target: event.target,
  }));

  return {
    id: stableId("session", seed),
    startTime,
    endTime,
    primaryApplication: countMostCommon(events.map((event) => event.application)),
    primaryDomain: countMostCommonOptional(
      events.map((event) => event.domain).filter((value): value is string => Boolean(value)),
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
  };

  const sortedEvents = [...normalizedEvents].sort((left, right) =>
    left.timestamp.localeCompare(right.timestamp),
  );
  const sessions: MutableSession[] = [
    {
      events: [sortedEvents[0] as NormalizedEvent],
      sessionBoundaryReason: "stream_start",
      sessionBoundaryDetails: {
        reason: "first_event",
      },
    },
  ];

  for (const event of sortedEvents.slice(1)) {
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

    const boundary = shouldStartNewSession(previousEvent, event, effectiveOptions);

    if (boundary.shouldSplit) {
      sessions.push({
        events: [event],
        sessionBoundaryReason: boundary.reason ?? "context_shift",
        sessionBoundaryDetails: boundary.details ?? {},
      });
      continue;
    }

    currentSession.events.push(event);
  }

  return sessions.map((session) => toSession(session));
}
