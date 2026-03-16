import { execFileSync } from "node:child_process";

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

export function resolveCredentialStore(): CredentialStore {
  if (process.platform === "darwin") {
    return createMacOSKeychainCredentialStore();
  }

  return createUnsupportedCredentialStore();
}
