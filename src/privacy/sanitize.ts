import type { RawEventInput } from "../domain/types.js";
import { sanitizeCalendarSignal } from "../calendar/signals.js";
import { deriveBrowserCanonicalFields } from "./browser.js";

const SENSITIVE_KEY_PATTERN =
  /password|passwd|secret|token|cookie|authorization|clipboard|emailbody|documentcontent|keystroke|session|auth/i;
const SAFE_ROUTE_SOURCE = new Set(["pathname", "hash"]);
const SAFE_DWELL_REASONS = new Set([
  "navigation",
  "route_change",
  "tab_switch",
  "tab_closed",
  "window_blur",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function compactObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  );
}

function sanitizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry));
  }

  if (value && typeof value === "object") {
    const sanitized: Record<string, unknown> = {};

    for (const [key, nestedValue] of Object.entries(value)) {
      sanitized[key] = SENSITIVE_KEY_PATTERN.test(key)
        ? "[REDACTED]"
        : sanitizeValue(nestedValue);
    }

    return sanitized;
  }

  return value;
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeOptionalInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function normalizeIsoTimestamp(value: unknown): string | undefined {
  const normalized = normalizeOptionalString(value);

  if (!normalized || Number.isNaN(Date.parse(normalized))) {
    return undefined;
  }

  return new Date(normalized).toISOString();
}

function normalizeOpaqueHash(value: unknown): string | undefined {
  const normalized = normalizeOptionalString(value)?.toLowerCase();

  if (!normalized || !/^[0-9a-f]{8,64}$/.test(normalized)) {
    return undefined;
  }

  return normalized;
}

function normalizeRouteValue(value: unknown): string | undefined {
  const normalized = normalizeOptionalString(value);

  if (!normalized || !/^\/[a-z0-9_\/{}-]*$/u.test(normalized)) {
    return undefined;
  }

  return normalized;
}

function normalizeRouteSignature(value: unknown): string | undefined {
  const normalized = normalizeOptionalString(value);

  if (!normalized || !/^(?:pathname|hash):\/[a-z0-9_\/{}-]*$/u.test(normalized)) {
    return undefined;
  }

  return normalized;
}

function normalizeRouteSection(value: unknown): string | undefined {
  const normalized = normalizeOptionalString(value);

  if (!normalized || !/^[a-z0-9_{}-]{1,64}$/u.test(normalized)) {
    return undefined;
  }

  return normalized;
}

function sanitizeRouteTaxonomy(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const source = normalizeOptionalString(value.source);
  const routeTaxonomy = compactObject({
    source: source && SAFE_ROUTE_SOURCE.has(source) ? source : undefined,
    signature: normalizeRouteSignature(value.signature),
    routeTemplate: normalizeRouteValue(value.routeTemplate),
    depth: normalizeOptionalInteger(value.depth),
    primarySection: normalizeRouteSection(value.primarySection),
    secondarySection: normalizeRouteSection(value.secondarySection),
    leafSection: normalizeRouteSection(value.leafSection),
    dynamicSegmentCount: normalizeOptionalInteger(value.dynamicSegmentCount),
  });

  return Object.keys(routeTaxonomy).length > 0 ? routeTaxonomy : undefined;
}

function sanitizeTabOrder(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const tabOrder = compactObject({
    globalSequence: normalizeOptionalInteger(value.globalSequence),
    windowSequence: normalizeOptionalInteger(value.windowSequence),
    tabIndex: normalizeOptionalInteger(value.tabIndex),
    previousTabId: normalizeOptionalInteger(value.previousTabId),
    windowId: normalizeOptionalInteger(value.windowId),
  });

  return Object.keys(tabOrder).length > 0 ? tabOrder : undefined;
}

function sanitizeDwell(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const reason = normalizeOptionalString(value.reason);
  const dwell = compactObject({
    durationMs:
      typeof value.durationMs === "number" && Number.isFinite(value.durationMs) && value.durationMs >= 0
        ? Math.round(value.durationMs)
        : undefined,
    startedAt: normalizeIsoTimestamp(value.startedAt),
    endedAt: normalizeIsoTimestamp(value.endedAt),
    reason: reason && SAFE_DWELL_REASONS.has(reason) ? reason : undefined,
  });

  return Object.keys(dwell).length > 0 ? dwell : undefined;
}

