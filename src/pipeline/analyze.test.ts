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

test("analyzeRawEvents includes workspace and git collector context in repeated workflows", () => {
  const rawEvents = toRawEvents([
    {
      source: "git",
      sourceEventType: "git.repo.commit",
      timestamp: "2026-03-14T09:00:00.000Z",
      application: "git",
      domain: "github.com",
      action: "git_activity",
      target: "record_git_commit",
      metadata: {
        gitContext: {
          repoHash: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
          remoteHost: "github.com",
          dirtyFileCount: 0,
          lastCommitAt: "2026-03-14T09:00:00.000Z",
        },
      },
    },
    {
      source: "workspace",
      sourceEventType: "workspace.sheets.viewed",
      timestamp: "2026-03-14T09:00:30.000Z",
      application: "gws-sheets",
      domain: "docs.google.com",
      action: "workspace_activity",
      target: "open_sheet",
      metadata: {
        workspaceContext: {
          provider: "gws",
          app: "sheets",
          itemType: "spreadsheet",
          itemHash: "1111111111111111111111111111111111111111111111111111111111111111",
          activityType: "viewed",
        },
      },
    },
    {
      source: "workspace",
      sourceEventType: "workspace.drive.modified",
      timestamp: "2026-03-14T09:01:00.000Z",
      application: "gws-drive",
      domain: "drive.google.com",
      action: "workspace_activity",
      target: "update_document",
      metadata: {
        workspaceContext: {
          provider: "gws",
          app: "drive",
          itemType: "document",
          itemHash: "2222222222222222222222222222222222222222222222222222222222222222",
          activityType: "modified",
        },
      },
    },
    {
      source: "git",
      sourceEventType: "git.repo.commit",
      timestamp: "2026-03-14T11:00:00.000Z",
      application: "git",
      domain: "github.com",
      action: "git_activity",
      target: "record_git_commit",
      metadata: {
        gitContext: {
          repoHash: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
          remoteHost: "github.com",
          dirtyFileCount: 0,
          lastCommitAt: "2026-03-14T11:00:00.000Z",
        },
      },
    },
    {
      source: "workspace",
      sourceEventType: "workspace.sheets.viewed",
      timestamp: "2026-03-14T11:00:30.000Z",
      application: "gws-sheets",
      domain: "docs.google.com",
      action: "workspace_activity",
      target: "open_sheet",
      metadata: {
        workspaceContext: {
          provider: "gws",
          app: "sheets",
          itemType: "spreadsheet",
          itemHash: "1111111111111111111111111111111111111111111111111111111111111111",
          activityType: "viewed",
        },
      },
    },
    {
      source: "workspace",
      sourceEventType: "workspace.drive.modified",
      timestamp: "2026-03-14T11:01:00.000Z",
      application: "gws-drive",
      domain: "drive.google.com",
      action: "workspace_activity",
      target: "update_document",
      metadata: {
        workspaceContext: {
          provider: "gws",
          app: "drive",
          itemType: "document",
          itemHash: "2222222222222222222222222222222222222222222222222222222222222222",
          activityType: "modified",
        },
      },
    },
  ]);

  const result = analyzeRawEvents(rawEvents, {
    minimumWorkflowFrequency: 2,
    minSessionDurationSeconds: 0,
  });

  assert.equal(result.workflowClusters.length, 1);
  assert.deepEqual(result.workflowClusters[0]?.involvedApps, ["git", "gws-sheets", "gws-drive"]);
  assert.deepEqual(result.workflowClusters[0]?.representativeSequence, [
    "record_git_commit",
    "open_sheet",
    "update_document",
  ]);
});
