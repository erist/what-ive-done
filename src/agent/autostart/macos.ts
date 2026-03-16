import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { resolveAppPaths } from "../../app-paths.js";

export interface MacOSLaunchAgentConfig {
  label: string;
  plistPath: string;
  cliEntrypointPath: string;
  workingDirectory: string;
  dataDir: string;
  stdoutPath: string;
  stderrPath: string;
  programArguments: string[];
}

export interface MacOSLaunchAgentStatus {
  supported: boolean;
  installed: boolean;
  loaded: boolean;
  label: string;
  plistPath: string;
  cliEntrypointPath: string;
  stdoutPath: string;
  stderrPath: string;
}

interface CommandRunnerResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error | undefined;
}

export interface LaunchctlRunner {
  (args: string[]): CommandRunnerResult;
}

function defaultLaunchctlRunner(args: string[]): CommandRunnerResult {
  const result = spawnSync("launchctl", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ?? undefined,
  };
}

function resolveRepositoryRoot(): string {
  return fileURLToPath(new URL("../../../", import.meta.url));
}

function resolveDefaultCLIEntrypointPath(): string {
  return fileURLToPath(new URL("../../../dist/cli.js", import.meta.url));
}

function resolveGuiDomain(): string {
  if (typeof process.getuid !== "function") {
    throw new Error("macOS LaunchAgent commands require a user session uid");
  }

  return `gui/${String(process.getuid())}`;
}

export function resolveMacOSLaunchAgentConfig(options: {
  dataDir?: string | undefined;
  plistPath?: string | undefined;
  cliEntrypointPath?: string | undefined;
  workingDirectory?: string | undefined;
} = {}): MacOSLaunchAgentConfig {
  const paths = resolveAppPaths(options.dataDir);
  const label = "com.whativedone.agent";
  const workingDirectory = options.workingDirectory ?? resolveRepositoryRoot();
  const cliEntrypointPath = options.cliEntrypointPath ?? resolveDefaultCLIEntrypointPath();
  const plistPath =
    options.plistPath ?? join(homedir(), "Library", "LaunchAgents", `${label}.plist`);
  const stdoutPath = join(paths.dataDir, "logs", "agent.stdout.log");
  const stderrPath = join(paths.dataDir, "logs", "agent.stderr.log");

  return {
    label,
    plistPath,
    cliEntrypointPath,
    workingDirectory,
    dataDir: paths.dataDir,
    stdoutPath,
    stderrPath,
    programArguments: [
      process.execPath,
      cliEntrypointPath,
      "agent:run",
      "--no-prompt-accessibility",
      "--data-dir",
      paths.dataDir,
    ],
  };
}

export function renderMacOSLaunchAgentPlist(config: MacOSLaunchAgentConfig): string {
  const programArguments = config.programArguments
    .map((argument) => `    <string>${escapeXml(argument)}</string>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${escapeXml(config.label)}</string>
  <key>ProgramArguments</key>
  <array>
${programArguments}
  </array>
  <key>WorkingDirectory</key>
  <string>${escapeXml(config.workingDirectory)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escapeXml(config.stdoutPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(config.stderrPath)}</string>
</dict>
</plist>
`;
}

export function getMacOSLaunchAgentStatus(
  options: {
    dataDir?: string | undefined;
    plistPath?: string | undefined;
    cliEntrypointPath?: string | undefined;
    workingDirectory?: string | undefined;
  } = {},
  launchctlRunner: LaunchctlRunner = defaultLaunchctlRunner,
): MacOSLaunchAgentStatus {
  const config = resolveMacOSLaunchAgentConfig(options);
  const installed = existsSync(config.plistPath);
  let loaded = false;

  if (installed) {
    const result = launchctlRunner(["print", `${resolveGuiDomain()}/${config.label}`]);
    loaded = result.status === 0;
  }

  return {
    supported: process.platform === "darwin",
    installed,
    loaded,
    label: config.label,
    plistPath: config.plistPath,
    cliEntrypointPath: config.cliEntrypointPath,
    stdoutPath: config.stdoutPath,
    stderrPath: config.stderrPath,
  };
}

export function installMacOSLaunchAgent(
  options: {
    dataDir?: string | undefined;
    plistPath?: string | undefined;
    cliEntrypointPath?: string | undefined;
    workingDirectory?: string | undefined;
    load?: boolean | undefined;
  } = {},
  launchctlRunner: LaunchctlRunner = defaultLaunchctlRunner,
): MacOSLaunchAgentStatus {
  const config = resolveMacOSLaunchAgentConfig(options);

  if (!existsSync(config.cliEntrypointPath)) {
    throw new Error(`Built CLI entrypoint not found: ${config.cliEntrypointPath}`);
  }

  mkdirSync(dirname(config.plistPath), { recursive: true });
  mkdirSync(dirname(config.stdoutPath), { recursive: true });
  mkdirSync(dirname(config.stderrPath), { recursive: true });
  writeFileSync(config.plistPath, renderMacOSLaunchAgentPlist(config), "utf8");

  if (options.load !== false) {
    launchctlRunner(["bootout", resolveGuiDomain(), config.plistPath]);

    const bootstrapResult = launchctlRunner(["bootstrap", resolveGuiDomain(), config.plistPath]);

    if (bootstrapResult.error || bootstrapResult.status !== 0) {
      throw new Error(
        bootstrapResult.error?.message ||
          bootstrapResult.stderr.trim() ||
          bootstrapResult.stdout.trim() ||
          "Failed to bootstrap LaunchAgent",
      );
    }

    const kickstartResult = launchctlRunner(["kickstart", "-k", `${resolveGuiDomain()}/${config.label}`]);

    if (kickstartResult.error || kickstartResult.status !== 0) {
      throw new Error(
        kickstartResult.error?.message ||
          kickstartResult.stderr.trim() ||
          kickstartResult.stdout.trim() ||
          "Failed to start LaunchAgent",
      );
    }
  }

  return getMacOSLaunchAgentStatus(options, launchctlRunner);
}

export function uninstallMacOSLaunchAgent(
  options: {
    dataDir?: string | undefined;
    plistPath?: string | undefined;
    cliEntrypointPath?: string | undefined;
    workingDirectory?: string | undefined;
    unload?: boolean | undefined;
  } = {},
  launchctlRunner: LaunchctlRunner = defaultLaunchctlRunner,
): MacOSLaunchAgentStatus {
  const config = resolveMacOSLaunchAgentConfig(options);

  if (options.unload !== false && existsSync(config.plistPath)) {
    launchctlRunner(["bootout", resolveGuiDomain(), config.plistPath]);
  }

  rmSync(config.plistPath, { force: true });

  return getMacOSLaunchAgentStatus(options, launchctlRunner);
}

export function readMacOSLaunchAgentPlist(plistPath: string): string {
  return readFileSync(plistPath, "utf8");
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
