import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { RawEventInput } from "../domain/types.js";
import { analyzeRawEvents } from "../pipeline/analyze.js";
import { AppDatabase } from "../storage/database.js";
import { buildDatasetQualityReport } from "./quality.js";

function createDatabase(prefix: string): { tempDir: string; database: AppDatabase } {
  const tempDir = mkdtempSync(join(tmpdir(), prefix));
  const database = new AppDatabase({
    dataDir: tempDir,
    databasePath: join(tempDir, "what-ive-done.sqlite"),
    agentLockPath: join(tempDir, "agent.lock"),
  });
  database.initialize();

  return {
    tempDir,
    database,
  };
}

function createRawEvent(input: Partial<RawEventInput> & Pick<RawEventInput, "timestamp" | "application">): RawEventInput {
  return {
    source: input.source ?? "desktop",
    sourceEventType: input.sourceEventType ?? "app.switch",
    timestamp: input.timestamp,
    application: input.application,
    windowTitle: input.windowTitle,
    domain: input.domain,
    url: input.url,
    browserSchemaVersion: input.browserSchemaVersion,
    canonicalUrl: input.canonicalUrl,
    routeTemplate: input.routeTemplate,
    routeKey: input.routeKey,
    resourceHash: input.resourceHash,
    action: input.action ?? "switch",
    target: input.target,
    metadata: input.metadata ?? {},
  };
}

test("buildDatasetQualityReport flags the remaining live-data quality gaps", () => {
  const { tempDir, database } = createDatabase("what-ive-done-quality-issues-");

  try {
    const events: RawEventInput[] = [
      createRawEvent({
        timestamp: "2026-03-20T09:00:00.000Z",
        application: "시스템-설정",
      }),
      createRawEvent({
        timestamp: "2026-03-20T10:00:00.000Z",
        application: "시스템-설정",
      }),
      createRawEvent({
        timestamp: "2026-03-20T11:00:00.000Z",
        application: "시스템-설정",
      }),
      createRawEvent({
        timestamp: "2026-03-20T12:00:00.000Z",
        application: "chrome",
        windowTitle: "Inbox - Chrome",
      }),
      createRawEvent({
        timestamp: "2026-03-20T15:48:00.651Z",
        application: "chrome",
        windowTitle: "What I've Done Viewer - Chrome",
      }),
      createRawEvent({
        source: "git",
        sourceEventType: "git.repo.commit",
        timestamp: "2026-03-20T18:32:44+09:00",
        application: "git",
        action: "git_activity",
        target: "record_git_commit",
        metadata: {
          gitContext: {
            repoHash: "0123456789abcdef0123456789abcdef",
            lastCommitAt: "2026-03-20T18:32:44+09:00",
          },
        },
      }),
    ];

    for (const event of events) {
      database.insertRawEvent(event);
    }

    const analysis = analyzeRawEvents(database.getRawEventsChronological());
    database.replaceAnalysisArtifacts(analysis);
    database.insertRawEvent(
      createRawEvent({
        timestamp: "2026-03-20T20:00:00.000Z",
        application: "codex",
        windowTitle: "Codex",
      }),
    );

    const report = buildDatasetQualityReport(database);
    const issueCodes = new Set(report.issues.map((issue) => issue.code));

    assert.equal(report.rawEvents.unanalyzedCount, 1);
    assert.equal(report.browserContext.chromeExtensionEvents, 0);
    assert.equal(report.browserContext.browserNavigationEvents, 0);
    assert.equal(report.browserContext.rawSchemaWithoutRouteContext, 0);
    assert.equal(report.actionQuality.emptySwitchActions, 0);
    assert.equal(report.sessionQuality.negativeDurationSessions, 0);
    assert.equal(report.workflowQuality.genericShortFormClusters, 0);
    assert.ok(report.actionQuality.switchActionPct >= 80);
    assert.ok(issueCodes.has("browser_context_missing"));
    assert.ok(issueCodes.has("analysis_artifacts_stale"));
    assert.ok(issueCodes.has("action_abstraction_switch_heavy"));
    assert.ok(!issueCodes.has("browser_schema_without_route_context"));
    assert.ok(!issueCodes.has("broken_application_identifier_actions"));
    assert.ok(!issueCodes.has("negative_session_durations"));
    assert.ok(!issueCodes.has("generic_short_form_clusters"));
  } finally {
    database.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("buildDatasetQualityReport recognizes browser context coverage when extension events exist", () => {
  const { tempDir, database } = createDatabase("what-ive-done-quality-browser-");

  try {
    database.insertRawEvent(
      createRawEvent({
        source: "chrome_extension",
        sourceEventType: "chrome.navigation",
        timestamp: "2026-03-20T09:00:00.000Z",
        application: "chrome",
        url: "https://admin.example.com/orders/123?tab=details",
        action: "navigate",
        target: "review_order",
      }),
    );

    const analysis = analyzeRawEvents(database.getRawEventsChronological());
    database.replaceAnalysisArtifacts(analysis);

    const report = buildDatasetQualityReport(database);
    const issueCodes = new Set(report.issues.map((issue) => issue.code));

    assert.equal(report.browserContext.chromeExtensionEvents, 1);
    assert.equal(report.browserContext.browserNavigationEvents, 1);
    assert.equal(report.browserContext.rawWithCanonicalUrl, 1);
    assert.equal(report.browserContext.rawWithRouteTemplate, 1);
    assert.equal(report.browserContext.rawSchemaWithoutRouteContext, 0);
    assert.ok(report.actionQuality.nonSwitchActions >= 1);
    assert.ok(!issueCodes.has("browser_context_missing"));
    assert.ok(!issueCodes.has("browser_schema_without_route_context"));
  } finally {
    database.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});
