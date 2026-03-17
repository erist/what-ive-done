import { randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";

import type { AppDatabase } from "../storage/database.js";

export const INGEST_SECURITY_SETTINGS_KEY = "ingest_security";
export const DEFAULT_INGEST_RATE_LIMIT_WINDOW_MS = 60_000;
export const DEFAULT_INGEST_RATE_LIMIT_MAX_REQUESTS = 180;

const ALLOWED_LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

interface IngestSecuritySettings {
  authToken: string;
}

export interface IngestSecurityState {
  localOnly: true;
  authRequired: true;
  authTokenPreview: string;
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
}

export interface IngestRateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds?: number | undefined;
  limit: number;
  windowMs: number;
}

export class InMemoryRateLimiter {
  private readonly buckets = new Map<string, number[]>();

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number,
  ) {}

  check(key: string, now = Date.now()): IngestRateLimitDecision {
    const existing = this.buckets.get(key) ?? [];
    const windowStart = now - this.windowMs;
    const active = existing.filter((timestamp) => timestamp > windowStart);

    if (active.length >= this.maxRequests) {
      const oldestTimestamp = active[0] ?? now;

      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((oldestTimestamp + this.windowMs - now) / 1000)),
        limit: this.maxRequests,
        windowMs: this.windowMs,
      };
    }

    active.push(now);
    this.buckets.set(key, active);

    return {
      allowed: true,
      remaining: Math.max(0, this.maxRequests - active.length),
      limit: this.maxRequests,
      windowMs: this.windowMs,
    };
  }
}

export function resolveLocalOnlyHost(host?: string): string {
  const resolvedHost = host?.trim() || "127.0.0.1";

  if (!ALLOWED_LOCAL_HOSTS.has(resolvedHost)) {
    throw new Error(
      `Ingest server must bind to localhost only. Received host: ${resolvedHost}`,
    );
  }

  return resolvedHost === "localhost" ? "127.0.0.1" : resolvedHost;
}

function generateIngestAuthToken(): string {
  return randomBytes(24).toString("base64url");
}

function getStoredSettings(database: AppDatabase): IngestSecuritySettings | undefined {
  return database.getSetting<IngestSecuritySettings>(INGEST_SECURITY_SETTINGS_KEY);
}

export function ensureIngestAuthToken(
  database: AppDatabase,
  preferredToken?: string | undefined,
): string {
  const normalizedPreferredToken = preferredToken?.trim();

  if (normalizedPreferredToken) {
    database.setSetting(INGEST_SECURITY_SETTINGS_KEY, {
      authToken: normalizedPreferredToken,
    });
    return normalizedPreferredToken;
  }

  const existing = getStoredSettings(database)?.authToken?.trim();

  if (existing) {
    return existing;
  }

  const generated = generateIngestAuthToken();
  database.setSetting(INGEST_SECURITY_SETTINGS_KEY, {
    authToken: generated,
  });

  return generated;
}

export function rotateIngestAuthToken(
  database: AppDatabase,
  preferredToken?: string | undefined,
): string {
  const nextToken = preferredToken?.trim() || generateIngestAuthToken();
  database.setSetting(INGEST_SECURITY_SETTINGS_KEY, {
    authToken: nextToken,
  });
  return nextToken;
}

export function getIngestAuthToken(database: AppDatabase): string | undefined {
  return getStoredSettings(database)?.authToken?.trim() || undefined;
}

export function maskIngestAuthToken(token: string): string {
  if (token.length <= 8) {
    return token;
  }

  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

export function buildIngestSecurityState(args: {
  authToken: string;
  rateLimitWindowMs?: number | undefined;
  rateLimitMaxRequests?: number | undefined;
}): IngestSecurityState {
  return {
    localOnly: true,
    authRequired: true,
    authTokenPreview: maskIngestAuthToken(args.authToken),
    rateLimitWindowMs: args.rateLimitWindowMs ?? DEFAULT_INGEST_RATE_LIMIT_WINDOW_MS,
    rateLimitMaxRequests: args.rateLimitMaxRequests ?? DEFAULT_INGEST_RATE_LIMIT_MAX_REQUESTS,
  };
}

export function extractIngestAuthToken(request: IncomingMessage): string | undefined {
  const authorizationHeader = request.headers.authorization?.trim();

  if (authorizationHeader?.toLowerCase().startsWith("bearer ")) {
    const bearerToken = authorizationHeader.slice("bearer ".length).trim();

    if (bearerToken) {
      return bearerToken;
    }
  }

  const headerValue = request.headers["x-what-ive-done-token"];

  if (typeof headerValue === "string" && headerValue.trim().length > 0) {
    return headerValue.trim();
  }

  return undefined;
}
