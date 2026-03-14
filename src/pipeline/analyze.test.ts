import test from "node:test";
import assert from "node:assert/strict";

import { generateMockRawEvents } from "../collectors/mock.js";
import type { RawEvent } from "../domain/types.js";
import { stableId } from "../domain/ids.js";
import { analyzeRawEvents } from "./analyze.js";

function toRawEvents(inputs = generateMockRawEvents()): RawEvent[] {
  return inputs.map((input, index) => ({
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

test("analyzeRawEvents detects the seeded mock workflows", () => {
  const result = analyzeRawEvents(toRawEvents());

  assert.equal(result.normalizedEvents.length, 60);
  assert.equal(result.sessions.length, 15);
  assert.equal(result.workflowClusters.length, 5);
  assert.deepEqual(
    result.workflowClusters.map((cluster) => cluster.frequency),
    [3, 3, 3, 3, 3],
  );
});

test("analyzeRawEvents reuses split feedback to fragment future workflow interpretation", () => {
  const rawEvents = toRawEvents([
    {
      source: "mock",
      sourceEventType: "chrome.navigation",
      timestamp: "2026-03-14T09:00:00.000Z",
      application: "chrome",
      domain: "admin.internal",
      url: "https://admin.internal/orders",
      action: "navigation",
    },
    {
      source: "mock",
      sourceEventType: "browser.click",
      timestamp: "2026-03-14T09:00:30.000Z",
      application: "chrome",
      domain: "admin.internal",
      action: "click",
      target: "search_order",
    },
    {
      source: "mock",
      sourceEventType: "browser.click",
      timestamp: "2026-03-14T09:01:00.000Z",
      application: "chrome",
      domain: "admin.internal",
      action: "click",
      target: "update_status",
    },
  ]);
  const signature = stableId("workflow_signature", "open_admin>search_order>update_status");
  const feedbackByWorkflowSignature = new Map([
    [
      signature,
      {
        splitAfterActionName: "search_order",
      },
    ],
  ]);

  const result = analyzeRawEvents(rawEvents, {
    feedbackByWorkflowSignature,
    minimumWorkflowFrequency: 1,
    minSessionDurationSeconds: 0,
  });

  assert.equal(result.sessions.length, 2);
  assert.deepEqual(
    result.sessions.map((session) => session.steps.map((step) => step.actionName)),
    [["open_admin", "search_order"], ["update_status"]],
  );
});
