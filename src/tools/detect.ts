import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";

import {
  getGeminiOAuthCredentials,
  getOpenAICodexOAuthCredentials,
  hasGeminiOAuthCredentials,
  hasLLMApiKey,
} from "../credentials/llm.js";
import type { CredentialStore } from "../credentials/store.js";
import { resolveCredentialStore } from "../credentials/store.js";
import {
  getLLMProviderDescriptor,
  type LLMAuthMethod,
  type LLMProvider,
} from "../llm/catalog.js";
import {
  buildGWSCollectorStatusBase,
  describeCommandFailure,
  isMissingBinaryError,
} from "../collectors/gws-shared.js";

export interface DetectionResult {
  name: string;
  available: boolean;
  authenticated: boolean;
  version?: string | undefined;
  details?: string | undefined;
  installHint?: string | undefined;
  authMethod?: LLMAuthMethod | undefined;
}

interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error | undefined;
}

interface DetectCommandOptions {
  execRunner?: ExecRunner | undefined;
}

interface AnalyzerDetectOptions {
  credentialStore?: CredentialStore | undefined;
  env?: NodeJS.ProcessEnv | undefined;
}

type ExecRunner = (command: string, args: string[]) => CommandResult;

function defaultExecRunner(command: string, args: string[]): CommandResult {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error ?? undefined,
  };
}

function parseVersion(output: string, fallbackCommand: string): string | undefined {
  const firstLine = output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  if (!firstLine) {
    return undefined;
  }

  return firstLine
    .replace(new RegExp(`^${fallbackCommand}\\s+version\\s+`, "iu"), "")
    .replace(new RegExp(`^${fallbackCommand}\\s+`, "iu"), "");
}

function findGitDirectory(startDir: string): string | null {
  let currentDir = resolve(startDir);
  const { root } = parse(currentDir);

  while (true) {
    if (existsSync(join(currentDir, ".git"))) {
      return currentDir;
    }

    if (currentDir === root) {
      return null;
    }

    currentDir = dirname(currentDir);
  }
}

function detectCommandVersion(
  command: string,
  versionArgs: string[],
  options: DetectCommandOptions = {},
): CommandResult {
  const execRunner = options.execRunner ?? defaultExecRunner;
  return execRunner(command, versionArgs);
}

function detectEnvApiKey(
  provider: LLMProvider,
  env: NodeJS.ProcessEnv,
): string | undefined {
  const descriptor = getLLMProviderDescriptor(provider);

  return descriptor.apiKeyEnvVars.find((name) => env[name]?.trim().length);
}

function detectApiKeyBackedProvider(
  provider: LLMProvider,
  options: AnalyzerDetectOptions = {},
): DetectionResult {
  const credentialStore = options.credentialStore ?? resolveCredentialStore();
  const env = options.env ?? process.env;
  const hasStoredKey = hasLLMApiKey(credentialStore, provider);
  const envVar = detectEnvApiKey(provider, env);
  const descriptor = getLLMProviderDescriptor(provider);

  if (hasStoredKey) {
    return {
      name: provider,
      available: true,
      authenticated: true,
      details: `API key stored in ${credentialStore.backend}`,
      authMethod: "api-key",
    };
  }

  if (envVar) {
    return {
      name: provider,
      available: true,
      authenticated: true,
      details: `API key available via ${envVar}`,
      authMethod: "api-key",
    };
  }

  return {
    name: provider,
    available: credentialStore.isSupported(),
    authenticated: false,
    details: credentialStore.isSupported()
      ? `No ${provider} API key configured yet`
      : "Secure credential storage is not supported on this platform",
    installHint: credentialStore.isSupported()
      ? `Run credential:set ${provider}`
      : `Set one of ${descriptor.apiKeyEnvVars.join(", ")} in the environment`,
    authMethod: "api-key",
  };
}

export async function detectGws(options: DetectCommandOptions = {}): Promise<DetectionResult> {
  const versionResult = detectCommandVersion("gws", ["--version"], options);

  if (isMissingBinaryError(versionResult.error)) {
    return {
      name: "gws",
      available: false,
      authenticated: false,
      installHint: "Install the gws CLI and make it available on PATH",
    };
  }

  if (versionResult.status !== 0) {
    return {
      name: "gws",
      available: false,
      authenticated: false,
      details: describeCommandFailure(versionResult, "gws --version failed"),
      installHint: "Install the gws CLI and make it available on PATH",
    };
  }

  const status = buildGWSCollectorStatusBase({
    collector: "gws",
    requiredScopes: ["https://www.googleapis.com/auth/calendar.readonly"],
    missingScopeDetail: "gws auth is missing a Calendar scope",
    commandRunner: (args) => {
      const execRunner = options.execRunner ?? defaultExecRunner;
      return execRunner("gws", args);
    },
  });

  return {
    name: "gws",
    available: true,
    authenticated: status.ready,
    version: parseVersion(
      [versionResult.stdout, versionResult.stderr].filter(Boolean).join("\n"),
      "gws",
    ),
    details: status.user ?? status.detail,
    installHint: status.installed ? undefined : "Install the gws CLI and make it available on PATH",
  };
}

export async function detectGitRepo(startDir: string): Promise<string | null> {
  return findGitDirectory(startDir);
}

