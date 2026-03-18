import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { resolveAppPaths } from "../app-paths.js";
import { AppDatabase } from "../storage/database.js";
import { runInit } from "./flow.js";

test("runInit prompts for reconfiguration on existing data dirs and resets stored data when requested", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "what-ive-done-init-reconfigure-"));
  const promptsSeen: string[] = [];

  try {
    await runInit(dataDir);

    const database = new AppDatabase(resolveAppPaths(dataDir));
    database.initialize();
    database.setSetting("test.marker", {
      persisted: true,
    });
    database.close();

    const result = await runInit(dataDir, {
      prompts: {
        confirm: async (question: string) => {
          promptsSeen.push(question);
          return true;
        },
      },
    });

    const resetDatabase = new AppDatabase(resolveAppPaths(dataDir));
    resetDatabase.initialize();

    assert.equal(result.status, "initialized");
    assert.equal(resetDatabase.getSetting("test.marker"), undefined);
    assert.deepEqual(promptsSeen, [
      "Reconfigure existing setup?",
      "Reset data? This will delete all collected events.",
    ]);

    resetDatabase.close();
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
