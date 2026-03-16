import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  getMacOSLaunchAgentStatus,
  installMacOSLaunchAgent,
  readMacOSLaunchAgentPlist,
  renderMacOSLaunchAgentPlist,
  resolveMacOSLaunchAgentConfig,
  uninstallMacOSLaunchAgent,
} from "./macos.js";

test("renderMacOSLaunchAgentPlist includes the CLI entrypoint and data dir arguments", () => {
  const config = resolveMacOSLaunchAgentConfig({
    dataDir: "/tmp/what-ive-done-data",
    plistPath: "/tmp/com.whativedone.agent.plist",
    cliEntrypointPath: "/repo/dist/cli.js",
    workingDirectory: "/repo",
  });
  const plist = renderMacOSLaunchAgentPlist(config);

  assert.ok(plist.includes("<string>/repo/dist/cli.js</string>"));
  assert.ok(plist.includes("<string>agent:run</string>"));
  assert.ok(plist.includes("<string>--no-prompt-accessibility</string>"));
  assert.ok(plist.includes("<string>/tmp/what-ive-done-data</string>"));
});

test("installMacOSLaunchAgent writes a plist and invokes launchctl bootstrap and kickstart", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "what-ive-done-launchagent-"));
  const plistPath = join(tempDir, "com.whativedone.agent.plist");
  const cliEntrypointPath = join(tempDir, "cli.js");
  const calls: string[][] = [];

  writeFileSync(cliEntrypointPath, "console.log('ok');", "utf8");

  try {
    const status = installMacOSLaunchAgent(
      {
        dataDir: join(tempDir, "data"),
        plistPath,
        cliEntrypointPath,
        workingDirectory: tempDir,
      },
      (args) => {
        calls.push(args);
        return {
          status: args[0] === "print" ? 0 : 0,
          stdout: "",
          stderr: "",
        };
      },
    );

    const plist = readMacOSLaunchAgentPlist(plistPath);

    assert.equal(status.installed, true);
    assert.equal(status.loaded, true);
    assert.ok(plist.includes(cliEntrypointPath));
    assert.ok(calls.some((args) => args[0] === "bootstrap"));
    assert.ok(calls.some((args) => args[0] === "kickstart"));
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("getMacOSLaunchAgentStatus reflects plist installation and launchctl state", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "what-ive-done-launchagent-status-"));
  const plistPath = join(tempDir, "com.whativedone.agent.plist");
  const cliEntrypointPath = join(tempDir, "cli.js");

  writeFileSync(cliEntrypointPath, "console.log('ok');", "utf8");
  writeFileSync(plistPath, "<plist></plist>", "utf8");

  try {
    const loadedStatus = getMacOSLaunchAgentStatus(
      {
        dataDir: join(tempDir, "data"),
        plistPath,
        cliEntrypointPath,
        workingDirectory: tempDir,
      },
      () => ({
        status: 0,
        stdout: "",
        stderr: "",
      }),
    );

    assert.equal(loadedStatus.installed, true);
    assert.equal(loadedStatus.loaded, true);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("uninstallMacOSLaunchAgent removes the plist", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "what-ive-done-launchagent-remove-"));
  const plistPath = join(tempDir, "com.whativedone.agent.plist");
  const cliEntrypointPath = join(tempDir, "cli.js");

  writeFileSync(cliEntrypointPath, "console.log('ok');", "utf8");
  writeFileSync(plistPath, "<plist></plist>", "utf8");

  try {
    const status = uninstallMacOSLaunchAgent(
      {
        dataDir: join(tempDir, "data"),
        plistPath,
        cliEntrypointPath,
        workingDirectory: tempDir,
      },
      () => ({
        status: 1,
        stdout: "",
        stderr: "",
      }),
    );

    assert.equal(status.installed, false);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
