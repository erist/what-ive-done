import { DEFAULT_NORMALIZATION_CONFIG, type NormalizationConfig } from "../config/analysis.js";
import type { NormalizedEvent, RawEvent } from "../domain/types.js";
import { stableId } from "../domain/ids.js";
import { abstractNormalizedEvents } from "./actions.js";

const ACTION_BY_SOURCE_EVENT_TYPE: Record<string, string> = {
  "app.switch": "application_switch",
  "application.switch": "application_switch",
  "browser.click": "button_click",
  "chrome.click": "button_click",
  "chrome.navigation": "page_navigation",
  "clipboard.use": "clipboard_usage",
  "dom.click": "button_click",
  "file.delete": "file_operation",
  "file.download": "file_download",
  "file.open": "file_operation",
  "file.save": "file_operation",
  "form.submit": "form_submit",
  "mouse.click": "button_click",
  "tab.navigation": "page_navigation",
};

const UUID_LIKE_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LONG_HEX_SEGMENT = /^[0-9a-f]{12,}$/i;
const NUMERIC_SEGMENT = /^\d+$/;
const NUMBER_SEQUENCE = /\b\d{2,}\b/g;
const UUID_SEQUENCE =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;

function normalizeAction(rawEvent: RawEvent): string {
  return ACTION_BY_SOURCE_EVENT_TYPE[rawEvent.sourceEventType] ?? rawEvent.action;
}

function normalizeAppName(application: string, config: NormalizationConfig): string {
  const normalized = application.trim().toLowerCase();

  return config.appAliases[normalized] ?? normalized.replace(/\s+/g, "_");
}

function normalizePathSegment(segment: string): string {
  if (NUMERIC_SEGMENT.test(segment)) {
    return "{id}";
  }

  if (UUID_LIKE_SEGMENT.test(segment)) {
    return "{uuid}";
  }

  if (LONG_HEX_SEGMENT.test(segment)) {
    return "{id}";
  }

  return segment.toLowerCase();
}

function normalizePathPattern(url: URL | undefined): string | undefined {
  if (!url) {
    return undefined;
  }

  const segments = url.pathname
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => normalizePathSegment(segment));

  if (segments.length === 0) {
    return "/";
  }

  return `/${segments.join("/")}`;
}

