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

test("normalizeRawEvents derives stable browser context fields", () => {
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
  assert.equal(event.application, "chrome");
  assert.equal(event.appNameNormalized, "chrome");
  assert.equal(event.domain, "admin.example.com");
  assert.equal(event.url, "https://admin.example.com/product/123/edit");
  assert.equal(event.pathPattern, "/product/{id}/edit");
  assert.equal(event.pageType, "product_edit");
  assert.equal(event.resourceHint, "product");
  assert.equal(event.titlePattern, "Admin - Product {id} Edit");
});

test("normalizeRawEvents normalizes title identifiers even without a URL", () => {
  const [event] = normalizeRawEvents([
    createRawEvent({
      id: "raw-2",
      timestamp: "2026-03-14T10:13:23.000Z",
      application: "Chrome",
      windowTitle: "Admin - Order #918273",
      action: "switch",
      sourceEventType: "app.switch",
    }),
  ]);

  assert.ok(event);
  assert.equal(event.titlePattern, "Admin - Order #{id}");
  assert.equal(event.pageType, "order_detail");
  assert.equal(event.resourceHint, "order");
});
