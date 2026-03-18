import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";

import {
  createDefaultWidConfig,
  normalizeWidConfig,
  WID_CONFIG_FILE_NAME,
  WID_DIRECTORY_NAME,
  type WidConfig,
} from "./schema.js";
import { getConfigVersion, migrateConfig } from "./migrate.js";

const FORBIDDEN_CONFIG_KEYS = [
  /^api[-_]?key$/iu,
  /^access[-_]?token$/iu,
  /^refresh[-_]?token$/iu,
  /^token$/iu,
  /^secret$/iu,
  /^client[-_]?secret$/iu,
  /^password$/iu,
  /^credential$/iu,
  /^credentials$/iu,
];

function resolveDataDirCandidate(dataDir: string): string {
  const trimmed = dataDir.trim();

  if (trimmed.length === 0) {
    throw new Error("Data directory must not be empty");
  }

  return resolve(trimmed);
}

function getByPath(record: Record<string, unknown>, key: string): unknown {
  let current: unknown = record;

  for (const segment of key.split(".").filter((part) => part.length > 0)) {
    if (typeof current !== "object" || current === null || Array.isArray(current)) {
      return undefined;
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

function deleteEmptyAncestors(record: Record<string, unknown>, segments: string[]): void {
  for (let index = segments.length - 1; index > 0; index -= 1) {
    const parentPath = segments.slice(0, index);
    const parent = getByPath(record, parentPath.join("."));

    if (typeof parent !== "object" || parent === null || Array.isArray(parent)) {
      continue;
    }

    const childKey = segments[index] ?? "";
    const childValue = (parent as Record<string, unknown>)[childKey];

    if (
      typeof childValue === "object" &&
      childValue !== null &&
      !Array.isArray(childValue) &&
      Object.keys(childValue).length === 0
    ) {
      delete (parent as Record<string, unknown>)[childKey];
    }
  }
}

function setByPath(record: Record<string, unknown>, key: string, value: unknown): void {
  const segments = key.split(".").filter((part) => part.length > 0);

  if (segments.length === 0) {
    throw new Error("Config key must not be empty");
  }

  let current = record;

  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index] ?? "";
    const existing = current[segment];

    if (typeof existing !== "object" || existing === null || Array.isArray(existing)) {
      current[segment] = {};
    }

    current = current[segment] as Record<string, unknown>;
  }

  const leaf = segments.at(-1) ?? "";

  if (value === undefined) {
    delete current[leaf];
    deleteEmptyAncestors(record, segments);
    return;
  }

  current[leaf] = value;
}

function assertNoCredentialKeys(value: unknown, path: string[] = []): void {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    if (FORBIDDEN_CONFIG_KEYS.some((pattern) => pattern.test(key))) {
      const keyPath = [...path, key].join(".");
      throw new Error(`Config must not store credential material: ${keyPath}`);
    }

    assertNoCredentialKeys(nestedValue, [...path, key]);
  }
}

function findDataDirByWalkingUp(startDir: string): string | null {
  let currentDir = resolve(startDir);
  const { root } = parse(currentDir);

  while (true) {
    const widDirectoryPath = join(currentDir, WID_DIRECTORY_NAME);

    if (existsSync(widDirectoryPath)) {
      return currentDir;
    }

    if (currentDir === root) {
      return null;
    }

    currentDir = dirname(currentDir);
  }
}

export class ConfigManager {
  static findDataDir(explicit?: string): string | null {
    if (explicit && explicit.trim().length > 0) {
      return resolveDataDirCandidate(explicit);
    }

    const envDataDir = process.env.WID_DATA_DIR;

    if (envDataDir && envDataDir.trim().length > 0) {
      return resolveDataDirCandidate(envDataDir);
    }

    return findDataDirByWalkingUp(process.cwd());
  }

  static resolveDataDir(explicit?: string): string {
    const dataDir = ConfigManager.findDataDir(explicit);

    if (!dataDir) {
      throw new Error("No data directory found. Run: wid init <path>");
    }

    return dataDir;
  }

  static resolveDirectoryPath(dataDir: string): string {
    return join(resolveDataDirCandidate(dataDir), WID_DIRECTORY_NAME);
  }

  static resolveConfigPath(dataDir: string): string {
    return join(ConfigManager.resolveDirectoryPath(dataDir), WID_CONFIG_FILE_NAME);
  }

  static isInitialized(dataDir: string): boolean {
    return existsSync(ConfigManager.resolveConfigPath(dataDir));
  }

  static load(dataDir: string): WidConfig {
    const resolvedDataDir = resolveDataDirCandidate(dataDir);
    const configPath = ConfigManager.resolveConfigPath(resolvedDataDir);

    if (!existsSync(configPath)) {
      return createDefaultWidConfig(resolvedDataDir);
    }

    const raw = JSON.parse(readFileSync(configPath, "utf8")) as unknown;
    const migrated = migrateConfig(resolvedDataDir, raw);

    if (getConfigVersion(raw) !== migrated.version) {
      ConfigManager.save(resolvedDataDir, migrated);
    }

    return migrated;
  }

  static save(dataDir: string, config: WidConfig): WidConfig {
    const resolvedDataDir = resolveDataDirCandidate(dataDir);
    const normalizedConfig = normalizeWidConfig(resolvedDataDir, config);

    assertNoCredentialKeys(normalizedConfig);
    mkdirSync(ConfigManager.resolveDirectoryPath(resolvedDataDir), { recursive: true });
    writeFileSync(
      ConfigManager.resolveConfigPath(resolvedDataDir),
      `${JSON.stringify(normalizedConfig, null, 2)}\n`,
      "utf8",
    );

    return normalizedConfig;
  }

  static initialize(dataDir: string): WidConfig {
    return ConfigManager.save(dataDir, ConfigManager.load(dataDir));
  }

  static set(dataDir: string, key: string, value: unknown): WidConfig {
    const nextConfig = ConfigManager.load(dataDir) as unknown as Record<string, unknown>;

    setByPath(nextConfig, key, value);
    return ConfigManager.save(dataDir, nextConfig as unknown as WidConfig);
  }

  static get(dataDir: string, key: string): unknown {
    return getByPath(ConfigManager.load(dataDir) as unknown as Record<string, unknown>, key);
  }
}
