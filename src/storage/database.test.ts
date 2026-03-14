import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { generateMockRawEvents } from "../collectors/mock.js";
import type { RawEvent } from "../domain/types.js";
import { analyzeRawEvents } from "../pipeline/analyze.js";
import { resolveReportTimeWindow } from "../reporting/windows.js";
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

function toRawEvents(): RawEvent[] {
  return generateMockRawEvents().map((input, index) => ({
    id: `raw-${index + 1}`,
    source: input.source,
    sourceEventType: input.sourceEventType,
    timestamp: input.timestamp,
    application: input.application,
    windowTitle: input.windowTitle,
    domain: input.domain,
    url: input.url,
    action: input.action,
    target: input.target,
    metadata: input.metadata ?? {},
    sensitiveFiltered: true,
    createdAt: input.timestamp,
  }));
}

function toRawEventInputs(referenceDate?: Date) {
  return generateMockRawEvents(referenceDate);
}

test("getRawEventsInRange returns only events within the selected local day", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "what-ive-done-range-"));
  const referenceDate = new Date(2026, 2, 14, 12, 0, 0, 0);
  const timezoneOffsetMinutes = -referenceDate.getTimezoneOffset();
  const reportWindow = resolveReportTimeWindow({
    window: "day",
    reportDate: "2026-03-14",
    timezone: "Test/Local",
    timezoneOffsetMinutes,
  });

  try {
    const database = new AppDatabase({
      dataDir: tempDir,
      databasePath: join(tempDir, "test.sqlite"),
    });
    database.initialize();

    for (const input of toRawEventInputs(referenceDate)) {
      database.insertRawEvent(input);
    }

    const rangedEvents = database.getRawEventsInRange(
      reportWindow.startTime ?? "",
      reportWindow.endTime ?? "",
    );

    assert.equal(rangedEvents.length, 20);
    assert.ok(
      rangedEvents.every(
        (event) =>
          event.timestamp >= (reportWindow.startTime ?? "") &&
          event.timestamp < (reportWindow.endTime ?? ""),
      ),
    );

    database.close();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("workflow feedback persists across analysis refreshes for stable cluster ids", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "what-ive-done-feedback-"));

  try {
    const database = new AppDatabase({
      dataDir: tempDir,
      databasePath: join(tempDir, "test.sqlite"),
    });
    database.initialize();

    for (const input of toRawEventInputs()) {
      database.insertRawEvent(input);
    }

    const analysisResult = analyzeRawEvents(database.getRawEventsChronological());
    database.replaceAnalysisArtifacts(analysisResult);

    const workflow = database.listWorkflowClusters()[0];

    assert.ok(workflow);

    database.saveWorkflowFeedback({
      workflowClusterId: workflow.id,
      renameTo: "Renamed workflow",
    });
    database.saveWorkflowFeedback({
      workflowClusterId: workflow.id,
      excluded: true,
    });

    database.replaceAnalysisArtifacts(analysisResult);

    const refreshedWorkflow = database
      .listWorkflowClusters()
      .find((cluster) => cluster.id === workflow.id);

    assert.equal(refreshedWorkflow?.name, "Renamed workflow");
    assert.equal(refreshedWorkflow?.excluded, true);

    database.close();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("normalized events persist derived normalization fields", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "what-ive-done-normalized-events-"));

  try {
    const database = new AppDatabase({
      dataDir: tempDir,
      databasePath: join(tempDir, "test.sqlite"),
    });
    database.initialize();

    database.insertRawEvent({
      source: "chrome_extension",
      sourceEventType: "chrome.navigation",
      timestamp: "2026-03-14T10:12:23.000Z",
      application: "Google Chrome",
      url: "https://admin.example.com/product/123/edit?tab=stock",
      windowTitle: "Admin - Product 123 Edit",
      action: "navigation",
      target: "edit_product",
    });

    const analysisResult = analyzeRawEvents(database.getRawEventsChronological());
    database.replaceAnalysisArtifacts(analysisResult);

    const normalizedEvents = database.listNormalizedEvents();

    assert.equal(normalizedEvents.length, 1);
    assert.equal(normalizedEvents[0]?.appNameNormalized, "chrome");
    assert.equal(normalizedEvents[0]?.pathPattern, "/product/{id}/edit");
    assert.equal(normalizedEvents[0]?.pageType, "product_edit");
    assert.equal(normalizedEvents[0]?.titlePattern, "Admin - Product {id} Edit");

    database.close();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("deleting a session removes its source events and changes downstream analysis", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "what-ive-done-session-delete-"));

  try {
    const database = new AppDatabase({
      dataDir: tempDir,
      databasePath: join(tempDir, "test.sqlite"),
    });
    database.initialize();

    for (const input of toRawEventInputs()) {
      database.insertRawEvent(input);
    }

    let analysisResult = analyzeRawEvents(database.getRawEventsChronological());
    database.replaceAnalysisArtifacts(analysisResult);

    const sessions = database.listSessionSummaries();

    assert.equal(sessions.length, 15);

    const deletedRawEvents = database.deleteSessionSourceEvents(sessions[0]!.id);

    assert.equal(deletedRawEvents, 4);

    analysisResult = analyzeRawEvents(database.getRawEventsChronological());
    database.replaceAnalysisArtifacts(analysisResult);

    assert.equal(database.getRawEventsChronological().length, 56);
    assert.equal(database.listSessionSummaries().length, 14);
    assert.equal(database.listWorkflowClusters().length, 4);

    database.close();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("session details can be loaded with ordered steps", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "what-ive-done-session-show-"));

  try {
    const database = new AppDatabase({
      dataDir: tempDir,
      databasePath: join(tempDir, "test.sqlite"),
    });
    database.initialize();

    for (const input of toRawEventInputs()) {
      database.insertRawEvent(input);
    }

    const analysisResult = analyzeRawEvents(database.getRawEventsChronological());
    database.replaceAnalysisArtifacts(analysisResult);

    const sessionSummary = database.listSessionSummaries()[0];
    const session = database.getSessionById(sessionSummary!.id);

    assert.ok(session);
    assert.ok(sessionSummary?.sessionBoundaryReason);
    assert.equal(session.sessionBoundaryReason, sessionSummary?.sessionBoundaryReason);
    assert.equal(session.steps.length, 4);
    assert.equal(session.steps[0]?.order, 1);
    assert.ok(session.steps[0]?.action);
    assert.ok(session.steps[0]?.actionName);
    assert.ok(typeof session.steps[0]?.actionConfidence === "number");

    database.close();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("LLM payload records exclude raw event details and honor workflow feedback filters", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "what-ive-done-llm-payload-"));

  try {
    const database = new AppDatabase({
      dataDir: tempDir,
      databasePath: join(tempDir, "test.sqlite"),
    });
    database.initialize();

    for (const input of toRawEventInputs()) {
      database.insertRawEvent(input);
    }

    const analysisResult = analyzeRawEvents(database.getRawEventsChronological());
    database.replaceAnalysisArtifacts(analysisResult);

    const firstWorkflow = database.listWorkflowClusters()[0];

    assert.ok(firstWorkflow);

    database.saveWorkflowFeedback({
      workflowClusterId: firstWorkflow.id,
      excluded: true,
    });

    const payloads = database.listWorkflowSummaryPayloadRecords();
    const includedPayloads = database.listWorkflowSummaryPayloadRecords({
      includeExcluded: true,
    });

    assert.equal(payloads.length, 4);
    assert.equal(includedPayloads.length, 5);
    assert.equal(JSON.stringify(includedPayloads).includes("windowTitle"), false);
    assert.equal(JSON.stringify(includedPayloads).includes("url"), false);
    assert.ok(includedPayloads[0]?.payload.workflowSteps.length);

    database.close();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("workflow LLM analyses can be stored and surfaced through workflow names", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "what-ive-done-llm-store-"));

  try {
    const database = new AppDatabase({
      dataDir: tempDir,
      databasePath: join(tempDir, "test.sqlite"),
    });
    database.initialize();

    for (const input of toRawEventInputs()) {
      database.insertRawEvent(input);
    }

    const analysisResult = analyzeRawEvents(database.getRawEventsChronological());
    database.replaceAnalysisArtifacts(analysisResult);

    const workflow = database.listWorkflowClusters()[0];

    assert.ok(workflow);

    database.replaceWorkflowLLMAnalyses([
      {
        workflowClusterId: workflow.id,
        provider: "openai",
        model: "gpt-5-mini",
        workflowName: "AI Renamed Workflow",
        workflowSummary: "Summarized workflow.",
        automationSuitability: "high",
        recommendedApproach: "Browser automation",
        rationale: "Repeated and browser heavy.",
        createdAt: new Date().toISOString(),
      },
    ]);
    database.saveWorkflowFeedback({
      workflowClusterId: workflow.id,
      renameTo: "AI Renamed Workflow",
    });

    const storedAnalysis = database.listWorkflowLLMAnalyses()[0];
    const renamedWorkflow = database
      .listWorkflowClusters()
      .find((cluster) => cluster.id === workflow.id);

    assert.equal(storedAnalysis?.workflowName, "AI Renamed Workflow");
    assert.equal(renamedWorkflow?.name, "AI Renamed Workflow");

    database.close();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
