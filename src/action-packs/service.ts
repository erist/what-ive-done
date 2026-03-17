import { stableId } from "../domain/ids.js";
import type {
  NormalizedEvent,
  RawEvent,
  Session,
  WorkflowCluster,
} from "../domain/types.js";
import { analyzeRawEvents } from "../pipeline/analyze.js";
import type {
  ActionCoverageReport,
  ActionMatchMetadata,
  UnknownActionReviewItem,
} from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeLayer(value: unknown): ActionMatchMetadata["layer"] | undefined {
  return value === "domain_pack" ||
    value === "page_type" ||
    value === "generic" ||
    value === "unknown"
    ? value
    : undefined;
}

export function describeActionMatchMetadata(
  event: Pick<NormalizedEvent, "metadata" | "actionName">,
): ActionMatchMetadata | undefined {
  const actionMatch = isRecord(event.metadata.actionMatch) ? event.metadata.actionMatch : undefined;

  if (!actionMatch) {
    return event.actionName === "unknown_action"
      ? {
          registryVersion: 1,
          layer: "unknown",
        }
      : undefined;
  }

  const layer = normalizeLayer(actionMatch.layer) ?? (event.actionName === "unknown_action" ? "unknown" : undefined);

  if (!layer) {
    return undefined;
  }

  return {
    registryVersion: normalizeOptionalNumber(actionMatch.registryVersion) ?? 1,
    layer,
    packId: normalizeOptionalString(actionMatch.packId),
    packVersion: normalizeOptionalNumber(actionMatch.packVersion),
    ruleId: normalizeOptionalString(actionMatch.ruleId),
    strategy: normalizeOptionalString(actionMatch.strategy),
    reason: normalizeOptionalString(actionMatch.reason),
  };
}

export interface ActionCoverageInspectionRow {
  rawEventId: string;
  timestamp: string;
  application: string;
  eventType: string;
  actionName: string;
  actionLayer: ActionMatchMetadata["layer"];
  actionPackId?: string | undefined;
  routeFamily?: string | undefined;
  domainPackId?: string | undefined;
  pageType?: string | undefined;
  target?: string | undefined;
  titlePattern?: string | undefined;
}

export interface ActionCoverageInspectionResult {
  coverage: ActionCoverageReport;
  reviewQueue: UnknownActionReviewItem[];
  events: ActionCoverageInspectionRow[];
}

function summarizeWorkflowUnknownRate(args: {
  workflowCluster: WorkflowCluster;
  sessionsById: Map<string, Session>;
}) {
  const sessions = args.workflowCluster.sessionIds
    .map((sessionId) => args.sessionsById.get(sessionId))
    .filter((session): session is Session => Boolean(session));
  const totalActionCount = sessions.reduce((sum, session) => sum + session.steps.length, 0);
  const unknownActionCount = sessions.reduce(
    (sum, session) =>
      sum + session.steps.filter((step) => step.actionName === "unknown_action").length,
    0,
  );

  return {
    workflowId: args.workflowCluster.id,
    workflowName: args.workflowCluster.name,
    frequency: args.workflowCluster.frequency,
    unknownActionCount,
    totalActionCount,
    unknownRate: totalActionCount === 0 ? 0 : unknownActionCount / totalActionCount,
    representativeSequence: args.workflowCluster.representativeSequence,
  };
}

