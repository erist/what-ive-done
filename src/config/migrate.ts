import {
  normalizeWidConfig,
  WID_CONFIG_VERSION,
  type WidConfig,
} from "./schema.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getConfigVersion(raw: unknown): number {
  if (!isRecord(raw)) {
    return 0;
  }

  if (typeof raw.version === "number" && Number.isInteger(raw.version)) {
    return raw.version;
  }

  if (typeof raw.version === "string") {
    const parsed = Number.parseInt(raw.version, 10);

    if (Number.isInteger(parsed)) {
      return parsed;
    }
  }

  return 0;
}

export function migrateConfig(dataDir: string, raw: unknown): WidConfig {
  const version = getConfigVersion(raw);

  if (version === 0) {
    return normalizeWidConfig(dataDir, raw);
  }

  if (version === WID_CONFIG_VERSION) {
    return normalizeWidConfig(dataDir, raw);
  }

  throw new Error(`Unknown config version: ${version}`);
}
