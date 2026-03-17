import test from "node:test";
import assert from "node:assert/strict";

import { hashCalendarField } from "../calendar/signals.js";
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

test("sanitizeRawEvent keeps only approved browser context metadata fields", () => {
  const sanitized = sanitizeRawEvent({
    source: "chrome_extension",
    sourceEventType: "chrome.route_change",
    timestamp: "2026-03-17T00:10:00.000Z",
    application: "chrome",
    action: "navigation",
    url: "https://workspace.example.com/#/orders/123/edit",
    metadata: {
      browserContext: {
        routeTaxonomy: {
          source: "hash",
          signature: "hash:/orders/{id}/edit",
          routeTemplate: "/orders/{id}/edit",
          depth: 3,
          primarySection: "orders",
          secondarySection: "{id}",
          leafSection: "edit",
          dynamicSegmentCount: 1,
          rawPath: "/orders/123/edit",
        },
        documentTypeHash: "ABCDEF1234567890",
        tabOrder: {
          globalSequence: 7,
          windowSequence: 3,
          tabIndex: 1,
          previousTabId: 22,
          windowId: 5,
          debug: "drop-me",
        },
        dwell: {
          durationMs: 4200.4,
          startedAt: "2026-03-17T00:09:55.800Z",
          endedAt: "2026-03-17T00:10:00.000Z",
          reason: "route_change",
          debug: "drop-me",
        },
        signalOnly: true,
        debug: "drop-me",
      },
    },
  });

  assert.deepEqual(sanitized.metadata, {
    browserContext: {
      routeTaxonomy: {
        source: "hash",
        signature: "hash:/orders/{id}/edit",
        routeTemplate: "/orders/{id}/edit",
        depth: 3,
        primarySection: "orders",
        secondarySection: "{id}",
        leafSection: "edit",
        dynamicSegmentCount: 1,
      },
      documentTypeHash: "abcdef1234567890",
      tabOrder: {
        globalSequence: 7,
        windowSequence: 3,
        tabIndex: 1,
        previousTabId: 22,
        windowId: 5,
      },
      dwell: {
        durationMs: 4200,
        startedAt: "2026-03-17T00:09:55.800Z",
        endedAt: "2026-03-17T00:10:00.000Z",
        reason: "route_change",
      },
      signalOnly: true,
    },
  });
});

test("sanitizeRawEvent keeps only privacy-safe calendar signal metadata fields", () => {
  const sanitized = sanitizeRawEvent({
    source: "calendar",
    sourceEventType: "calendar.meeting.start",
    timestamp: "2026-03-17T09:00:00.000Z",
    application: "gws-calendar",
    action: "calendar_signal",
    target: "meeting_start",
    metadata: {
      calendarSignal: {
        signalType: "meeting_start",
        eventIdHash: hashCalendarField("event-123"),
        summaryHash: hashCalendarField("Quarterly planning"),
        startAt: "2026-03-17T09:00:00.000Z",
        endAt: "2026-03-17T10:00:00.000Z",
        attendeesCount: 7,
        signalOnly: true,
        rawSummary: "Quarterly planning",
      },
      sessionCookie: "drop-me",
    },
  });

  assert.deepEqual(sanitized.metadata, {
    calendarSignal: {
      signalType: "meeting_start",
      eventIdHash: hashCalendarField("event-123"),
      summaryHash: hashCalendarField("Quarterly planning"),
      startAt: "2026-03-17T09:00:00.000Z",
      endAt: "2026-03-17T10:00:00.000Z",
      attendeesCount: 7,
      signalOnly: true,
    },
    sessionCookie: "[REDACTED]",
  });
});

test("sanitizeRawEvent keeps only privacy-safe workspace context metadata fields", () => {
  const sanitized = sanitizeRawEvent({
    source: "workspace",
    sourceEventType: "workspace.sheets.viewed",
    timestamp: "2026-03-17T09:31:00.000Z",
    application: "gws-sheets",
    action: "workspace_activity",
    resourceHash: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
    metadata: {
      workspaceContext: {
        provider: "gws",
        app: "sheets",
        itemType: "spreadsheet",
        itemHash: "ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890",
        activityType: "viewed",
        modifiedAt: "2026-03-17T09:30:42.225Z",
        viewedAt: "2026-03-17T09:31:00.000Z",
        sheetCount: 3,
        gridSheetCount: 2,
        title: "drop-me",
      },
    },
  });

  assert.deepEqual(sanitized.metadata, {
    workspaceContext: {
      provider: "gws",
      app: "sheets",
      itemType: "spreadsheet",
      itemHash: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
      activityType: "viewed",
      modifiedAt: "2026-03-17T09:30:42.225Z",
      viewedAt: "2026-03-17T09:31:00.000Z",
      sheetCount: 3,
      gridSheetCount: 2,
    },
  });
});

test("sanitizeRawEvent keeps only privacy-safe git context metadata fields", () => {
  const sanitized = sanitizeRawEvent({
    source: "git",
    sourceEventType: "git.repo.status",
    timestamp: "2026-03-17T09:45:00.000Z",
    application: "git",
    action: "git_activity",
    resourceHash: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
    metadata: {
      gitContext: {
        repoHash: "ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890",
        remoteHost: "GitHub.com",
        dirtyFileCount: 4,
        lastCommitAt: "2026-03-17T09:45:00.000Z",
        branchName: "drop-me",
      },
      authToken: "drop-me",
    },
  });

  assert.deepEqual(sanitized.metadata, {
    gitContext: {
      repoHash: "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
      remoteHost: "github.com",
      dirtyFileCount: 4,
      lastCommitAt: "2026-03-17T09:45:00.000Z",
    },
    authToken: "[REDACTED]",
  });
});
