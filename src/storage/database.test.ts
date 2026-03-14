import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { generateMockRawEvents } from "../collectors/mock.js";
import type { RawEvent } from "../domain/types.js";
import { analyzeRawEvents } from "../pipeline/analyze.js";
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

function toRawEventInputs() {
  return generateMockRawEvents();
}

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
