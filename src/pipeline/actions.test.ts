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

test("normalizeRawEvents keeps non-ASCII application switch identifiers intact", () => {
  const [event] = normalizeRawEvents([
    createRawEvent({
      id: "raw-4",
      timestamp: "2026-03-14T10:15:23.000Z",
      source: "desktop",
      sourceEventType: "app.switch",
      application: "시스템 설정",
      action: "switch",
    }),
  ]);

  assert.ok(event);
  assert.equal(event.actionName, "switch_to_시스템_설정");
  assert.equal(event.actionSource, "inferred");
});

test("normalizeRawEvents derives workspace metadata actions even without a target", () => {
  const [event] = normalizeRawEvents([
    createRawEvent({
      id: "raw-5",
      timestamp: "2026-03-14T10:16:23.000Z",
      source: "workspace",
      sourceEventType: "workspace.sheets.viewed",
      application: "gws-sheets",
      action: "workspace_activity",
      metadata: {
        workspaceContext: {
          provider: "gws",
          app: "sheets",
          itemType: "spreadsheet",
          itemHash: "abcdef1234567890abcdef1234567890",
          activityType: "viewed",
        },
      },
    }),
  ]);

  assert.ok(event);
  assert.equal(event.actionName, "open_sheet");
  assert.equal(event.actionSource, "rule");
  assert.equal((event.metadata.actionMatch as Record<string, unknown>)?.strategy, "workspace_context");
});

test("normalizeRawEvents derives git metadata actions even without a target", () => {
  const events = normalizeRawEvents([
    createRawEvent({
      id: "raw-6",
      timestamp: "2026-03-14T10:17:23.000Z",
      source: "git",
      sourceEventType: "git.repo.status",
      application: "git",
      action: "git_activity",
      metadata: {
        gitContext: {
          repoHash: "abcdef1234567890abcdef1234567890",
          remoteHost: "github.com",
          dirtyFileCount: 3,
        },
      },
    }),
    createRawEvent({
      id: "raw-7",
      timestamp: "2026-03-14T10:18:23.000Z",
      source: "git",
      sourceEventType: "git.repo.commit",
      application: "git",
      action: "git_activity",
      target: "record_git_commit",
      metadata: {
        gitContext: {
          repoHash: "abcdef1234567890abcdef1234567890",
          remoteHost: "github.com",
          dirtyFileCount: 0,
        },
      },
    }),
  ]);

  assert.equal(events[0]?.actionName, "review_git_changes");
  assert.equal(events[0]?.actionSource, "rule");
  assert.equal(events[1]?.actionName, "record_git_commit");
  assert.equal((events[0]?.metadata.actionMatch as Record<string, unknown>)?.strategy, "git_context");
});

test("normalizeRawEvents derives Gmail, Calendar, and Notion semantic actions from domain packs", () => {
  const events = normalizeRawEvents([
    createRawEvent({
      id: "raw-gmail-1",
      timestamp: "2026-03-14T10:19:23.000Z",
      sourceEventType: "chrome.navigation",
      domain: "mail.google.com",
      browserSchemaVersion: 2,
      metadata: {
        browserContext: {
          routeTaxonomy: {
            source: "hash",
            signature: "hash:/inbox/{id}",
            routeTemplate: "/inbox/{id}",
            primarySection: "inbox",
            secondarySection: "{id}",
            leafSection: "{id}",
            dynamicSegmentCount: 1,
          },
        },
      },
    }),
    createRawEvent({
      id: "raw-gmail-2",
      timestamp: "2026-03-14T10:19:53.000Z",
      sourceEventType: "browser.click",
      action: "click",
      domain: "mail.google.com",
      target: "reply_send",
      browserSchemaVersion: 2,
      metadata: {
        browserContext: {
          routeTaxonomy: {
            source: "hash",
            signature: "hash:/inbox/{id}",
            routeTemplate: "/inbox/{id}",
            primarySection: "inbox",
            secondarySection: "{id}",
            leafSection: "{id}",
            dynamicSegmentCount: 1,
          },
        },
      },
    }),
    createRawEvent({
      id: "raw-calendar-1",
      timestamp: "2026-03-14T10:20:23.000Z",
      domain: "calendar.google.com",
      url: "https://calendar.google.com/calendar/u/0/r/eventedit/opaqueEventKey123456",
      target: "save_event",
    }),
    createRawEvent({
      id: "raw-notion-1",
      timestamp: "2026-03-14T10:20:53.000Z",
      domain: "www.notion.so",
      url: "https://www.notion.so/Project-Roadmap-0123456789abcdef0123456789abcdef",
      target: "edit_block",
    }),
  ]);

  assert.equal(events[0]?.actionName, "open_mail_thread");
  assert.equal(events[1]?.actionName, "reply_mail_thread");
  assert.equal(events[2]?.actionName, "schedule_calendar_event");
  assert.equal(events[3]?.actionName, "edit_notion_page");
  assert.equal((events[3]?.metadata.actionMatch as Record<string, unknown>)?.packId, "notion");
});
