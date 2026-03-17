import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { RawEvent } from "../domain/types.js";
import { importEventsFromFile } from "../importers/events.js";
import { buildActionSuggestionPrompt, inspectActionCoverage } from "./service.js";

interface GoldenFixtureManifestEntry {
  file: string;
}

function resolveFixturePath(relativePath: string): string {
  return fileURLToPath(new URL(relativePath, import.meta.url));
}

function loadFixtureRawEvents(relativePath: string): RawEvent[] {
  return importEventsFromFile(resolveFixturePath(relativePath)).map((event, index) => ({
    id: `fixture-${index + 1}-${relativePath}`,
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

function loadGoldenManifest(): GoldenFixtureManifestEntry[] {
  return JSON.parse(
    readFileSync(resolveFixturePath("../../fixtures/golden/manifest.json"), "utf8"),
  ) as GoldenFixtureManifestEntry[];
}

test("action coverage keeps repeated golden workflows below the unknown_action threshold", () => {
  const rawEvents = loadGoldenManifest().flatMap((fixture) =>
    loadFixtureRawEvents(`../../fixtures/golden/${fixture.file}`),
  );
  const result = inspectActionCoverage(rawEvents);

  assert.equal(result.coverage.unknownEventCount, 0);
  assert.ok(result.coverage.topWorkflows.length >= 7);
  assert.ok(result.coverage.topWorkflows.every((workflow) => workflow.unknownRate < 0.1));
});

test("action coverage groups unknown_action events into a review queue and builds an offline prompt", () => {
  const rawEvents: RawEvent[] = [
    {
      id: "raw-1",
      source: "chrome_extension",
      sourceEventType: "browser.click",
      timestamp: "2026-03-14T10:00:00.000Z",
      application: "chrome",
      windowTitle: "Team Wiki",
      domain: "wiki.internal",
      url: "https://wiki.internal/",
      action: "click",
      target: "toolbar_button",
      metadata: {},
      sensitiveFiltered: true,
      createdAt: "2026-03-14T10:00:00.000Z",
    },
    {
      id: "raw-2",
      source: "chrome_extension",
      sourceEventType: "browser.click",
      timestamp: "2026-03-14T10:00:20.000Z",
      application: "chrome",
      windowTitle: "Team Wiki",
      domain: "wiki.internal",
      url: "https://wiki.internal/",
      action: "click",
      target: "toolbar_button",
      metadata: {},
      sensitiveFiltered: true,
      createdAt: "2026-03-14T10:00:20.000Z",
    },
  ];
  const result = inspectActionCoverage(rawEvents);
  const prompt = buildActionSuggestionPrompt(result.reviewQueue);

  assert.equal(result.coverage.unknownEventCount, 2);
  assert.equal(result.reviewQueue.length, 1);
  assert.equal(result.reviewQueue[0]?.occurrences, 2);
  assert.equal(result.reviewQueue[0]?.sampleTargets[0], "toolbar_button");
  assert.match(prompt, /unknown action review queue/i);
  assert.match(prompt, /toolbar_button/);
  assert.match(prompt, /queueId/);
});
