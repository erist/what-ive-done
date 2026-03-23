import assert from "node:assert/strict";
import test from "node:test";

import { CLI_ALIASES, normalizeCliArgv } from "./aliases.js";

test("CLI_ALIASES keeps the short command map stable", () => {
  assert.equal(CLI_ALIASES.up, "agent:run");
  assert.equal(CLI_ALIASES.restart, "agent:restart");
  assert.equal(CLI_ALIASES.stop, "agent:stop");
  assert.equal(CLI_ALIASES.status, "agent:health");
  assert.equal(CLI_ALIASES.compare, "report:compare");
  assert.equal(CLI_ALIASES.trace, "debug:trace:workflow");
  assert.equal(CLI_ALIASES.coverage, "action:coverage");
  assert.equal(CLI_ALIASES.viewer, "viewer:open");
  assert.equal(CLI_ALIASES.token, "ingest:token");
});

test("normalizeCliArgv rewrites wid up alias options", () => {
  assert.deepEqual(
    normalizeCliArgv(["node", "wid", "up", "--open", "--no-gws", "--verbose"]),
    ["node", "wid", "up", "--open-viewer", "--disable-gws", "--verbose"],
  );
});

test("normalizeCliArgv leaves long-form commands untouched", () => {
  assert.deepEqual(
    normalizeCliArgv(["node", "wid", "agent:run", "--open-viewer"]),
    ["node", "wid", "agent:run", "--open-viewer"],
  );
});

test("normalizeCliArgv leaves natural command groups untouched", () => {
  assert.deepEqual(
    normalizeCliArgv(["node", "wid", "workflow", "list", "--json"]),
    ["node", "wid", "workflow", "list", "--json"],
  );
});
