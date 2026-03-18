import assert from "node:assert/strict";
import test from "node:test";

import { createDefaultWidConfig } from "../config/schema.js";
import { resolveCollectorRuntimeOptions } from "./runtime.js";

test("resolveCollectorRuntimeOptions enables only ready config-backed collectors", () => {
  const config = createDefaultWidConfig("/tmp/what-ive-done-runtime-test");
  config.tools.gws = {
    added: true,
    "calendar-id": "primary",
  };
  config.tools.git = {
    added: true,
    "repo-path": "/tmp/repo",
  };

  const resolved = resolveCollectorRuntimeOptions({
    config,
    gwsCalendarStatus: {
      collector: "gws-calendar",
      command: "gws",
      selectedCalendarId: "primary",
      installed: true,
      ready: true,
      status: "available",
    },
    gwsDriveStatus: {
      collector: "gws-drive",
      command: "gws",
      installed: true,
      ready: false,
      status: "missing_scope",
      detail: "Drive scope missing",
    },
    gwsSheetsStatus: {
      collector: "gws-sheets",
      command: "gws",
      installed: true,
      ready: false,
      status: "auth_error",
      detail: "Sheets token expired",
    },
    gitStatus: {
      collector: "git-context",
      command: "git",
      installed: true,
      ready: true,
      status: "available",
      selectedRepoPath: "/tmp/repo",
    },
  });

  assert.equal(resolved.enableGWSCalendar, true);
  assert.equal(resolved.enableGWSDrive, false);
  assert.equal(resolved.enableGWSSheets, false);
  assert.equal(resolved.gitRepoPath, "/tmp/repo");
  assert.deepEqual(resolved.warnings, [
    "gws-drive skipped: Drive scope missing",
    "gws-sheets skipped: Sheets token expired",
  ]);
});
