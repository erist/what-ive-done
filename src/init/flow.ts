import { rmSync } from "node:fs";
import { resolve } from "node:path";

import { resolveAppPaths } from "../app-paths.js";
import { PromptSession } from "../cli/prompts.js";
import { ConfigManager } from "../config/manager.js";
import type { WidConfig } from "../config/schema.js";
import type { LLMProvider } from "../llm/catalog.js";
import { getDefaultLLMAuthMethod, getLLMProviderDescriptor } from "../llm/catalog.js";
import { updateLLMConfiguration } from "../llm/config.js";
import { runGoogleOAuthInteractiveLogin } from "../auth/google-oauth.js";
import { openSystemBrowser } from "../auth/browser.js";
import { setGeminiOAuthCredentials, setLLMApiKey } from "../credentials/llm.js";
import { resolveCredentialStore } from "../credentials/store.js";
import { ensureIngestAuthToken, maskIngestAuthToken } from "../server/security.js";
import { AppDatabase } from "../storage/database.js";
import { syncConfiguredAnalyzerTool } from "../tools/service.js";
import {
  detectClaude,
  detectGemini,
  detectGh,
  detectGit,
  detectGws,
  detectOpenai,
  type DetectionResult,
} from "../tools/detect.js";

export interface InitSummary {
  status: "initialized";
  dataDir: string;
  configPath: string;
  databasePath: string;
  authTokenPreview: string;
}

export interface InitPromptSession {
  text(question: string, defaultValue?: string): Promise<string>;
  confirm(question: string, defaultValue: boolean): Promise<boolean>;
  select(question: string, options: string[], defaultIndex?: number): Promise<string>;
  secret(question: string, defaultValue?: string): Promise<string>;
  close?(): void;
}

export interface RunInitOptions {
  prompts?: Pick<InitPromptSession, "confirm"> | undefined;
}

export interface RunInteractiveInitOptions {
  prompts?: InitPromptSession | undefined;
}

export const AUTO_DETECT_TOOLS = ["gws", "git", "gh"] as const;
export const EXPLICIT_PROMPT_TOOLS = ["gemini", "claude", "openai"] as const;

function withDatabase<T>(dataDir: string, fn: (database: AppDatabase) => T): T {
  const database = new AppDatabase(resolveAppPaths(dataDir));
  database.initialize();

  try {
    return fn(database);
  } finally {
    database.close();
  }
}

function initializeStorage(dataDir: string): InitSummary {
  const config = ConfigManager.initialize(dataDir);
  const paths = resolveAppPaths(config.dataDir);
  const authToken = withDatabase(config.dataDir, (database) => ensureIngestAuthToken(database));

  return {
    status: "initialized",
    dataDir: config.dataDir,
    configPath: ConfigManager.resolveConfigPath(config.dataDir),
    databasePath: paths.databasePath,
    authTokenPreview: maskIngestAuthToken(authToken),
  };
}

function resetDataDirStorage(dataDir: string): void {
  const paths = resolveAppPaths(dataDir);

  rmSync(paths.databasePath, { force: true });
  rmSync(paths.agentLockPath, { force: true });
}

async function maybeHandleExistingInitialization(
  dataDir: string,
  prompts?: Pick<InitPromptSession, "confirm">,
): Promise<"reconfigured" | "skipped" | "fresh"> {
  if (!ConfigManager.isInitialized(dataDir)) {
    return "fresh";
  }

  if (!prompts) {
    return "reconfigured";
  }

  process.stdout.write("Data directory already initialized.\n");

  const shouldReconfigure = await prompts.confirm("Reconfigure existing setup?", false);

  if (!shouldReconfigure) {
    return "skipped";
  }

  const shouldReset = await prompts.confirm(
    "Reset data? This will delete all collected events.",
    false,
  );

  if (shouldReset) {
    resetDataDirStorage(dataDir);
    process.stdout.write("Reset existing data.\n");
  }

  return "reconfigured";
}