export async function detectGit(
  startDir = process.cwd(),
  options: DetectCommandOptions = {},
): Promise<DetectionResult> {
  const versionResult = detectCommandVersion("git", ["--version"], options);

  if (isMissingBinaryError(versionResult.error)) {
    return {
      name: "git",
      available: false,
      authenticated: false,
      installHint: "Install Git and make it available on PATH",
    };
  }

  if (versionResult.status !== 0) {
    return {
      name: "git",
      available: false,
      authenticated: false,
      details: describeCommandFailure(versionResult, "git --version failed"),
      installHint: "Install Git and make it available on PATH",
    };
  }

  const repoPath = await detectGitRepo(startDir);

  return {
    name: "git",
    available: true,
    authenticated: repoPath !== null,
    version: parseVersion(
      [versionResult.stdout, versionResult.stderr].filter(Boolean).join("\n"),
      "git",
    ),
    details: repoPath ?? "No .git directory found from the current working tree",
  };
}

export async function detectGh(options: DetectCommandOptions = {}): Promise<DetectionResult> {
  const execRunner = options.execRunner ?? defaultExecRunner;
  const versionResult = detectCommandVersion("gh", ["--version"], options);

  if (isMissingBinaryError(versionResult.error)) {
    return {
      name: "gh",
      available: false,
      authenticated: false,
      installHint: "Install GitHub CLI from https://cli.github.com/",
    };
  }

  if (versionResult.status !== 0) {
    return {
      name: "gh",
      available: false,
      authenticated: false,
      details: describeCommandFailure(versionResult, "gh --version failed"),
      installHint: "Install GitHub CLI from https://cli.github.com/",
    };
  }

  const authResult = execRunner("gh", ["auth", "status"]);
  const authOutput = [authResult.stdout, authResult.stderr].filter(Boolean).join("\n");
  const whoamiMatch = authOutput.match(/logged in to [^\s]+ as ([^\s]+)/iu);

  return {
    name: "gh",
    available: true,
    authenticated: authResult.status === 0,
    version: parseVersion(
      [versionResult.stdout, versionResult.stderr].filter(Boolean).join("\n"),
      "gh",
    ),
    details:
      whoamiMatch?.[1] ??
      (authResult.status === 0 ? "GitHub CLI is authenticated" : describeCommandFailure(authResult, "gh auth status failed")),
  };
}

export async function detectGemini(options: AnalyzerDetectOptions = {}): Promise<DetectionResult> {
  const credentialStore = options.credentialStore ?? resolveCredentialStore();
  const env = options.env ?? process.env;
  const hasOAuthCredentials = hasGeminiOAuthCredentials(credentialStore);
  const envVar = detectEnvApiKey("gemini", env);
  const hasStoredApiKey = hasLLMApiKey(credentialStore, "gemini");

  if (hasOAuthCredentials) {
    const credentials = getGeminiOAuthCredentials(credentialStore);

    return {
      name: "gemini",
      available: true,
      authenticated: true,
      details: credentials?.projectId
        ? `OAuth2 configured (${credentials.projectId})`
        : `OAuth2 configured in ${credentialStore.backend}`,
      authMethod: "oauth2",
    };
  }

  if (hasStoredApiKey) {
    return {
      name: "gemini",
      available: true,
      authenticated: true,
      details: `API key stored in ${credentialStore.backend}`,
      authMethod: "api-key",
    };
  }

  if (envVar) {
    return {
      name: "gemini",
      available: true,
      authenticated: true,
      details: `API key available via ${envVar}`,
      authMethod: "api-key",
    };
  }

  return {
    name: "gemini",
    available: credentialStore.isSupported(),
    authenticated: false,
    details: credentialStore.isSupported()
      ? "No Gemini credentials configured yet"
      : "Secure credential storage is not supported on this platform",
    installHint: credentialStore.isSupported()
      ? "Run auth:login gemini or credential:set gemini"
      : "Set GEMINI_API_KEY or GOOGLE_API_KEY in the environment",
  };
}

export async function detectClaude(options: AnalyzerDetectOptions = {}): Promise<DetectionResult> {
  return detectApiKeyBackedProvider("claude", options);
}

export async function detectOpenai(options: AnalyzerDetectOptions = {}): Promise<DetectionResult> {
  return detectApiKeyBackedProvider("openai", options);
}

export async function detectOpenaiCodex(
  options: AnalyzerDetectOptions = {},
): Promise<DetectionResult> {
  const credentialStore = options.credentialStore ?? resolveCredentialStore();
  const credentials = getOpenAICodexOAuthCredentials(credentialStore);

  if (credentials) {
    return {
      name: "openai-codex",
      available: true,
      authenticated: true,
      details: credentials.expiresAt
        ? `${credentials.email ?? "OAuth credentials stored"} (expires ${credentials.expiresAt})`
        : (credentials.email ?? "OAuth credentials stored"),
      authMethod: "oauth2",
    };
  }

  return {
    name: "openai-codex",
    available: credentialStore.isSupported(),
    authenticated: false,
    details: credentialStore.isSupported()
      ? "No OpenAI Codex OAuth credentials configured yet"
      : "Secure credential storage is not supported on this platform",
    installHint: credentialStore.isSupported()
      ? "Run auth:login openai-codex"
      : "Secure credential storage is required for OAuth login on this platform",
    authMethod: "oauth2",
  };
}
