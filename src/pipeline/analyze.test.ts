import test from "node:test";
import assert from "node:assert/strict";

import { generateMockRawEvents } from "../collectors/mock.js";
import type { RawEvent } from "../domain/types.js";
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
