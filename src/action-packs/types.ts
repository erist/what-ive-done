import type { ActionSource, NormalizedEvent } from "../domain/types.js";

export type ActionMatchLayer = "domain_pack" | "page_type" | "generic" | "unknown";

export type ActionlessNormalizedEvent = Omit<
  NormalizedEvent,
  "actionName" | "actionConfidence" | "actionSource"
>;

export interface NearbyContext {
  previousNearby?: ActionlessNormalizedEvent | undefined;
  nextNearby?: ActionlessNormalizedEvent | undefined;
}

export interface ActionPackContext extends NearbyContext {
  event: ActionlessNormalizedEvent;
}

export interface ActionPackRule {
  id: string;
  layer: Exclude<ActionMatchLayer, "unknown">;
  applications?: string[] | undefined;
  domains?: string[] | undefined;
  domainPackIds?: string[] | undefined;
  routeFamilies?: string[] | undefined;
  eventTypes?: string[] | undefined;
  pageTypes?: string[] | undefined;
  targetIncludes?: string[] | undefined;
  requireExplicitTarget?: boolean | undefined;
  resourceHints?: string[] | undefined;
  actionName: string;
  confidence: number;
  source?: ActionSource | undefined;
}

export interface ActionPackDefinition {
  id: string;
  version: number;
  priority: number;
  rules: ActionPackRule[];
}

export interface MatchedActionPackRule {
  actionName: string;
  actionConfidence: number;
  actionSource: ActionSource;
  packId: string;
  packVersion: number;
  ruleId: string;
  layer: Exclude<ActionMatchLayer, "unknown">;
}

export interface ActionMatchMetadata {
  registryVersion: number;
  layer: ActionMatchLayer;
  packId?: string | undefined;
  packVersion?: number | undefined;
  ruleId?: string | undefined;
  strategy?: string | undefined;
  reason?: string | undefined;
}

export interface ActionCoverageLayerEntry {
  layer: ActionMatchLayer;
  eventCount: number;
  rate: number;
}

export interface ActionCoveragePackEntry {
  packId: string;
  eventCount: number;
  unknownEventCount: number;
  unknownRate: number;
}

export interface ActionCoverageActionEntry {
  actionName: string;
  eventCount: number;
}

export interface ActionCoverageWorkflowEntry {
  workflowId: string;
  workflowName: string;
  frequency: number;
  unknownActionCount: number;
  totalActionCount: number;
  unknownRate: number;
  representativeSequence: string[];
}

export interface UnknownActionReviewItem {
  queueId: string;
  occurrences: number;
  application: string;
  eventType: string;
  domain?: string | undefined;
  domainPackId?: string | undefined;
  routeFamily?: string | undefined;
  pageType?: string | undefined;
  sampleTargets: string[];
  sampleTitles: string[];
  sampleRawEventIds: string[];
}

export interface ActionCoverageReport {
  totalEvents: number;
  unknownEventCount: number;
  unknownRate: number;
  layers: ActionCoverageLayerEntry[];
  packs: ActionCoveragePackEntry[];
  topActions: ActionCoverageActionEntry[];
  topWorkflows: ActionCoverageWorkflowEntry[];
}
