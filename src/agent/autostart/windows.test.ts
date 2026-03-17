import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  getWindowsStartupStatus,
  installWindowsStartupScript,
  readWindowsStartupScript,
  renderWindowsStartupScript,
  resolveWindowsStartupConfig,
  uninstallWindowsStartupScript,
} from "./windows.js";

test("renderWindowsStartupScript includes the CLI entrypoint and data dir arguments", () => {
  const config = resolveWindowsStartupConfig({
    dataDir: "C:\\what-ive-done-data",
    startupScriptPath: "C:\\Startup\\what-ive-done-agent.cmd",
    cliEntrypointPath: "C:\\repo\\dist\\cli.js",
    workingDirectory: "C:\\repo",
  });
  const script = renderWindowsStartupScript(config);

  assert.ok(script.includes("C:\\repo\\dist\\cli.js"));
  assert.ok(script.includes("agent:run"));
  assert.ok(script.includes("C:\\what-ive-done-data"));
  assert.ok(script.includes("Start-Process"));
});

test("installWindowsStartupScript writes a startup script", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "what-ive-done-startup-"));
  const startupScriptPath = join(tempDir, "what-ive-done-agent.cmd");
  const cliEntrypointPath = join(tempDir, "cli.js");

  writeFileSync(cliEntrypointPath, "console.log('ok');", "utf8");

  try {
    const status = installWindowsStartupScript({
      dataDir: join(tempDir, "data"),
      startupScriptPath,
      cliEntrypointPath,
      workingDirectory: tempDir,
    });

    const script = readWindowsStartupScript(startupScriptPath);

    assert.equal(status.installed, true);
    assert.equal(status.loaded, true);
    assert.ok(script.includes(cliEntrypointPath));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("getWindowsStartupStatus reflects script installation", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "what-ive-done-startup-status-"));
  const startupScriptPath = join(tempDir, "what-ive-done-agent.cmd");
  const cliEntrypointPath = join(tempDir, "cli.js");

  writeFileSync(cliEntrypointPath, "console.log('ok');", "utf8");
  writeFileSync(startupScriptPath, "@echo off\n", "utf8");

  try {
    const status = getWindowsStartupStatus({
      dataDir: join(tempDir, "data"),
      startupScriptPath,
      cliEntrypointPath,
      workingDirectory: tempDir,
    });

    assert.equal(status.installed, true);
    assert.equal(status.loaded, true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("uninstallWindowsStartupScript removes the startup script", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "what-ive-done-startup-remove-"));
  const startupScriptPath = join(tempDir, "what-ive-done-agent.cmd");
  const cliEntrypointPath = join(tempDir, "cli.js");

  writeFileSync(cliEntrypointPath, "console.log('ok');", "utf8");
  writeFileSync(startupScriptPath, "@echo off\n", "utf8");

  try {
    const status = uninstallWindowsStartupScript({
      dataDir: join(tempDir, "data"),
      startupScriptPath,
      cliEntrypointPath,
      workingDirectory: tempDir,
    });

    assert.equal(status.installed, false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
