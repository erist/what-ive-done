import assert from "node:assert/strict";
import test from "node:test";

import {
  createSheetsContextRawEvent,
  getGWSSheetsCollectorStatus,
  getSpreadsheetSummary,
  listRecentSpreadsheetFiles,
} from "./gws-sheets.js";

test("getGWSSheetsCollectorStatus parses prefixed gws auth output", () => {
  const status = getGWSSheetsCollectorStatus({
    commandRunner: () => ({
      status: 0,
      stdout: `Using keyring backend: keyring
{
  "auth_method": "oauth2",
  "token_valid": true,
  "has_refresh_token": true,
  "project_id": "demo-project",
  "user": "user@example.com",
  "scopes": [
    "https://www.googleapis.com/auth/spreadsheets"
  ]
}`,
      stderr: "",
    }),
  });

  assert.equal(status.installed, true);
  assert.equal(status.ready, true);
  assert.equal(status.sheetsScopeGranted, true);
});

test("listRecentSpreadsheetFiles filters spreadsheet drive payloads", () => {
  const files = listRecentSpreadsheetFiles({
    commandRunner: () => ({
      status: 0,
      stdout: JSON.stringify({
        files: [
          {
            id: "spreadsheet-1",
            mimeType: "application/vnd.google-apps.spreadsheet",
            modifiedTime: "2026-03-17T09:30:42.225Z",
            viewedByMeTime: "2026-03-17T09:31:00.000Z",
          },
        ],
      }),
      stderr: "",
    }),
  });

  assert.equal(files.length, 1);
  assert.equal(files[0]?.mimeType, "application/vnd.google-apps.spreadsheet");
});

test("getSpreadsheetSummary extracts sheet counts", () => {
  const summary = getSpreadsheetSummary("spreadsheet-1", {
    commandRunner: () => ({
      status: 0,
      stdout: JSON.stringify({
        spreadsheetId: "spreadsheet-1",
        sheets: [
          { properties: { sheetId: 0, sheetType: "GRID" } },
          { properties: { sheetId: 1, sheetType: "GRID" } },
          { properties: { sheetId: 2, sheetType: "OBJECT" } },
        ],
      }),
      stderr: "",
    }),
  });

  assert.deepEqual(summary, {
    spreadsheetId: "spreadsheet-1",
    sheetCount: 3,
    gridSheetCount: 2,
  });
});

test("createSheetsContextRawEvent builds privacy-safe spreadsheet events", () => {
  const event = createSheetsContextRawEvent({
    file: {
      id: "spreadsheet-1",
      mimeType: "application/vnd.google-apps.spreadsheet",
      viewedByMeTime: "2026-03-17T09:31:00.000Z",
    },
    summary: {
      spreadsheetId: "spreadsheet-1",
      sheetCount: 3,
      gridSheetCount: 2,
    },
  });

  assert.equal(event.application, "gws-sheets");
  assert.equal(event.domain, "docs.google.com");
  assert.equal(event.target, "open_sheet");
  assert.ok(event.metadata);
  assert.deepEqual(event.metadata.workspaceContext, {
    provider: "gws",
    app: "sheets",
    itemType: "spreadsheet",
    itemHash: event.resourceHash,
    activityType: "viewed",
    modifiedAt: undefined,
    viewedAt: "2026-03-17T09:31:00.000Z",
    sheetCount: 3,
    gridSheetCount: 2,
  });
});
