import test from "node:test";
import assert from "node:assert/strict";

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createMacOSKeychainCredentialStore,
  createUnsupportedCredentialStore,
  createWindowsDPAPICredentialStore,
} from "./store.js";

test("macOS credential store uses security commands for named secrets", () => {
  const calls: Array<{ file: string; args: string[] }> = [];
  const secrets = new Map<string, string>([["what-ive-done.llm.openai.api-key|default", "stored-key"]]);

  const store = createMacOSKeychainCredentialStore((file, args) => {
    calls.push({ file, args });
    const serviceName = args[args.indexOf("-s") + 1] ?? "";
    const accountName = args[args.indexOf("-a") + 1] ?? "";
    const key = `${serviceName}|${accountName}`;

    if (args[0] === "find-generic-password") {
      const secret = secrets.get(key);

      if (!secret) {
        throw new Error("not found");
      }

      return `${secret}\n`;
    }

    if (args[0] === "add-generic-password") {
      secrets.set(key, args[3] ?? "");
      return "";
    }

    if (args[0] === "delete-generic-password") {
      secrets.delete(key);
      return "";
    }

    throw new Error("unexpected command");
  });

  assert.equal(store.isSupported(), true);
  assert.equal(store.hasSecret("what-ive-done.llm.openai.api-key"), true);
  assert.equal(store.getSecret("what-ive-done.llm.openai.api-key"), "stored-key");

  store.setSecret("what-ive-done.llm.gemini.oauth", "{\"accessToken\":\"new-token\"}");
  assert.equal(store.getSecret("what-ive-done.llm.gemini.oauth"), "{\"accessToken\":\"new-token\"}");

  store.deleteSecret("what-ive-done.llm.openai.api-key");
  assert.equal(store.getSecret("what-ive-done.llm.openai.api-key"), undefined);
  assert.ok(calls.some((call) => call.args[0] === "add-generic-password"));
  assert.ok(calls.some((call) => call.args[0] === "delete-generic-password"));
});

test("unsupported credential store rejects secure storage writes", () => {
  const store = createUnsupportedCredentialStore();

  assert.equal(store.isSupported(), false);
  assert.throws(() => store.setSecret("test.service", "key"), /not supported/);
});

test("windows DPAPI credential store persists encrypted secrets in the local profile store", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "what-ive-done-win-credentials-"));
  const calls: Array<{ file: string; args: string[] }> = [];

  try {
    const store = createWindowsDPAPICredentialStore((file, args) => {
      calls.push({ file, args });

      if (args.some((argument) => argument.includes("Unprotect"))) {
        return "stored-key\n";
      }

      if (args.some((argument) => argument.includes("Protect"))) {
        return "encrypted-value\n";
      }

      throw new Error("unexpected command");
    }, tempDir);

    store.setSecret("what-ive-done.llm.openai.api-key", "stored-key");

    assert.equal(store.isSupported(), true);
    assert.equal(store.hasSecret("what-ive-done.llm.openai.api-key"), true);
    assert.equal(store.getSecret("what-ive-done.llm.openai.api-key"), "stored-key");

    store.deleteSecret("what-ive-done.llm.openai.api-key");
    assert.equal(store.getSecret("what-ive-done.llm.openai.api-key"), undefined);
    assert.ok(calls.some((call) => call.file === "powershell.exe"));
    assert.ok(calls.some((call) => call.args.some((argument) => argument.includes("Protect"))));
    assert.ok(calls.some((call) => call.args.some((argument) => argument.includes("Unprotect"))));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