function normalizeTitlePattern(title: string | undefined): string | undefined {
  if (!title) {
    return undefined;
  }

  return title
    .trim()
    .replace(UUID_SEQUENCE, "{uuid}")
    .replace(/#\d+/g, "#{id}")
    .replace(NUMBER_SEQUENCE, "{id}")
    .replace(/\s+/g, " ");
}

function tryParseUrl(rawEvent: RawEvent): URL | undefined {
  if (!rawEvent.url) {
    return undefined;
  }

  try {
    return new URL(rawEvent.url);
  } catch {
    return undefined;
  }
}

function normalizeUrl(url: URL | undefined, config: NormalizationConfig): string | undefined {
  if (!url) {
    return undefined;
  }

  const normalized = new URL(url.toString());

  normalized.hash = "";

  if (config.stripQueryParameters) {
    normalized.search = "";
  }

  return normalized.toString();
}

function singularize(value: string): string {
  if (value.endsWith("ies")) {
    return `${value.slice(0, -3)}y`;
  }

  if (value.endsWith("ses")) {
    return value.slice(0, -2);
  }

  if (value.endsWith("s") && value.length > 3) {
    return value.slice(0, -1);
  }

  return value;
}

function deriveResourceHint(args: {
  pathPattern?: string | undefined;
  titlePattern?: string | undefined;
  target?: string | undefined;
}): string | undefined {
  if (args.target) {
    const normalizedTarget = args.target.toLowerCase();

    if (normalizedTarget.includes("order")) {
      return "order";
    }

    if (normalizedTarget.includes("product")) {
      return "product";
    }

    if (normalizedTarget.includes("ticket")) {
      return "ticket";
    }

    if (normalizedTarget.includes("refund")) {
      return "refund";
    }
  }

  if (args.pathPattern) {
    const pathSegments = args.pathPattern.split("/").filter(Boolean);
    const candidate = pathSegments.find(
      (segment) => !segment.startsWith("{") && !["edit", "view", "new", "create"].includes(segment),
    );

    if (candidate) {
      return singularize(candidate);
    }
  }

  if (args.titlePattern) {
    const lowerTitle = args.titlePattern.toLowerCase();

    for (const keyword of ["order", "product", "ticket", "refund", "shipment", "customer"]) {
      if (lowerTitle.includes(keyword)) {
        return keyword;
      }
    }
  }

  return undefined;
}

function derivePageType(args: {
  domain?: string | undefined;
  pathPattern?: string | undefined;
  titlePattern?: string | undefined;
  resourceHint?: string | undefined;
  config: NormalizationConfig;
}): string | undefined {
  for (const rule of args.config.pageTypeRules) {
    const matchesDomain =
      !rule.domainIncludes ||
      rule.domainIncludes.some((domainToken) => (args.domain ?? "").includes(domainToken));
    const matchesPath = !rule.pathPattern || rule.pathPattern.test(args.pathPattern ?? "");
    const matchesTitle = !rule.titlePattern || rule.titlePattern.test(args.titlePattern ?? "");

    if (matchesDomain && matchesPath && matchesTitle) {
      return rule.pageType;
    }
  }

  if (args.resourceHint && args.pathPattern?.endsWith("/edit")) {
    return `${args.resourceHint}_edit`;
  }

  if (args.resourceHint && /\/\{(?:id|uuid)\}$/.test(args.pathPattern ?? "")) {
    return `${args.resourceHint}_detail`;
  }

  if (args.resourceHint && (args.pathPattern === `/${args.resourceHint}` || args.pathPattern === `/${args.resourceHint}s`)) {
    return `${args.resourceHint}_list`;
  }

  return undefined;
}

function deriveDomain(rawEvent: RawEvent, parsedUrl: URL | undefined): string | undefined {
  return rawEvent.domain?.toLowerCase() ?? parsedUrl?.hostname.toLowerCase();
}

export function normalizeRawEvents(
  rawEvents: RawEvent[],
  config: NormalizationConfig = DEFAULT_NORMALIZATION_CONFIG,
): NormalizedEvent[] {
  const baseEvents = [...rawEvents]
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
    .map((rawEvent) => {
      const parsedUrl = tryParseUrl(rawEvent);
      const appNameNormalized = normalizeAppName(rawEvent.application, config);
      const url = normalizeUrl(parsedUrl, config);
      const titlePattern = normalizeTitlePattern(rawEvent.windowTitle);
      const pathPattern = normalizePathPattern(parsedUrl);
      const domain = deriveDomain(rawEvent, parsedUrl);
      const resourceHint = deriveResourceHint({
        pathPattern,
        titlePattern,
        target: rawEvent.target,
      });
      const pageType = derivePageType({
        domain,
        pathPattern,
        titlePattern,
        resourceHint,
        config,
      });

      return {
        id: stableId("normalized_event", rawEvent.id),
        rawEventId: rawEvent.id,
        timestamp: rawEvent.timestamp,
        application: appNameNormalized,
        appNameNormalized,
        domain,
        url,
        pathPattern,
        pageType,
        resourceHint,
        titlePattern,
        action: normalizeAction(rawEvent),
        target: rawEvent.target,
        metadata: {
          ...rawEvent.metadata,
          sourceEventType: rawEvent.sourceEventType,
          source: rawEvent.source,
          rawApplication: rawEvent.application,
          rawDomain: rawEvent.domain,
          rawUrl: rawEvent.url,
          rawWindowTitle: rawEvent.windowTitle,
        },
        createdAt: new Date().toISOString(),
      };
    });

  return abstractNormalizedEvents(baseEvents);
}
