import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveAppPaths } from "../../app-paths.js";

export interface WindowsStartupConfig {
  label: string;
  startupScriptPath: string;
  cliEntrypointPath: string;
  workingDirectory: string;
  dataDir: string;
  stdoutPath: string;
  stderrPath: string;
  programArguments: string[];
}

export interface WindowsStartupStatus {
  supported: boolean;
  installed: boolean;
  loaded: boolean;
  label: string;
  startupScriptPath: string;
  cliEntrypointPath: string;
  stdoutPath: string;
  stderrPath: string;
}

function resolveRepositoryRoot(): string {
  return fileURLToPath(new URL("../../../", import.meta.url));
}

function resolveDefaultCLIEntrypointPath(): string {
  return fileURLToPath(new URL("../../../dist/cli.js", import.meta.url));
}

function resolveDefaultStartupScriptPath(label: string): string {
  const appData = process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");

  return join(
    appData,
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs",
    "Startup",
    `${label}.cmd`,
  );
}

export function resolveWindowsStartupConfig(options: {
  dataDir?: string | undefined;
  startupScriptPath?: string | undefined;
  cliEntrypointPath?: string | undefined;
  workingDirectory?: string | undefined;
} = {}): WindowsStartupConfig {
  const paths = resolveAppPaths(options.dataDir);
  const label = "what-ive-done-agent";
  const workingDirectory = options.workingDirectory ?? resolveRepositoryRoot();
  const cliEntrypointPath = options.cliEntrypointPath ?? resolveDefaultCLIEntrypointPath();
  const startupScriptPath =
    options.startupScriptPath ?? resolveDefaultStartupScriptPath(label);
  const stdoutPath = join(paths.dataDir, "logs", "agent.stdout.log");
  const stderrPath = join(paths.dataDir, "logs", "agent.stderr.log");

  return {
    label,
    startupScriptPath,
    cliEntrypointPath,
    workingDirectory,
    dataDir: paths.dataDir,
    stdoutPath,
    stderrPath,
    programArguments: [
      cliEntrypointPath,
      "agent:run",
      "--data-dir",
      paths.dataDir,
    ],
  };
}

function toPowerShellSingleQuoted(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

export function renderWindowsStartupScript(config: WindowsStartupConfig): string {
  const argumentList = config.programArguments
    .map((argument) => toPowerShellSingleQuoted(argument))
    .join(", ");

  return `@echo off
setlocal
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -Command "$stdoutDir = Split-Path -Parent ${toPowerShellSingleQuoted(config.stdoutPath)}; $stderrDir = Split-Path -Parent ${toPowerShellSingleQuoted(config.stderrPath)}; if (!(Test-Path $stdoutDir)) { New-Item -ItemType Directory -Path $stdoutDir -Force | Out-Null }; if (!(Test-Path $stderrDir)) { New-Item -ItemType Directory -Path $stderrDir -Force | Out-Null }; Start-Process -FilePath ${toPowerShellSingleQuoted(process.execPath)} -ArgumentList @(${argumentList}) -WorkingDirectory ${toPowerShellSingleQuoted(config.workingDirectory)} -WindowStyle Hidden -RedirectStandardOutput ${toPowerShellSingleQuoted(config.stdoutPath)} -RedirectStandardError ${toPowerShellSingleQuoted(config.stderrPath)}"
endlocal
`;
}

export function getWindowsStartupStatus(
  options: {
    dataDir?: string | undefined;
    startupScriptPath?: string | undefined;
    cliEntrypointPath?: string | undefined;
    workingDirectory?: string | undefined;
  } = {},
): WindowsStartupStatus {
  const config = resolveWindowsStartupConfig(options);
  const installed = existsSync(config.startupScriptPath);

  return {
    supported: process.platform === "win32",
    installed,
    loaded: installed,
    label: config.label,
    startupScriptPath: config.startupScriptPath,
    cliEntrypointPath: config.cliEntrypointPath,
    stdoutPath: config.stdoutPath,
    stderrPath: config.stderrPath,
  };
}

export function installWindowsStartupScript(
  options: {
    dataDir?: string | undefined;
    startupScriptPath?: string | undefined;
    cliEntrypointPath?: string | undefined;
    workingDirectory?: string | undefined;
  } = {},
): WindowsStartupStatus {
  const config = resolveWindowsStartupConfig(options);

  if (!existsSync(config.cliEntrypointPath)) {
    throw new Error(`Built CLI entrypoint not found: ${config.cliEntrypointPath}`);
  }

  mkdirSync(dirname(config.startupScriptPath), { recursive: true });
  mkdirSync(dirname(config.stdoutPath), { recursive: true });
  mkdirSync(dirname(config.stderrPath), { recursive: true });
  writeFileSync(config.startupScriptPath, renderWindowsStartupScript(config), "utf8");

  return getWindowsStartupStatus(options);
}

export function uninstallWindowsStartupScript(
  options: {
    dataDir?: string | undefined;
    startupScriptPath?: string | undefined;
    cliEntrypointPath?: string | undefined;
    workingDirectory?: string | undefined;
  } = {},
): WindowsStartupStatus {
  const config = resolveWindowsStartupConfig(options);

  rmSync(config.startupScriptPath, { force: true });

  return getWindowsStartupStatus(options);
}

export function readWindowsStartupScript(startupScriptPath: string): string {
  return readFileSync(startupScriptPath, "utf8");
}
