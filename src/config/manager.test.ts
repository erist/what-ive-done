import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { ConfigManager } from "./manager.js";
import { WID_DIRECTORY_NAME } from "./schema.js";

function createTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

test("ConfigManager saves, loads, and updates config values via dot notation", () => {
  const dataDir = createTempDir("what-ive-done-config-");

  try {
    const initialized = ConfigManager.initialize(dataDir);

    assert.equal(initialized.dataDir, resolve(dataDir));
    assert.equal(existsSync(ConfigManager.resolveConfigPath(dataDir)), true);

    ConfigManager.set(dataDir, "server.port", 4319);
    ConfigManager.set(dataDir, "tools.gws", {
      added: true,
      "calendar-id": "primary",
    });
    ConfigManager.set(dataDir, "tools.gws.added", false);
    ConfigManager.set(dataDir, "tools.gws.calendar-id", undefined);

    const loaded = ConfigManager.load(dataDir);

    assert.equal(loaded.server.port, 4319);
    assert.equal(loaded.tools.gws?.added, false);
    assert.equal(ConfigManager.get(dataDir, "tools.gws.calendar-id"), undefined);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("ConfigManager finds the data dir via explicit path, env var, and .wid parent search", () => {
  const originalCwd = process.cwd();
  const originalEnv = process.env.WID_DATA_DIR;
  const dataDir = createTempDir("what-ive-done-config-find-");
  const nestedDir = join(dataDir, "nested", "child");
  const resolvedDataDir = resolve(dataDir);
  const realDataDir = realpathSync(dataDir);

  try {
    ConfigManager.initialize(dataDir);
    mkdirSync(nestedDir, { recursive: true });

    assert.equal(ConfigManager.findDataDir("./relative-data"), resolve("relative-data"));

    process.env.WID_DATA_DIR = dataDir;
    assert.equal(ConfigManager.findDataDir(), resolvedDataDir);

    delete process.env.WID_DATA_DIR;
    process.chdir(nestedDir);
    assert.equal(ConfigManager.findDataDir(), realDataDir);
  } finally {
    if (originalEnv === undefined) {
      delete process.env.WID_DATA_DIR;
    } else {
      process.env.WID_DATA_DIR = originalEnv;
    }

    process.chdir(originalCwd);
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("ConfigManager rejects credential-like keys in persisted config", () => {
  const dataDir = createTempDir("what-ive-done-config-guard-");

  try {
    ConfigManager.initialize(dataDir);

    assert.throws(
      () =>
        ConfigManager.set(dataDir, "tools.openai.apiKey", "sk-secret"),
      /must not store credential material/,
    );

    const stored = readFileSync(ConfigManager.resolveConfigPath(dataDir), "utf8");

    assert.equal(stored.includes("apiKey"), false);
    assert.equal(stored.includes("sk-secret"), false);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("ConfigManager creates config under the .wid directory", () => {
  const dataDir = createTempDir("what-ive-done-config-layout-");

  try {
    ConfigManager.initialize(dataDir);

    assert.equal(
      existsSync(join(dataDir, WID_DIRECTORY_NAME)),
      true,
    );
    assert.equal(
      existsSync(ConfigManager.resolveConfigPath(dataDir)),
      true,
    );
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("ConfigManager.load migrates a version 0 config and persists version 1", () => {
  const dataDir = createTempDir("what-ive-done-config-migrate-");

  try {
    mkdirSync(join(dataDir, WID_DIRECTORY_NAME), { recursive: true });
    writeFileSync(
      ConfigManager.resolveConfigPath(dataDir),
      JSON.stringify(
        {
          dataDir,
          server: {
            port: "4319",
          },
          agent: {
            verbose: true,
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const loaded = ConfigManager.load(dataDir);
    const persisted = JSON.parse(readFileSync(ConfigManager.resolveConfigPath(dataDir), "utf8")) as {
      version: number;
      server: { port: number };
    };

    assert.equal(loaded.version, 1);
    assert.equal(loaded.server.port, 4319);
    assert.equal(loaded.agent.verbose, true);
    assert.equal(persisted.version, 1);
    assert.equal(persisted.server.port, 4319);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
