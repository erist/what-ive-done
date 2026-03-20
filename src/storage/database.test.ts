import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { generateMockRawEvents } from "../collectors/mock.js";
import type { RawEvent, RawEventInput } from "../domain/types.js";
import { analyzeRawEvents } from "../pipeline/analyze.js";
import { resolveReportTimeWindow } from "../reporting/windows.js";
import { AppDatabase } from "./database.js";

function createTestDatabase(tempDir: string): AppDatabase {
  return new AppDatabase({
    dataDir: tempDir,
    databasePath: join(tempDir, "test.sqlite"),
    agentLockPath: join(tempDir, "agent.lock"),
  });
}

function seedSchemaVersion10Database(databasePath: string): void {
  const connection = new DatabaseSync(databasePath);

  connection.exec(`
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );

    CREATE TABLE raw_events (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      source_event_type TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      application TEXT NOT NULL,
      window_title TEXT,
      domain TEXT,
      url TEXT,
      action TEXT NOT NULL,
      target TEXT,
      metadata_json TEXT NOT NULL,
      sensitive_filtered INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE normalized_events (
      id TEXT PRIMARY KEY,
      raw_event_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      application TEXT NOT NULL,
      app_name_normalized TEXT NOT NULL,
      domain TEXT,
      url TEXT,
      path_pattern TEXT,
      page_type TEXT,
      resource_hint TEXT,
      title_pattern TEXT,
      action TEXT NOT NULL,
      action_name TEXT NOT NULL,
      action_confidence REAL NOT NULL DEFAULT 0,
      action_source TEXT NOT NULL DEFAULT 'inferred',
      target TEXT,
      metadata_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  connection
    .prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
    .run(10, "2026-03-14T00:00:00.000Z");

  connection
    .prepare(`
      INSERT INTO raw_events (
        id,
        source,
        source_event_type,
        timestamp,
        application,
        window_title,
        domain,
        url,
        action,
        target,
        metadata_json,
        sensitive_filtered,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      "legacy-raw-1",
      "chrome_extension",
      "chrome.navigation",
      "2026-03-14T10:12:23.000Z",
      "chrome",
      "Orders",
      "admin.example.com",
      "https://admin.example.com/orders/123?tab=history&token=secret#frag",
      "navigation",
      "orders_page",
      JSON.stringify({ sessionCookie: "secret", safe: "value" }),
      1,
      "2026-03-14T10:12:23.000Z",
    );

  connection.close();
}

function seedSchemaVersion14WorkflowDatabase(databasePath: string): void {
  const connection = new DatabaseSync(databasePath);

  connection.exec(`
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );

    CREATE TABLE workflow_clusters (
      id TEXT PRIMARY KEY,
      workflow_signature TEXT NOT NULL,
      name TEXT NOT NULL,
      occurrence_count INTEGER NOT NULL DEFAULT 0,
      frequency INTEGER NOT NULL,
      average_duration_seconds REAL NOT NULL,
      total_duration_seconds REAL NOT NULL,
      representative_sequence_json TEXT NOT NULL DEFAULT '[]',
      representative_steps_json TEXT NOT NULL,
      involved_apps_json TEXT NOT NULL DEFAULT '[]',
      confidence_score REAL NOT NULL DEFAULT 0,
      confidence_details_json TEXT NOT NULL DEFAULT '{}',
      top_variants_json TEXT NOT NULL DEFAULT '[]',
      automation_suitability TEXT NOT NULL,
      recommended_approach TEXT NOT NULL,
      automation_hints_json TEXT NOT NULL DEFAULT '[]',
      excluded INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE workflow_cluster_sessions (
      workflow_cluster_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      PRIMARY KEY (workflow_cluster_id, session_id)
    );

    CREATE TABLE workflow_feedback (
      id TEXT PRIMARY KEY,
      workflow_cluster_id TEXT NOT NULL,
      workflow_signature TEXT NOT NULL,
      rename_to TEXT,
      business_purpose TEXT,
      excluded INTEGER,
      hidden INTEGER,
      repetitive INTEGER,
      automation_candidate INTEGER,
      automation_difficulty TEXT,
      approved_automation_candidate INTEGER,
      merge_into_workflow_id TEXT,
      merge_into_workflow_signature TEXT,
      split_after_action_name TEXT,
      created_at TEXT NOT NULL
    );
  `);

  connection
    .prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
    .run(14, "2026-03-18T00:00:00.000Z");

  connection
    .prepare(`
      INSERT INTO workflow_clusters (
        id,
        workflow_signature,
        name,
        occurrence_count,
        frequency,
        average_duration_seconds,
        total_duration_seconds,
        representative_sequence_json,
        representative_steps_json,
        involved_apps_json,
        confidence_score,
        confidence_details_json,
        top_variants_json,
        automation_suitability,
        recommended_approach,
        automation_hints_json,
        excluded,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      "workflow-legacy",
      "signature-legacy",
      "Legacy Workflow",
      3,
      3,
      8,
      24,
      JSON.stringify(["switch_to_system_settings"]),
      JSON.stringify(["Switch To in System Settings"]),
      JSON.stringify(["system settings"]),
      0.81,
      JSON.stringify({}),
      JSON.stringify([]),
      "low",
      "Manual review before automation",
      JSON.stringify([]),
      0,
      "2026-03-18T00:00:00.000Z",
    );

  connection.close();
}

function seedSchemaVersion15BrowserDatabase(databasePath: string): void {
  const connection = new DatabaseSync(databasePath);

  connection.exec(`
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );

    CREATE TABLE raw_events (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      source_event_type TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      application TEXT NOT NULL,
      window_title TEXT,
      domain TEXT,
      url TEXT,
      browser_schema_version INTEGER,
      canonical_url TEXT,
      route_template TEXT,
      route_key TEXT,
      resource_hash TEXT,
      action TEXT NOT NULL,
      target TEXT,
      metadata_json TEXT NOT NULL,
      sensitive_filtered INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
  `);

  connection
    .prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
    .run(15, "2026-03-20T00:00:00.000Z");

  connection
    .prepare(`
      INSERT INTO raw_events (
        id,
        source,
        source_event_type,
        timestamp,
        application,
        window_title,
        domain,
        url,
        browser_schema_version,
        canonical_url,
        route_template,
        route_key,
        resource_hash,
        action,
        target,
        metadata_json,
        sensitive_filtered,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      "legacy-browser-switch-1",
      "desktop",
      "app.switch",
      "2026-03-20T09:00:00.000Z",
      "Google Chrome",
      "Orders Dashboard",
      null,
      null,
      2,
      null,
      null,
      null,
      null,
      "application_switch",
      null,
      JSON.stringify({}),
      1,
      "2026-03-20T09:00:00.000Z",
    );

  connection.close();
}

function seedSchemaVersion16TimestampDatabase(databasePath: string): void {
  const connection = new DatabaseSync(databasePath);

  connection.exec(`
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );

    CREATE TABLE raw_events (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      source_event_type TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      application TEXT NOT NULL,
      window_title TEXT,
      domain TEXT,
      url TEXT,
      browser_schema_version INTEGER,
      canonical_url TEXT,
      route_template TEXT,
      route_key TEXT,
      resource_hash TEXT,
      action TEXT NOT NULL,
      target TEXT,
      metadata_json TEXT NOT NULL,
      sensitive_filtered INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
  `);

  connection
    .prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
    .run(16, "2026-03-20T00:00:00.000Z");

  connection
    .prepare(`
      INSERT INTO raw_events (
        id,
        source,
        source_event_type,
        timestamp,
        application,
        window_title,
        domain,
        url,
        browser_schema_version,
        canonical_url,
        route_template,
        route_key,
        resource_hash,
        action,
        target,
        metadata_json,
        sensitive_filtered,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      "legacy-timestamp-1",
      "git",
      "git.repo.status",
      "2026-03-20T17:24:57+09:00",
      "git",
      null,
      "github.com",
      null,
      null,
      null,
      null,
      null,
      "abc123def4567890abc123def4567890",
      "git_activity",
      "review_git_changes",
      JSON.stringify({
        gitContext: {
          repoHash: "abc123def4567890abc123def4567890",
          remoteHost: "github.com",
          dirtyFileCount: 2,
          lastCommitAt: "2026-03-20T17:24:57+09:00",
        },
      }),
      1,
      "2026-03-20T17:24:57+09:00",
    );

  connection.close();
}

test("AppDatabase initializes schema and stores sanitized raw events", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "what-ive-done-"));

  try {
    const database = createTestDatabase(tempDir);

    database.initialize();

    database.insertRawEvent({
      source: "mock",
      sourceEventType: "chrome.navigation",
      timestamp: "2026-03-14T10:12:23.000Z",
      application: "chrome",
      url: "https://admin.internal/orders?status=open&token=sensitive",
      action: "page_navigation",
      metadata: {
        clickedButton: "open-order",
        authToken: "secret",
      },
    });

    const events = database.listRawEvents();
    const stored = events[0] ? database.getRawEventById(events[0].id) : undefined;

    assert.equal(events.length, 1);
    assert.equal(events[0]?.application, "chrome");
    assert.equal(
      events[0]?.url,
      "https://admin.internal/orders?status=open",
    );
    assert.equal(events[0]?.browserSchemaVersion, 2);
    assert.equal(events[0]?.canonicalUrl, "https://admin.internal/orders");
    assert.equal(events[0]?.routeTemplate, "/orders");
    assert.equal(events[0]?.routeKey, "https://admin.internal/orders");
    assert.deepEqual(events[0]?.metadata, {
      clickedButton: "open-order",
      authToken: "[REDACTED]",
    });
    assert.equal(stored?.canonicalUrl, "https://admin.internal/orders");
    assert.equal(stored?.routeTemplate, "/orders");

    database.close();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("AppDatabase upgrades schema v10 browser rows with privacy-safe canonical fields", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "what-ive-done-schema-v10-"));
  const databasePath = join(tempDir, "test.sqlite");

  try {
    seedSchemaVersion10Database(databasePath);

    const database = new AppDatabase({
      dataDir: tempDir,
      databasePath,
      agentLockPath: join(tempDir, "agent.lock"),
    });
    database.initialize();

    const [event] = database.listRawEvents();

    assert.ok(event);
    assert.equal(event.url, "https://admin.example.com/orders/123?tab=history");
    assert.equal(event.browserSchemaVersion, 2);
    assert.equal(event.canonicalUrl, "https://admin.example.com/orders/{id}");
    assert.equal(event.routeTemplate, "/orders/{id}");
    assert.equal(event.routeKey, "https://admin.example.com/orders/{id}");
    assert.equal(event.resourceHash, undefined);
    assert.deepEqual(event.metadata, {
      sessionCookie: "[REDACTED]",
      safe: "value",
    });

    database.close();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("AppDatabase upgrades schema v14 workflow clusters with a default detection mode", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "what-ive-done-schema-v14-"));
  const databasePath = join(tempDir, "test.sqlite");

  try {
    seedSchemaVersion14WorkflowDatabase(databasePath);

    const database = new AppDatabase({
      dataDir: tempDir,
      databasePath,
      agentLockPath: join(tempDir, "agent.lock"),
    });
    database.initialize();

    const [workflow] = database.listWorkflowClusters();

    assert.ok(workflow);
    assert.equal(workflow.detectionMode, "standard");

    database.close();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("AppDatabase refreshes schema v15 browser app-switch rows with the tightened v2 stamp rules", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "what-ive-done-schema-v15-"));
  const databasePath = join(tempDir, "test.sqlite");

  try {
    seedSchemaVersion15BrowserDatabase(databasePath);

    const database = new AppDatabase({
      dataDir: tempDir,
      databasePath,
      agentLockPath: join(tempDir, "agent.lock"),
    });
    database.initialize();

    const [event] = database.listRawEvents();

    assert.ok(event);
    assert.equal(event.application, "Google Chrome");
    assert.equal(event.browserSchemaVersion, undefined);
    assert.equal(event.canonicalUrl, undefined);
    assert.equal(event.routeTemplate, undefined);
    assert.equal(event.routeKey, undefined);

    database.close();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("AppDatabase refreshes schema v16 timestamps into canonical UTC ISO strings", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "what-ive-done-schema-v16-"));
  const databasePath = join(tempDir, "test.sqlite");

  try {
    seedSchemaVersion16TimestampDatabase(databasePath);

    const database = new AppDatabase({
      dataDir: tempDir,
      databasePath,
      agentLockPath: join(tempDir, "agent.lock"),
    });
    database.initialize();

    const [event] = database.listRawEvents();

    assert.ok(event);
    assert.equal(event.timestamp, "2026-03-20T08:24:57.000Z");
    assert.deepEqual(event.metadata, {
      gitContext: {
        repoHash: "abc123def4567890abc123def4567890",
        remoteHost: "github.com",
        dirtyFileCount: 2,
        lastCommitAt: "2026-03-20T08:24:57.000Z",
      },
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
    const database = createTestDatabase(tempDir);
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
    const database = createTestDatabase(tempDir);
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

test("advanced workflow feedback fields are persisted and applied by workflow signature", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "what-ive-done-feedback-advanced-"));

  try {
    const database = new AppDatabase({
      dataDir: tempDir,
      databasePath: join(tempDir, "test.sqlite"),
      agentLockPath: join(tempDir, "agent.lock"),
    });
    database.initialize();

    for (const input of toRawEventInputs()) {
      database.insertRawEvent(input);
    }

    const analysisResult = analyzeRawEvents(database.getRawEventsChronological());
    database.replaceAnalysisArtifacts(analysisResult);

    const [workflow] = database.listWorkflowClusters();

    assert.ok(workflow);

    database.saveWorkflowFeedback({
      workflowClusterId: workflow.id,
      businessPurpose: "Reply to customer shipping requests",
      repetitive: true,
      automationCandidate: true,
      automationDifficulty: "medium",
      approvedAutomationCandidate: true,
    });

    const refreshedWorkflow = database
      .listWorkflowClusters()
      .find((cluster) => cluster.id === workflow.id);

    assert.equal(refreshedWorkflow?.businessPurpose, "Reply to customer shipping requests");
    assert.equal(refreshedWorkflow?.repetitive, true);
    assert.equal(refreshedWorkflow?.automationCandidate, true);
    assert.equal(refreshedWorkflow?.automationDifficulty, "medium");
    assert.equal(refreshedWorkflow?.approvedAutomationCandidate, true);
    assert.equal(refreshedWorkflow?.userLabeled, true);

    database.close();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("merge feedback is reused on the next analysis run", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "what-ive-done-feedback-merge-"));

  try {
    const database = new AppDatabase({
      dataDir: tempDir,
      databasePath: join(tempDir, "test.sqlite"),
      agentLockPath: join(tempDir, "agent.lock"),
    });
    database.initialize();

    for (const input of toRawEventInputs()) {
      database.insertRawEvent(input);
    }

    let analysisResult = analyzeRawEvents(database.getRawEventsChronological());
    database.replaceAnalysisArtifacts(analysisResult);

    const workflows = database.listWorkflowClusters();

    assert.equal(workflows.length, 5);

    database.saveWorkflowFeedback({
      workflowClusterId: workflows[1]!.id,
      mergeIntoWorkflowId: workflows[0]!.id,
    });

    analysisResult = analyzeRawEvents(database.getRawEventsChronological(), {
      feedbackByWorkflowSignature: database.listWorkflowFeedbackSummary(),
    });
    database.replaceAnalysisArtifacts(analysisResult);

    const mergedWorkflows = database.listWorkflowClusters();
    const mergedTarget = mergedWorkflows.find((workflow) => workflow.id === workflows[0]!.id);

    assert.equal(mergedWorkflows.length, 4);
    assert.equal(mergedTarget?.frequency, 6);

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
      agentLockPath: join(tempDir, "agent.lock"),
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
    assert.equal(normalizedEvents[0]?.canonicalUrl, "https://admin.example.com/product/{id}");
    assert.equal(normalizedEvents[0]?.routeTemplate, "/product/{id}/edit");
    assert.equal(normalizedEvents[0]?.routeKey, "https://admin.example.com/product/{id}");
    assert.equal(normalizedEvents[0]?.routeFamily, "makestar-admin.products.edit");
    assert.equal(normalizedEvents[0]?.domainPackId, "makestar-admin");
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
    const database = createTestDatabase(tempDir);
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
    const database = createTestDatabase(tempDir);
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
    const database = createTestDatabase(tempDir);
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

test("workflow cluster detection modes persist when analysis artifacts are replaced", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "what-ive-done-short-form-store-"));

  try {
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

    const analysisResult = analyzeRawEvents(database.getRawEventsChronological());
    database.replaceAnalysisArtifacts(analysisResult);

    const detectionModes = database
      .listWorkflowClusters()
      .map((cluster) => cluster.detectionMode)
      .sort();

    assert.deepEqual(detectionModes, ["short_form", "standard"]);

    database.close();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("LLM payload records exclude short-form workflows unless explicitly included", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "what-ive-done-short-form-payloads-"));

  try {
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

    database.replaceAnalysisArtifacts(analyzeRawEvents(database.getRawEventsChronological()));

    const defaultPayloads = database.listWorkflowSummaryPayloadRecords();
    const includedPayloads = database.listWorkflowSummaryPayloadRecords({
      includeShortForm: true,
    });

    assert.equal(defaultPayloads.length, 1);
    assert.equal(defaultPayloads[0]?.detectionMode, "standard");
    assert.deepEqual(
      includedPayloads.map((payload) => payload.detectionMode).sort(),
      ["short_form", "standard"],
    );

    database.close();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("workflow LLM analyses can be stored and surfaced through workflow names", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "what-ive-done-llm-store-"));

  try {
    const database = createTestDatabase(tempDir);
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

test("analysis runs can be created, updated, and queried", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "what-ive-done-analysis-runs-"));

  try {
    const database = createTestDatabase(tempDir);
    database.initialize();

    const createdRun = database.createAnalysisRun({
      window: "day",
      reportDate: "2026-03-19",
      workflowCount: 3,
      payloadCount: 2,
      applyNames: true,
    });

    assert.equal(createdRun.status, "running");
    assert.equal(createdRun.summary.payloadCount, 2);

    const completedRun = database.updateAnalysisRun({
      id: createdRun.id,
      status: "completed",
      completedAt: "2026-03-19T01:02:03.000Z",
      summary: {
        ...createdRun.summary,
        provider: "openai",
        model: "gpt-5-mini",
        resultCount: 2,
      },
    });

    assert.equal(completedRun.status, "completed");
    assert.equal(completedRun.completedAt, "2026-03-19T01:02:03.000Z");
    assert.equal(completedRun.summary.resultCount, 2);
    assert.equal(database.getAnalysisRun(createdRun.id)?.summary.provider, "openai");
    assert.equal(database.getLatestAnalysisRun()?.id, createdRun.id);

    database.close();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("settings can be stored, updated, and deleted as JSON values", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "what-ive-done-settings-"));

  try {
    const database = createTestDatabase(tempDir);
    database.initialize();

    database.setSetting("llm.config", {
      provider: "gemini",
      authMethod: "oauth2",
      model: "gemini-2.5-flash",
    });

    assert.deepEqual(database.getSetting("llm.config"), {
      provider: "gemini",
      authMethod: "oauth2",
      model: "gemini-2.5-flash",
    });

    database.setSetting("agent.runtime", {
      status: "running",
      pid: 1234,
    });

    assert.deepEqual(database.getSetting("agent.runtime"), {
      status: "running",
      pid: 1234,
    });

    database.setSetting("agent.runtime", {
      status: "stopped",
      pid: 1234,
    });

    assert.deepEqual(database.getSetting("agent.runtime"), {
      status: "stopped",
      pid: 1234,
    });

    database.deleteSetting("agent.runtime");
    database.deleteSetting("llm.config");
    assert.equal(database.getSetting("agent.runtime"), undefined);
    assert.equal(database.getSetting("llm.config"), undefined);

    database.close();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
