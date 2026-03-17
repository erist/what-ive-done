import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { analyzeRawEvents } from "../pipeline/analyze.js";
import { AppDatabase } from "../storage/database.js";
import type { RawEvent } from "../domain/types.js";
import { importEventsFromFile } from "../importers/events.js";
import {
  buildRawEventTrace,
  buildSessionTrace,
  buildWorkflowClusterTrace,
} from "./trace.js";

function loadFixtureRawEvents(relativePath: string): RawEvent[] {
  const fixturePath = fileURLToPath(new URL(relativePath, import.meta.url));

  return importEventsFromFile(fixturePath).map((event, index) => ({
    id: `fixture-${index + 1}`,
    source: event.source,
    sourceEventType: event.sourceEventType,
    timestamp: event.timestamp,
    application: event.application,
    windowTitle: event.windowTitle,
    domain: event.domain,
    url: event.url,
    action: event.action,
    target: event.target,
    metadata: event.metadata ?? {},
    sensitiveFiltered: true,
    createdAt: event.timestamp,
  }));
}

test("buildRawEventTrace follows raw to normalized to session to workflow cluster", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "what-ive-done-debug-trace-"));
  const database = new AppDatabase({
    dataDir: tempDir,
    databasePath: join(tempDir, "what-ive-done.sqlite"),
    agentLockPath: join(tempDir, "agent.lock"),
  });
  database.initialize();

  try {
    const importedEvents = loadFixtureRawEvents("../../fixtures/golden/admin-order-review.ndjson");

    for (const event of importedEvents) {
      database.insertRawEvent(event);
    }
    const rawEvents = database.getRawEventsChronological();
    const analysis = analyzeRawEvents(rawEvents);
    database.replaceAnalysisArtifacts(analysis);

    const rawEventId = rawEvents[1]?.id ?? "";
    const trace = buildRawEventTrace(database, rawEventId);

    assert.ok(trace);
    assert.equal(trace?.rawEvent.target, "search_order");
    assert.equal(trace?.normalizedEvent?.actionName, "search_order");
    assert.equal(trace?.session?.matchingStepOrder, 2);
    assert.equal(trace?.workflowCluster?.name, "Search Order workflow");
  } finally {
    database.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("buildSessionTrace includes linked raw events and workflow cluster context", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "what-ive-done-session-trace-"));
  const database = new AppDatabase({
    dataDir: tempDir,
    databasePath: join(tempDir, "what-ive-done.sqlite"),
    agentLockPath: join(tempDir, "agent.lock"),
  });
  database.initialize();

  try {
    const importedEvents = loadFixtureRawEvents("../../fixtures/golden/admin-report-export.ndjson");

    for (const event of importedEvents) {
      database.insertRawEvent(event);
    }
    const rawEvents = database.getRawEventsChronological();
    const analysis = analyzeRawEvents(rawEvents);
    database.replaceAnalysisArtifacts(analysis);

    const sessionId = analysis.sessions[0]?.id ?? "";
    const trace = buildSessionTrace(database, sessionId);

    assert.ok(trace);
    assert.equal(trace?.session.sessionBoundaryReason, "stream_start");
    assert.equal(trace?.rawEvents.length, 3);
    assert.equal(trace?.workflowCluster?.name, "Export Excel workflow");
  } finally {
    database.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("buildWorkflowClusterTrace returns member sessions with boundary reasons", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "what-ive-done-workflow-trace-"));
  const database = new AppDatabase({
    dataDir: tempDir,
    databasePath: join(tempDir, "what-ive-done.sqlite"),
    agentLockPath: join(tempDir, "agent.lock"),
  });
  database.initialize();

  try {
    const importedEvents = loadFixtureRawEvents("../../fixtures/golden/desktop-ops-handoff.ndjson");

    for (const event of importedEvents) {
      database.insertRawEvent(event);
    }
    const rawEvents = database.getRawEventsChronological();
    const analysis = analyzeRawEvents(rawEvents);
    database.replaceAnalysisArtifacts(analysis);

    const workflowId = analysis.workflowClusters[0]?.id ?? "";
    const trace = buildWorkflowClusterTrace(database, workflowId);

    assert.ok(trace);
    assert.equal(trace?.workflowCluster.name, "Send Email Response workflow");
    assert.equal(trace?.sessions.length, 3);
    assert.deepEqual(
      trace?.sessions.map((session) => session.sessionBoundaryReason),
      ["stream_start", "idle_gap", "idle_gap"],
    );
  } finally {
    database.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});
