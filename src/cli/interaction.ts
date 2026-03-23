import { PromptSession, isInteractiveTerminal } from "./prompts.js";

export interface InteractiveCommandOptions {
  interactive?: boolean | undefined;
  nonInteractive?: boolean | undefined;
}

export function shouldUseInteractiveSession(
  options: InteractiveCommandOptions = {},
  input: NodeJS.ReadStream = process.stdin,
  output: NodeJS.WriteStream = process.stdout,
): boolean {
  if (options.interactive && options.nonInteractive) {
    throw new Error("Cannot combine --interactive and --non-interactive");
  }

  if (options.nonInteractive) {
    return false;
  }

  if (options.interactive) {
    return true;
  }

  return isInteractiveTerminal(input, output);
}

export function createPromptSessionForCommand(
  options: InteractiveCommandOptions = {},
  input: NodeJS.ReadStream = process.stdin,
  output: NodeJS.WriteStream = process.stdout,
): PromptSession | undefined {
  return shouldUseInteractiveSession(options, input, output)
    ? new PromptSession(input, output)
    : undefined;
}
