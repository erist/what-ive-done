import { URL } from "node:url";

import type { RawEventInput } from "../domain/types.js";

const SENSITIVE_KEY_PATTERN =
  /password|passwd|secret|token|cookie|authorization|clipboard|emailbody|documentcontent|keystroke|session|auth/i;

function sanitizeUrl(rawUrl: string | undefined): string | undefined {
  if (!rawUrl) {
    return undefined;
  }

  try {
    const url = new URL(rawUrl);

    for (const [key] of url.searchParams) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        url.searchParams.set(key, "[REDACTED]");
      }
    }

    return url.toString();
  } catch {
    return rawUrl;
  }
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

export function sanitizeMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!metadata) {
    return {};
  }

  return sanitizeValue(metadata) as Record<string, unknown>;
}

export function sanitizeRawEvent(input: RawEventInput): RawEventInput {
  const windowTitle = input.windowTitle && SENSITIVE_KEY_PATTERN.test(input.windowTitle)
    ? "[REDACTED]"
    : input.windowTitle;

  const target = input.target && SENSITIVE_KEY_PATTERN.test(input.target)
    ? "[REDACTED]"
    : input.target;

  return {
    ...input,
    windowTitle,
    target,
    url: sanitizeUrl(input.url),
    metadata: sanitizeMetadata(input.metadata),
  };
}
