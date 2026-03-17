import test from "node:test";
import assert from "node:assert/strict";

import type { RawEvent } from "../domain/types.js";
import { normalizeRawEvents } from "./normalize.js";

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

test("normalizeRawEvents derives rule-based semantic actions", () => {
  const [event] = normalizeRawEvents([
    createRawEvent({
      id: "raw-1",
      timestamp: "2026-03-14T10:12:23.000Z",
      url: "https://admin.example.com/product/123/edit?tab=price",
      windowTitle: "Admin - Product 123 Edit",
      target: "edit_product",
    }),
  ]);

  assert.ok(event);
  assert.equal(event.actionName, "edit_product");
  assert.equal(event.actionSource, "rule");
  assert.equal(event.actionConfidence, 0.98);
  assert.equal((event.metadata.actionMatch as Record<string, unknown>)?.layer, "domain_pack");
  assert.equal((event.metadata.actionMatch as Record<string, unknown>)?.packId, "makestar-admin");
});

test("normalizeRawEvents falls back to inferred semantic actions when no explicit rule matches", () => {
  const [event] = normalizeRawEvents([
    createRawEvent({
      id: "raw-2",
      timestamp: "2026-03-14T10:13:23.000Z",
      sourceEventType: "browser.click",
      action: "click",
      target: "focus_customer_note",
      domain: "admin.internal",
      application: "Google Chrome",
    }),
  ]);

  assert.ok(event);
  assert.equal(event.actionName, "focus_customer_note");
  assert.equal(event.actionSource, "inferred");
  assert.ok(event.actionConfidence >= 0.7);
  assert.equal((event.metadata.actionMatch as Record<string, unknown>)?.layer, "generic");
});

test("normalizeRawEvents captures low-signal browser interactions as unknown_action", () => {
  const [event] = normalizeRawEvents([
    createRawEvent({
      id: "raw-3",
      timestamp: "2026-03-14T10:14:23.000Z",
      sourceEventType: "browser.click",
      action: "click",
      domain: "wiki.internal",
      application: "Google Chrome",
      target: "toolbar_button",
    }),
  ]);

  assert.ok(event);
  assert.equal(event.actionName, "unknown_action");
  assert.equal(event.actionSource, "inferred");
  assert.equal((event.metadata.actionMatch as Record<string, unknown>)?.layer, "unknown");
});
