import type { RawEvent } from "../domain/types.js";

export interface DomainRouteTaxonomy {
  source?: string | undefined;
  signature?: string | undefined;
  routeTemplate?: string | undefined;
  primarySection?: string | undefined;
  secondarySection?: string | undefined;
  leafSection?: string | undefined;
  dynamicSegmentCount?: number | undefined;
}

export interface DomainPackContext {
  rawEvent: RawEvent;
  domain?: string | undefined;
  canonicalUrl?: string | undefined;
  routeTemplate?: string | undefined;
  titlePattern?: string | undefined;
  target?: string | undefined;
  routeTaxonomy?: DomainRouteTaxonomy | undefined;
}

export interface DomainPackMatch {
  routeFamily: string;
  pageType?: string | undefined;
  resourceHint?: string | undefined;
  matchSource?: "route_template" | "route_taxonomy" | "title_pattern" | undefined;
}

export interface DomainPackDefinition {
  id: string;
  version: number;
  domainTokens: string[];
  match(context: DomainPackContext): DomainPackMatch | undefined;
}

export interface MatchedDomainPack {
  packId: string;
  packVersion: number;
  routeFamily: string;
  pageType?: string | undefined;
  resourceHint?: string | undefined;
  matchSource?: DomainPackMatch["matchSource"];
}

export interface DomainPackCoverageDomainEntry {
  domain: string;
  totalBrowserEvents: number;
  matchedEvents: number;
  unmatchedEvents: number;
  matchRate: number;
}

export interface DomainPackCoverageReport {
  totalBrowserEvents: number;
  matchedEvents: number;
  unmatchedEvents: number;
  matchRate: number;
  domains: DomainPackCoverageDomainEntry[];
}
