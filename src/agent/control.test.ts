import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { generateMockRawEvents } from "../collectors/mock.js";
import { resolveAppPaths } from "../app-paths.js";
import { AppDatabase } from "../storage/database.js";
import { writeAgentRuntimeState } from "./state.js";
import { getAgentHealthReport, listLatestAgentSnapshots, runAgentOnce } from "./control.js";

function createTestDatabase(tempDir: string): AppDatabase {
  return new AppDatabase(resolveAppPaths(tempDir));
}

function createEmptySummary() {
  return {
    topRepetitiveWorkflows: [],
    highestTimeConsumingRepetitiveWorkflows: [],
    quickWinAutomationCandidates: [],
    workflowsNeedingHumanJudgment: [],
  };
}

test("getAgentHealthReport surfaces runtime issues and latest snapshots", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "what-ive-done-agent-health-"));

  try {
    const database = createTestDatabase(tempDir);
    database.initialize();

    database.upsertReportSnapshot({
      timeWindow: {
        window: "day",
        reportDate: "2026-03-14",
        timezone: "UTC",
        timezoneOffsetMinutes: 0,
      },
      totalSessions: 0,
      totalTrackedDurationSeconds: 0,
      workflows: [],
      emergingWorkflows: [],
      summary: createEmptySummary(),
    });

    writeAgentRuntimeState(database, {
      status: "running",
      pid: 1234,
      startedAt: "2026-03-14T00:00:00.000Z",
      heartbeatAt: "2026-03-14T00:05:00.000Z",
      ingestServer: {
        status: "running",
        host: "127.0.0.1",
        port: 4318,
      },
      collectors: [
        {
          id: "macos-active-window",
          platform: "macos",
          runtime: "swift",
          status: "failed",
          restartCount: 1,
          lastError: "collector failed",
        },
      ],
      snapshotScheduler: {
        status: "running",
        windows: ["day", "week"],
        intervalMs: 300_000,
        lastGeneratedSnapshots: [],
      },
    });

    database.close();

    const report = getAgentHealthReport(tempDir);

    assert.equal(report.status, "stale");
    assert.ok(report.issues.includes("agent_runtime_stale"));
    assert.equal(report.latestSnapshots.length, 1);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("runAgentOnce stores snapshots through the control plane helper", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "what-ive-done-agent-run-once-"));

  try {
    const database = createTestDatabase(tempDir);
    database.initialize();

    for (const event of generateMockRawEvents()) {
      database.insertRawEvent(event);
    }

    database.close();

    const result = runAgentOnce(tempDir, {
      windows: ["day", "week"],
    });
    const latestSnapshots = listLatestAgentSnapshots(tempDir);

    assert.equal(result.snapshots.length, 2);
    assert.equal(latestSnapshots.length, 2);
    assert.deepEqual(
      latestSnapshots.map((snapshot) => snapshot.window),
      ["day", "week"],
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
