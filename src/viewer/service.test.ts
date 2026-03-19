import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ConfigManager } from "../config/manager.js";
import type { RawEventInput } from "../domain/types.js";
import { AppDatabase } from "../storage/database.js";
import { buildViewerAnalysisPreparation, buildViewerDashboard } from "./service.js";

function createTestDatabase(tempDir: string): AppDatabase {
  return new AppDatabase({
    dataDir: tempDir,
    databasePath: join(tempDir, "test.sqlite"),
    agentLockPath: join(tempDir, "agent.lock"),
  });
}

test("buildViewerAnalysisPreparation excludes short-form workflows from LLM payloads by default", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "what-ive-done-viewer-short-form-"));

  try {
    ConfigManager.initialize(tempDir);

    const database = createTestDatabase(tempDir);
    database.initialize();

    const rawEvents: RawEventInput[] = [
      {
        source: "mock",
        sourceEventType: "chrome.navigation",
        timestamp: "2026-03-14T09:00:00.000Z",
        application: "chrome",
        domain: "admin.internal",
        url: "https://admin.internal/orders",
        action: "navigation",
        metadata: {},
      },
      {
        source: "mock",
        sourceEventType: "browser.click",
        timestamp: "2026-03-14T09:00:30.000Z",
        application: "chrome",
        domain: "admin.internal",
        action: "click",
        target: "search_order",
        metadata: {},
      },
      {
        source: "mock",
        sourceEventType: "browser.click",
        timestamp: "2026-03-14T09:01:00.000Z",
        application: "chrome",
        domain: "admin.internal",
        action: "click",
        target: "update_status",
        metadata: {},
      },
      {
        source: "mock",
        sourceEventType: "browser.click",
        timestamp: "2026-03-14T10:00:00.000Z",
        application: "chrome",
        domain: "admin.internal",
        action: "click",
        target: "switch_to_system_settings",
        metadata: {},
      },
      {
        source: "mock",
        sourceEventType: "chrome.navigation",
        timestamp: "2026-03-14T11:00:00.000Z",
        application: "chrome",
        domain: "admin.internal",
        url: "https://admin.internal/orders",
        action: "navigation",
        metadata: {},
      },
      {
        source: "mock",
        sourceEventType: "browser.click",
        timestamp: "2026-03-14T11:00:30.000Z",
        application: "chrome",
        domain: "admin.internal",
        action: "click",
        target: "search_order",
        metadata: {},
      },
      {
        source: "mock",
        sourceEventType: "browser.click",
        timestamp: "2026-03-14T11:01:00.000Z",
        application: "chrome",
        domain: "admin.internal",
        action: "click",
        target: "update_status",
        metadata: {},
      },
      {
        source: "mock",
        sourceEventType: "browser.click",
        timestamp: "2026-03-14T12:00:00.000Z",
        application: "chrome",
        domain: "admin.internal",
        action: "click",
        target: "switch_to_system_settings",
        metadata: {},
      },
      {
        source: "mock",
        sourceEventType: "chrome.navigation",
        timestamp: "2026-03-14T13:00:00.000Z",
        application: "chrome",
        domain: "admin.internal",
        url: "https://admin.internal/orders",
        action: "navigation",
        metadata: {},
      },
      {
        source: "mock",
        sourceEventType: "browser.click",
        timestamp: "2026-03-14T13:00:30.000Z",
        application: "chrome",
        domain: "admin.internal",
        action: "click",
        target: "search_order",
        metadata: {},
      },
      {
        source: "mock",
        sourceEventType: "browser.click",
        timestamp: "2026-03-14T13:01:00.000Z",
        application: "chrome",
        domain: "admin.internal",
        action: "click",
        target: "update_status",
        metadata: {},
      },
      {
        source: "mock",
        sourceEventType: "browser.click",
        timestamp: "2026-03-14T14:00:00.000Z",
        application: "chrome",
        domain: "admin.internal",
        action: "click",
        target: "switch_to_system_settings",
        metadata: {},
      },
    ];

    for (const rawEvent of rawEvents) {
      database.insertRawEvent(rawEvent);
    }

    const dashboard = buildViewerDashboard(database, { dataDir: tempDir, window: "all" });
    const defaultPreparation = buildViewerAnalysisPreparation(database, { window: "all" });
    const includedPreparation = buildViewerAnalysisPreparation(database, {
      window: "all",
      includeShortForm: true,
    });

    assert.deepEqual(
      dashboard.report.workflows.map((workflow) => workflow.detectionMode),
      ["standard", "short_form"],
    );
    assert.deepEqual(
      dashboard.reviewableWorkflows.map((workflow) => workflow.detectionMode),
      ["standard", "short_form"],
    );
    assert.equal(defaultPreparation.workflowCount, 2);
    assert.equal(defaultPreparation.shortFormExcludedCount, 1);
    assert.equal(defaultPreparation.payloadRecords.length, 1);
    assert.equal(defaultPreparation.payloadRecords[0]?.detectionMode, "standard");
    assert.equal(includedPreparation.shortFormExcludedCount, 0);
    assert.deepEqual(
      includedPreparation.payloadRecords.map((payload) => payload.detectionMode).sort(),
      ["short_form", "standard"],
    );

    database.close();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
