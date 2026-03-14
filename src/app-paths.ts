import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface AppPaths {
  dataDir: string;
  databasePath: string;
}

const APP_NAME = "what-ive-done";
const DATABASE_FILE = `${APP_NAME}.sqlite`;

export function resolveDefaultDataDir(): string {
  if (process.platform === "win32") {
    return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), APP_NAME);
  }

  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", APP_NAME);
  }

  return join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), APP_NAME);
}

export function resolveAppPaths(dataDir = resolveDefaultDataDir()): AppPaths {
  return {
    dataDir,
    databasePath: join(dataDir, DATABASE_FILE),
  };
}

export function ensureAppPaths(paths: AppPaths): void {
  mkdirSync(dirname(paths.databasePath), { recursive: true });
  mkdirSync(paths.dataDir, { recursive: true });
}
