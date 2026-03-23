import type { InitPromptSession, InitSummary } from "../init/flow.js";
import { runInit, runInteractiveInit } from "../init/flow.js";

export interface RunSetupOptions {
  prompts?: InitPromptSession | undefined;
}

export async function runSetup(
  initialDataDir?: string,
  options: RunSetupOptions = {},
): Promise<InitSummary> {
  if (options.prompts) {
    return runInteractiveInit(initialDataDir, {
      prompts: options.prompts,
    });
  }

  return runInit(initialDataDir);
}

export function isMissingDataDirError(error: unknown): error is Error {
  return error instanceof Error && error.message.startsWith("No data directory found.");
}
