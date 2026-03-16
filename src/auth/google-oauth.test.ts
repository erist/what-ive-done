import test from "node:test";
import assert from "node:assert/strict";

import {
  isGoogleOAuthAccessTokenExpired,
  refreshGoogleOAuthCredentials,
} from "./google-oauth.js";

test("refreshGoogleOAuthCredentials refreshes access tokens", async () => {
  const refreshed = await refreshGoogleOAuthCredentials({
    credentials: {
      provider: "gemini",
      clientId: "client-id",
      clientSecret: "client-secret",
      projectId: "project-id",
      accessToken: "old-token",
      refreshToken: "refresh-token",
      tokenType: "Bearer",
      scope: ["scope-a"],
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    },
    fetchImpl: async (_url, init) => {
      const params = new URLSearchParams(String(init?.body));

      assert.equal(params.get("grant_type"), "refresh_token");
      assert.equal(params.get("refresh_token"), "refresh-token");

      return new Response(
        JSON.stringify({
          access_token: "new-token",
          token_type: "Bearer",
          expires_in: 3600,
          scope: "scope-a scope-b",
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

  assert.equal(refreshed.accessToken, "new-token");
  assert.deepEqual(refreshed.scope, ["scope-a", "scope-b"]);
});

test("isGoogleOAuthAccessTokenExpired respects expiry timestamps", () => {
  assert.equal(
    isGoogleOAuthAccessTokenExpired({
      provider: "gemini",
      clientId: "client-id",
      clientSecret: "client-secret",
      projectId: "project-id",
      accessToken: "token",
      refreshToken: "refresh-token",
      tokenType: "Bearer",
      scope: ["scope-a"],
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    }),
    false,
  );
});
