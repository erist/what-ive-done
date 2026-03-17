import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

export interface CommandRunnerResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error | undefined;
}

export interface GWSCommandRunner {
  (args: string[]): CommandRunnerResult;
}

export interface GWSAuthStatus {
  auth_method?: string | undefined;
  has_refresh_token?: boolean | undefined;
  project_id?: string | undefined;
  scopes?: string[] | undefined;
  token_valid?: boolean | undefined;
  user?: string | undefined;
}

export interface GWSCollectorStatusBase {
  collector: string;
  command: string;
  installed: boolean;
  ready: boolean;
  status: "available" | "auth_error" | "missing_binary" | "missing_scope";
  detail?: string | undefined;
  authMethod?: string | undefined;
  tokenValid?: boolean | undefined;
  hasRefreshToken?: boolean | undefined;
  user?: string | undefined;
  projectId?: string | undefined;
}

export function defaultGWSCommandRunner(args: string[]): CommandRunnerResult {
  const result = spawnSync("gws", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ?? undefined,
  };
}

export function extractJsonPayload(output: string, failureLabel: string): string {
  const trimmed = output.trim();
  const objectIndex = trimmed.indexOf("{");
  const arrayIndex = trimmed.indexOf("[");
  const indices = [objectIndex, arrayIndex].filter((value) => value >= 0);

  if (indices.length === 0) {
    throw new Error(`gws did not return ${failureLabel} JSON output`);
  }

  return trimmed.slice(Math.min(...indices));
}

export function describeCommandFailure(result: CommandRunnerResult, fallback: string): string {
  if (result.error) {
    return result.error.message;
  }

  const detail = [result.stderr, result.stdout].find((value) => value.trim().length > 0);

  return detail?.trim() ?? fallback;
}

export function isMissingBinaryError(error: Error | undefined): boolean {
  const candidate = error as NodeJS.ErrnoException | undefined;

  return candidate?.code === "ENOENT";
}

export function parseGWSAuthStatus(output: string): GWSAuthStatus {
  return JSON.parse(extractJsonPayload(output, "auth status")) as GWSAuthStatus;
}

export function getGrantedScopes(authStatus: GWSAuthStatus): string[] {
  return Array.isArray(authStatus.scopes)
    ? authStatus.scopes.filter((scope): scope is string => typeof scope === "string")
    : [];
}

export function hasAnyScope(scopes: string[], requiredPrefixes: string[]): boolean {
  return requiredPrefixes.some((requiredScope) =>
    scopes.some((scope) => scope === requiredScope || scope.startsWith(`${requiredScope}.`)),
  );
}

export function buildGWSCollectorStatusBase(args: {
  collector: string;
  requiredScopes: string[];
  missingScopeDetail: string;
  commandRunner?: GWSCommandRunner | undefined;
}): GWSCollectorStatusBase {
  const commandRunner = args.commandRunner ?? defaultGWSCommandRunner;
  const result = commandRunner(["auth", "status"]);

  if (isMissingBinaryError(result.error)) {
    return {
      collector: args.collector,
      command: "gws",
      installed: false,
      ready: false,
      status: "missing_binary",
      detail: "gws CLI is not installed or not available on PATH",
    };
  }

  if (result.status !== 0) {
    return {
      collector: args.collector,
      command: "gws",
      installed: true,
      ready: false,
      status: "auth_error",
      detail: describeCommandFailure(result, "gws auth status failed"),
    };
  }

  let authStatus: GWSAuthStatus;

  try {
    authStatus = parseGWSAuthStatus(result.stdout);
  } catch (error) {
    return {
      collector: args.collector,
      command: "gws",
      installed: true,
      ready: false,
      status: "auth_error",
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  const scopes = getGrantedScopes(authStatus);
  const scopeGranted = hasAnyScope(scopes, args.requiredScopes);
  const tokenValid = authStatus.token_valid === true;
  const ready = tokenValid && scopeGranted;

  return {
    collector: args.collector,
    command: "gws",
    installed: true,
    ready,
    status: ready ? "available" : scopeGranted ? "auth_error" : "missing_scope",
    detail: ready
      ? undefined
      : scopeGranted
        ? "gws auth is present but the token is not currently valid"
        : args.missingScopeDetail,
    authMethod: authStatus.auth_method,
    tokenValid,
    hasRefreshToken: authStatus.has_refresh_token === true,
    user: authStatus.user,
    projectId: authStatus.project_id,
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function normalizeIsoTimestamp(value: unknown): string | undefined {
  const normalized = normalizeOptionalString(value);

  if (!normalized || Number.isNaN(Date.parse(normalized))) {
    return undefined;
  }

  return normalized;
}

export function hashOpaqueIdentifier(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
