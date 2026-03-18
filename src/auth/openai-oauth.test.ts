import assert from "node:assert/strict";
import test from "node:test";

import {
  isOpenAICodexOAuthAccessTokenExpired,
  refreshOpenAICodexOAuthCredentials,
  runOpenAICodexOAuthInteractiveLogin,
} from "./openai-oauth.js";

function createJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" }), "utf8").toString("base64url");
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${header}.${body}.`;
}

test("runOpenAICodexOAuthInteractiveLogin exchanges the browser code and stores token metadata", async () => {
  const expiresAtEpoch = Math.floor(Date.now() / 1000) + 3600;
  const accessToken = createJwt({
    exp: expiresAtEpoch,
  });
  const idToken = createJwt({
    exp: expiresAtEpoch,
    email: "tester@example.com",
  });

  const credentialsPromise = runOpenAICodexOAuthInteractiveLogin({
    clientId: "client-id",
    issuer: "https://auth.example.test",
    timeoutMs: 10_000,
    fetchImpl: async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      assert.equal(url, "https://auth.example.test/oauth/token");

      const params = new URLSearchParams(String(init?.body ?? ""));
      const grantType = params.get("grant_type");

      if (grantType === "authorization_code") {
        assert.equal(params.get("client_id"), "client-id");
        assert.equal(params.get("code"), "test-code");
        assert.match(params.get("redirect_uri") ?? "", /^http:\/\/localhost:\d+\/auth\/callback$/u);
        assert.ok(params.get("code_verifier"));

        return new Response(
          JSON.stringify({
            id_token: idToken,
            access_token: accessToken,
            refresh_token: "refresh-token",
            token_type: "Bearer",
            scope: "openid profile email offline_access api.connectors.read api.connectors.invoke",
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          },
        );
      }

      assert.equal(grantType, "urn:ietf:params:oauth:grant-type:token-exchange");
      assert.equal(params.get("client_id"), "client-id");
      assert.equal(params.get("requested_token"), "openai-api-key");
      assert.equal(params.get("subject_token"), idToken);
      assert.equal(params.get("subject_token_type"), "urn:ietf:params:oauth:token-type:id_token");

      return new Response(
        JSON.stringify({
          access_token: "sk-openai-api-key",
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
    },
    openBrowser: (url) => {
      const authorizationUrl = new URL(url);
      assert.equal(authorizationUrl.origin, "https://auth.example.test");
      assert.equal(authorizationUrl.pathname, "/oauth/authorize");
      assert.equal(authorizationUrl.searchParams.get("client_id"), "client-id");
      assert.equal(authorizationUrl.searchParams.get("response_type"), "code");
      assert.equal(
        authorizationUrl.searchParams.get("scope"),
        "openid profile email offline_access api.connectors.read api.connectors.invoke",
      );
      assert.equal(authorizationUrl.searchParams.get("code_challenge_method"), "S256");
      assert.equal(authorizationUrl.searchParams.get("id_token_add_organizations"), "true");
      assert.equal(authorizationUrl.searchParams.get("codex_cli_simplified_flow"), "true");

      const redirectUri = authorizationUrl.searchParams.get("redirect_uri");
      const state = authorizationUrl.searchParams.get("state");

      assert.ok(redirectUri);
      assert.ok(state);

      setTimeout(() => {
        void fetch(`${redirectUri}?code=test-code&state=${state}`);
      }, 0);

      return true;
    },
  });

  const credentials = await credentialsPromise;

  assert.equal(credentials.provider, "openai-codex");
  assert.equal(credentials.clientId, "client-id");
  assert.equal(credentials.issuer, "https://auth.example.test");
  assert.equal(credentials.accessToken, accessToken);
  assert.equal(credentials.refreshToken, "refresh-token");
  assert.equal(credentials.idToken, idToken);
  assert.equal(credentials.tokenType, "Bearer");
  assert.deepEqual(credentials.scope, [
    "openid",
    "profile",
    "email",
    "offline_access",
    "api.connectors.read",
    "api.connectors.invoke",
  ]);
  assert.equal(credentials.email, "tester@example.com");
  assert.equal(credentials.apiKey, "sk-openai-api-key");
  assert.ok(credentials.expiresAt);
});

test("refreshOpenAICodexOAuthCredentials refreshes tokens and exchanges a new API token", async () => {
  const refreshedAccessToken = createJwt({
    exp: Math.floor(Date.now() / 1000) + 7200,
  });
  const refreshedIdToken = createJwt({
    exp: Math.floor(Date.now() / 1000) + 7200,
    email: "tester@example.com",
  });

  const refreshed = await refreshOpenAICodexOAuthCredentials({
    credentials: {
      provider: "openai-codex",
      clientId: "client-id",
      issuer: "https://auth.example.test",
      accessToken: "old-access-token",
      refreshToken: "refresh-token",
      idToken: "old-id-token",
      tokenType: "Bearer",
      scope: ["openid", "profile", "email"],
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
      email: "tester@example.com",
      apiKey: "old-api-key",
    },
    fetchImpl: async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      assert.equal(url, "https://auth.example.test/oauth/token");

      const params = new URLSearchParams(String(init?.body ?? ""));

      if (params.get("grant_type") === "refresh_token") {
        assert.equal(params.get("client_id"), "client-id");
        assert.equal(params.get("refresh_token"), "refresh-token");

        return new Response(
          JSON.stringify({
            id_token: refreshedIdToken,
            access_token: refreshedAccessToken,
            refresh_token: "next-refresh-token",
            token_type: "Bearer",
            scope: "openid profile email offline_access api.connectors.read api.connectors.invoke",
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          },
        );
      }

      assert.equal(params.get("grant_type"), "urn:ietf:params:oauth:grant-type:token-exchange");
      assert.equal(params.get("requested_token"), "openai-api-key");
      assert.equal(params.get("subject_token"), refreshedIdToken);

      return new Response(
        JSON.stringify({
          access_token: "new-api-key",
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
    },
  });

  assert.equal(refreshed.accessToken, refreshedAccessToken);
  assert.equal(refreshed.refreshToken, "next-refresh-token");
  assert.equal(refreshed.idToken, refreshedIdToken);
  assert.equal(refreshed.apiKey, "new-api-key");
  assert.deepEqual(refreshed.scope, [
    "openid",
    "profile",
    "email",
    "offline_access",
    "api.connectors.read",
    "api.connectors.invoke",
  ]);
  assert.equal(refreshed.email, "tester@example.com");
  assert.ok(refreshed.expiresAt);
});

test("isOpenAICodexOAuthAccessTokenExpired respects optional expiry timestamps", () => {
  assert.equal(
    isOpenAICodexOAuthAccessTokenExpired({
      provider: "openai-codex",
      clientId: "client-id",
      issuer: "https://auth.openai.com",
      accessToken: "access-token",
      refreshToken: "refresh-token",
      idToken: "id-token",
      tokenType: "Bearer",
      scope: ["openid"],
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    }),
    false,
  );
  assert.equal(
    isOpenAICodexOAuthAccessTokenExpired({
      provider: "openai-codex",
      clientId: "client-id",
      issuer: "https://auth.openai.com",
      accessToken: "access-token",
      refreshToken: "refresh-token",
      idToken: "id-token",
      tokenType: "Bearer",
      scope: ["openid"],
    }),
    false,
  );
});
