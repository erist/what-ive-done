import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AppDatabase } from "../storage/database.js";
import { coerceIncomingEvents } from "./ingest.js";
import { startIngestServer } from "./ingest-server.js";

test("coerceIncomingEvents accepts a single event or events wrapper", () => {
  const single = coerceIncomingEvents({
    sourceEventType: "browser.click",
    target: "save_button",
  });
  const wrapped = coerceIncomingEvents({
    events: [{ sourceEventType: "chrome.navigation", url: "https://example.com" }],
  });

  assert.equal(single.length, 1);
  assert.equal(single[0]?.source, "chrome_extension");
  assert.equal(single[0]?.application, "chrome");
  assert.equal(single[0]?.action, "click");
  assert.equal(wrapped.length, 1);
  assert.equal(wrapped[0]?.action, "navigation");
});

test("startIngestServer stores posted events", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "what-ive-done-server-"));
  const server = await startIngestServer({
    dataDir: tempDir,
    host: "127.0.0.1",
    port: 0,
  });

  try {
    const response = await fetch(`http://${server.host}:${server.port}/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        events: [
          {
            sourceEventType: "chrome.navigation",
            application: "chrome",
            url: "https://example.com/orders",
            domain: "example.com",
            action: "navigation",
            target: "orders_page",
          },
        ],
      }),
    });

    assert.equal(response.status, 202);

    const database = new AppDatabase({
      dataDir: tempDir,
      databasePath: join(tempDir, "what-ive-done.sqlite"),
    });
    database.initialize();
    const events = database.listRawEvents();
    database.close();

    assert.equal(events.length, 1);
    assert.equal(events[0]?.target, "orders_page");
  } finally {
    await server.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});
