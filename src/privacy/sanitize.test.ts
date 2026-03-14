import test from "node:test";
import assert from "node:assert/strict";

import { sanitizeRawEvent } from "./sanitize.js";

test("sanitizeRawEvent redacts sensitive metadata and URL params", () => {
  const sanitized = sanitizeRawEvent({
    source: "mock",
    sourceEventType: "browser.click",
    timestamp: "2026-03-14T00:00:00.000Z",
    application: "chrome",
    action: "button_click",
    url: "https://internal.example.com/path?token=abc123&orderId=42",
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
    "https://internal.example.com/path?token=%5BREDACTED%5D&orderId=42",
  );
  assert.deepEqual(sanitized.metadata, {
    password: "[REDACTED]",
    nested: {
      sessionCookie: "[REDACTED]",
      allowed: "value",
    },
  });
});
