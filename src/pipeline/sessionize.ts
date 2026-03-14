import type { NormalizedEvent, Session, SessionStep } from "../domain/types.js";
import { stableId } from "../domain/ids.js";

export interface SessionizeOptions {
  inactivityThresholdMs?: number;
  contextShiftThresholdMs?: number;
}

interface MutableSession {
  events: NormalizedEvent[];
}

const DEFAULT_INACTIVITY_THRESHOLD_MS = 5 * 60 * 1000;
const DEFAULT_CONTEXT_SHIFT_THRESHOLD_MS = 90 * 1000;

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

function shouldStartNewSession(
  previous: NormalizedEvent,
  current: NormalizedEvent,
  options: Required<SessionizeOptions>,
): boolean {
  const gapMs = new Date(current.timestamp).getTime() - new Date(previous.timestamp).getTime();

  if (gapMs > options.inactivityThresholdMs) {
    return true;
  }

  if (gapMs > options.contextShiftThresholdMs && previous.application !== current.application) {
    return true;
  }

  if (
    gapMs > options.contextShiftThresholdMs &&
    previous.domain &&
    current.domain &&
    previous.domain !== current.domain
  ) {
    return true;
  }

  return false;
}

function toSession(events: NormalizedEvent[]): Session {
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

  const effectiveOptions: Required<SessionizeOptions> = {
    inactivityThresholdMs: options.inactivityThresholdMs ?? DEFAULT_INACTIVITY_THRESHOLD_MS,
    contextShiftThresholdMs: options.contextShiftThresholdMs ?? DEFAULT_CONTEXT_SHIFT_THRESHOLD_MS,
  };

  const sortedEvents = [...normalizedEvents].sort((left, right) =>
    left.timestamp.localeCompare(right.timestamp),
  );
  const sessions: MutableSession[] = [{ events: [sortedEvents[0] as NormalizedEvent] }];

  for (const event of sortedEvents.slice(1)) {
    const currentSession = sessions[sessions.length - 1];
    const previousEvent = currentSession?.events[currentSession.events.length - 1];

    if (!currentSession || !previousEvent || shouldStartNewSession(previousEvent, event, effectiveOptions)) {
      sessions.push({ events: [event] });
      continue;
    }

    currentSession.events.push(event);
  }

  return sessions.map((session) => toSession(session.events));
}
