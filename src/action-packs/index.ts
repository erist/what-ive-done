import type {
  ActionPackContext,
  ActionPackDefinition,
  ActionPackRule,
  MatchedActionPackRule,
} from "./types.js";
import { bigqueryActionPack } from "./packs/bigquery.js";
import { desktopProductivityActionPack } from "./packs/desktop-productivity.js";
import { generalWebActionPack } from "./packs/general-web.js";
import { googleSheetsActionPack } from "./packs/google-sheets.js";
import { makestarAdminActionPack } from "./packs/makestar-admin.js";

export const ACTION_PACK_REGISTRY_VERSION = 1;

export const DEFAULT_ACTION_PACKS: ActionPackDefinition[] = [
  makestarAdminActionPack,
  googleSheetsActionPack,
  bigqueryActionPack,
  generalWebActionPack,
  desktopProductivityActionPack,
];

function specificity(rule: ActionPackRule): number {
  return [
    rule.applications,
    rule.domains,
    rule.domainPackIds,
    rule.routeFamilies,
    rule.eventTypes,
    rule.pageTypes,
    rule.targetIncludes,
    rule.resourceHints,
  ].filter((value) => Boolean(value && value.length > 0)).length;
}

function eventMatchesRule(context: ActionPackContext, rule: ActionPackRule): boolean {
  const { event } = context;
  const contextualTargetValue = [context.previousNearby?.target, context.nextNearby?.target]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();
  const targetValue = ((event.target ?? "").toLowerCase() || contextualTargetValue).trim();
  const pageType = event.pageType ?? context.previousNearby?.pageType ?? context.nextNearby?.pageType;
  const resourceHint =
    event.resourceHint ??
    context.previousNearby?.resourceHint ??
    context.nextNearby?.resourceHint;
  const application = event.application.toLowerCase();
  const domain = (event.domain ?? "").toLowerCase();
  const domainPackId = event.domainPackId;
  const routeFamily = event.routeFamily;

  if (rule.applications && !rule.applications.includes(application)) {
    return false;
  }

  if (rule.domains && !rule.domains.some((token) => domain.includes(token.toLowerCase()))) {
    return false;
  }

  if (rule.domainPackIds && !rule.domainPackIds.includes(domainPackId ?? "")) {
    return false;
  }

  if (rule.routeFamilies && !rule.routeFamilies.includes(routeFamily ?? "")) {
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

function layerPriority(layer: ActionPackRule["layer"]): number {
  switch (layer) {
    case "domain_pack":
      return 3;
    case "page_type":
      return 2;
    case "generic":
      return 1;
  }
}

export function matchActionPackRule(
  context: ActionPackContext,
  packs: ActionPackDefinition[] = DEFAULT_ACTION_PACKS,
): MatchedActionPackRule | undefined {
  return packs
    .flatMap((pack) =>
      pack.rules
        .filter((rule) => eventMatchesRule(context, rule))
        .map((rule) => ({
          pack,
          rule,
        })),
    )
    .sort(
      (left, right) =>
        layerPriority(right.rule.layer) - layerPriority(left.rule.layer) ||
        right.pack.priority - left.pack.priority ||
        specificity(right.rule) - specificity(left.rule) ||
        right.rule.confidence - left.rule.confidence,
    )
    .map(({ pack, rule }) => ({
      actionName: rule.actionName,
      actionConfidence: rule.confidence,
      actionSource: rule.source ?? "rule",
      packId: pack.id,
      packVersion: pack.version,
      ruleId: rule.id,
      layer: rule.layer,
    }))[0];
}
