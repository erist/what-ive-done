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
    browserSchemaVersion: input.browserSchemaVersion,
    canonicalUrl: input.canonicalUrl,
    routeTemplate: input.routeTemplate,
    routeKey: input.routeKey,
    resourceHash: input.resourceHash,
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
  assert.equal(event.canonicalUrl, "https://admin.example.com/product/{id}");
  assert.equal(event.routeTemplate, "/product/{id}/edit");
  assert.equal(event.routeKey, "https://admin.example.com/product/{id}");
  assert.equal(event.pathPattern, "/product/{id}/edit");
  assert.equal(event.routeFamily, "makestar-admin.products.edit");
  assert.equal(event.domainPackId, "makestar-admin");
  assert.equal(event.pageType, "product_edit");
  assert.equal(event.resourceHint, "product");
  assert.equal(event.titlePattern, "Admin - Product {id} Edit");
});

test("normalizeRawEvents converges browser URL variants into one canonical route family", () => {
  const events = normalizeRawEvents([
    createRawEvent({
      id: "raw-3",
      timestamp: "2026-03-14T10:12:23.000Z",
      url: "https://admin.example.com/orders/123/edit?tab=history#summary",
      target: "edit_order",
    }),
    createRawEvent({
      id: "raw-4",
      timestamp: "2026-03-14T10:12:24.000Z",
      url: "https://admin.example.com/orders/456/edit?tab=history",
      target: "edit_order",
    }),
    createRawEvent({
      id: "raw-5",
      timestamp: "2026-03-14T10:12:25.000Z",
      url: "https://admin.example.com/orders/789/edit?search=alice",
      target: "edit_order",
    }),
  ]);

  assert.equal(new Set(events.map((event) => event.canonicalUrl)).size, 1);
  assert.equal(new Set(events.map((event) => event.routeTemplate)).size, 1);
  assert.equal(new Set(events.map((event) => event.routeKey)).size, 1);
  assert.equal(events[0]?.canonicalUrl, "https://admin.example.com/orders/{id}");
  assert.equal(events[0]?.routeTemplate, "/orders/{id}/edit");
  assert.equal(events[2]?.url, "https://admin.example.com/orders/789/edit");
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

test("normalizeRawEvents skips signal-only browser context events", () => {
  const events = normalizeRawEvents([
    createRawEvent({
      id: "raw-3",
      timestamp: "2026-03-17T00:00:00.000Z",
      sourceEventType: "chrome.navigation",
      url: "https://workspace.example.com/orders/123",
      metadata: {
        browserContext: {
          routeTaxonomy: {
            signature: "pathname:/orders/{id}",
          },
        },
      },
    }),
    createRawEvent({
      id: "raw-4",
      timestamp: "2026-03-17T00:00:30.000Z",
      sourceEventType: "chrome.dwell",
      action: "dwell",
      metadata: {
        browserContext: {
          routeTaxonomy: {
            signature: "pathname:/orders/{id}",
          },
          dwell: {
            durationMs: 30000,
          },
          signalOnly: true,
        },
      },
    }),
  ]);

  assert.equal(events.length, 1);
  assert.equal(events[0]?.rawEventId, "raw-3");
});