function sanitizeBrowserContext(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const browserContext = compactObject({
    routeTaxonomy: sanitizeRouteTaxonomy(value.routeTaxonomy),
    documentTypeHash: normalizeOpaqueHash(value.documentTypeHash),
    tabOrder: sanitizeTabOrder(value.tabOrder),
    dwell: sanitizeDwell(value.dwell),
    signalOnly: value.signalOnly === true ? true : undefined,
  });

  return Object.keys(browserContext).length > 0 ? browserContext : undefined;
}

function sanitizeWorkspaceContext(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const app = normalizeOptionalString(value.app);
  const itemType = normalizeOptionalString(value.itemType);
  const activityType = normalizeOptionalString(value.activityType);
  const workspaceContext = compactObject({
    provider: normalizeOptionalString(value.provider),
    app: app && ["drive", "sheets"].includes(app) ? app : undefined,
    itemType:
      itemType && ["spreadsheet", "document", "presentation", "pdf", "folder", "file"].includes(itemType)
        ? itemType
        : undefined,
    itemHash: normalizeOpaqueHash(value.itemHash),
    activityType:
      activityType && ["modified", "viewed"].includes(activityType) ? activityType : undefined,
    modifiedAt: normalizeIsoTimestamp(value.modifiedAt),
    viewedAt: normalizeIsoTimestamp(value.viewedAt),
    sheetCount: normalizeOptionalInteger(value.sheetCount),
    gridSheetCount: normalizeOptionalInteger(value.gridSheetCount),
  });

  return Object.keys(workspaceContext).length > 0 ? workspaceContext : undefined;
}

function sanitizeGitContext(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const remoteHost = normalizeOptionalString(value.remoteHost)?.toLowerCase();
  const gitContext = compactObject({
    repoHash: normalizeOpaqueHash(value.repoHash),
    remoteHost:
      remoteHost && /^[a-z0-9.-]{1,128}$/u.test(remoteHost) ? remoteHost : undefined,
    dirtyFileCount: normalizeOptionalInteger(value.dirtyFileCount),
    lastCommitAt: normalizeIsoTimestamp(value.lastCommitAt),
  });

  return Object.keys(gitContext).length > 0 ? gitContext : undefined;
}

export function sanitizeMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!metadata) {
    return {};
  }

  const sanitized = sanitizeValue(metadata) as Record<string, unknown>;
  const browserContext = sanitizeBrowserContext(sanitized.browserContext);

  if (browserContext) {
    sanitized.browserContext = browserContext;
  } else {
    delete sanitized.browserContext;
  }

  const calendarSignal = sanitizeCalendarSignal(sanitized.calendarSignal);

  if (calendarSignal) {
    sanitized.calendarSignal = calendarSignal;
  } else {
    delete sanitized.calendarSignal;
  }

  const workspaceContext = sanitizeWorkspaceContext(sanitized.workspaceContext);

  if (workspaceContext) {
    sanitized.workspaceContext = workspaceContext;
  } else {
    delete sanitized.workspaceContext;
  }

  const gitContext = sanitizeGitContext(sanitized.gitContext);

  if (gitContext) {
    sanitized.gitContext = gitContext;
  } else {
    delete sanitized.gitContext;
  }

  return sanitized;
}

export function sanitizeRawEvent(input: RawEventInput): RawEventInput {
  const timestamp = normalizeIsoTimestamp(input.timestamp) ?? input.timestamp;
  const windowTitle = input.windowTitle && SENSITIVE_KEY_PATTERN.test(input.windowTitle)
    ? "[REDACTED]"
    : input.windowTitle;

  const target = input.target && SENSITIVE_KEY_PATTERN.test(input.target)
    ? "[REDACTED]"
    : input.target;
  const metadata = sanitizeMetadata(input.metadata);
  const browserFields = deriveBrowserCanonicalFields({
    ...input,
    hasBrowserContext: isRecord(metadata.browserContext),
  });

  return {
    ...input,
    timestamp,
    windowTitle,
    domain: browserFields.domain ?? input.domain,
    target,
    url: browserFields.url,
    browserSchemaVersion: browserFields.browserSchemaVersion,
    canonicalUrl: browserFields.canonicalUrl,
    routeTemplate: browserFields.routeTemplate,
    routeKey: browserFields.routeKey,
    resourceHash: browserFields.resourceHash,
    metadata,
  };
}
