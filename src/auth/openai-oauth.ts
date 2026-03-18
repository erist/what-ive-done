import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";

import type { OpenAICodexOAuthCredentials } from "../credentials/llm.js";

export const DEFAULT_OPENAI_CODEX_ISSUER = "https://auth.openai.com";
const DEFAULT_OPENAI_CODEX_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "api.connectors.read",
  "api.connectors.invoke",
];
const DEFAULT_OPENAI_CODEX_ORIGINATOR = "what-ive-done";

export interface OpenAICodexOAuthInteractiveLoginOptions {
  clientId: string;
  issuer?: string | undefined;
  port?: number | undefined;
  timeoutMs?: number | undefined;
  scopes?: string[] | undefined;
  originator?: string | undefined;
  openBrowser?: ((url: string) => boolean) | undefined;
  fetchImpl?: typeof fetch | undefined;
  onAuthorizationUrl?: ((url: string, redirectUri: string) => void) | undefined;
}

export interface OpenAICodexOAuthRefreshOptions {
  credentials: OpenAICodexOAuthCredentials;
  fetchImpl?: typeof fetch | undefined;
}

interface OpenAIAuthTokenResponse {
  id_token?: string;
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  scope?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

function createCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

function createCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function buildRedirectUri(port: number): string {
  return `http://localhost:${port}/auth/callback`;
}

function parseScope(scope: string | undefined, fallbackScopes: string[]): string[] {
  if (!scope) {
    return fallbackScopes;
  }

  return scope
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function computeExpiryIso(expiresInSeconds: number): string {
  return new Date(Date.now() + expiresInSeconds * 1000).toISOString();
}

function readJwtClaims(token: string): Record<string, unknown> | undefined {
  const parts = token.split(".");

  if (parts.length < 2) {
    return undefined;
  }

  try {
    const payload = Buffer.from(parts[1] ?? "", "base64url").toString("utf8");
    return JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function readJwtExpiryIso(token: string): string | undefined {
  const claims = readJwtClaims(token);
  const exp = claims?.exp;

  if (typeof exp !== "number" || !Number.isFinite(exp)) {
    return undefined;
  }

  return new Date(exp * 1000).toISOString();
}

function readJwtEmail(token: string): string | undefined {
  const claims = readJwtClaims(token);
  return typeof claims?.email === "string" && claims.email.trim().length > 0
    ? claims.email.trim()
    : undefined;
}

async function exchangeOpenAIToken(
  issuer: string,
  params: URLSearchParams,
  fetchImpl: typeof fetch,
): Promise<OpenAIAuthTokenResponse> {
  const response = await fetchImpl(`${issuer}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  const parsed = (await response.json()) as OpenAIAuthTokenResponse;

  if (!response.ok) {
    throw new Error(
      parsed.error_description ??
        parsed.error ??
        `OpenAI OAuth token request failed with status ${response.status}`,
    );
  }

  return parsed;
}

async function exchangeOpenAIApiKey(
  issuer: string,
  clientId: string,
  idToken: string,
  fetchImpl: typeof fetch,
): Promise<string | undefined> {
  try {
    const parsed = await exchangeOpenAIToken(
      issuer,
      new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
        client_id: clientId,
        requested_token: "openai-api-key",
        subject_token: idToken,
        subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
      }),
      fetchImpl,
    );

    return parsed.access_token;
  } catch {
    return undefined;
  }
}

export function isOpenAICodexOAuthAccessTokenExpired(
  credentials: OpenAICodexOAuthCredentials,
  bufferSeconds = 60,
): boolean {
  if (!credentials.expiresAt) {
    return false;
  }

  return Date.now() >= new Date(credentials.expiresAt).getTime() - bufferSeconds * 1000;
}

export async function refreshOpenAICodexOAuthCredentials(
  options: OpenAICodexOAuthRefreshOptions,
): Promise<OpenAICodexOAuthCredentials> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const tokenResponse = await exchangeOpenAIToken(
    options.credentials.issuer,
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: options.credentials.refreshToken,
      client_id: options.credentials.clientId,
    }),
    fetchImpl,
  );

  if (!tokenResponse.access_token) {
    throw new Error("OpenAI OAuth refresh response was missing an access token");
  }

  const idToken = tokenResponse.id_token ?? options.credentials.idToken;
  const expiresAt =
    (typeof tokenResponse.expires_in === "number"
      ? computeExpiryIso(tokenResponse.expires_in)
      : readJwtExpiryIso(tokenResponse.access_token) ?? readJwtExpiryIso(idToken)) ??
    options.credentials.expiresAt;
  const apiKey = await exchangeOpenAIApiKey(
    options.credentials.issuer,
    options.credentials.clientId,
    idToken,
    fetchImpl,
  );

  return {
    ...options.credentials,
    accessToken: tokenResponse.access_token,
    refreshToken: tokenResponse.refresh_token ?? options.credentials.refreshToken,
    idToken,
    tokenType: tokenResponse.token_type ?? options.credentials.tokenType,
    scope: parseScope(tokenResponse.scope, options.credentials.scope),
    expiresAt,
    email: readJwtEmail(idToken) ?? options.credentials.email,
    apiKey,
  };
}

export async function runOpenAICodexOAuthInteractiveLogin(
  options: OpenAICodexOAuthInteractiveLoginOptions,
): Promise<OpenAICodexOAuthCredentials> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const issuer = (options.issuer ?? DEFAULT_OPENAI_CODEX_ISSUER).replace(/\/+$/u, "");
  const scopes = options.scopes ?? DEFAULT_OPENAI_CODEX_SCOPES;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const state = randomBytes(16).toString("hex");
  const codeVerifier = createCodeVerifier();
  const codeChallenge = createCodeChallenge(codeVerifier);
  const originator = options.originator ?? DEFAULT_OPENAI_CODEX_ORIGINATOR;

  const code = await new Promise<{
    code: string;
    redirectUri: string;
  }>((resolve, reject) => {
    const server = createServer((request, response) => {
      const requestUrl = new URL(request.url ?? "/", "http://localhost");

      if (requestUrl.pathname !== "/auth/callback") {
        response.statusCode = 404;
        response.end("Not found");
        return;
      }

      const requestState = requestUrl.searchParams.get("state");
      const requestCode = requestUrl.searchParams.get("code");
      const requestError = requestUrl.searchParams.get("error");

      if (requestError) {
        response.statusCode = 400;
        response.end("OAuth login failed. You can close this tab.");
        server.close();
        reject(new Error(`OpenAI OAuth login failed: ${requestError}`));
        return;
      }

      if (!requestCode || requestState !== state) {
        response.statusCode = 400;
        response.end("Invalid OAuth callback. You can close this tab.");
        server.close();
        reject(new Error("OpenAI OAuth callback was missing a valid authorization code"));
        return;
      }

      response.statusCode = 200;
      response.setHeader("Content-Type", "text/plain; charset=utf-8");
      response.end("Login completed. You can close this tab and return to the terminal.");

      const address = server.address();
      const redirectUri =
        address && typeof address !== "string" ? buildRedirectUri(address.port) : buildRedirectUri(0);
      server.close();
      resolve({
        code: requestCode,
        redirectUri,
      });
    });

    server.listen(options.port ?? 0, "127.0.0.1", () => {
      const address = server.address();

      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Failed to determine local OAuth callback port"));
        return;
      }

      const redirectUri = buildRedirectUri(address.port);
      const authorizationUrl = new URL(`${issuer}/oauth/authorize`);
      authorizationUrl.searchParams.set("response_type", "code");
      authorizationUrl.searchParams.set("client_id", options.clientId);
      authorizationUrl.searchParams.set("redirect_uri", redirectUri);
      authorizationUrl.searchParams.set("scope", scopes.join(" "));
      authorizationUrl.searchParams.set("code_challenge", codeChallenge);
      authorizationUrl.searchParams.set("code_challenge_method", "S256");
      authorizationUrl.searchParams.set("id_token_add_organizations", "true");
      authorizationUrl.searchParams.set("codex_cli_simplified_flow", "true");
      authorizationUrl.searchParams.set("state", state);
      authorizationUrl.searchParams.set("originator", originator);

      options.onAuthorizationUrl?.(authorizationUrl.toString(), redirectUri);
      options.openBrowser?.(authorizationUrl.toString());
    });

    const timeout = setTimeout(() => {
      server.close();
      reject(new Error("Timed out waiting for OpenAI OAuth callback"));
    }, timeoutMs);

    server.on("close", () => {
      clearTimeout(timeout);
    });
    server.on("error", reject);
  });

  const tokenResponse = await exchangeOpenAIToken(
    issuer,
    new URLSearchParams({
      grant_type: "authorization_code",
      code: code.code,
      redirect_uri: code.redirectUri,
      client_id: options.clientId,
      code_verifier: codeVerifier,
    }),
    fetchImpl,
  );

  if (!tokenResponse.id_token || !tokenResponse.access_token || !tokenResponse.refresh_token) {
    throw new Error("OpenAI OAuth token exchange response was missing required token fields");
  }

  const expiresAt =
    (typeof tokenResponse.expires_in === "number"
      ? computeExpiryIso(tokenResponse.expires_in)
      : readJwtExpiryIso(tokenResponse.access_token) ?? readJwtExpiryIso(tokenResponse.id_token)) ??
    undefined;
  const apiKey = await exchangeOpenAIApiKey(
    issuer,
    options.clientId,
    tokenResponse.id_token,
    fetchImpl,
  );

  return {
    provider: "openai-codex",
    clientId: options.clientId,
    issuer,
    accessToken: tokenResponse.access_token,
    refreshToken: tokenResponse.refresh_token,
    idToken: tokenResponse.id_token,
    tokenType: tokenResponse.token_type ?? "Bearer",
    scope: parseScope(tokenResponse.scope, scopes),
    expiresAt,
    email: readJwtEmail(tokenResponse.id_token),
    apiKey,
  };
}
