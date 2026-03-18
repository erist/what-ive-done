import assert from "node:assert/strict";
import test from "node:test";

import { getConfigVersion, migrateConfig } from "./migrate.js";

test("migrateConfig upgrades version 0 configs to version 1", () => {
  const migrated = migrateConfig("/tmp/what-ive-done-config", {
    dataDir: "/tmp/legacy-data",
    tools: {
      gws: {
        added: true,
      },
    },
    server: {
      port: "4319",
    },
    agent: {
      verbose: true,
    },
  });

  assert.equal(migrated.version, 1);
  assert.equal(migrated.dataDir, "/tmp/what-ive-done-config");
  assert.equal(migrated.tools.gws?.added, true);
  assert.equal(migrated.server.port, 4319);
  assert.equal(migrated.agent.verbose, true);
});

test("getConfigVersion returns 0 for missing version and migrateConfig rejects unknown versions", () => {
  assert.equal(getConfigVersion({ server: { port: 4318 } }), 0);
  assert.throws(
    () => migrateConfig("/tmp/what-ive-done-config", { version: 99 }),
    /Unknown config version: 99/u,
  );
});
