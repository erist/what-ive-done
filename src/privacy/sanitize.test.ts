import test from "node:test";
import assert from "node:assert/strict";

import { sanitizeRawEvent } from "./sanitize.js";

test("sanitizeRawEvent drops non-allowlisted query params and derives browser v2 fields", () => {
  const sanitized = sanitizeRawEvent({
    source: "mock",
    sourceEventType: "browser.click",
    timestamp: "2026-03-14T00:00:00.000Z",
    application: "chrome",
    action: "button_click",
    url: "https://internal.example.com/path/123/details?tab=history&token=abc123&orderId=42#sensitive",
    metadata: {
      password: "secret",
      nested: {
        sessionCookie: "cookie",
        allowed: "value",
      },
    },
  });

  assert.equal(
    sanitized.url,
    "https://internal.example.com/path/123/details?tab=history",
  );
  assert.equal(sanitized.browserSchemaVersion, 2);
  assert.equal(sanitized.canonicalUrl, "https://internal.example.com/path/{id}");
  assert.equal(sanitized.routeTemplate, "/path/{id}/details");
  assert.equal(sanitized.routeKey, "https://internal.example.com/path/{id}");
  assert.equal(sanitized.resourceHash, undefined);
  assert.deepEqual(sanitized.metadata, {
    password: "[REDACTED]",
    nested: {
      sessionCookie: "[REDACTED]",
      allowed: "value",
    },
  });
});

test("sanitizeRawEvent derives a stable opaque resource hash for approved browser ids", () => {
  const first = sanitizeRawEvent({
    source: "chrome_extension",
    sourceEventType: "chrome.navigation",
    timestamp: "2026-03-14T00:00:00.000Z",
    application: "chrome",
    action: "navigation",
    url: "https://internal.example.com/orders/550e8400-e29b-41d4-a716-446655440000/edit?view=summary",
  });
  const second = sanitizeRawEvent({
    source: "chrome_extension",
    sourceEventType: "chrome.navigation",
    timestamp: "2026-03-14T00:01:00.000Z",
    application: "chrome",
    action: "navigation",
    url: "https://internal.example.com/orders/550e8400-e29b-41d4-a716-446655440000/edit?view=summary#fragment",
  });

  assert.equal(first.canonicalUrl, "https://internal.example.com/orders/{uuid}");
  assert.equal(first.routeTemplate, "/orders/{uuid}/edit");
  assert.ok(first.resourceHash);
  assert.equal(first.resourceHash, second.resourceHash);
  assert.equal(first.resourceHash?.includes("550e8400"), false);
});
