import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import type { RawEventInput } from "../domain/types.js";
import { coerceIncomingEvent } from "../server/ingest.js";
import type { CollectorInfo } from "./types.js";

export interface MacOSCollectorPermissionStatus {
  collector: string;
  platform: string;
  accessibilityTrusted: boolean;
  windowTitleAvailable: boolean;
  frontmostApplicationAvailable: boolean;
  systemSettingsPath: string;
}

interface CommandRunnerResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error | undefined;
}

interface CommandRunner {
  (args: string[]): CommandRunnerResult;
}

export function getMacOSActiveWindowCollectorInfo(): CollectorInfo {
  return {
    id: "macos-active-window",
    name: "macOS Active Window Collector",
    platform: "macos",
    runtime: "swift",
    description:
      "Captures frontmost application changes and focused window titles when Accessibility permission is available.",
    supportedEventTypes: ["app.switch"],
    scriptPath: fileURLToPath(new URL("../../collectors/macos/active-window-collector.swift", import.meta.url)),
    sampleFixturePath: fileURLToPath(new URL("../../fixtures/macos-active-window-sample.ndjson", import.meta.url)),
  };
}

function defaultCommandRunner(args: string[]): CommandRunnerResult {
  const info = getMacOSActiveWindowCollectorInfo();
  const result = spawnSync("swift", [info.scriptPath!, ...args], {
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

function parseLastJsonLine(output: string, failureLabel: string): string {
  const line = output
    .split(/\r?\n/u)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .at(-1);

  if (!line) {
    throw new Error(`macOS collector did not return ${failureLabel} output`);
  }

  return line;
}

export function createMacOSCollectorRunner(commandRunner: CommandRunner = defaultCommandRunner): {
  getPermissionStatus: (options?: { promptAccessibility?: boolean | undefined }) => MacOSCollectorPermissionStatus;
  captureOnce: (options?: { promptAccessibility?: boolean | undefined }) => RawEventInput;
} {
  function execute(args: string[]): string {
    const result = commandRunner(args);

    if (result.error) {
      throw new Error(`Failed to execute macOS collector: ${result.error.message}`);
    }

    if (result.status !== 0) {
      const detail = [result.stderr, result.stdout].find((value) => value.trim().length > 0);
      throw new Error(detail?.trim() ?? `macOS collector exited with status ${String(result.status)}`);
    }

    return result.stdout;
  }

  return {
    getPermissionStatus: (options = {}) =>
      JSON.parse(
        execute([
          "--check-permissions",
          "--json",
          ...(options.promptAccessibility ? ["--prompt-accessibility"] : []),
        ]),
      ) as MacOSCollectorPermissionStatus,
    captureOnce: (options = {}) =>
      coerceIncomingEvent(
        JSON.parse(
          parseLastJsonLine(
            execute(["--once", "--stdout", ...(options.promptAccessibility ? ["--prompt-accessibility"] : [])]),
            "event",
          ),
        ),
      ),
  };
}

export function resolveMacOSCollectorRunner(): ReturnType<typeof createMacOSCollectorRunner> {
  if (process.platform !== "darwin") {
    throw new Error("macOS collector runtime commands are only supported on macOS");
  }

  return createMacOSCollectorRunner();
}
