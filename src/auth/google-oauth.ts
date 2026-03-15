import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";

import type { GeminiOAuthCredentials } from "../credentials/llm.js";

const DEFAULT_GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const DEFAULT_GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const DEFAULT_GOOGLE_SCOPES = ["https://www.googleapis.com/auth/cloud-platform"];

export interface GoogleOAuthInteractiveLoginOptions {
  clientId: string;
  clientSecret: string;
  projectId: string;
  port?: number | undefined;
  timeoutMs?: number | undefined;
  scopes?: string[] | undefined;
  openBrowser?: ((url: string) => boolean) | undefined;
  fetchImpl?: typeof fetch | undefined;
  onAuthorizationUrl?: ((url: string, redirectUri: string) => void) | undefined;
}

export interface GoogleOAuthRefreshOptions {
  credentials: GeminiOAuthCredentials;
  fetchImpl?: typeof fetch | undefined;
}

interface GoogleTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
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
  return `http://127.0.0.1:${port}/oauth/callback`;
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

async function exchangeGoogleToken(
  params: URLSearchParams,
  fetchImpl: typeof fetch,
): Promise<GoogleTokenResponse> {
  const response = await fetchImpl(DEFAULT_GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  const parsed = (await response.json()) as GoogleTokenResponse;

  if (!response.ok) {
    throw new Error(
      parsed.error_description ??
        parsed.error ??
        `Google OAuth token request failed with status ${response.status}`,
    );
  }

  return parsed;
}

export function isGoogleOAuthAccessTokenExpired(
  credentials: GeminiOAuthCredentials,
  bufferSeconds = 60,
): boolean {
  return Date.now() >= new Date(credentials.expiresAt).getTime() - bufferSeconds * 1000;
}

export async function refreshGoogleOAuthCredentials(
  options: GoogleOAuthRefreshOptions,
): Promise<GeminiOAuthCredentials> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const tokenResponse = await exchangeGoogleToken(
    new URLSearchParams({
      client_id: options.credentials.clientId,
      client_secret: options.credentials.clientSecret,
      grant_type: "refresh_token",
      refresh_token: options.credentials.refreshToken,
    }),
    fetchImpl,
  );

  if (!tokenResponse.access_token || !tokenResponse.expires_in || !tokenResponse.token_type) {
    throw new Error("Google OAuth refresh response was missing required token fields");
  }

  return {
    ...options.credentials,
    accessToken: tokenResponse.access_token,
    tokenType: tokenResponse.token_type,
    scope: parseScope(tokenResponse.scope, options.credentials.scope),
    expiresAt: computeExpiryIso(tokenResponse.expires_in),
  };
}

export async function runGoogleOAuthInteractiveLogin(
  options: GoogleOAuthInteractiveLoginOptions,
): Promise<GeminiOAuthCredentials> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const scopes = options.scopes ?? DEFAULT_GOOGLE_SCOPES;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const state = randomBytes(16).toString("hex");
  const codeVerifier = createCodeVerifier();
  const codeChallenge = createCodeChallenge(codeVerifier);

  const code = await new Promise<{
    code: string;
    redirectUri: string;
  }>((resolve, reject) => {
    const server = createServer((request, response) => {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");

      if (requestUrl.pathname !== "/oauth/callback") {
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
        reject(new Error(`Google OAuth login failed: ${requestError}`));
        return;
      }

      if (!requestCode || requestState !== state) {
        response.statusCode = 400;
        response.end("Invalid OAuth callback. You can close this tab.");
        server.close();
        reject(new Error("Google OAuth callback was missing a valid authorization code"));
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
      const authorizationUrl = new URL(DEFAULT_GOOGLE_AUTH_URL);
      authorizationUrl.searchParams.set("client_id", options.clientId);
      authorizationUrl.searchParams.set("redirect_uri", redirectUri);
      authorizationUrl.searchParams.set("response_type", "code");
      authorizationUrl.searchParams.set("scope", scopes.join(" "));
      authorizationUrl.searchParams.set("access_type", "offline");
      authorizationUrl.searchParams.set("prompt", "consent");
      authorizationUrl.searchParams.set("state", state);
      authorizationUrl.searchParams.set("code_challenge", codeChallenge);
      authorizationUrl.searchParams.set("code_challenge_method", "S256");

      options.onAuthorizationUrl?.(authorizationUrl.toString(), redirectUri);
      options.openBrowser?.(authorizationUrl.toString());
    });

    const timeout = setTimeout(() => {
      server.close();
      reject(new Error("Timed out waiting for Google OAuth callback"));
    }, timeoutMs);

    server.on("close", () => {
      clearTimeout(timeout);
    });
    server.on("error", reject);
  });

  const tokenResponse = await exchangeGoogleToken(
    new URLSearchParams({
      client_id: options.clientId,
      client_secret: options.clientSecret,
      code: code.code,
      code_verifier: codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: code.redirectUri,
    }),
    fetchImpl,
  );

  if (
    !tokenResponse.access_token ||
    !tokenResponse.refresh_token ||
    !tokenResponse.expires_in ||
    !tokenResponse.token_type
  ) {
    throw new Error("Google OAuth token exchange response was missing required token fields");
  }

  return {
    provider: "gemini",
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    projectId: options.projectId,
    accessToken: tokenResponse.access_token,
    refreshToken: tokenResponse.refresh_token,
    tokenType: tokenResponse.token_type,
    scope: parseScope(tokenResponse.scope, scopes),
    expiresAt: computeExpiryIso(tokenResponse.expires_in),
  };
}
