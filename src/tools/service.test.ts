import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { resolveAppPaths } from "../app-paths.js";
import { createLinuxFileCredentialStore } from "../credentials/store.js";
import {
  getGeminiOAuthCredentials,
  getLLMApiKey,
  getOpenAICodexOAuthCredentials,
  setGeminiOAuthCredentials,
} from "../credentials/llm.js";
import { AppDatabase } from "../storage/database.js";
import { ConfigManager } from "../config/manager.js";
import { addTool, refreshTool, removeTool } from "./service.js";

function initializeDataDir(dataDir: string): void {
  ConfigManager.initialize(dataDir);
  const database = new AppDatabase(resolveAppPaths(dataDir));
  database.initialize();
  database.close();
}

function createPromptStub(overrides: {
  secret?: string;
  confirm?: boolean;
} = {}) {
  return {
    text: async (_question: string, defaultValue?: string) => defaultValue ?? "",
    confirm: async () => overrides.confirm ?? false,
    select: async (_question: string, options: string[], defaultIndex = 0) =>
      options[defaultIndex] ?? "",
    secret: async () => overrides.secret ?? "",
  };
}

test("addTool and removeTool manage analyzer credentials through the configured store", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "what-ive-done-tools-service-"));
  const dataDir = join(tempDir, "data");
  const credentialDir = join(tempDir, "credentials");

  try {
    initializeDataDir(dataDir);

    const credentialStore = createLinuxFileCredentialStore(credentialDir);

    const added = await addTool(
      dataDir,
      "claude",
      {
        model: "claude-sonnet-4-5",
      },
      {
        credentialStore,
        prompts: createPromptStub({
          secret: "sk-test-claude",
        }),
      },
    );

    assert.equal(added.status, "added");
    assert.equal(getLLMApiKey(credentialStore, "claude"), "sk-test-claude");

    const config = ConfigManager.load(dataDir);

    assert.equal(config.tools.claude?.added, true);
    assert.equal(config.tools.claude?.auth, "api-key");
    assert.equal(config.tools.claude?.model, "claude-sonnet-4-5");
    assert.equal(config.llm.default, "claude");

    const removed = await removeTool(
      dataDir,
      "claude",
      {
        deleteCredentials: true,
      },
      {
        credentialStore,
      },
    );

    assert.equal(removed.status, "removed");
    assert.equal(getLLMApiKey(credentialStore, "claude"), undefined);
    assert.equal(ConfigManager.load(dataDir).tools.claude, undefined);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("refreshTool updates stored gemini OAuth credentials", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "what-ive-done-tools-refresh-"));
  const dataDir = join(tempDir, "data");
  const credentialDir = join(tempDir, "credentials");

  try {
    initializeDataDir(dataDir);

    const credentialStore = createLinuxFileCredentialStore(credentialDir);

    setGeminiOAuthCredentials(credentialStore, {
      provider: "gemini",
      clientId: "client-id",
      clientSecret: "client-secret",
      projectId: "project-id",
      accessToken: "old-token",
      refreshToken: "refresh-token",
      tokenType: "Bearer",
      scope: ["scope-a"],
      expiresAt: "2026-03-18T00:00:00.000Z",
    });

    const refreshed = await refreshTool(dataDir, "gemini", {
      credentialStore,
      refreshOAuthCredentials: async ({ credentials }) => ({
        ...credentials,
        accessToken: "new-token",
        expiresAt: "2026-03-19T00:00:00.000Z",
      }),
    });

    assert.equal(refreshed.status, "refreshed");
    assert.equal(getGeminiOAuthCredentials(credentialStore)?.accessToken, "new-token");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("addTool stores openai-codex OAuth credentials and analyzer config", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "what-ive-done-tools-openai-codex-"));
  const dataDir = join(tempDir, "data");
  const credentialDir = join(tempDir, "credentials");

  try {
    initializeDataDir(dataDir);

    const credentialStore = createLinuxFileCredentialStore(credentialDir);

    const added = await addTool(
      dataDir,
      "openai-codex",
      {
        model: "gpt-5.4",
        clientId: "openai-client-id",
      },
      {
        credentialStore,
        runOpenAICodexOAuthLogin: async ({ clientId, issuer }) => ({
          provider: "openai-codex",
          clientId,
          issuer: issuer ?? "https://auth.openai.com",
          accessToken: "oauth-access-token",
          refreshToken: "oauth-refresh-token",
          idToken: "oauth-id-token",
          tokenType: "Bearer",
          scope: ["openid", "profile", "email", "offline_access"],
          expiresAt: "2026-03-19T00:00:00.000Z",
          email: "tester@example.com",
          apiKey: "sk-openai-api-key",
        }),
      },
    );

    assert.equal(added.status, "added");
    assert.match(added.message, /openai-codex/iu);

    const config = ConfigManager.load(dataDir) as {
      tools: Record<string, Record<string, unknown> | undefined>;
      llm: { default?: string };
    };

    assert.equal(config.tools["openai-codex"]?.added, true);
    assert.equal(config.tools["openai-codex"]?.auth, "oauth2");
    assert.equal(config.tools["openai-codex"]?.model, "gpt-5.4");
    assert.equal(config.llm.default, "openai-codex");
    assert.equal(getOpenAICodexOAuthCredentials(credentialStore)?.email, "tester@example.com");

    const removed = await removeTool(
      dataDir,
      "openai-codex",
      {
        deleteCredentials: true,
      },
      {
        credentialStore,
      },
    );

    assert.equal(removed.status, "removed");
    assert.equal(getOpenAICodexOAuthCredentials(credentialStore), undefined);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
