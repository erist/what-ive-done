import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import type { RawEvent } from "../domain/types.js";
import { analyzeRawEvents } from "../pipeline/analyze.js";
import { parseImportedEvents } from "./events.js";
import { importEventsFromFile } from "./events.js";

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

test("parseImportedEvents parses NDJSON input", () => {
  const events = parseImportedEvents(
    `
{"sourceEventType":"app.switch","application":"excel","timestamp":"2026-03-14T09:00:00.000Z","action":"switch","windowTitle":"Inventory.xlsx"}
{"sourceEventType":"app.switch","application":"chrome","timestamp":"2026-03-14T09:01:15.000Z","action":"switch","windowTitle":"Orders"}
    `,
    "sample.ndjson",
  );

  assert.equal(events.length, 2);
  assert.equal(events[0]?.source, "chrome_extension");
  assert.equal(events[0]?.application, "excel");
  assert.equal(events[1]?.application, "chrome");
});

test("parseImportedEvents parses JSON wrapper input", () => {
  const events = parseImportedEvents(
    JSON.stringify({
      events: [
        {
          source: "desktop",
          sourceEventType: "app.switch",
          application: "outlook",
          timestamp: "2026-03-14T09:03:00.000Z",
          action: "switch",
        },
      ],
    }),
    "sample.json",
  );

  assert.equal(events.length, 1);
  assert.equal(events[0]?.source, "desktop");
  assert.equal(events[0]?.application, "outlook");
});

test("windows fixture import produces one workflow cluster", () => {
  const rawEvents = loadFixtureRawEvents("../../fixtures/windows-active-window-sample.ndjson");
  const result = analyzeRawEvents(rawEvents);

  assert.equal(result.sessions.length, 3);
  assert.equal(result.workflowClusters.length, 1);
  assert.equal(result.workflowClusters[0]?.frequency, 3);
});

test("macos fixture import produces one workflow cluster", () => {
  const rawEvents = loadFixtureRawEvents("../../fixtures/macos-active-window-sample.ndjson");
  const result = analyzeRawEvents(rawEvents);

  assert.equal(result.sessions.length, 3);
  assert.equal(result.workflowClusters.length, 1);
  assert.equal(result.workflowClusters[0]?.frequency, 3);
});
