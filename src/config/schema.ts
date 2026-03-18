import { resolve } from "node:path";

export const WID_CONFIG_VERSION = 1;
export const WID_DIRECTORY_NAME = ".wid";
export const WID_CONFIG_FILE_NAME = "config.json";
export const DEFAULT_WID_SERVER_HOST = "127.0.0.1";
export const DEFAULT_WID_SERVER_PORT = 4318;

export interface WidToolConfig {
  added: boolean;
  [key: string]: unknown;
}

export interface WidConfig {
  version: 1;
  dataDir: string;
  tools: Record<string, WidToolConfig>;
  llm: {
    default?: string | undefined;
  };
  server: {
    host: string;
    port: number;
  };
  agent: {
    verbose: boolean;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizePort(value: unknown): number {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);

    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }

  return DEFAULT_WID_SERVER_PORT;
}

function normalizeTools(value: unknown): Record<string, WidToolConfig> {
  if (!isRecord(value)) {
    return {};
  }

  const tools = Object.entries(value).flatMap(([toolName, toolConfig]) => {
    if (!isRecord(toolConfig)) {
      return [];
    }

    return [
      [
        toolName,
        {
          ...toolConfig,
          added: toolConfig.added === true,
        } satisfies WidToolConfig,
      ] as const,
    ];
  });

  return Object.fromEntries(tools);
}

export function createDefaultWidConfig(dataDir: string): WidConfig {
  return {
    version: WID_CONFIG_VERSION,
    dataDir: resolve(dataDir),
    tools: {},
    llm: {},
    server: {
      host: DEFAULT_WID_SERVER_HOST,
      port: DEFAULT_WID_SERVER_PORT,
    },
    agent: {
      verbose: false,
    },
  };
}

export function normalizeWidConfig(dataDir: string, raw: unknown): WidConfig {
  const defaults = createDefaultWidConfig(dataDir);
  const candidate = isRecord(raw) ? raw : {};
  const llm = isRecord(candidate.llm) ? candidate.llm : {};
  const server = isRecord(candidate.server) ? candidate.server : {};
  const agent = isRecord(candidate.agent) ? candidate.agent : {};

  return {
    version: WID_CONFIG_VERSION,
    dataDir: defaults.dataDir,
    tools: normalizeTools(candidate.tools),
    llm: {
      default: normalizeOptionalString(llm.default),
    },
    server: {
      host: normalizeOptionalString(server.host) ?? DEFAULT_WID_SERVER_HOST,
      port: normalizePort(server.port),
    },
    agent: {
      verbose: agent.verbose === true,
    },
  };
}
