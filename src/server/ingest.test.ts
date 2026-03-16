import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { generateMockRawEvents } from "../collectors/mock.js";
import { AppDatabase } from "../storage/database.js";
import { generateReportSnapshot } from "../reporting/service.js";
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
      agentLockPath: join(tempDir, "agent.lock"),
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

test("startIngestServer serves the local viewer and live viewer API", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "what-ive-done-viewer-server-"));
  const database = new AppDatabase({
    dataDir: tempDir,
    databasePath: join(tempDir, "what-ive-done.sqlite"),
    agentLockPath: join(tempDir, "agent.lock"),
  });
  database.initialize();

  for (const event of generateMockRawEvents()) {
    database.insertRawEvent(event);
  }

  generateReportSnapshot(database, {
    window: "week",
  });
  database.close();

  const server = await startIngestServer({
    dataDir: tempDir,
    host: "127.0.0.1",
    port: 0,
  });

  try {
    const htmlResponse = await fetch(server.viewerUrl);
    const html = await htmlResponse.text();

    assert.equal(htmlResponse.status, 200);
    assert.ok(html.includes("What I've Done"));

    const dashboardResponse = await fetch(`${server.viewerUrl}api/viewer/dashboard?window=all`);
    const dashboard = (await dashboardResponse.json()) as {
      report: { workflows: unknown[]; emergingWorkflows: unknown[] };
      sessionSummaries: Array<{ id: string }>;
      latestSnapshots: unknown[];
    };

    assert.equal(dashboardResponse.status, 200);
    assert.ok(Array.isArray(dashboard.report.workflows));
    assert.ok(Array.isArray(dashboard.sessionSummaries));
    assert.ok(dashboard.sessionSummaries.length > 0);
    assert.equal(dashboard.latestSnapshots.length, 1);

    const firstSessionId = dashboard.sessionSummaries[0]?.id;
    assert.ok(firstSessionId);

    const sessionResponse = await fetch(
      `${server.viewerUrl}api/viewer/sessions/${encodeURIComponent(firstSessionId ?? "")}?window=all`,
    );
    const session = (await sessionResponse.json()) as { id: string; steps: unknown[] };

    assert.equal(sessionResponse.status, 200);
    assert.equal(session.id, firstSessionId);
    assert.ok(session.steps.length > 0);
  } finally {
    await server.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});
