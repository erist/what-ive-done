import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { ReportSnapshot } from "../domain/types.js";
import { startSnapshotScheduler } from "./scheduler.js";

function createEmptySummary(): ReportSnapshot["summary"] {
  return {
    topRepetitiveWorkflows: [],
    highestTimeConsumingRepetitiveWorkflows: [],
    quickWinAutomationCandidates: [],
    workflowsNeedingHumanJudgment: [],
  };
}

function createSnapshots(): ReportSnapshot[] {
  return [
    {
      id: "day-snapshot",
      timeWindow: {
        window: "day",
        reportDate: "2026-03-14",
        timezone: "UTC",
        timezoneOffsetMinutes: 0,
      },
      totalSessions: 2,
      totalTrackedDurationSeconds: 120,
      workflows: [],
      emergingWorkflows: [],
      summary: createEmptySummary(),
      generatedAt: "2026-03-14T00:00:00.000Z",
    },
    {
      id: "week-snapshot",
      timeWindow: {
        window: "week",
        reportDate: "2026-03-14",
        timezone: "UTC",
        timezoneOffsetMinutes: 0,
      },
      totalSessions: 10,
      totalTrackedDurationSeconds: 900,
      workflows: [],
      emergingWorkflows: [],
      summary: createEmptySummary(),
      generatedAt: "2026-03-14T00:00:01.000Z",
    },
  ];
}

test("startSnapshotScheduler runs immediately and records scheduler state", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "what-ive-done-agent-scheduler-"));
  const now = new Date("2026-03-14T12:00:00.000Z");

  try {
    const scheduler = await startSnapshotScheduler({
      dataDir: tempDir,
      windows: ["day", "week"],
      intervalMs: 60_000,
      nowFactory: () => now,
      runCycle: () => createSnapshots(),
    });

    const state = scheduler.getState();

    assert.equal(state.status, "running");
    assert.equal(state.lastGeneratedSnapshots.length, 2);
    assert.equal(state.lastGeneratedSnapshots[0]?.window, "day");
    assert.equal(state.nextRunAt, "2026-03-14T12:01:00.000Z");

    await scheduler.stop();

    assert.equal(scheduler.getState().status, "stopped");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("startSnapshotScheduler records failures and preserves the next run", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "what-ive-done-agent-scheduler-failure-"));
  const now = new Date("2026-03-14T12:00:00.000Z");

  try {
    const scheduler = await startSnapshotScheduler({
      dataDir: tempDir,
      windows: ["day"],
      intervalMs: 30_000,
      nowFactory: () => now,
      runCycle: () => {
        throw new Error("scheduler boom");
      },
    });

    const state = scheduler.getState();

    assert.equal(state.status, "failed");
    assert.equal(state.lastError, "scheduler boom");
    assert.equal(state.nextRunAt, "2026-03-14T12:00:30.000Z");

    await scheduler.stop();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
