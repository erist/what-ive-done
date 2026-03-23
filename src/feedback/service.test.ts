import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { generateMockRawEvents } from "../collectors/mock.js";
import type { RawEventInput } from "../domain/types.js";
import { analyzeRawEvents } from "../pipeline/analyze.js";
import { AppDatabase } from "../storage/database.js";
import { saveWorkflowReview } from "./service.js";

function createTestDatabase(tempDir: string): AppDatabase {
  return new AppDatabase({
    dataDir: tempDir,
    databasePath: join(tempDir, "test.sqlite"),
    agentLockPath: join(tempDir, "agent.lock"),
  });
}

function seedRawEvents(database: AppDatabase, inputs: RawEventInput[]): void {
  for (const input of inputs) {
    database.insertRawEvent(input);
  }
}

function createRepeatedOrderReviewEvents(): RawEventInput[] {
  const steps: Array<{ timestamp: string; action: "navigation" | "click"; target: string }> = [
    { timestamp: "2026-03-14T09:00:00.000Z", action: "navigation", target: "open_admin" },
    { timestamp: "2026-03-14T09:00:50.000Z", action: "click", target: "search_order" },
    { timestamp: "2026-03-14T09:01:35.000Z", action: "click", target: "update_status" },
    { timestamp: "2026-03-14T09:02:30.000Z", action: "click", target: "notify_customer" },
    { timestamp: "2026-03-14T09:09:00.000Z", action: "navigation", target: "open_admin" },
    { timestamp: "2026-03-14T09:09:50.000Z", action: "click", target: "search_order" },
    { timestamp: "2026-03-14T09:10:35.000Z", action: "click", target: "update_status" },
    { timestamp: "2026-03-14T09:11:30.000Z", action: "click", target: "notify_customer" },
    { timestamp: "2026-03-14T09:18:00.000Z", action: "navigation", target: "open_admin" },
    { timestamp: "2026-03-14T09:18:50.000Z", action: "click", target: "search_order" },
    { timestamp: "2026-03-14T09:19:35.000Z", action: "click", target: "update_status" },
    { timestamp: "2026-03-14T09:20:30.000Z", action: "click", target: "notify_customer" },
  ];

  return steps.map(({ timestamp, action, target }, index) => ({
    source: "mock",
    sourceEventType: action === "navigation" ? "chrome.navigation" : "browser.click",
    timestamp,
    application: "chrome",
    domain: "admin.internal",
    url: "https://admin.internal/orders",
    action,
    target,
    metadata: {
      fixture: "feedback-service-split",
      stepIndex: index + 1,
    },
  }));
}

test("saveWorkflowReview immediately refreshes stored artifacts for merge feedback", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "what-ive-done-feedback-service-merge-"));

  try {
    const database = createTestDatabase(tempDir);
    database.initialize();
    seedRawEvents(database, generateMockRawEvents(new Date("2026-03-14T18:00:00.000Z")));

    database.replaceAnalysisArtifacts(analyzeRawEvents(database.getRawEventsChronological()));

    const workflows = database.listWorkflowClusters();

    assert.equal(workflows.length, 5);

    const result = saveWorkflowReview(database, {
      workflowId: workflows[1]!.id,
      mergeIntoWorkflowId: workflows[0]!.id,
    });
    const mergedWorkflows = database.listWorkflowClusters();
    const mergeTarget = mergedWorkflows.find((workflow) => workflow.id === workflows[0]!.id);

    assert.equal(result.analysisRefreshed, true);
    assert.equal(result.resolvedWorkflowId, workflows[0]!.id);
    assert.ok(result.affectedWorkflows.some((workflow) => workflow.id === workflows[0]!.id));
    assert.equal(mergedWorkflows.length, 4);
    assert.equal(mergeTarget?.frequency, 6);

    database.close();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("saveWorkflowReview immediately refreshes stored artifacts for split feedback", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "what-ive-done-feedback-service-split-"));

  try {
    const database = createTestDatabase(tempDir);
    database.initialize();
    seedRawEvents(database, createRepeatedOrderReviewEvents());

    database.replaceAnalysisArtifacts(analyzeRawEvents(database.getRawEventsChronological(), {
      minimumWorkflowFrequency: 1,
      minSessionDurationSeconds: 0,
    }));

    const [workflow] = database.listWorkflowClusters();

    assert.ok(workflow);
    assert.deepEqual(workflow.representativeSequence, [
      "open_admin",
      "search_order",
      "update_status",
      "notify_customer",
    ]);

    const result = saveWorkflowReview(database, {
      workflowId: workflow.id,
      splitAfterActionName: "search_order",
    });
    const splitWorkflows = database.listWorkflowClusters()
      .map((cluster) => cluster.representativeSequence);

    assert.equal(result.analysisRefreshed, true);
    assert.equal(result.affectedWorkflows.length, 2);
    assert.equal(database.listWorkflowClusters().length, 2);
    assert.deepEqual(
      splitWorkflows.sort((left, right) => left.join(">").localeCompare(right.join(">"))),
      [["open_admin", "search_order"], ["update_status", "notify_customer"]],
    );

    database.close();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("saveWorkflowReview marks structural feedback as user-labeled in stored artifacts", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "what-ive-done-feedback-service-visibility-"));

  try {
    const database = createTestDatabase(tempDir);
    database.initialize();
    seedRawEvents(database, generateMockRawEvents(new Date("2026-03-14T18:00:00.000Z")));

    database.replaceAnalysisArtifacts(analyzeRawEvents(database.getRawEventsChronological()));

    const [workflow] = database.listWorkflowClusters();

    assert.ok(workflow);
    assert.equal(workflow.userLabeled, false);

    const result = saveWorkflowReview(database, {
      workflowId: workflow.id,
      excluded: true,
    });
    const refreshedWorkflow = database.getWorkflowClusterById(workflow.id);

    assert.equal(result.workflow?.userLabeled, true);
    assert.equal(refreshedWorkflow?.excluded, true);
    assert.equal(refreshedWorkflow?.userLabeled, true);

    database.close();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
