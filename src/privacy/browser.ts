import { createHash } from "node:crypto";
import { URL, URLSearchParams } from "node:url";

import {
  DEFAULT_NORMALIZATION_CONFIG,
  type NormalizationConfig,
} from "../config/analysis.js";
import type { EventSource } from "../domain/types.js";

const UUID_LIKE_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LONG_HEX_SEGMENT = /^[0-9a-f]{12,}$/i;
const NUMERIC_SEGMENT = /^\d+$/;
const LONG_OPAQUE_SEGMENT = /^[A-Za-z0-9_-]{16,}$/;
const ALLOWLISTED_QUERY_VALUE = /^[a-z0-9._:-]{1,64}$/i;

export interface BrowserCanonicalFields {
  browserSchemaVersion?: number | undefined;
  domain?: string | undefined;
  url?: string | undefined;
  canonicalUrl?: string | undefined;
  routeTemplate?: string | undefined;
  routeKey?: string | undefined;
  resourceHash?: string | undefined;
}

interface BrowserCanonicalizationInput {
  source?: EventSource | undefined;
  sourceEventType?: string | undefined;
  application?: string | undefined;
  domain?: string | undefined;
  url?: string | undefined;
  hasBrowserContext?: boolean | undefined;
  browserSchemaVersion?: number | undefined;
  canonicalUrl?: string | undefined;
  routeTemplate?: string | undefined;
  routeKey?: string | undefined;
  resourceHash?: string | undefined;
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeDomain(value: string | undefined): string | undefined {
  const normalized = normalizeOptionalString(value);

  return normalized?.toLowerCase();
}

function tryParseUrl(rawUrl: string | undefined): URL | undefined {
  if (!rawUrl) {
    return undefined;
  }

  try {
    return new URL(rawUrl);
  } catch {
    return undefined;
  }
}

function normalizePathSegment(segment: string): string {
  const decoded = segment.trim();

  if (!decoded) {
    return "segment";
  }

  const suffix = decoded.split(/[-_]/).filter(Boolean).at(-1);
  const looksOpaqueIdentifier = (value: string | undefined): boolean => {
    if (!value) {
      return false;
    }

    return (
      LONG_OPAQUE_SEGMENT.test(value) &&
      (/\d/.test(value) || (/[a-z]/.test(value) && /[A-Z]/.test(value)) || !/[-_]/.test(value))
    );
  };
  const looksOpaqueSegment = looksOpaqueIdentifier(decoded);
  const looksOpaqueSuffix = looksOpaqueIdentifier(suffix);

  if (NUMERIC_SEGMENT.test(decoded)) {
    return "{id}";
  }

  if (UUID_LIKE_SEGMENT.test(decoded)) {
    return "{uuid}";
  }

  if (LONG_HEX_SEGMENT.test(decoded) || looksOpaqueSegment || looksOpaqueSuffix) {
    return "{id}";
  }

  return decoded.toLowerCase();
}

function normalizeSegments(pathname: string): string[] {
  return pathname
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => normalizePathSegment(segment));
}

function formatPath(segments: string[]): string {
  if (segments.length === 0) {
    return "/";
  }

  return `/${segments.join("/")}`;
}

function normalizeAllowlistedQueryValue(value: string): string | undefined {
  const normalized = value.trim();

  if (!normalized || !ALLOWLISTED_QUERY_VALUE.test(normalized)) {
    return undefined;
  }

  return normalized;
}

function buildSanitizedUrl(parsedUrl: URL, config: NormalizationConfig): string {
  const sanitized = new URL(parsedUrl.toString());
  const keptParams = new URLSearchParams();

  sanitized.username = "";
  sanitized.password = "";
  sanitized.hash = "";
  sanitized.search = "";

  const allowlistedKeys = new Set(
    config.browser.allowlistedQueryParameters.map((key) => key.toLowerCase()),
  );

  for (const [rawKey, rawValue] of parsedUrl.searchParams.entries()) {
    const normalizedKey = rawKey.toLowerCase();

    if (!allowlistedKeys.has(normalizedKey)) {
      continue;
    }

    const normalizedValue = normalizeAllowlistedQueryValue(rawValue);

    if (!normalizedValue) {
      continue;
    }

    keptParams.append(normalizedKey, normalizedValue);
  }

  const sortedEntries = [...keptParams.entries()].sort(([leftKey, leftValue], [rightKey, rightValue]) =>
    leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue),
  );

  for (const [key, value] of sortedEntries) {
    sanitized.searchParams.append(key, value);
  }

  return sanitized.toString();
}

