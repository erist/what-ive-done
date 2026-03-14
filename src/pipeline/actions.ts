import {
  DEFAULT_ACTION_ABSTRACTION_CONFIG,
  type ActionAbstractionConfig,
  type ActionRule,
} from "../config/analysis.js";
import type { ActionSource, NormalizedEvent } from "../domain/types.js";

type ActionlessNormalizedEvent = Omit<
  NormalizedEvent,
  "actionName" | "actionConfidence" | "actionSource"
>;

interface NearbyContext {
  previousNearby?: ActionlessNormalizedEvent | undefined;
  nextNearby?: ActionlessNormalizedEvent | undefined;
}

function millisecondsBetween(left: string, right: string): number {
  return Math.abs(new Date(left).getTime() - new Date(right).getTime());
}

function normalizeIdentifier(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function specificity(rule: ActionRule): number {
  return [
    rule.applications,
    rule.domains,
    rule.eventTypes,
    rule.pageTypes,
    rule.targetIncludes,
    rule.resourceHints,
  ].filter((value) => Boolean(value && value.length > 0)).length;
}

function buildNearbyContext(
  events: ActionlessNormalizedEvent[],
  index: number,
  config: ActionAbstractionConfig,
): NearbyContext {
  const current = events[index];

  if (!current) {
    return {};
  }

  const previousNearby = [...events.slice(0, index)]
    .reverse()
    .find(
      (event) =>
        event.application === current.application &&
        event.domain === current.domain &&
        millisecondsBetween(event.timestamp, current.timestamp) <= config.nearbyContextWindowMs,
    );
  const nextNearby = events.slice(index + 1).find(
    (event) =>
      event.application === current.application &&
      event.domain === current.domain &&
      millisecondsBetween(event.timestamp, current.timestamp) <= config.nearbyContextWindowMs,
  );

  return {
    previousNearby,
    nextNearby,
  };
}

function eventMatchesRule(
  event: ActionlessNormalizedEvent,
  rule: ActionRule,
  context: NearbyContext,
): boolean {
  const directTargetValue = (event.target ?? "").toLowerCase();
  const contextualTargetValue = [context.previousNearby?.target, context.nextNearby?.target]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();
  const targetValue = directTargetValue || contextualTargetValue;
  const pageType = event.pageType ?? context.previousNearby?.pageType ?? context.nextNearby?.pageType;
  const resourceHint =
    event.resourceHint ??
    context.previousNearby?.resourceHint ??
    context.nextNearby?.resourceHint;

  if (rule.applications && !rule.applications.includes(event.application)) {
    return false;
  }

  if (
    rule.domains &&
    !rule.domains.some((domainToken) => (event.domain ?? "").toLowerCase().includes(domainToken))
  ) {
    return false;
  }

  if (rule.eventTypes && !rule.eventTypes.includes(event.action)) {
    return false;
  }

  if (rule.pageTypes && !rule.pageTypes.includes(pageType ?? "")) {
    return false;
  }

  if (
    rule.targetIncludes &&
    !rule.targetIncludes.some((token) => targetValue.includes(token.toLowerCase()))
  ) {
    return false;
  }

  if (rule.resourceHints && !rule.resourceHints.includes(resourceHint ?? "")) {
    return false;
  }

  return true;
}

function selectActionRule(
  event: ActionlessNormalizedEvent,
  context: NearbyContext,
  config: ActionAbstractionConfig,
): ActionRule | undefined {
  return [...config.rules]
    .filter((rule) => eventMatchesRule(event, rule, context))
    .sort((left, right) => specificity(right) - specificity(left) || right.confidence - left.confidence)[0];
}

function inferFromPageType(pageType: string, resourceHint: string | undefined): string {
  if (pageType.endsWith("_edit") && resourceHint) {
    return `edit_${resourceHint}`;
  }

  if (pageType.endsWith("_detail") && resourceHint) {
    return `review_${resourceHint}`;
  }

  if (pageType.endsWith("_list") && resourceHint) {
    return `open_${resourceHint}_list`;
  }

  return `open_${pageType}`;
}

function inferAction(event: ActionlessNormalizedEvent, context: NearbyContext): {
  actionName: string;
  actionConfidence: number;
  actionSource: ActionSource;
} {
  const target = event.target ?? context.previousNearby?.target ?? context.nextNearby?.target;
  const pageType = event.pageType ?? context.previousNearby?.pageType ?? context.nextNearby?.pageType;
  const resourceHint =
    event.resourceHint ??
    context.previousNearby?.resourceHint ??
    context.nextNearby?.resourceHint;

  if (target) {
    return {
      actionName: normalizeIdentifier(target),
      actionConfidence: 0.74,
      actionSource: "inferred",
    };
  }

  if (pageType) {
    return {
      actionName: inferFromPageType(pageType, resourceHint),
      actionConfidence: 0.69,
      actionSource: "inferred",
    };
  }

  if (event.action === "application_switch") {
    return {
      actionName: `switch_to_${normalizeIdentifier(event.application)}`,
      actionConfidence: 0.62,
      actionSource: "inferred",
    };
  }

  if (event.action === "file_download") {
    return {
      actionName: "export_file",
      actionConfidence: 0.67,
      actionSource: "inferred",
    };
  }

  if (resourceHint) {
    return {
      actionName: `${normalizeIdentifier(event.action)}_${normalizeIdentifier(resourceHint)}`,
      actionConfidence: 0.58,
      actionSource: "inferred",
    };
  }

  return {
    actionName: normalizeIdentifier(event.action),
    actionConfidence: 0.5,
    actionSource: "inferred",
  };
}

export function abstractNormalizedEvents(
  events: ActionlessNormalizedEvent[],
  config: ActionAbstractionConfig = DEFAULT_ACTION_ABSTRACTION_CONFIG,
): NormalizedEvent[] {
  return events.map((event, index) => {
    const context = buildNearbyContext(events, index, config);
    const matchedRule = selectActionRule(event, context, config);

    if (matchedRule) {
      return {
        ...event,
        actionName: matchedRule.actionName,
        actionConfidence: matchedRule.confidence,
        actionSource: matchedRule.source ?? "rule",
      };
    }

    return {
      ...event,
      ...inferAction(event, context),
    };
  });
}
