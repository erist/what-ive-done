import test from "node:test";
import assert from "node:assert/strict";

import { buildWorkflowSummaryPayload } from "./payloads.js";

test("buildWorkflowSummaryPayload keeps only summarized workflow fields", () => {
  const payload = buildWorkflowSummaryPayload({
    representativeSteps: ["Open admin page", "Search order", "Send Slack update"],
    frequency: 3,
    averageDurationSeconds: 120,
    applications: ["chrome", "chrome", "slack"],
    domains: ["admin.internal", "admin.internal", ""],
  });

  assert.deepEqual(payload, {
    workflowSteps: ["Open admin page", "Search order", "Send Slack update"],
    frequency: 3,
    averageDurationSeconds: 120,
    applications: ["chrome", "slack"],
    domains: ["admin.internal"],
  });
  assert.equal("url" in payload, false);
  assert.equal("windowTitle" in payload, false);
});
