import test from "node:test";
import assert from "node:assert/strict";

import type { Session } from "../domain/types.js";
import { clusterSessions } from "./cluster.js";

function createSession(input: {
  id: string;
  startTime: string;
  endTime: string;
  application: string;
  actions: string[];
}): Session {
  return {
    id: input.id,
    startTime: input.startTime,
    endTime: input.endTime,
    primaryApplication: input.application,
    primaryDomain: "admin.internal",
    sessionBoundaryReason: "stream_start",
    sessionBoundaryDetails: {},
    steps: input.actions.map((actionName, index) => ({
      order: index + 1,
      normalizedEventId: `${input.id}-event-${index + 1}`,
      timestamp: new Date(new Date(input.startTime).getTime() + index * 30_000).toISOString(),
      action: "button_click",
      actionName,
      actionConfidence: 0.9,
      actionSource: "rule",
      application: input.application,
      domain: "admin.internal",
      target: actionName,
    })),
  };
}

test("clusterSessions groups near-matching semantic action sequences", () => {
  const clusters = clusterSessions(
    [
      createSession({
        id: "session-1",
        startTime: "2026-03-10T09:00:00.000Z",
        endTime: "2026-03-10T09:03:00.000Z",
        application: "chrome",
        actions: ["open_admin", "search_order", "update_status"],
      }),
      createSession({
        id: "session-2",
        startTime: "2026-03-12T09:00:00.000Z",
        endTime: "2026-03-12T09:04:00.000Z",
        application: "chrome",
        actions: ["open_admin", "search_order", "review_order", "update_status"],
      }),
    ],
    {
      similarityThreshold: 0.6,
      minSessionDurationSeconds: 0,
      minimumWorkflowFrequency: 2,
    },
  );

  assert.equal(clusters.length, 1);
  assert.equal(clusters[0]?.frequency, 2);
  assert.deepEqual(clusters[0]?.involvedApps, ["chrome"]);
  assert.ok(clusters[0]?.representativeSequence.length);
  assert.equal(clusters[0]?.topVariants.length, 2);
  assert.ok((clusters[0]?.confidenceScore ?? 0) > 0.5);
  assert.ok((clusters[0]?.confidenceDetails.averageActionSetSimilarity ?? 0) >= 0.75);
  assert.ok((clusters[0]?.automationHints.length ?? 0) > 0);
  assert.ok(clusters[0]?.automationHints[0]?.expectedTimeSavings.includes("week"));
});

test("clusterSessions keeps same action sequences apart when domain context diverges", () => {
  const supportSession = createSession({
    id: "session-2",
    startTime: "2026-03-12T15:10:00.000Z",
    endTime: "2026-03-12T15:13:00.000Z",
    application: "chrome",
    actions: ["open_admin", "review_order", "search_order", "update_status"],
  });

  const clusters = clusterSessions(
    [
      createSession({
        id: "session-1",
        startTime: "2026-03-10T09:00:00.000Z",
        endTime: "2026-03-10T09:03:00.000Z",
        application: "chrome",
        actions: ["open_admin", "search_order", "review_order", "update_status"],
      }),
      {
        ...supportSession,
        primaryDomain: "support.internal",
        steps: supportSession.steps.map((step) => ({
          ...step,
          domain: "support.internal",
        })),
      },
    ],
    {
      similarityThreshold: 0.74,
      minSessionDurationSeconds: 0,
      minimumWorkflowFrequency: 1,
    },
  );

  assert.equal(clusters.length, 2);
  assert.notEqual(clusters[0]?.workflowSignature, clusters[1]?.workflowSignature);
});
