import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AppDatabase } from "./database.js";

test("AppDatabase initializes schema and stores sanitized raw events", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "what-ive-done-"));

  try {
    const database = new AppDatabase({
      dataDir: tempDir,
      databasePath: join(tempDir, "test.sqlite"),
    });

    database.initialize();

    database.insertRawEvent({
      source: "mock",
      sourceEventType: "chrome.navigation",
      timestamp: "2026-03-14T10:12:23.000Z",
      application: "chrome",
      url: "https://admin.internal/orders?token=sensitive",
      action: "page_navigation",
      metadata: {
        clickedButton: "open-order",
        authToken: "secret",
      },
    });

    const events = database.listRawEvents();

    assert.equal(events.length, 1);
    assert.equal(events[0]?.application, "chrome");
    assert.equal(
      events[0]?.url,
      "https://admin.internal/orders?token=%5BREDACTED%5D",
    );
    assert.deepEqual(events[0]?.metadata, {
      clickedButton: "open-order",
      authToken: "[REDACTED]",
    });

    database.close();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
