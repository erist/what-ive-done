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

async function readViewerSurface(viewerUrl: string): Promise<{
  status: number;
  html: string;
  viewerActionToken: string;
}> {
  const response = await fetch(viewerUrl);
  const html = await response.text();
  const viewerActionToken =
    html.match(/<meta name="wid-viewer-action-token" content="([^"]*)"/u)?.[1] ?? "";

  assert.ok(viewerActionToken);

  return {
    status: response.status,
    html,
    viewerActionToken,
  };
}

async function waitForAnalysisRun(
  viewerUrl: string,
  runId: string,
): Promise<{ id: string; status: string; summary: Record<string, unknown> }> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await fetch(
      `${viewerUrl}api/viewer/analysis/runs/${encodeURIComponent(runId)}`,
    );
    const payload = (await response.json()) as {
      run: { id: string; status: string; summary: Record<string, unknown> };
    };

    assert.equal(response.status, 200);

    if (payload.run.status !== "running") {
      return payload.run;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(`Timed out waiting for analysis run ${runId}`);
}

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
    const viewerSurface = await readViewerSurface(server.viewerUrl);

    assert.equal(viewerSurface.status, 200);
    assert.ok(viewerSurface.html.includes("What I've Done"));

    const dashboardResponse = await fetch(`${server.viewerUrl}api/viewer/dashboard?window=all`);
    const dashboard = (await dashboardResponse.json()) as {
      report: { workflows: unknown[]; emergingWorkflows: unknown[] };
      comparison?: unknown;
      reviewableWorkflows: Array<{ id: string; excluded: boolean; hidden: boolean }>;
      sessionSummaries: Array<{ id: string }>;
      latestSnapshots: unknown[];
    };

    assert.equal(dashboardResponse.status, 200);
    assert.ok(Array.isArray(dashboard.report.workflows));
    assert.ok(Array.isArray(dashboard.reviewableWorkflows));
    assert.ok(dashboard.reviewableWorkflows.length > 0);
    assert.ok(Array.isArray(dashboard.sessionSummaries));
    assert.ok(dashboard.sessionSummaries.length > 0);
    assert.equal(dashboard.latestSnapshots.length, 1);
    assert.equal(dashboard.comparison, undefined);
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

    const firstWorkflowId = dashboard.reviewableWorkflows[0]?.id;
    assert.ok(firstWorkflowId);

    const workflowResponse = await fetch(
      `${server.viewerUrl}api/viewer/workflows/${encodeURIComponent(firstWorkflowId ?? "")}?window=all`,
    );
    const workflow = (await workflowResponse.json()) as {
      id: string;
      automationHints: unknown[];
      workflowName: string;
      excluded: boolean;
      hidden: boolean;
    };

    assert.equal(workflowResponse.status, 200);
    assert.equal(workflow.id, firstWorkflowId);
    assert.ok(Array.isArray(workflow.automationHints));

    const feedbackResponse = await fetch(
      `${server.viewerUrl}api/viewer/workflows/${encodeURIComponent(firstWorkflowId ?? "")}?window=all`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-What-Ive-Done-Viewer-Action-Token": viewerSurface.viewerActionToken,
        },
        body: JSON.stringify({
          name: "Viewer-reviewed workflow",
          purpose: "Validate the minimal feedback surface",
          automationCandidate: true,
          difficulty: "medium",
          excluded: true,
        }),
      },
    );
    const feedbackPayload = (await feedbackResponse.json()) as {
      status: string;
      workflow: {
        workflowName: string;
        businessPurpose: string;
        automationCandidate: boolean;
        automationDifficulty: string;
        excluded: boolean;
      };
    };

    assert.equal(feedbackResponse.status, 200);
    assert.equal(feedbackPayload.status, "workflow_feedback_saved");
    assert.equal(feedbackPayload.workflow.workflowName, "Viewer-reviewed workflow");
    assert.equal(feedbackPayload.workflow.businessPurpose, "Validate the minimal feedback surface");
    assert.equal(feedbackPayload.workflow.automationCandidate, true);
    assert.equal(feedbackPayload.workflow.automationDifficulty, "medium");
    assert.equal(feedbackPayload.workflow.excluded, true);

    const refreshedDashboardResponse = await fetch(`${server.viewerUrl}api/viewer/dashboard?window=all`);
    const refreshedDashboard = (await refreshedDashboardResponse.json()) as {
      report: { workflows: Array<{ workflowClusterId: string }> };
      reviewableWorkflows: Array<{ id: string; workflowName: string; excluded: boolean; visibleInReport: boolean }>;
    };
    const refreshedWorkflow = refreshedDashboard.reviewableWorkflows.find(
      (entry) => entry.id === firstWorkflowId,
    );

    assert.equal(refreshedDashboardResponse.status, 200);
    assert.ok(refreshedWorkflow);
    assert.equal(refreshedWorkflow?.workflowName, "Viewer-reviewed workflow");
    assert.equal(refreshedWorkflow?.excluded, true);
    assert.equal(refreshedWorkflow?.visibleInReport, false);
    assert.equal(
      refreshedDashboard.report.workflows.some((entry) => entry.workflowClusterId === firstWorkflowId),
      false,
    );

    const weekDashboardResponse = await fetch(`${server.viewerUrl}api/viewer/dashboard?window=week`);
    const weekDashboard = (await weekDashboardResponse.json()) as {
      comparison?: {
        currentTimeWindow: { reportDate: string };
        previousTimeWindow: { reportDate: string };
        newlyAppearedWorkflows: unknown[];
      };
    };

    assert.equal(weekDashboardResponse.status, 200);
    assert.ok(weekDashboard.comparison);
    assert.equal(weekDashboard.comparison?.currentTimeWindow.reportDate >= weekDashboard.comparison?.previousTimeWindow.reportDate, true);
    assert.ok(Array.isArray(weekDashboard.comparison?.newlyAppearedWorkflows));
  } finally {
    await server.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("startIngestServer rejects viewer workflow writes without an action token", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "what-ive-done-viewer-write-auth-"));
  const database = new AppDatabase({
    dataDir: tempDir,
    databasePath: join(tempDir, "what-ive-done.sqlite"),
    agentLockPath: join(tempDir, "agent.lock"),
  });
  database.initialize();

  for (const event of generateMockRawEvents()) {
    database.insertRawEvent(event);
  }

  database.close();

  const server = await startIngestServer({
    dataDir: tempDir,
    host: "127.0.0.1",
    port: 0,
    authToken: TEST_AUTH_TOKEN,
  });

  try {
    const dashboardResponse = await fetch(`${server.viewerUrl}api/viewer/dashboard?window=all`);
    const dashboard = (await dashboardResponse.json()) as {
      reviewableWorkflows: Array<{ id: string }>;
    };
    const firstWorkflowId = dashboard.reviewableWorkflows[0]?.id;

    assert.equal(dashboardResponse.status, 200);
    assert.ok(firstWorkflowId);

    const response = await fetch(
      `${server.viewerUrl}api/viewer/workflows/${encodeURIComponent(firstWorkflowId ?? "")}?window=all`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          hidden: true,
        }),
      },
    );

    assert.equal(response.status, 401);
  } finally {
    await server.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("startIngestServer runs viewer analysis and persists results", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "what-ive-done-viewer-analysis-"));
  const database = new AppDatabase({
    dataDir: tempDir,
    databasePath: join(tempDir, "what-ive-done.sqlite"),
    agentLockPath: join(tempDir, "agent.lock"),
  });
  database.initialize();

  for (const event of generateMockRawEvents()) {
    database.insertRawEvent(event);
  }

  database.close();

  let capturedPayloadCount = 0;
  const server = await startIngestServer({
    dataDir: tempDir,
    host: "127.0.0.1",
    port: 0,
    authToken: TEST_AUTH_TOKEN,
    analysisRunner: async ({ payloadRecords }) => {
      capturedPayloadCount = payloadRecords.length;

      return {
        configuration: {
          provider: "openai",
          authMethod: "api-key",
          model: "gpt-5-mini",
        },
        analyses: payloadRecords.map((record, index) => ({
          workflowClusterId: record.workflowClusterId,
          provider: "openai",
          model: "gpt-5-mini",
          workflowName: `Analyzed Workflow ${index + 1}`,
          workflowSummary: `Summary for ${record.workflowName}`,
          automationSuitability: "medium",
          recommendedApproach: "Browser automation",
          rationale: "Repeated workflow with stable steps.",
          createdAt: new Date().toISOString(),
        })),
      };
    },
  });

  try {
    const viewerSurface = await readViewerSurface(server.viewerUrl);

    const statusResponse = await fetch(`${server.viewerUrl}api/viewer/analysis/status?window=all`);
    const statusPayload = (await statusResponse.json()) as {
      payloadCount: number;
      workflowCount: number;
      shortFormExcludedCount: number;
      includeShortForm: boolean;
      latestRun: unknown;
      latestResultCount: number;
      credentialStatus: { configuration: { provider: string } };
    };

    assert.equal(statusResponse.status, 200);
    assert.ok(statusPayload.payloadCount > 0);
    assert.ok(statusPayload.workflowCount > 0);
    assert.equal(statusPayload.shortFormExcludedCount, 0);
    assert.equal(statusPayload.includeShortForm, false);
    assert.equal(statusPayload.latestRun, null);
    assert.equal(statusPayload.latestResultCount, 0);
    assert.equal(statusPayload.credentialStatus.configuration.provider, "openai");

    const runResponse = await fetch(`${server.viewerUrl}api/viewer/analysis/runs?window=all`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-What-Ive-Done-Viewer-Action-Token": viewerSurface.viewerActionToken,
      },
      body: JSON.stringify({
        applyNames: true,
      }),
    });
    const runPayload = (await runResponse.json()) as {
      status: string;
      run: { id: string; status: string; summary: { payloadCount: number } };
    };

    assert.equal(runResponse.status, 202);
    assert.equal(runPayload.status, "analysis_run_started");
    assert.equal(runPayload.run.status, "running");
    assert.equal(runPayload.run.summary.payloadCount, statusPayload.payloadCount);

    const completedRun = await waitForAnalysisRun(server.viewerUrl, runPayload.run.id);

    assert.equal(completedRun.status, "completed");
    assert.equal(completedRun.summary.resultCount, statusPayload.payloadCount);
    assert.equal(capturedPayloadCount, statusPayload.payloadCount);

    const resultsResponse = await fetch(`${server.viewerUrl}api/viewer/analysis/results`);
    const resultsPayload = (await resultsResponse.json()) as {
      latestRun: { id: string; status: string };
      analyses: Array<{ workflowName: string }>;
    };

    assert.equal(resultsResponse.status, 200);
    assert.equal(resultsPayload.latestRun.id, runPayload.run.id);
    assert.equal(resultsPayload.latestRun.status, "completed");
    assert.equal(resultsPayload.analyses.length, statusPayload.payloadCount);
    assert.equal(resultsPayload.analyses[0]?.workflowName, "Analyzed Workflow 1");

    const refreshedDashboardResponse = await fetch(`${server.viewerUrl}api/viewer/dashboard?window=all`);
    const refreshedDashboard = (await refreshedDashboardResponse.json()) as {
      reviewableWorkflows: Array<{ workflowName: string }>;
    };

    assert.equal(refreshedDashboardResponse.status, 200);
    assert.equal(
      refreshedDashboard.reviewableWorkflows.some((workflow) =>
        workflow.workflowName.startsWith("Analyzed Workflow"),
      ),
      true,
    );
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
