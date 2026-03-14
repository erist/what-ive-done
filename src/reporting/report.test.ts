import test from "node:test";
import assert from "node:assert/strict";

import { generateMockRawEvents } from "../collectors/mock.js";
import type { RawEvent } from "../domain/types.js";
import { buildWorkflowReport } from "./report.js";
import { resolveReportTimeWindow } from "./windows.js";

function toRawEvents(referenceDate: Date): RawEvent[] {
  return generateMockRawEvents(referenceDate).map((input, index) => ({
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

test("buildWorkflowReport produces emerging workflows for a single local day", () => {
  const referenceDate = new Date(2026, 2, 14, 12, 0, 0, 0);
  const timezoneOffsetMinutes = -referenceDate.getTimezoneOffset();
  const rawEvents = toRawEvents(referenceDate);
  const reportWindow = resolveReportTimeWindow({
    window: "day",
    reportDate: "2026-03-14",
    timezone: "Test/Local",
    timezoneOffsetMinutes,
  });
  const filteredEvents = rawEvents.filter(
    (event) =>
      event.timestamp >= (reportWindow.startTime ?? "") &&
      event.timestamp < (reportWindow.endTime ?? ""),
  );
  const report = buildWorkflowReport({
    rawEvents: filteredEvents,
    timeWindow: reportWindow,
  });

  assert.equal(report.totalSessions, 5);
  assert.equal(report.totalTrackedDurationSeconds, 750);
  assert.equal(report.workflows.length, 0);
  assert.equal(report.emergingWorkflows.length, 5);
  assert.deepEqual(
    report.emergingWorkflows.map((entry) => entry.frequency),
    [1, 1, 1, 1, 1],
  );
});

test("buildWorkflowReport produces confirmed workflows for a weekly window", () => {
  const referenceDate = new Date(2026, 2, 14, 12, 0, 0, 0);
  const timezoneOffsetMinutes = -referenceDate.getTimezoneOffset();
  const rawEvents = toRawEvents(referenceDate);
  const reportWindow = resolveReportTimeWindow({
    window: "week",
    reportDate: "2026-03-14",
    timezone: "Test/Local",
    timezoneOffsetMinutes,
  });
  const filteredEvents = rawEvents.filter(
    (event) =>
      event.timestamp >= (reportWindow.startTime ?? "") &&
      event.timestamp < (reportWindow.endTime ?? ""),
  );
  const report = buildWorkflowReport({
    rawEvents: filteredEvents,
    timeWindow: reportWindow,
  });

  assert.equal(report.totalSessions, 15);
  assert.equal(report.totalTrackedDurationSeconds, 2250);
  assert.equal(report.workflows.length, 5);
  assert.equal(report.emergingWorkflows.length, 0);
  assert.deepEqual(
    report.workflows.map((entry) => entry.frequency),
    [3, 3, 3, 3, 3],
  );
});

test("resolveReportTimeWindow computes the expected weekly UTC boundaries", () => {
  const reportWindow = resolveReportTimeWindow({
    window: "week",
    reportDate: "2026-03-14",
    timezone: "UTC",
    timezoneOffsetMinutes: 0,
  });

  assert.equal(reportWindow.startTime, "2026-03-08T00:00:00.000Z");
  assert.equal(reportWindow.endTime, "2026-03-15T00:00:00.000Z");
});
