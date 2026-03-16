import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { generateMockRawEvents } from "../collectors/mock.js";
import { AppDatabase } from "../storage/database.js";
import { generateReportSnapshot, runReportSchedulerCycle } from "./service.js";

function createTestDatabase(tempDir: string): AppDatabase {
  return new AppDatabase({
    dataDir: tempDir,
    databasePath: join(tempDir, "test.sqlite"),
    agentLockPath: join(tempDir, "agent.lock"),
  });
}

function seedMockEvents(database: AppDatabase, referenceDate: Date): void {
  for (const event of generateMockRawEvents(referenceDate)) {
    database.insertRawEvent(event);
  }
}

test("generateReportSnapshot upserts one snapshot per window and report date", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "what-ive-done-report-snapshot-"));
  const referenceDate = new Date(2026, 2, 14, 12, 0, 0, 0);
  const timezoneOffsetMinutes = -referenceDate.getTimezoneOffset();

  try {
    const database = createTestDatabase(tempDir);
    database.initialize();
    seedMockEvents(database, referenceDate);

    const firstSnapshot = generateReportSnapshot(database, {
      window: "day",
      date: "2026-03-14",
      timezone: "Test/Local",
      timezoneOffsetMinutes,
    });
    const secondSnapshot = generateReportSnapshot(database, {
      window: "day",
      date: "2026-03-14",
      timezone: "Test/Local",
      timezoneOffsetMinutes,
    });
    const snapshots = database.listReportSnapshots({
      window: "day",
      timezone: "Test/Local",
      limit: 10,
    });

    assert.equal(firstSnapshot.id, secondSnapshot.id);
    assert.equal(snapshots.length, 1);
    assert.equal(snapshots[0]?.workflowCount, 0);
    assert.equal(snapshots[0]?.emergingWorkflowCount, 5);

    database.close();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("runReportSchedulerCycle stores daily and weekly snapshots for the current local date", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "what-ive-done-report-scheduler-"));
  const referenceDate = new Date(2026, 2, 14, 12, 0, 0, 0);
  const timezoneOffsetMinutes = -referenceDate.getTimezoneOffset();

  try {
    const database = createTestDatabase(tempDir);
    database.initialize();
    seedMockEvents(database, referenceDate);

    const snapshots = runReportSchedulerCycle(database, {
      windows: ["day", "week"],
      timezone: "Test/Local",
      timezoneOffsetMinutes,
      now: referenceDate,
    });
    const latestDaySnapshot = database.getLatestReportSnapshot("day", "Test/Local");
    const latestWeekSnapshot = database.getLatestReportSnapshot("week", "Test/Local");

    assert.equal(snapshots.length, 2);
    assert.equal(snapshots[0]?.timeWindow.reportDate, "2026-03-14");
    assert.equal(latestDaySnapshot?.emergingWorkflows.length, 5);
    assert.equal(latestWeekSnapshot?.workflows.length, 5);

    database.close();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
