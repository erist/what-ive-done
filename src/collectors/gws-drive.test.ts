import assert from "node:assert/strict";
import test from "node:test";

import {
  createDriveContextRawEvent,
  getGWSDriveCollectorStatus,
  listRecentDriveFiles,
  resolveDriveActivity,
} from "./gws-drive.js";

test("getGWSDriveCollectorStatus parses prefixed gws auth output", () => {
  const status = getGWSDriveCollectorStatus({
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
    "https://www.googleapis.com/auth/drive"
  ]
}`,
      stderr: "",
    }),
  });

  assert.equal(status.installed, true);
  assert.equal(status.ready, true);
  assert.equal(status.driveScopeGranted, true);
  assert.equal(status.user, "user@example.com");
});

test("listRecentDriveFiles parses Drive file payloads", () => {
  const files = listRecentDriveFiles({
    commandRunner: () => ({
      status: 0,
      stdout: JSON.stringify({
        files: [
          {
            id: "drive-file-1",
            mimeType: "application/vnd.google-apps.document",
            modifiedTime: "2026-03-17T18:30:42.225+09:00",
            viewedByMeTime: "2026-03-17T18:31:00+09:00",
          },
        ],
      }),
      stderr: "",
    }),
  });

  assert.equal(files.length, 1);
  assert.equal(files[0]?.id, "drive-file-1");
  assert.equal(files[0]?.modifiedTime, "2026-03-17T09:30:42.225Z");
  assert.equal(files[0]?.viewedByMeTime, "2026-03-17T09:31:00.000Z");
  assert.equal(resolveDriveActivity(files[0]!)?.activityType, "viewed");
});

test("createDriveContextRawEvent builds privacy-safe Drive context events", () => {
  const event = createDriveContextRawEvent({
    file: {
      id: "drive-file-1",
      mimeType: "application/vnd.google-apps.document",
      modifiedTime: "2026-03-17T18:30:42.225+09:00",
    },
  });

  assert.equal(event.source, "workspace");
  assert.equal(event.application, "gws-drive");
  assert.equal(event.target, "update_document");
  assert.equal(event.timestamp, "2026-03-17T09:30:42.225Z");
  assert.ok(event.resourceHash);
  assert.equal(event.resourceHash?.includes("drive-file-1"), false);
  assert.ok(event.metadata);
  assert.deepEqual(event.metadata.workspaceContext, {
    provider: "gws",
    app: "drive",
    itemType: "document",
    itemHash: event.resourceHash,
    activityType: "modified",
    modifiedAt: "2026-03-17T09:30:42.225Z",
    viewedAt: undefined,
  });
});
