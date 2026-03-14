import test from "node:test";
import assert from "node:assert/strict";

import { createMacOSKeychainCredentialStore, createUnsupportedCredentialStore } from "./store.js";

test("macOS credential store uses security commands for OpenAI keys", () => {
  const calls: Array<{ file: string; args: string[] }> = [];
  let currentKey = "stored-key";

  const store = createMacOSKeychainCredentialStore((file, args) => {
    calls.push({ file, args });

    if (args[0] === "find-generic-password") {
      if (!currentKey) {
        throw new Error("not found");
      }

      return `${currentKey}\n`;
    }

    if (args[0] === "add-generic-password") {
      currentKey = args[3] ?? "";
      return "";
    }

    if (args[0] === "delete-generic-password") {
      currentKey = "";
      return "";
    }

    throw new Error("unexpected command");
  });

  assert.equal(store.isSupported(), true);
  assert.equal(store.hasOpenAIKey(), true);
  assert.equal(store.getOpenAIKey(), "stored-key");

  store.setOpenAIKey("new-key");
  assert.equal(store.getOpenAIKey(), "new-key");

  store.deleteOpenAIKey();
  assert.equal(store.getOpenAIKey(), undefined);
  assert.ok(calls.some((call) => call.args[0] === "add-generic-password"));
  assert.ok(calls.some((call) => call.args[0] === "delete-generic-password"));
});

test("unsupported credential store rejects secure storage writes", () => {
  const store = createUnsupportedCredentialStore();

  assert.equal(store.isSupported(), false);
  assert.throws(() => store.setOpenAIKey("key"), /not supported/);
});
