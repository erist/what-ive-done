import {
  DEFAULT_ACTION_ABSTRACTION_CONFIG,
  type ActionAbstractionConfig,
} from "../config/analysis.js";
import { parseCalendarSignalMetadata } from "../calendar/signals.js";
import type { ActionSource, NormalizedEvent } from "../domain/types.js";
import { ACTION_PACK_REGISTRY_VERSION, matchActionPackRule } from "../action-packs/index.js";
import type {
  ActionMatchMetadata,
  ActionlessNormalizedEvent,
  NearbyContext,
} from "../action-packs/types.js";

function millisecondsBetween(left: string, right: string): number {
  return Math.abs(new Date(left).getTime() - new Date(right).getTime());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function compactObject<T extends Record<string, unknown>>(value: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function normalizeIdentifier(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "_")
    .replace(/^_+|_+$/g, "");
}

function inferStructuredContextAction(event: ActionlessNormalizedEvent): {
  actionName: string;
  actionConfidence: number;
  actionSource: ActionSource;
  actionMatchMetadata: ActionMatchMetadata;
} | undefined {
  const workspaceContext = isRecord(event.metadata.workspaceContext)
    ? event.metadata.workspaceContext
    : undefined;

  if (workspaceContext) {
    const app = normalizeIdentifier(typeof workspaceContext.app === "string" ? workspaceContext.app : "");
    const itemType = normalizeIdentifier(
      typeof workspaceContext.itemType === "string" ? workspaceContext.itemType : "",
    );
    const activityType = normalizeIdentifier(
      typeof workspaceContext.activityType === "string" ? workspaceContext.activityType : "",
    );
    const normalizedItemType = itemType === "spreadsheet" ? "sheet" : itemType;

    if (app === "sheets") {
      return {
        actionName: activityType === "modified" ? "update_sheet" : "open_sheet",
        actionConfidence: 0.93,
        actionSource: "rule",
        actionMatchMetadata: {
          registryVersion: ACTION_PACK_REGISTRY_VERSION,
          layer: "generic",
          strategy: "workspace_context",
        },
      };
    }

    if (normalizedItemType && activityType) {
      return {
        actionName:
          activityType === "modified"
            ? `update_${normalizedItemType}`
            : normalizedItemType === "folder"
              ? `open_${normalizedItemType}`
              : `review_${normalizedItemType}`,
        actionConfidence: 0.9,
        actionSource: "rule",
        actionMatchMetadata: {
          registryVersion: ACTION_PACK_REGISTRY_VERSION,
          layer: "generic",
          strategy: "workspace_context",
        },
      };
    }
  }

  const gitContext = isRecord(event.metadata.gitContext) ? event.metadata.gitContext : undefined;

  if (gitContext) {
    const dirtyFileCount =
      typeof gitContext.dirtyFileCount === "number" && Number.isFinite(gitContext.dirtyFileCount)
        ? gitContext.dirtyFileCount
        : undefined;

    return {
      actionName: (dirtyFileCount ?? 0) > 0 ? "review_git_changes" : "sync_git_repo",
      actionConfidence: 0.92,
      actionSource: "rule",
      actionMatchMetadata: {
        registryVersion: ACTION_PACK_REGISTRY_VERSION,
        layer: "generic",
        strategy: "git_context",
      },
    };
  }

  return undefined;
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

function hasMeaningfulTarget(target: string): boolean {
  const normalized = normalizeIdentifier(target);

  if (!normalized) {
    return false;
  }

  const tokens = normalized.split("_").filter(Boolean);

  if (tokens.length === 0) {
    return false;
  }

  const genericTokens = new Set([
    "button",
    "card",
    "dialog",
    "dropdown",
    "field",
    "form",
    "icon",
    "input",
    "link",
    "list",
    "menu",
    "modal",
    "panel",
    "row",
    "section",
    "tab",
    "toolbar",
    "view",
  ]);
  const verbTokens = new Set([
    "approve",
    "download",
    "edit",
    "export",
    "focus",
    "notify",
    "open",
    "reply",
    "run",
    "save",
    "search",
    "send",
    "share",
    "submit",
    "update",
  ]);

  return (
    tokens.some((token) => verbTokens.has(token)) ||
    tokens.some((token) => !genericTokens.has(token)) && tokens.length >= 2
  );
}

function inferFromPageType(pageType: string, resourceHint: string | undefined): string {
  const specialCases: Record<string, string> = {
    bigquery_saved_queries: "open_saved_queries",
    bigquery_sql_workspace: "open_query_workspace",
    bigquery_workspace: "open_bigquery_workspace",
    document_edit: "open_document",
    sheet_edit: "open_sheet",
  };

  if (specialCases[pageType]) {
    return specialCases[pageType];
  }

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
  actionMatchMetadata: ActionMatchMetadata;
} {
  const calendarSignal = parseCalendarSignalMetadata(event.metadata.calendarSignal);

  if (calendarSignal?.signalOnly) {
    return {
      actionName: "calendar_signal",
      actionConfidence: 1,
      actionSource: "rule",
      actionMatchMetadata: {
        registryVersion: ACTION_PACK_REGISTRY_VERSION,
        layer: "generic",
        strategy: "calendar_signal",
      },
    };
  }

  const target = event.target ?? context.previousNearby?.target ?? context.nextNearby?.target;
  const pageType = event.pageType ?? context.previousNearby?.pageType ?? context.nextNearby?.pageType;
  const resourceHint =
    event.resourceHint ??
    context.previousNearby?.resourceHint ??
    context.nextNearby?.resourceHint;

  if (target && hasMeaningfulTarget(target)) {
    return {
      actionName: normalizeIdentifier(target),
      actionConfidence: 0.74,
      actionSource: "inferred",
      actionMatchMetadata: {
        registryVersion: ACTION_PACK_REGISTRY_VERSION,
        layer: "generic",
        strategy: "target_inference",
      },
    };
  }

  const structuredContextAction = inferStructuredContextAction(event);

  if (structuredContextAction) {
    return structuredContextAction;
  }

  if (pageType) {
    return {
      actionName: inferFromPageType(pageType, resourceHint),
      actionConfidence: 0.69,
      actionSource: "inferred",
      actionMatchMetadata: {
        registryVersion: ACTION_PACK_REGISTRY_VERSION,
        layer: "page_type",
        strategy: "page_type_inference",
      },
    };
  }

  if (event.action === "application_switch") {
    return {
      actionName: `switch_to_${normalizeIdentifier(event.application)}`,
      actionConfidence: 0.62,
      actionSource: "inferred",
      actionMatchMetadata: {
        registryVersion: ACTION_PACK_REGISTRY_VERSION,
        layer: "generic",
        strategy: "application_switch_inference",
      },
    };
  }

  if (event.action === "file_download") {
    return {
      actionName: "export_file",
      actionConfidence: 0.67,
      actionSource: "inferred",
      actionMatchMetadata: {
        registryVersion: ACTION_PACK_REGISTRY_VERSION,
        layer: "generic",
        strategy: "file_download_inference",
      },
    };
  }

  if (resourceHint) {
    return {
      actionName: `${normalizeIdentifier(event.action)}_${normalizeIdentifier(resourceHint)}`,
      actionConfidence: 0.58,
      actionSource: "inferred",
      actionMatchMetadata: {
        registryVersion: ACTION_PACK_REGISTRY_VERSION,
        layer: "generic",
        strategy: "resource_hint_inference",
      },
    };
  }

  return {
    actionName: "unknown_action",
    actionConfidence: 0.2,
    actionSource: "inferred",
    actionMatchMetadata: {
      registryVersion: ACTION_PACK_REGISTRY_VERSION,
      layer: "unknown",
      reason: "missing_pack_rule_and_low_signal_fallback",
    },
  };
}

function attachActionMatchMetadata(
  event: ActionlessNormalizedEvent,
  action: {
    actionName: string;
    actionConfidence: number;
    actionSource: ActionSource;
    actionMatchMetadata: ActionMatchMetadata;
  },
): NormalizedEvent {
  const metadata = isRecord(event.metadata) ? event.metadata : {};

  return {
    ...event,
    actionName: action.actionName,
    actionConfidence: action.actionConfidence,
    actionSource: action.actionSource,
    metadata: {
      ...metadata,
      actionMatch: compactObject({
        registryVersion: action.actionMatchMetadata.registryVersion,
        layer: action.actionMatchMetadata.layer,
        packId: action.actionMatchMetadata.packId,
        packVersion: action.actionMatchMetadata.packVersion,
        ruleId: action.actionMatchMetadata.ruleId,
        strategy: action.actionMatchMetadata.strategy,
        reason: action.actionMatchMetadata.reason,
      }),
    },
  };
}

export function abstractNormalizedEvents(
  events: ActionlessNormalizedEvent[],
  config: ActionAbstractionConfig = DEFAULT_ACTION_ABSTRACTION_CONFIG,
): NormalizedEvent[] {
  return events.map((event, index) => {
    const context = buildNearbyContext(events, index, config);
    const matchedRule = matchActionPackRule({
      event,
      previousNearby: context.previousNearby,
      nextNearby: context.nextNearby,
    });

    if (matchedRule) {
      return attachActionMatchMetadata(event, {
        actionName: matchedRule.actionName,
        actionConfidence: matchedRule.actionConfidence,
        actionSource: matchedRule.actionSource,
        actionMatchMetadata: {
          registryVersion: ACTION_PACK_REGISTRY_VERSION,
          layer: matchedRule.layer,
          packId: matchedRule.packId,
          packVersion: matchedRule.packVersion,
          ruleId: matchedRule.ruleId,
        },
      });
    }

    return attachActionMatchMetadata(event, inferAction(event, context));
  });
}