function buildCanonicalUrl(parsedUrl: URL, normalizedSegments: string[], config: NormalizationConfig): string {
  const canonicalPath = formatPath(normalizedSegments.slice(0, config.browser.canonicalPathDepth));

  return `${parsedUrl.protocol}//${parsedUrl.hostname.toLowerCase()}${canonicalPath}`;
}

function buildResourceHash(parsedUrl: URL, rawSegments: string[], normalizedSegments: string[]): string | undefined {
  for (let index = rawSegments.length - 1; index >= 0; index -= 1) {
    const rawSegment = rawSegments[index];

    if (!rawSegment || (!UUID_LIKE_SEGMENT.test(rawSegment) && !LONG_HEX_SEGMENT.test(rawSegment))) {
      continue;
    }

    const seed = `${parsedUrl.hostname.toLowerCase()}:${formatPath(normalizedSegments.slice(0, index + 1))}:${rawSegment.toLowerCase()}`;

    return createHash("sha256").update(seed).digest("hex").slice(0, 16);
  }

  return undefined;
}

function normalizeRouteTemplate(value: string | undefined): string | undefined {
  const normalized = normalizeOptionalString(value);

  if (!normalized || !normalized.startsWith("/")) {
    return undefined;
  }

  return normalized;
}

function normalizeCanonicalUrlFallback(value: string | undefined): string | undefined {
  const normalized = normalizeOptionalString(value);

  if (!normalized) {
    return undefined;
  }

  return normalized.split("#", 1)[0]?.split("?", 1)[0];
}

function normalizeOpaqueHash(value: string | undefined): string | undefined {
  const normalized = normalizeOptionalString(value)?.toLowerCase();

  if (!normalized || !/^[0-9a-f]{8,64}$/.test(normalized)) {
    return undefined;
  }

  return normalized;
}

export function stripUrlQuery(rawUrl: string | undefined): string | undefined {
  const parsedUrl = tryParseUrl(rawUrl);

  if (!parsedUrl) {
    return undefined;
  }

  parsedUrl.username = "";
  parsedUrl.password = "";
  parsedUrl.hash = "";
  parsedUrl.search = "";

  return parsedUrl.toString();
}

export function deriveBrowserCanonicalFields(
  input: BrowserCanonicalizationInput,
  config: NormalizationConfig = DEFAULT_NORMALIZATION_CONFIG,
): BrowserCanonicalFields {
  const parsedUrl = tryParseUrl(input.url);
  const shouldStampSchemaVersion =
    Boolean(parsedUrl) ||
    input.hasBrowserContext === true ||
    Boolean(input.canonicalUrl) ||
    Boolean(input.routeTemplate) ||
    Boolean(input.routeKey);

  if (!parsedUrl) {
    return {
      browserSchemaVersion: shouldStampSchemaVersion ? config.browser.schemaVersion : undefined,
      domain: normalizeDomain(input.domain),
      url: undefined,
      canonicalUrl: normalizeCanonicalUrlFallback(input.canonicalUrl),
      routeTemplate: normalizeRouteTemplate(input.routeTemplate),
      routeKey: normalizeOptionalString(input.routeKey),
      resourceHash: normalizeOpaqueHash(input.resourceHash),
    };
  }

  const rawSegments = parsedUrl.pathname.split("/").filter((segment) => segment.length > 0);
  const normalizedSegments = normalizeSegments(parsedUrl.pathname);
  const routeTemplate = formatPath(normalizedSegments);
  const canonicalUrl = buildCanonicalUrl(parsedUrl, normalizedSegments, config);

  return {
    browserSchemaVersion: shouldStampSchemaVersion ? config.browser.schemaVersion : undefined,
    domain: parsedUrl.hostname.toLowerCase(),
    url: buildSanitizedUrl(parsedUrl, config),
    canonicalUrl,
    routeTemplate,
    routeKey: canonicalUrl,
    resourceHash: buildResourceHash(parsedUrl, rawSegments, normalizedSegments),
  };
}