export function inspectActionCoverage(rawEvents: RawEvent[]): ActionCoverageInspectionResult {
  const analysis = analyzeRawEvents(rawEvents);
  const events = analysis.normalizedEvents.map((event) => {
    const actionMatch = describeActionMatchMetadata(event);

    return {
      rawEventId: event.rawEventId,
      timestamp: event.timestamp,
      application: event.application,
      eventType: event.action,
      actionName: event.actionName,
      actionLayer: actionMatch?.layer ?? "generic",
      actionPackId: actionMatch?.packId,
      routeFamily: event.routeFamily,
      domainPackId: event.domainPackId,
      pageType: event.pageType,
      target: event.target,
      titlePattern: event.titlePattern,
    };
  });
  const totalEvents = events.length;
  const unknownEvents = events.filter((event) => event.actionName === "unknown_action");
  const sessionsById = new Map(analysis.sessions.map((session) => [session.id, session]));
  const layers = (["domain_pack", "page_type", "generic", "unknown"] as const).map((layer) => {
    const eventCount = events.filter((event) => event.actionLayer === layer).length;

    return {
      layer,
      eventCount,
      rate: totalEvents === 0 ? 0 : eventCount / totalEvents,
    };
  });
  const packs = [...new Set(events.map((event) => event.actionPackId).filter(Boolean))]
    .map((packId) => {
      const packEvents = events.filter((event) => event.actionPackId === packId);
      const unknownEventCount = packEvents.filter((event) => event.actionName === "unknown_action").length;

      return {
        packId: packId ?? "unknown",
        eventCount: packEvents.length,
        unknownEventCount,
        unknownRate: packEvents.length === 0 ? 0 : unknownEventCount / packEvents.length,
      };
    })
    .sort((left, right) => right.eventCount - left.eventCount || left.packId.localeCompare(right.packId));
  const actionCounts = new Map<string, number>();

  for (const event of events) {
    actionCounts.set(event.actionName, (actionCounts.get(event.actionName) ?? 0) + 1);
  }

  const topActions = [...actionCounts.entries()]
    .map(([actionName, eventCount]) => ({
      actionName,
      eventCount,
    }))
    .sort((left, right) => right.eventCount - left.eventCount || left.actionName.localeCompare(right.actionName))
    .slice(0, 10);
  const topWorkflows = [...analysis.workflowClusters]
    .sort(
      (left, right) =>
        right.frequency - left.frequency ||
        right.totalDurationSeconds - left.totalDurationSeconds ||
        left.name.localeCompare(right.name),
    )
    .slice(0, 20)
    .map((workflowCluster) =>
      summarizeWorkflowUnknownRate({
        workflowCluster,
        sessionsById,
      }),
    );
  const reviewGroups = new Map<string, UnknownActionReviewItem>();

  for (const event of unknownEvents) {
    const key = [
      event.application,
      event.eventType,
      event.domainPackId ?? "no-pack",
      event.routeFamily ?? "no-route-family",
      event.pageType ?? "no-page-type",
    ].join("|");
    const queueId = stableId("unknown_action_queue", key);
    const entry = reviewGroups.get(queueId) ?? {
      queueId,
      occurrences: 0,
      application: event.application,
      eventType: event.eventType,
      domain: event.domainPackId ? undefined : rawEvents.find((rawEvent) => rawEvent.id === event.rawEventId)?.domain,
      domainPackId: event.domainPackId,
      routeFamily: event.routeFamily,
      pageType: event.pageType,
      sampleTargets: [],
      sampleTitles: [],
      sampleRawEventIds: [],
    };

    entry.occurrences += 1;

    if (event.target && !entry.sampleTargets.includes(event.target) && entry.sampleTargets.length < 3) {
      entry.sampleTargets.push(event.target);
    }

    if (
      event.titlePattern &&
      !entry.sampleTitles.includes(event.titlePattern) &&
      entry.sampleTitles.length < 3
    ) {
      entry.sampleTitles.push(event.titlePattern);
    }

    if (!entry.sampleRawEventIds.includes(event.rawEventId) && entry.sampleRawEventIds.length < 3) {
      entry.sampleRawEventIds.push(event.rawEventId);
    }

    reviewGroups.set(queueId, entry);
  }

  return {
    coverage: {
      totalEvents,
      unknownEventCount: unknownEvents.length,
      unknownRate: totalEvents === 0 ? 0 : unknownEvents.length / totalEvents,
      layers,
      packs,
      topActions,
      topWorkflows,
    },
    reviewQueue: [...reviewGroups.values()].sort(
      (left, right) => right.occurrences - left.occurrences || left.queueId.localeCompare(right.queueId),
    ),
    events,
  };
}

export function buildActionSuggestionPrompt(
  reviewQueue: UnknownActionReviewItem[],
  options: { limit?: number | undefined } = {},
): string {
  const selected = reviewQueue.slice(0, options.limit ?? 10);

  if (selected.length === 0) {
    return "No unknown_action review items are available.";
  }

  return [
    "You are helping maintain deterministic semantic action packs for a local-first workflow analyzer.",
    "Given the unknown action review queue below, suggest new rule candidates that reduce unknown_action without collecting new sensitive data.",
    "Return JSON with this shape:",
    '[{"queueId":"...", "suggestedActionName":"...", "packId":"...", "layer":"domain_pack|page_type|generic", "matchingHints":{"routeFamilies":["..."],"pageTypes":["..."],"eventTypes":["..."],"targetIncludes":["..."]}, "rationale":"..."}]',
    "Review queue:",
    JSON.stringify(selected, null, 2),
  ].join("\n\n");
}
