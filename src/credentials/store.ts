import { execFileSync } from "node:child_process";

const OPENAI_SERVICE_NAME = "what-ive-done.openai";
const OPENAI_ACCOUNT_NAME = "default";

export interface CredentialStore {
  backend: string;
  isSupported(): boolean;
  hasOpenAIKey(): boolean;
  getOpenAIKey(): string | undefined;
  setOpenAIKey(apiKey: string): void;
  deleteOpenAIKey(): void;
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
    hasOpenAIKey: () => false,
    getOpenAIKey: () => undefined,
    setOpenAIKey: () => {
      throw new Error("Secure credential storage is not supported on this platform yet");
    },
    deleteOpenAIKey: () => {
      throw new Error("Secure credential storage is not supported on this platform yet");
    },
  };
}

export function createMacOSKeychainCredentialStore(execRunner: ExecRunner = defaultExecRunner): CredentialStore {
  const baseArgs = ["-s", OPENAI_SERVICE_NAME, "-a", OPENAI_ACCOUNT_NAME];

  function find(): string | undefined {
    try {
      return execRunner("security", ["find-generic-password", "-w", ...baseArgs]).trim();
    } catch {
      return undefined;
    }
  }

  return {
    backend: "macos-keychain",
    isSupported: () => true,
    hasOpenAIKey: () => Boolean(find()),
    getOpenAIKey: () => find(),
    setOpenAIKey: (apiKey: string) => {
      execRunner("security", ["add-generic-password", "-U", "-w", apiKey, ...baseArgs]);
    },
    deleteOpenAIKey: () => {
      try {
        execRunner("security", ["delete-generic-password", ...baseArgs]);
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
