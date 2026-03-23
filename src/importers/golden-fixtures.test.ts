import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { RawEvent } from "../domain/types.js";
import { analyzeRawEvents } from "../pipeline/analyze.js";
import { importEventsFromFile } from "./events.js";

interface GoldenFixtureManifestEntry {
  id: string;
  file: string;
  description: string;
  expectedSessions: number;
  expectedWorkflowClusters: number;
  expectedWorkflowName: string;
  expectedRepresentativeSequence: string[];
  expectedSessionBoundaryReasons?: string[];
}

function resolveFixturePath(relativePath: string): string {
  return fileURLToPath(new URL(relativePath, import.meta.url));
}

function loadFixtureRawEvents(relativePath: string): RawEvent[] {
  return importEventsFromFile(resolveFixturePath(relativePath)).map((event, index) => ({
    id: `fixture-${index + 1}`,
    source: event.source,
    sourceEventType: event.sourceEventType,
    timestamp: event.timestamp,
    application: event.application,
    windowTitle: event.windowTitle,
    domain: event.domain,
    url: event.url,
    browserSchemaVersion: event.browserSchemaVersion,
    canonicalUrl: event.canonicalUrl,
    routeTemplate: event.routeTemplate,
    routeKey: event.routeKey,
    resourceHash: event.resourceHash,
    action: event.action,
    target: event.target,
    metadata: event.metadata ?? {},
    sensitiveFiltered: true,
    createdAt: event.timestamp,
  }));
}

function loadManifest(): GoldenFixtureManifestEntry[] {
  const manifestPath = resolveFixturePath("../../fixtures/golden/manifest.json");

  return JSON.parse(readFileSync(manifestPath, "utf8")) as GoldenFixtureManifestEntry[];
}

for (const fixture of loadManifest()) {
  test(`golden fixture ${fixture.id} stays stable`, () => {
    const rawEvents = loadFixtureRawEvents(`../../fixtures/golden/${fixture.file}`);
    const result = analyzeRawEvents(rawEvents);

    assert.equal(result.sessions.length, fixture.expectedSessions, fixture.description);
    assert.equal(
      result.workflowClusters.length,
      fixture.expectedWorkflowClusters,
      fixture.description,
    );
    assert.deepEqual(
      result.sessions.map((session) => session.sessionBoundaryReason),
      fixture.expectedSessionBoundaryReasons ?? ["stream_start", "idle_gap", "idle_gap"],
      fixture.description,
    );
    assert.equal(result.workflowClusters[0]?.name, fixture.expectedWorkflowName, fixture.description);
    assert.deepEqual(
      result.workflowClusters[0]?.representativeSequence,
      fixture.expectedRepresentativeSequence,
      fixture.description,
    );
  });
}
