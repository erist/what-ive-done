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
