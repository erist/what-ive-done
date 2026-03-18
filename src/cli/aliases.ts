export const CLI_ALIASES: Record<string, string> = {
  up: "agent:run",
  restart: "agent:restart",
  stop: "agent:stop",
  status: "agent:health",
  report: "report",
  compare: "report:compare",
  trace: "debug:trace:workflow",
  coverage: "action:coverage",
  viewer: "viewer:open",
  token: "ingest:token",
};

const COMMAND_OPTION_ALIASES: Record<string, Record<string, string>> = {
  "agent:run": {
    "--open": "--open-viewer",
    "--no-gws": "--disable-gws",
  },
  "agent:restart": {
    "--open": "--open-viewer",
    "--no-gws": "--disable-gws",
  },
};

export function normalizeCliArgv(argv: readonly string[]): string[] {
  const normalized = [...argv];

  if (normalized.length > 1) {
    normalized[1] = "wid";
  }

  if (normalized.length < 3) {
    return normalized;
  }

  const commandName = normalized[2];

  if (!commandName) {
    return normalized;
  }

  const resolvedCommandName = CLI_ALIASES[commandName] ?? commandName;
  const optionAliases = COMMAND_OPTION_ALIASES[resolvedCommandName];

  if (!optionAliases) {
    return normalized;
  }

  for (let index = 3; index < normalized.length; index += 1) {
    const argument = normalized[index];

    if (argument && optionAliases[argument]) {
      normalized[index] = optionAliases[argument];
    }
  }

  return normalized;
}
