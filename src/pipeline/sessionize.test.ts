import test from "node:test";
import assert from "node:assert/strict";

import type { RawEvent } from "../domain/types.js";
import { normalizeRawEvents } from "./normalize.js";
import { sessionizeNormalizedEvents } from "./sessionize.js";

function createRawEvent(input: Partial<RawEvent> & Pick<RawEvent, "id" | "timestamp">): RawEvent {
  return {
    id: input.id,
    source: input.source ?? "chrome_extension",
    sourceEventType: input.sourceEventType ?? "chrome.navigation",
    timestamp: input.timestamp,
    application: input.application ?? "Google Chrome",
    windowTitle: input.windowTitle,
    domain: input.domain,
    url: input.url,
    action: input.action ?? "navigation",
    target: input.target,
    metadata: input.metadata ?? {},
    sensitiveFiltered: input.sensitiveFiltered ?? true,
    createdAt: input.createdAt ?? input.timestamp,
  };
}

test("sessionizeNormalizedEvents records idle and context-shift boundaries", () => {
  const normalizedEvents = normalizeRawEvents([
    createRawEvent({
      id: "raw-1",
      timestamp: "2026-03-14T10:00:00.000Z",
      url: "https://admin.example.com/orders",
      target: "order_search",
    }),
    createRawEvent({
      id: "raw-2",
      timestamp: "2026-03-14T10:00:30.000Z",
      sourceEventType: "browser.click",
      action: "click",
      domain: "admin.example.com",
      target: "search_order",
    }),
    createRawEvent({
      id: "raw-3",
      timestamp: "2026-03-14T10:04:00.000Z",
      url: "https://support.example.com/tickets/918273",
      target: "open_refund_ticket",
    }),
  ]);

  const sessions = sessionizeNormalizedEvents(normalizedEvents);

  assert.equal(sessions.length, 2);
  assert.equal(sessions[0]?.sessionBoundaryReason, "stream_start");
  assert.equal(sessions[1]?.sessionBoundaryReason, "idle_and_context_shift");
});

test("sessionizeNormalizedEvents splits interrupted workflows that restart with a fresh action", () => {
  const normalizedEvents = normalizeRawEvents([
    createRawEvent({
      id: "raw-1",
      timestamp: "2026-03-14T10:00:00.000Z",
      url: "https://admin.example.com/orders",
      target: "order_search",
    }),
    createRawEvent({
      id: "raw-2",
      timestamp: "2026-03-14T10:00:30.000Z",
      source: "desktop",
      sourceEventType: "app.switch",
      application: "Slack",
      action: "switch",
      target: "send_status_reply",
    }),
    createRawEvent({
      id: "raw-3",
      timestamp: "2026-03-14T10:01:40.000Z",
      url: "https://admin.example.com/product/123/edit",
      target: "edit_product",
    }),
  ]);

  const sessions = sessionizeNormalizedEvents(normalizedEvents);

  assert.equal(sessions.length, 2);
  assert.equal(sessions[1]?.sessionBoundaryReason, "reset_after_interruption");
  assert.equal(sessions[1]?.steps[0]?.actionName, "edit_product");
});

test("sessionizeNormalizedEvents keeps a dominant rolling context in one session after a brief interruption", () => {
  const normalizedEvents = normalizeRawEvents([
    createRawEvent({
      id: "raw-1",
      timestamp: "2026-03-14T10:00:00.000Z",
      url: "https://admin.example.com/orders",
      target: "orders_report",
    }),
    createRawEvent({
      id: "raw-2",
      timestamp: "2026-03-14T10:00:30.000Z",
      sourceEventType: "browser.click",
      action: "click",
      domain: "admin.example.com",
      target: "search_order",
    }),
    createRawEvent({
      id: "raw-3",
      timestamp: "2026-03-14T10:01:00.000Z",
      sourceEventType: "browser.click",
      action: "click",
      domain: "admin.example.com",
      target: "status_dropdown",
    }),
    createRawEvent({
      id: "raw-4",
      timestamp: "2026-03-14T10:01:30.000Z",
      source: "desktop",
      sourceEventType: "app.switch",
      application: "Slack",
      action: "switch",
      target: "send_status_reply",
    }),
    createRawEvent({
      id: "raw-5",
      timestamp: "2026-03-14T10:02:40.000Z",
      url: "https://admin.example.com/orders",
      target: "orders_report",
    }),
  ]);

  const sessions = sessionizeNormalizedEvents(normalizedEvents);

  assert.equal(sessions.length, 1);
  assert.deepEqual(
    sessions[0]?.steps.map((step) => step.actionName),
    ["open_admin", "search_order", "update_status", "send_slack_report", "open_admin"],
  );
});

test("sessionizeNormalizedEvents uses calendar signal events as explicit boundaries without adding them as steps", () => {
  const normalizedEvents = normalizeRawEvents([
    createRawEvent({
      id: "raw-1",
      timestamp: "2026-03-14T10:00:00.000Z",
      url: "https://admin.example.com/orders",
      target: "orders_report",
    }),
    createRawEvent({
      id: "raw-2",
      timestamp: "2026-03-14T10:00:30.000Z",
      sourceEventType: "browser.click",
      action: "click",
      domain: "admin.example.com",
      target: "search_order",
    }),
    createRawEvent({
      id: "raw-3",
      timestamp: "2026-03-14T10:05:00.000Z",
      source: "calendar",
      sourceEventType: "calendar.meeting.start",
      application: "gws-calendar",
      action: "calendar_signal",
      target: "meeting_start",
      metadata: {
        calendarSignal: {
          signalType: "meeting_start",
          eventIdHash: "abcdef1234567890",
          summaryHash: "0123456789abcdef",
          startAt: "2026-03-14T10:05:00.000Z",
          endAt: "2026-03-14T10:30:00.000Z",
          attendeesCount: 5,
          signalOnly: true,
        },
      },
    }),
    createRawEvent({
      id: "raw-4",
      timestamp: "2026-03-14T10:35:00.000Z",
      url: "https://admin.example.com/product/123/edit",
      target: "product_form",
    }),
  ]);

  const sessions = sessionizeNormalizedEvents(normalizedEvents);

  assert.equal(sessions.length, 2);
  assert.equal(sessions[1]?.sessionBoundaryReason, "calendar_signal");
  assert.deepEqual(
    sessions.map((session) => session.steps.map((step) => step.actionName)),
    [["open_admin", "search_order"], ["edit_product"]],
  );
});

test("sessionizeNormalizedEvents orders mixed-offset timestamps chronologically without negative durations", () => {
  const normalizedEvents = normalizeRawEvents([
    createRawEvent({
      id: "raw-1",
      timestamp: "2026-03-20T08:33:53.645Z",
      url: "https://admin.example.com/orders",
      target: "orders_report",
    }),
    createRawEvent({
      id: "raw-2",
      timestamp: "2026-03-20T17:33:20+09:00",
      sourceEventType: "browser.click",
      action: "click",
      domain: "admin.example.com",
      target: "search_order",
    }),
    createRawEvent({
      id: "raw-3",
      timestamp: "2026-03-20T08:34:10.000Z",
      url: "https://admin.example.com/orders/123",
      target: "open_order",
    }),
  ]);

  const sessions = sessionizeNormalizedEvents(normalizedEvents);

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0]?.steps[0]?.timestamp, "2026-03-20T17:33:20+09:00");
  assert.equal(sessions[0]?.steps[0]?.actionName, "search_order");
  assert.ok(
    Date.parse(sessions[0]?.endTime ?? "") >= Date.parse(sessions[0]?.startTime ?? ""),
  );
});
