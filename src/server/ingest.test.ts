import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { generateMockRawEvents } from "../collectors/mock.js";
import { analyzeRawEvents } from "../pipeline/analyze.js";
import { AppDatabase } from "../storage/database.js";
import { generateReportSnapshot } from "../reporting/service.js";
import { coerceIncomingEvent, coerceIncomingEvents } from "./ingest.js";
import { startIngestServer } from "./ingest-server.js";

const TEST_AUTH_TOKEN = "test-ingest-auth-token";

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

test("coerceIncomingEvent preserves browser schema v2 payloads while remaining compatible with v1", () => {
  const v2 = coerceIncomingEvent({
    sourceEventType: "chrome.navigation",
    application: "chrome",
    browserSchemaVersion: 2,
    canonicalUrl: "https://admin.example.com/orders/{id}",
    routeTemplate: "/orders/{id}/edit",
    routeKey: "https://admin.example.com/orders/{id}",
    resourceHash: "abcdef1234567890",
    url: "https://admin.example.com/orders/123/edit?tab=history",
  });
  const v1 = coerceIncomingEvent({
    sourceEventType: "chrome.navigation",
    application: "chrome",
    url: "https://admin.example.com/orders/123/edit?tab=history",
  });

  assert.equal(v2.browserSchemaVersion, 2);
  assert.equal(v2.canonicalUrl, "https://admin.example.com/orders/{id}");
  assert.equal(v2.routeTemplate, "/orders/{id}/edit");
  assert.equal(v2.routeKey, "https://admin.example.com/orders/{id}");
  assert.equal(v2.resourceHash, "abcdef1234567890");
  assert.equal(v1.browserSchemaVersion, undefined);
  assert.equal(v1.canonicalUrl, undefined);
});

test("startIngestServer stores posted events", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "what-ive-done-server-"));
  const server = await startIngestServer({
    dataDir: tempDir,
    host: "127.0.0.1",
    port: 0,
    authToken: TEST_AUTH_TOKEN,
  });

  try {
    const response = await fetch(`http://${server.host}:${server.port}/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-What-Ive-Done-Token": TEST_AUTH_TOKEN,
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

test("collector browser context payloads survive ingest while signal-only dwell stays out of analysis", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "what-ive-done-browser-context-"));
  const server = await startIngestServer({
    dataDir: tempDir,
    host: "127.0.0.1",
    port: 0,
    authToken: TEST_AUTH_TOKEN,
  });

  try {
    const response = await fetch(`http://${server.host}:${server.port}/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-What-Ive-Done-Token": TEST_AUTH_TOKEN,
      },
      body: JSON.stringify({
        events: [
          {
            sourceEventType: "chrome.route_change",
            application: "chrome",
            url: "https://workspace.example.com/#/orders/123/edit",
            action: "navigation",
            target: "route_change",
            metadata: {
              browserContext: {
                routeTaxonomy: {
                  source: "hash",
                  signature: "hash:/orders/{id}/edit",
                  routeTemplate: "/orders/{id}/edit",
                  depth: 3,
                  primarySection: "orders",
                  secondarySection: "{id}",
                  leafSection: "edit",
                  dynamicSegmentCount: 1,
                },
                documentTypeHash: "abcdef1234567890abcdef12",
                tabOrder: {
                  globalSequence: 8,
                  windowSequence: 4,
                  tabIndex: 2,
                  previousTabId: 7,
                  windowId: 3,
                },
              },
            },
          },
          {
            sourceEventType: "chrome.dwell",
            application: "chrome",
            url: "https://workspace.example.com/#/orders/123/edit",
            action: "dwell",
            target: "route_dwell",
            metadata: {
              browserContext: {
                routeTaxonomy: {
                  source: "hash",
                  signature: "hash:/orders/{id}/edit",
                  routeTemplate: "/orders/{id}/edit",
                },
                documentTypeHash: "abcdef1234567890abcdef12",
                dwell: {
                  durationMs: 15000,
                  startedAt: "2026-03-17T00:00:00.000Z",
                  endedAt: "2026-03-17T00:00:15.000Z",
                  reason: "route_change",
                },
                signalOnly: true,
              },
            },
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

    const rawEvents = database.getRawEventsChronological();
    const analysis = analyzeRawEvents(rawEvents);

    assert.equal(rawEvents.length, 2);
    assert.equal(analysis.normalizedEvents.length, 1);
    assert.equal(
      ((rawEvents[0]?.metadata.browserContext as Record<string, unknown>)?.routeTaxonomy as Record<
        string,
        unknown
      >)?.signature,
      "hash:/orders/{id}/edit",
    );
    assert.equal(
      (rawEvents[0]?.metadata.browserContext as Record<string, unknown>)?.documentTypeHash,
      "abcdef1234567890abcdef12",
    );
    assert.equal(
      ((rawEvents[1]?.metadata.browserContext as Record<string, unknown>)?.dwell as Record<string, unknown>)?.durationMs,
      15000,
    );
    assert.equal(
      ((analysis.normalizedEvents[0]?.metadata.browserContext as Record<string, unknown>)?.routeTaxonomy as Record<
        string,
        unknown
      >)?.signature,
      "hash:/orders/{id}/edit",
    );

    database.close();
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
    authToken: TEST_AUTH_TOKEN,
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
    const healthResponse = await fetch(`http://${server.host}:${server.port}/health`);
    const health = (await healthResponse.json()) as {
      security: { authRequired: boolean; localOnly: boolean; authTokenPreview: string };
    };

    assert.equal(health.security.authRequired, true);
    assert.equal(health.security.localOnly, true);
    assert.equal(typeof health.security.authTokenPreview, "string");

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

test("startIngestServer rejects browser ingest requests without an auth token", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "what-ive-done-ingest-auth-"));
  const server = await startIngestServer({
    dataDir: tempDir,
    host: "127.0.0.1",
    port: 0,
    authToken: TEST_AUTH_TOKEN,
  });

  try {
    const response = await fetch(`http://${server.host}:${server.port}/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sourceEventType: "chrome.navigation",
        application: "chrome",
        url: "https://example.com/orders",
      }),
    });

    assert.equal(response.status, 401);
  } finally {
    await server.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("startIngestServer rate limits abnormal ingest bursts", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "what-ive-done-ingest-rate-limit-"));
  const server = await startIngestServer({
    dataDir: tempDir,
    host: "127.0.0.1",
    port: 0,
    authToken: TEST_AUTH_TOKEN,
    rateLimitMaxRequests: 1,
    rateLimitWindowMs: 60_000,
  });

  try {
    const headers = {
      "Content-Type": "application/json",
      "X-What-Ive-Done-Token": TEST_AUTH_TOKEN,
    };
    const body = JSON.stringify({
      sourceEventType: "chrome.navigation",
      application: "chrome",
      url: "https://example.com/orders",
    });
    const firstResponse = await fetch(`http://${server.host}:${server.port}/events`, {
      method: "POST",
      headers,
      body,
    });
    const secondResponse = await fetch(`http://${server.host}:${server.port}/events`, {
      method: "POST",
      headers,
      body,
    });

    assert.equal(firstResponse.status, 202);
    assert.equal(secondResponse.status, 429);
    assert.ok(secondResponse.headers.get("Retry-After"));
  } finally {
    await server.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("startIngestServer rejects non-local bind hosts", async () => {
  await assert.rejects(
    () =>
      startIngestServer({
        host: "0.0.0.0",
        port: 0,
        authToken: TEST_AUTH_TOKEN,
      }),
    /localhost only/u,
  );
});
