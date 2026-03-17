import type { NormalizedEvent, RawEvent, RawEventInput } from "../domain/types.js";
import { normalizeRawEvents } from "../pipeline/normalize.js";
import { buildDomainPackCoverageReport } from "./index.js";
import type { DomainPackCoverageReport } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export interface DomainPackInspectionRow {
  rawEventId: string;
  timestamp: string;
  domain?: string | undefined;
  routeTemplate?: string | undefined;
  routeFamily?: string | undefined;
  pageType?: string | undefined;
  resourceHint?: string | undefined;
  domainPackId?: string | undefined;
  domainPackVersion?: number | undefined;
}

export interface DomainPackInspectionResult {
  coverage: DomainPackCoverageReport;
  events: DomainPackInspectionRow[];
}

export function rawEventInputsToRawEvents(inputs: RawEventInput[]): RawEvent[] {
  return inputs.map((event, index) => ({
    id: `domain-pack-fixture-${index + 1}`,
    source: event.source,
    sourceEventType: event.sourceEventType,
    timestamp: event.timestamp,
    application: event.application,
    windowTitle: event.windowTitle,
    domain: event.domain,
    url: event.url,
    browserSchemaVersion: event.browserSchemaVersion,
    canonicalUrl: event.canonicalUrl,
    routeTemplate: event.routeTemplate,
    routeKey: event.routeKey,
    resourceHash: event.resourceHash,
    action: event.action,
    target: event.target,
    metadata: event.metadata ?? {},
    sensitiveFiltered: true,
    createdAt: event.timestamp,
  }));
}

export function inspectDomainPackCoverage(rawEvents: RawEvent[]): DomainPackInspectionResult {
  const normalizedEvents = normalizeRawEvents(rawEvents);

  return {
    coverage: buildDomainPackCoverageReport(normalizedEvents),
    events: normalizedEvents.map((event) => ({
      rawEventId: event.rawEventId,
      timestamp: event.timestamp,
      domain: event.domain,
      routeTemplate: event.routeTemplate,
      routeFamily: event.routeFamily,
      pageType: event.pageType,
      resourceHint: event.resourceHint,
      domainPackId: event.domainPackId,
      domainPackVersion: event.domainPackVersion,
    })),
  };
}

export function describeDomainPackMetadata(
  event: NormalizedEvent,
): Record<string, unknown> | undefined {
  const domainPack = isRecord(event.metadata.domainPack) ? event.metadata.domainPack : undefined;

  return domainPack && Object.keys(domainPack).length > 0 ? domainPack : undefined;
}
