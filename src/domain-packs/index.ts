import type { RawEvent } from "../domain/types.js";
import type {
  DomainPackContext,
  DomainPackCoverageReport,
  DomainRouteTaxonomy,
  MatchedDomainPack,
  DomainPackDefinition,
} from "./types.js";
import { bigqueryConsolePack } from "./packs/bigquery-console.js";
import { googleCalendarPack } from "./packs/google-calendar.js";
import { googleDocsPack } from "./packs/google-docs.js";
import { googleMailPack } from "./packs/google-mail.js";
import { googleSheetsPack } from "./packs/google-sheets.js";
import { makestarAdminPack } from "./packs/makestar-admin.js";
import { notionPack } from "./packs/notion.js";

export const DOMAIN_PACK_REGISTRY_VERSION = 1;

export const DEFAULT_DOMAIN_PACKS: DomainPackDefinition[] = [
  makestarAdminPack,
  googleMailPack,
  googleCalendarPack,
  googleSheetsPack,
  googleDocsPack,
  notionPack,
  bigqueryConsolePack,
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeRouteTaxonomy(value: unknown): DomainRouteTaxonomy | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const normalized = {
    source: normalizeOptionalString(value.source),
    signature: normalizeOptionalString(value.signature),
    routeTemplate: normalizeOptionalString(value.routeTemplate),
    primarySection: normalizeOptionalString(value.primarySection),
    secondarySection: normalizeOptionalString(value.secondarySection),
    leafSection: normalizeOptionalString(value.leafSection),
    dynamicSegmentCount: normalizeOptionalNumber(value.dynamicSegmentCount),
  };

  return Object.values(normalized).some((entry) => entry !== undefined) ? normalized : undefined;
}

function buildContext(args: {
  rawEvent: RawEvent;
  domain?: string | undefined;
  canonicalUrl?: string | undefined;
  routeTemplate?: string | undefined;
  titlePattern?: string | undefined;
  target?: string | undefined;
}): DomainPackContext {
  const browserContext = isRecord(args.rawEvent.metadata.browserContext)
    ? args.rawEvent.metadata.browserContext
    : undefined;

  return {
    rawEvent: args.rawEvent,
    domain: args.domain,
    canonicalUrl: args.canonicalUrl,
    routeTemplate: args.routeTemplate,
    titlePattern: args.titlePattern,
    target: args.target,
    routeTaxonomy: normalizeRouteTaxonomy(browserContext?.routeTaxonomy),
  };
}

export function matchDomainPack(
  args: {
    rawEvent: RawEvent;
    domain?: string | undefined;
    canonicalUrl?: string | undefined;
    routeTemplate?: string | undefined;
    titlePattern?: string | undefined;
    target?: string | undefined;
  },
  packs: DomainPackDefinition[] = DEFAULT_DOMAIN_PACKS,
): MatchedDomainPack | undefined {
  const context = buildContext(args);
  const normalizedDomain = context.domain?.toLowerCase();

  if (!normalizedDomain) {
    return undefined;
  }

  for (const pack of packs) {
    if (!pack.domainTokens.some((token) => normalizedDomain.includes(token))) {
      continue;
    }

    const match = pack.match(context);

    if (!match) {
      continue;
    }

    return {
      packId: pack.id,
      packVersion: pack.version,
      routeFamily: match.routeFamily,
      pageType: match.pageType,
      resourceHint: match.resourceHint,
      matchSource: match.matchSource,
    };
  }

  return undefined;
}

export function buildDomainPackCoverageReport(
  events: Array<{
    domain?: string | undefined;
    routeFamily?: string | undefined;
    browserSchemaVersion?: number | undefined;
    source?: RawEvent["source"] | undefined;
  }>,
): DomainPackCoverageReport {
  const coverageByDomain = new Map<
    string,
    { totalBrowserEvents: number; matchedEvents: number; unmatchedEvents: number }
  >();

  let totalBrowserEvents = 0;
  let matchedEvents = 0;

  for (const event of events) {
    const isBrowserEvent =
      event.source === "chrome_extension" ||
      Boolean(event.browserSchemaVersion) ||
      Boolean(event.domain);

    if (!isBrowserEvent) {
      continue;
    }

    totalBrowserEvents += 1;

    const domain = event.domain ?? "unknown";
    const bucket = coverageByDomain.get(domain) ?? {
      totalBrowserEvents: 0,
      matchedEvents: 0,
      unmatchedEvents: 0,
    };

    bucket.totalBrowserEvents += 1;

    if (event.routeFamily) {
      matchedEvents += 1;
      bucket.matchedEvents += 1;
    } else {
      bucket.unmatchedEvents += 1;
    }

    coverageByDomain.set(domain, bucket);
  }

  const unmatchedEvents = totalBrowserEvents - matchedEvents;

  return {
    totalBrowserEvents,
    matchedEvents,
    unmatchedEvents,
    matchRate: totalBrowserEvents === 0 ? 0 : matchedEvents / totalBrowserEvents,
    domains: [...coverageByDomain.entries()]
      .map(([domain, stats]) => ({
        domain,
        totalBrowserEvents: stats.totalBrowserEvents,
        matchedEvents: stats.matchedEvents,
        unmatchedEvents: stats.unmatchedEvents,
        matchRate:
          stats.totalBrowserEvents === 0 ? 0 : stats.matchedEvents / stats.totalBrowserEvents,
      }))
      .sort(
        (left, right) =>
          right.unmatchedEvents - left.unmatchedEvents ||
          right.totalBrowserEvents - left.totalBrowserEvents ||
          left.domain.localeCompare(right.domain),
      ),
  };
}
