import type { EventSource, RawEventInput } from "../domain/types.js";

type JsonRecord = Record<string, unknown>;

export interface IncomingEventPayload {
  source?: EventSource;
  sourceEventType?: string;
  timestamp?: string;
  application?: string;
  windowTitle?: string;
  domain?: string;
  url?: string;
  browserSchemaVersion?: number;
  canonicalUrl?: string;
  routeTemplate?: string;
  routeKey?: string;
  resourceHash?: string;
  action?: string;
  target?: string;
  metadata?: Record<string, unknown>;
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function inferAction(sourceEventType: string, explicitAction: unknown): string {
  if (typeof explicitAction === "string" && explicitAction.trim().length > 0) {
    return explicitAction.trim();
  }

  const segments = sourceEventType.split(".");

  return segments[segments.length - 1] ?? "unknown";
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeMetadata(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

export function coerceIncomingEvent(payload: unknown): RawEventInput {
  if (!isRecord(payload)) {
    throw new Error("Incoming event must be an object");
  }

  const sourceEventType = normalizeOptionalString(payload.sourceEventType);

  if (!sourceEventType) {
    throw new Error("sourceEventType is required");
  }

  const source = normalizeOptionalString(payload.source) as EventSource | undefined;
  const timestamp = normalizeOptionalString(payload.timestamp) ?? new Date().toISOString();
  const application = normalizeOptionalString(payload.application) ?? "chrome";

  return {
    source: source ?? "chrome_extension",
    sourceEventType,
    timestamp,
    application,
    windowTitle: normalizeOptionalString(payload.windowTitle),
    domain: normalizeOptionalString(payload.domain),
    url: normalizeOptionalString(payload.url),
    browserSchemaVersion: normalizeOptionalNumber(payload.browserSchemaVersion),
    canonicalUrl: normalizeOptionalString(payload.canonicalUrl),
    routeTemplate: normalizeOptionalString(payload.routeTemplate),
    routeKey: normalizeOptionalString(payload.routeKey),
    resourceHash: normalizeOptionalString(payload.resourceHash),
    action: inferAction(sourceEventType, payload.action),
    target: normalizeOptionalString(payload.target),
    metadata: normalizeMetadata(payload.metadata),
  };
}

export function coerceIncomingEvents(payload: unknown): RawEventInput[] {
  if (Array.isArray(payload)) {
    return payload.map((entry) => coerceIncomingEvent(entry));
  }

  if (isRecord(payload) && Array.isArray(payload.events)) {
    return payload.events.map((entry) => coerceIncomingEvent(entry));
  }

  return [coerceIncomingEvent(payload)];
}
