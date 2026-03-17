import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { resolveDefaultDataDir } from "../app-paths.js";

const DEFAULT_ACCOUNT_NAME = "default";

export interface CredentialStore {
  backend: string;
  isSupported(): boolean;
  hasSecret(serviceName: string, accountName?: string): boolean;
  getSecret(serviceName: string, accountName?: string): string | undefined;
  setSecret(serviceName: string, secret: string, accountName?: string): void;
  deleteSecret(serviceName: string, accountName?: string): void;
}

interface ExecRunner {
  (file: string, args: string[]): string;
}

function defaultExecRunner(file: string, args: string[]): string {
  return execFileSync(file, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function createUnsupportedCredentialStore(): CredentialStore {
  return {
    backend: "unsupported",
    isSupported: () => false,
    hasSecret: () => false,
    getSecret: () => undefined,
    setSecret: () => {
      throw new Error("Secure credential storage is not supported on this platform yet");
    },
    deleteSecret: () => {
      throw new Error("Secure credential storage is not supported on this platform yet");
    },
  };
}

export function createMacOSKeychainCredentialStore(execRunner: ExecRunner = defaultExecRunner): CredentialStore {
  function find(serviceName: string, accountName = DEFAULT_ACCOUNT_NAME): string | undefined {
    const baseArgs = ["-s", serviceName, "-a", accountName];

    try {
      return execRunner("security", ["find-generic-password", "-w", ...baseArgs]).trim();
    } catch {
      return undefined;
    }
  }

  return {
    backend: "macos-keychain",
    isSupported: () => true,
    hasSecret: (serviceName: string, accountName?: string) =>
      Boolean(find(serviceName, accountName)),
    getSecret: (serviceName: string, accountName?: string) => find(serviceName, accountName),
    setSecret: (serviceName: string, secret: string, accountName?: string) => {
      execRunner("security", [
        "add-generic-password",
        "-U",
        "-w",
        secret,
        "-s",
        serviceName,
        "-a",
        accountName ?? DEFAULT_ACCOUNT_NAME,
      ]);
    },
    deleteSecret: (serviceName: string, accountName?: string) => {
      try {
        execRunner("security", [
          "delete-generic-password",
          "-s",
          serviceName,
          "-a",
          accountName ?? DEFAULT_ACCOUNT_NAME,
        ]);
      } catch {
        return;
      }
    },
  };
}

function resolveWindowsCredentialStoreDir(): string {
  return join(resolveDefaultDataDir(), "credentials");
}

function encodeCredentialPathPart(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function resolveWindowsCredentialPath(
  baseDir: string,
  serviceName: string,
  accountName: string,
): string {
  return join(
    baseDir,
    `${encodeCredentialPathPart(serviceName)}--${encodeCredentialPathPart(accountName)}.json`,
  );
}

function protectWindowsSecret(secret: string, execRunner: ExecRunner): string {
  return execRunner("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "[Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Protect([System.Text.Encoding]::UTF8.GetBytes($args[0]), $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser))",
    secret,
  ]).trim();
}

function unprotectWindowsSecret(encryptedSecret: string, execRunner: ExecRunner): string {
  return execRunner("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "[System.Text.Encoding]::UTF8.GetString([System.Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($args[0]), $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser))",
    encryptedSecret,
  ]).trim();
}

export function createWindowsDPAPICredentialStore(
  execRunner: ExecRunner = defaultExecRunner,
  baseDir = resolveWindowsCredentialStoreDir(),
): CredentialStore {
  function readEncryptedRecord(
    serviceName: string,
    accountName = DEFAULT_ACCOUNT_NAME,
  ): { encryptedSecret: string } | undefined {
    const recordPath = resolveWindowsCredentialPath(baseDir, serviceName, accountName);

    if (!existsSync(recordPath)) {
      return undefined;
    }

    try {
      return JSON.parse(readFileSync(recordPath, "utf8")) as { encryptedSecret: string };
    } catch {
      return undefined;
    }
  }

  return {
    backend: "windows-dpapi",
    isSupported: () => true,
    hasSecret: (serviceName: string, accountName?: string) =>
      readEncryptedRecord(serviceName, accountName)?.encryptedSecret !== undefined,
    getSecret: (serviceName: string, accountName?: string) => {
      const record = readEncryptedRecord(serviceName, accountName);

      if (!record?.encryptedSecret) {
        return undefined;
      }

      try {
        return unprotectWindowsSecret(record.encryptedSecret, execRunner);
      } catch {
        return undefined;
      }
    },
    setSecret: (serviceName: string, secret: string, accountName?: string) => {
      const resolvedAccountName = accountName ?? DEFAULT_ACCOUNT_NAME;
      const recordPath = resolveWindowsCredentialPath(baseDir, serviceName, resolvedAccountName);

      mkdirSync(baseDir, { recursive: true });
      writeFileSync(
        recordPath,
        JSON.stringify(
          {
            serviceName,
            accountName: resolvedAccountName,
            encryptedSecret: protectWindowsSecret(secret, execRunner),
            updatedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
        "utf8",
      );
    },
    deleteSecret: (serviceName: string, accountName?: string) => {
      rmSync(resolveWindowsCredentialPath(baseDir, serviceName, accountName ?? DEFAULT_ACCOUNT_NAME), {
        force: true,
      });
    },
  };
}

export function resolveCredentialStore(): CredentialStore {
  if (process.platform === "darwin") {
    return createMacOSKeychainCredentialStore();
  }

  if (process.platform === "win32") {
    return createWindowsDPAPICredentialStore();
  }

  return createUnsupportedCredentialStore();
}
