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
  assert.equal(report.summary.topRepetitiveWorkflows.length, 0);
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
  assert.ok(report.summary.topRepetitiveWorkflows.length > 0);
  const firstWorkflow = report.workflows[0];

  assert.ok(firstWorkflow);
  assert.ok(firstWorkflow.graph.text.includes("->"));
  assert.ok(firstWorkflow.frequencyPerWeek >= 3);
  assert.ok(firstWorkflow.confidenceScore > 0);
  assert.ok(firstWorkflow.automationHints.length > 0);
  assert.ok(firstWorkflow.automationHints[0]?.suggestedApproach);
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

test("buildWorkflowReport includes window-title context in representative steps", () => {
  const rawEvents: RawEvent[] = [
    {
      id: "raw-1",
      source: "desktop",
      sourceEventType: "app.switch",
      timestamp: "2026-03-14T09:00:00.000Z",
      application: "chrome",
      windowTitle: "Orders Queue",
      action: "switch",
      metadata: {},
      sensitiveFiltered: true,
      createdAt: "2026-03-14T09:00:00.000Z",
    },
    {
      id: "raw-2",
      source: "chrome_extension",
      sourceEventType: "browser.click",
      timestamp: "2026-03-14T09:00:20.000Z",
      application: "chrome",
      domain: "admin.internal",
      action: "click",
      target: "search_order",
      metadata: {},
      sensitiveFiltered: true,
      createdAt: "2026-03-14T09:00:20.000Z",
    },
    {
      id: "raw-3",
      source: "desktop",
      sourceEventType: "app.switch",
      timestamp: "2026-03-14T09:00:45.000Z",
      application: "slack",
      windowTitle: "Order Status Updates",
      action: "switch",
      metadata: {},
      sensitiveFiltered: true,
      createdAt: "2026-03-14T09:00:45.000Z",
    },
    {
      id: "raw-4",
      source: "desktop",
      sourceEventType: "app.switch",
      timestamp: "2026-03-14T11:00:00.000Z",
      application: "chrome",
      windowTitle: "Orders Queue",
      action: "switch",
      metadata: {},
      sensitiveFiltered: true,
      createdAt: "2026-03-14T11:00:00.000Z",
    },
    {
      id: "raw-5",
      source: "chrome_extension",
      sourceEventType: "browser.click",
      timestamp: "2026-03-14T11:00:20.000Z",
      application: "chrome",
      domain: "admin.internal",
      action: "click",
      target: "search_order",
      metadata: {},
      sensitiveFiltered: true,
      createdAt: "2026-03-14T11:00:20.000Z",
    },
    {
      id: "raw-6",
      source: "desktop",
      sourceEventType: "app.switch",
      timestamp: "2026-03-14T11:00:45.000Z",
      application: "slack",
      windowTitle: "Order Status Updates",
      action: "switch",
      metadata: {},
      sensitiveFiltered: true,
      createdAt: "2026-03-14T11:00:45.000Z",
    },
    {
      id: "raw-7",
      source: "desktop",
      sourceEventType: "app.switch",
      timestamp: "2026-03-14T13:00:00.000Z",
      application: "chrome",
      windowTitle: "Orders Queue",
      action: "switch",
      metadata: {},
      sensitiveFiltered: true,
      createdAt: "2026-03-14T13:00:00.000Z",
    },
    {
      id: "raw-8",
      source: "chrome_extension",
      sourceEventType: "browser.click",
      timestamp: "2026-03-14T13:00:20.000Z",
      application: "chrome",
      domain: "admin.internal",
      action: "click",
      target: "search_order",
      metadata: {},
      sensitiveFiltered: true,
      createdAt: "2026-03-14T13:00:20.000Z",
    },
    {
      id: "raw-9",
      source: "desktop",
      sourceEventType: "app.switch",
      timestamp: "2026-03-14T13:00:45.000Z",
      application: "slack",
      windowTitle: "Order Status Updates",
      action: "switch",
      metadata: {},
      sensitiveFiltered: true,
      createdAt: "2026-03-14T13:00:45.000Z",
    },
  ];
  const reportWindow = resolveReportTimeWindow({
    window: "day",
    reportDate: "2026-03-14",
    timezone: "UTC",
    timezoneOffsetMinutes: 0,
  });
  const report = buildWorkflowReport({
    rawEvents,
    timeWindow: reportWindow,
  });

  assert.equal(report.workflows.length, 1);
  assert.ok(report.workflows[0]?.representativeSteps[0]?.includes("Orders Queue"));
  assert.ok(report.workflows[0]?.representativeSteps[1]?.includes("Admin Internal"));
  assert.ok(report.workflows[0]?.representativeSteps[2]?.includes("Order Status Updates"));
});