function describeDetection(result: DetectionResult): string {
  if (!result.available) {
    return `not found${result.installHint ? ` (${result.installHint})` : ""}`;
  }

  const version = result.version ? `v${result.version}` : "available";
  const auth = result.authenticated ? "ready" : "not ready";
  const details = result.details ? `, ${result.details}` : "";
  return `${version}, ${auth}${details}`;
}

function loadConfig(dataDir: string): WidConfig {
  return ConfigManager.load(dataDir);
}

function saveConfig(config: WidConfig): WidConfig {
  return ConfigManager.save(config.dataDir, config);
}

function setToolConfig(config: WidConfig, toolName: string, value: Record<string, unknown>): WidConfig {
  config.tools[toolName] = {
    added: true,
    ...value,
  };

  return saveConfig(config);
}

async function maybeConfigureExistingLLM(
  dataDir: string,
  prompts: InitPromptSession,
): Promise<LLMProvider | undefined> {
  if (!(await prompts.confirm("Set a default LLM from already available credentials?", false))) {
    return undefined;
  }

  const detections = await Promise.all([
    detectGemini(),
    detectClaude(),
    detectOpenai(),
  ]);
  const availableProviders = detections.filter((detection) => detection.authenticated);

  if (availableProviders.length === 0) {
    process.stdout.write("No LLM credentials were detected. Skip for now and configure it in a later milestone.\n");
    return undefined;
  }

  const provider = await prompts.select(
    "Choose the default LLM provider",
    availableProviders.map((detection) => detection.name),
  ) as LLMProvider;
  const selectedDetection = availableProviders.find((detection) => detection.name === provider);
  const authMethod = selectedDetection?.authMethod ?? getDefaultLLMAuthMethod(provider);
  const model = await prompts.text(
    "Model",
    getLLMProviderDescriptor(provider).defaultModel,
  );

  withDatabase(dataDir, (database) => {
    updateLLMConfiguration(database, {
      provider,
      authMethod,
      model,
    });
  });
  syncConfiguredAnalyzerTool({
    dataDir,
    provider,
    authMethod,
    model,
  });

  process.stdout.write(`Configured default LLM: ${provider} (${authMethod})\n`);
  return provider;
}

async function maybeConfigureFreshLLM(
  dataDir: string,
  prompts: InitPromptSession,
): Promise<LLMProvider | undefined> {
  if (!(await prompts.confirm("Configure a new LLM credential now?", false))) {
    return undefined;
  }

  const provider = await prompts.select("Choose an LLM provider", ["gemini", "claude", "openai"]) as LLMProvider;
  const descriptor = getLLMProviderDescriptor(provider);
  const authMethod = descriptor.supportedAuthMethods.length === 1
    ? descriptor.supportedAuthMethods[0]!
    : await prompts.select("Authentication method", descriptor.supportedAuthMethods) as "api-key" | "oauth2";

  if (authMethod === "oauth2") {
    const credentialStore = resolveCredentialStore();

    if (!credentialStore.isSupported()) {
      throw new Error("Secure credential storage is required for OAuth login on this platform");
    }

    const clientId = await prompts.text("Google OAuth client id", process.env.GOOGLE_CLIENT_ID);
    const clientSecret = await prompts.secret("Google OAuth client secret", process.env.GOOGLE_CLIENT_SECRET);
    const projectId = await prompts.text("Google Cloud project id", process.env.GOOGLE_CLOUD_PROJECT);
    const credentials = await runGoogleOAuthInteractiveLogin({
      clientId,
      clientSecret,
      projectId,
      port: 0,
      openBrowser: openSystemBrowser,
    });

    setGeminiOAuthCredentials(credentialStore, credentials);

    withDatabase(dataDir, (database) => {
      updateLLMConfiguration(database, {
        provider,
        authMethod,
        googleProjectId: credentials.projectId,
        model: getLLMProviderDescriptor(provider).defaultModel,
      });
    });
    syncConfiguredAnalyzerTool({
      dataDir,
      provider,
      authMethod,
      model: getLLMProviderDescriptor(provider).defaultModel,
      projectId: credentials.projectId,
    });
  } else {
    const credentialStore = resolveCredentialStore();

    if (!credentialStore.isSupported()) {
      throw new Error("Secure credential storage is not supported on this platform yet");
    }

    const apiKey = await prompts.secret(`${provider} API key`);
    setLLMApiKey(credentialStore, provider, apiKey);

    withDatabase(dataDir, (database) => {
      updateLLMConfiguration(database, {
        provider,
        authMethod,
        model: getLLMProviderDescriptor(provider).defaultModel,
      });
    });
    syncConfiguredAnalyzerTool({
      dataDir,
      provider,
      authMethod,
      model: getLLMProviderDescriptor(provider).defaultModel,
    });
  }

  process.stdout.write(`Configured default LLM: ${provider} (${authMethod})\n`);
  return provider;
}

async function runInteractiveInitWithPrompts(
  initialDataDir: string | undefined,
  prompts: InitPromptSession,
  shouldClosePrompts: boolean,
): Promise<InitSummary> {
  const suggestedDataDir =
    initialDataDir ??
    ConfigManager.findDataDir() ??
    resolveAppPaths().dataDir;

  try {
    const requestedDataDir = await prompts.text("Step 1: Data directory", suggestedDataDir);
    const resolvedDataDir = resolve(requestedDataDir);
    const existingInitResult = await maybeHandleExistingInitialization(resolvedDataDir, prompts);
    const summary = initializeStorage(resolvedDataDir);

    process.stdout.write(`${existingInitResult === "fresh" ? "Created" : "Using"} ${summary.configPath}\n`);
    process.stdout.write(`Generated ingest token: ${summary.authTokenPreview}\n`);

    if (existingInitResult === "skipped") {
      process.stdout.write("Setup complete.\n");
      return summary;
    }

    process.stdout.write("Scanning environment...\n");

    const [gws, git, gh] = await Promise.all([
      detectGws(),
      detectGit(process.cwd()),
      detectGh(),
    ]);

    process.stdout.write(`  gws: ${describeDetection(gws)}\n`);
    process.stdout.write(`  git: ${describeDetection(git)}\n`);
    process.stdout.write(`  gh: ${describeDetection(gh)}\n`);

    let config = loadConfig(summary.dataDir);

    if (gws.available && await prompts.confirm("Add gws context collector?", true)) {
      config = setToolConfig(config, "gws", {
        "calendar-id": "primary",
      });
      process.stdout.write("Added gws collector.\n");
    }

    if (git.available) {
      const defaultRepoPath = git.authenticated && git.details ? git.details : process.cwd();
      const shouldAddGit = await prompts.confirm("Add git context collector?", true);

      if (shouldAddGit) {
        const repoPath = await prompts.text("Git repo path", defaultRepoPath);
        config = setToolConfig(config, "git", {
          "repo-path": resolve(repoPath),
        });
        process.stdout.write(`Added git collector (${resolve(repoPath)}).\n`);
      }
    }

    if (gh.available && await prompts.confirm("Add GitHub CLI context collector?", true)) {
      config = setToolConfig(config, "gh", {});
      process.stdout.write("Added gh collector.\n");
    }

    await maybeConfigureExistingLLM(summary.dataDir, prompts) ??
      await maybeConfigureFreshLLM(summary.dataDir, prompts);

    process.stdout.write("Setup complete.\n");
    return summary;
  } finally {
    if (shouldClosePrompts) {
      prompts.close?.();
    }
  }
}

export async function runInteractiveInit(
  initialDataDir?: string,
  options: RunInteractiveInitOptions = {},
): Promise<InitSummary> {
  const prompts = options.prompts ?? new PromptSession();
  return runInteractiveInitWithPrompts(initialDataDir, prompts, options.prompts === undefined);
}

export async function runInit(
  initialDataDir?: string,
  options: RunInitOptions = {},
): Promise<InitSummary> {
  const dataDir =
    initialDataDir ??
    ConfigManager.findDataDir() ??
    resolveAppPaths().dataDir;
  const resolvedDataDir = resolve(dataDir);

  await maybeHandleExistingInitialization(resolvedDataDir, options.prompts);
  return initializeStorage(resolvedDataDir);
}
