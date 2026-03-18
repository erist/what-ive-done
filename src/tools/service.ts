import { DEFAULT_GWS_CALENDAR_ID } from "../collectors/gws-calendar.js";
import { getGitContextCollectorStatus } from "../collectors/git-context.js";
import { resolveAppPaths } from "../app-paths.js";
import { openSystemBrowser } from "../auth/browser.js";
import {
  DEFAULT_OPENAI_CODEX_ISSUER,
  runOpenAICodexOAuthInteractiveLogin,
} from "../auth/openai-oauth.js";
import {
  refreshGoogleOAuthCredentials,
  runGoogleOAuthInteractiveLogin,
} from "../auth/google-oauth.js";
import { ConfigManager } from "../config/manager.js";
import {
  deleteOpenAICodexOAuthCredentials,
  deleteGeminiOAuthCredentials,
  deleteLLMApiKey,
  getGeminiOAuthCredentials,
  getOpenAICodexOAuthCredentials,
  setOpenAICodexOAuthCredentials,
  setGeminiOAuthCredentials,
  setLLMApiKey,
} from "../credentials/llm.js";
import type { CredentialStore } from "../credentials/store.js";
import { resolveCredentialStore } from "../credentials/store.js";
import type { WidConfig, WidToolConfig } from "../config/schema.js";
import {
  getDefaultLLMAuthMethod,
  getLLMProviderDescriptor,
  normalizeLLMAuthMethod,
  type LLMAuthMethod,
  type LLMProvider,
} from "../llm/catalog.js";
import {
  getDefaultLLMConfiguration,
  getStoredLLMConfiguration,
  saveLLMConfiguration,
  updateLLMConfiguration,
} from "../llm/config.js";
import { AppDatabase } from "../storage/database.js";
import type { DetectionResult } from "./detect.js";
import {
  getToolDefinition,
  isAnalyzerToolName,
  listToolDefinitions,
  type ToolDefinition,
  type ToolName,
} from "./registry.js";

export interface ToolCommandPrompts {
  text(question: string, defaultValue?: string): Promise<string>;
  confirm(question: string, defaultValue: boolean): Promise<boolean>;
  select(question: string, options: string[], defaultIndex?: number): Promise<string>;
  secret(question: string, defaultValue?: string): Promise<string>;
}

export interface ToolServiceDependencies {
  prompts?: ToolCommandPrompts | undefined;
  credentialStore?: CredentialStore | undefined;
  runOAuthLogin?: typeof runGoogleOAuthInteractiveLogin | undefined;
  runOpenAICodexOAuthLogin?: typeof runOpenAICodexOAuthInteractiveLogin | undefined;
  refreshOAuthCredentials?: typeof refreshGoogleOAuthCredentials | undefined;
  openBrowser?: typeof openSystemBrowser | undefined;
}

export interface AddToolOptions {
  authMethod?: string | undefined;
  model?: string | undefined;
  repoPath?: string | undefined;
  calendarId?: string | undefined;
  apiKey?: string | undefined;
  clientId?: string | undefined;
  clientSecret?: string | undefined;
  projectId?: string | undefined;
  issuerUrl?: string | undefined;
  port?: number | undefined;
}

export interface RemoveToolOptions {
  deleteCredentials?: boolean | undefined;
}

export interface ToolMutationResult {
  status: "added" | "removed" | "refreshed" | "authenticated" | "unavailable";
  tool: ToolName;
  message: string;
  warning?: string | undefined;
}

export interface ListedTool {
  category: "collector" | "analyzer";
  indicator: "✓" | "⚠" | "○";
  name: string;
  defaultMarker: "★" | "";
  detail: string;
  authLabel?: string | undefined;
}

export interface ToolListReport {
  collectors: ListedTool[];
  analyzers: ListedTool[];
}

function withDatabase<T>(dataDir: string, fn: (database: AppDatabase) => T): T {
  const database = new AppDatabase(resolveAppPaths(dataDir));
  database.initialize();

  try {
    return fn(database);
  } finally {
    database.close();
  }
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function resolveProviderApiKey(provider: LLMProvider, explicitApiKey?: string): string | undefined {
  if (explicitApiKey && explicitApiKey.trim().length > 0) {
    return explicitApiKey.trim();
  }

  const descriptor = getLLMProviderDescriptor(provider);

  for (const envVar of descriptor.apiKeyEnvVars) {
    const value = process.env[envVar];

    if (value?.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function resolveCredentialStoreWithFallback(
  dependencies: ToolServiceDependencies,
): CredentialStore {
  return dependencies.credentialStore ?? resolveCredentialStore();
}

function buildWarning(credentialStore: CredentialStore): string | undefined {
  return credentialStore.warning;
}

function saveConfig(config: WidConfig): WidConfig {
  return ConfigManager.save(config.dataDir, config);
}

function setToolConfig(
  config: WidConfig,
  toolName: ToolName,
  value: WidToolConfig,
): WidConfig {
  config.tools[toolName] = value;
  return saveConfig(config);
}

function removeToolConfig(config: WidConfig, toolName: ToolName): WidConfig {
  delete config.tools[toolName];
  return saveConfig(config);
}

function resolveDefaultProvider(config: WidConfig, dataDir: string): string {
  if (config.llm.default) {
    return config.llm.default;
  }

  return withDatabase(dataDir, (database) => getStoredLLMConfiguration(database).provider);
}

function maybeSetDefaultAnalyzer(config: WidConfig, provider: LLMProvider): WidConfig {
  const currentDefault = config.llm.default;

  if (!currentDefault || config.tools[currentDefault]?.added !== true) {
    config.llm.default = provider;
  }

  return saveConfig(config);
}

function syncAnalyzerConfiguration(
  dataDir: string,
  provider: LLMProvider,
  authMethod: LLMAuthMethod,
  model: string,
  projectId?: string | undefined,
): void {
  withDatabase(dataDir, (database) => {
    updateLLMConfiguration(database, {
      provider,
      authMethod,
      model,
      googleProjectId: provider === "gemini" ? projectId : undefined,
    });
  });
}

function syncFallbackAnalyzerConfiguration(dataDir: string, config: WidConfig): void {
  const nextDefault = config.llm.default;

  withDatabase(dataDir, (database) => {
    if (nextDefault && isAnalyzerToolName(nextDefault) && config.tools[nextDefault]?.added === true) {
      const toolConfig = config.tools[nextDefault];
      const descriptor = getLLMProviderDescriptor(nextDefault);

      updateLLMConfiguration(database, {
        provider: nextDefault,
        authMethod: normalizeLLMAuthMethod(
          normalizeOptionalString(toolConfig?.auth) ?? getDefaultLLMAuthMethod(nextDefault),
        ),
        model: normalizeOptionalString(toolConfig?.model) ?? descriptor.defaultModel,
        googleProjectId: normalizeOptionalString(toolConfig?.["project-id"]),
      });
      return;
    }

    saveLLMConfiguration(database, getDefaultLLMConfiguration());
  });
}

async function resolveDetection(
  definition: ToolDefinition,
): Promise<DetectionResult> {
  return definition.detect({
    cwd: process.cwd(),
  });
}

function formatAnalyzerAuthLabel(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  if (value === "api-key") {
    return "API key";
  }

  if (value === "oauth2") {
    return "OAuth2";
  }

  return value;
}

function formatIndicator(added: boolean, healthy: boolean): "✓" | "⚠" | "○" {
  if (!added) {
    return "○";
  }

  return healthy ? "✓" : "⚠";
}

function formatListLine(tool: ListedTool): string {
  const nameColumn = tool.defaultMarker
    ? `${tool.name} ${tool.defaultMarker}`.padEnd(18)
    : tool.name.padEnd(18);
  const authColumn = tool.authLabel ? `  ${tool.authLabel}` : "";

  return `  ${tool.indicator} ${nameColumn}${tool.detail}${authColumn}`.trimEnd();
}

async function buildListedTool(
  dataDir: string,
  config: WidConfig,
  definition: ToolDefinition,
): Promise<ListedTool> {
  const detection = await resolveDetection(definition);
  const toolConfig = config.tools[definition.name];
  const added = toolConfig?.added === true;

  if (definition.category === "collector") {
    const detail = !added
      ? `not added (-> tools add ${definition.name})`
      : definition.name === "git"
        ? normalizeOptionalString(toolConfig?.["repo-path"]) ??
          detection.details ??
          definition.description
        : definition.description;

    return {
      category: definition.category,
      indicator: formatIndicator(added, detection.available && detection.authenticated),
      name: definition.name,
      defaultMarker: "",
      detail,
      authLabel: added
        ? (detection.authenticated ? "ready" : detection.details ?? detection.installHint ?? "not ready")
        : undefined,
      };
  }

  if (!isAnalyzerToolName(definition.name)) {
    throw new Error(`Analyzer tool is not supported: ${definition.name}`);
  }

  const currentDefault = resolveDefaultProvider(config, dataDir);
  const descriptor = getLLMProviderDescriptor(definition.name);
  const model =
    normalizeOptionalString(toolConfig?.model) ??
    (currentDefault === definition.name
      ? withDatabase(dataDir, (database) => getStoredLLMConfiguration(database).model)
      : undefined) ??
    descriptor.defaultModel;
  const authMethod =
    normalizeOptionalString(toolConfig?.auth) ??
    (currentDefault === definition.name
      ? withDatabase(dataDir, (database) => getStoredLLMConfiguration(database).authMethod)
      : undefined) ??
    detection.authMethod ??
    getDefaultLLMAuthMethod(definition.name);

  return {
    category: definition.category,
    indicator: formatIndicator(added, detection.authenticated),
    name: definition.name,
    defaultMarker: currentDefault === definition.name && added ? "★" : "",
    detail: added ? model : `not added (-> tools add ${definition.name})`,
    authLabel: added ? formatAnalyzerAuthLabel(authMethod) : undefined,
  };
}

function selectAuthMethod(
  definition: ToolDefinition,
  currentConfig: WidToolConfig | undefined,
  explicitAuthMethod: string | undefined,
): LLMAuthMethod | undefined {
  if (!definition.authMethods || definition.authMethods.length === 0) {
    return undefined;
  }

  if (explicitAuthMethod) {
    return normalizeLLMAuthMethod(explicitAuthMethod);
  }

  const configuredAuth = normalizeOptionalString(currentConfig?.auth);

  if (configuredAuth) {
    return normalizeLLMAuthMethod(configuredAuth);
  }

  return definition.authMethods[0];
}

async function ensureApiKeyCredential(args: {
  provider: LLMProvider;
  options: AddToolOptions;
  prompts?: ToolCommandPrompts | undefined;
  credentialStore: CredentialStore;
}): Promise<void> {
  const configuredApiKey =
    resolveProviderApiKey(args.provider, args.options.apiKey) ??
    (args.prompts
      ? await args.prompts.secret(`${args.provider} API key`)
      : undefined);

  if (!configuredApiKey) {
    const descriptor = getLLMProviderDescriptor(args.provider);
    throw new Error(`API key is required. Expected one of: ${descriptor.apiKeyEnvVars.join(", ")}`);
  }

  setLLMApiKey(args.credentialStore, args.provider, configuredApiKey);
}

async function ensureGeminiOAuthCredential(args: {
  options: AddToolOptions;
  prompts?: ToolCommandPrompts | undefined;
  credentialStore: CredentialStore;
  dependencies: ToolServiceDependencies;
}): Promise<{ projectId: string }> {
  const storedCredentials = getGeminiOAuthCredentials(args.credentialStore);

  if (
    storedCredentials &&
    !args.options.clientId &&
    !args.options.clientSecret &&
    !args.options.projectId
  ) {
    return {
      projectId: storedCredentials.projectId,
    };
  }

  if (!args.credentialStore.isSupported()) {
    throw new Error("Secure credential storage is required for OAuth login on this platform");
  }

  const prompts = args.prompts;
  const clientId =
    args.options.clientId ??
    process.env.GOOGLE_CLIENT_ID ??
    (prompts ? await prompts.text("Google OAuth client id") : undefined);
  const clientSecret =
    args.options.clientSecret ??
    process.env.GOOGLE_CLIENT_SECRET ??
    (prompts ? await prompts.secret("Google OAuth client secret") : undefined);
  const projectId =
    args.options.projectId ??
    process.env.GOOGLE_CLOUD_PROJECT ??
    (prompts ? await prompts.text("Google Cloud project id") : undefined);

  if (!clientId || !clientSecret || !projectId) {
    throw new Error("Gemini OAuth setup requires client id, client secret, and project id");
  }

  const runOAuthLogin = args.dependencies.runOAuthLogin ?? runGoogleOAuthInteractiveLogin;
  const credentials = await runOAuthLogin({
    clientId,
    clientSecret,
    projectId,
    port: args.options.port ?? 0,
    openBrowser: args.dependencies.openBrowser ?? openSystemBrowser,
  });

  setGeminiOAuthCredentials(args.credentialStore, credentials);
  return {
    projectId: credentials.projectId,
  };
}

async function ensureOpenAICodexOAuthCredential(args: {
  options: AddToolOptions;
  prompts?: ToolCommandPrompts | undefined;
  credentialStore: CredentialStore;
  dependencies: ToolServiceDependencies;
}): Promise<void> {
  const storedCredentials = getOpenAICodexOAuthCredentials(args.credentialStore);

  if (storedCredentials && !args.options.clientId && !args.options.issuerUrl) {
    return;
  }

  if (!args.credentialStore.isSupported()) {
    throw new Error("Secure credential storage is required for OAuth login on this platform");
  }

  const prompts = args.prompts;
  const clientId =
    normalizeOptionalString(args.options.clientId) ??
    normalizeOptionalString(process.env.OPENAI_CODEX_CLIENT_ID) ??
    normalizeOptionalString(
      prompts
        ? await prompts.text("OpenAI Codex OAuth client id", process.env.OPENAI_CODEX_CLIENT_ID)
        : undefined,
    );
  const issuer =
    normalizeOptionalString(args.options.issuerUrl) ??
    normalizeOptionalString(process.env.OPENAI_CODEX_ISSUER) ??
    DEFAULT_OPENAI_CODEX_ISSUER;

  if (!clientId) {
    throw new Error("OpenAI Codex OAuth requires --client-id or OPENAI_CODEX_CLIENT_ID");
  }

  const runOpenAICodexOAuthLogin =
    args.dependencies.runOpenAICodexOAuthLogin ?? runOpenAICodexOAuthInteractiveLogin;
  const credentials = await runOpenAICodexOAuthLogin({
    clientId,
    issuer,
    port: args.options.port ?? 0,
    openBrowser: args.dependencies.openBrowser ?? openSystemBrowser,
  });

  setOpenAICodexOAuthCredentials(args.credentialStore, credentials);
}

async function resolveModel(
  definition: ToolDefinition,
  currentConfig: WidToolConfig | undefined,
  explicitModel: string | undefined,
  prompts?: ToolCommandPrompts | undefined,
): Promise<string> {
  const defaultModel =
    explicitModel ??
    normalizeOptionalString(currentConfig?.model) ??
    normalizeOptionalString(definition.prompts?.find((prompt) => prompt.key === "model")?.defaultValue) ??
    (isAnalyzerToolName(definition.name)
      ? getLLMProviderDescriptor(definition.name).defaultModel
      : undefined) ??
    "";

  if (explicitModel || !prompts) {
    return defaultModel;
  }

  return prompts.text("Model", defaultModel);
}

export async function listTools(dataDir: string): Promise<ToolListReport> {
  const config = ConfigManager.load(dataDir);
  const collectors: ListedTool[] = [
    {
      category: "collector",
      indicator: process.platform === "darwin" || process.platform === "win32" ? "✓" : "⚠",
      name: "active-window",
      defaultMarker: "",
      detail: process.platform === "darwin" || process.platform === "win32" ? "built-in" : "unsupported on this platform",
    },
    {
      category: "collector",
      indicator: "✓",
      name: "chrome-extension",
      defaultMarker: "",
      detail: "built-in",
    },
  ];
  const analyzers: ListedTool[] = [];

  for (const definition of listToolDefinitions()) {
    const entry = await buildListedTool(dataDir, config, definition);

    if (definition.category === "collector") {
      collectors.push(entry);
      continue;
    }

    analyzers.push(entry);
  }

  return {
    collectors,
    analyzers,
  };
}

export function formatToolList(report: ToolListReport): string {
  return [
    "COLLECTORS",
    ...report.collectors.map(formatListLine),
    "",
    "ANALYZERS",
    ...report.analyzers.map(formatListLine),
  ].join("\n");
}

export async function addTool(
  dataDir: string,
  toolName: string,
  options: AddToolOptions = {},
  dependencies: ToolServiceDependencies = {},
): Promise<ToolMutationResult> {
  const definition = getToolDefinition(toolName);

  if (!definition) {
    throw new Error(`Unknown tool: ${toolName}`);
  }

  const detection = await resolveDetection(definition);

  if (!detection.available) {
    return {
      status: "unavailable",
      tool: definition.name,
      message: `${definition.displayName} is not available${detection.installHint ? ` (${detection.installHint})` : ""}.`,
    };
  }

  const config = ConfigManager.load(dataDir);

  if (definition.category === "collector") {
    if (definition.name === "gws") {
      setToolConfig(config, "gws", {
        added: true,
        "calendar-id": options.calendarId ?? normalizeOptionalString(config.tools.gws?.["calendar-id"]) ?? DEFAULT_GWS_CALENDAR_ID,
      });

      return {
        status: "added",
        tool: "gws",
        message: detection.authenticated
          ? "Added gws collector."
          : "Added gws collector. Authenticate the gws CLI before runtime.",
      };
    }

    if (definition.name === "git") {
      const prompts = dependencies.prompts;
      const detectedRepoPath =
        options.repoPath ??
        normalizeOptionalString(config.tools.git?.["repo-path"]) ??
        await definition.prompts?.[0]?.detectDefault?.(process.cwd()) ??
        process.cwd();
      const repoPath =
        options.repoPath ??
        (prompts ? await prompts.text("Git repo path", detectedRepoPath) : detectedRepoPath);
      const gitStatus = getGitContextCollectorStatus({
        repoPath,
      });

      if (!gitStatus.ready) {
        return {
          status: "unavailable",
          tool: "git",
          message: `Git repo is not ready (${gitStatus.detail ?? gitStatus.status}).`,
        };
      }

      setToolConfig(config, "git", {
        added: true,
        "repo-path": gitStatus.selectedRepoPath ?? repoPath,
      });

      return {
        status: "added",
        tool: "git",
        message: `Added git collector (${gitStatus.selectedRepoPath ?? repoPath}).`,
      };
    }

    setToolConfig(config, "gh", {
      added: true,
    });

    return {
      status: "added",
      tool: "gh",
      message: detection.authenticated
        ? "Added GitHub CLI collector."
        : "Added GitHub CLI collector. Authenticate gh before using it.",
    };
  }

  if (!isAnalyzerToolName(definition.name)) {
    throw new Error(`Analyzer tool is not supported: ${definition.name}`);
  }

  const provider = definition.name;
  const prompts = dependencies.prompts;
  const credentialStore = resolveCredentialStoreWithFallback(dependencies);
  const authMethod = selectAuthMethod(definition, config.tools[provider], options.authMethod);

  if (!authMethod) {
    throw new Error(`No auth method is configured for ${provider}`);
  }

  const model = await resolveModel(definition, config.tools[provider], options.model, prompts);
  let projectId = normalizeOptionalString(config.tools[provider]?.["project-id"]);

  if (authMethod === "api-key") {
    await ensureApiKeyCredential({
      provider,
      options,
      prompts,
      credentialStore,
    });
  } else if (provider === "gemini") {
    const oauth = await ensureGeminiOAuthCredential({
      options,
      prompts,
      credentialStore,
      dependencies,
    });
    projectId = oauth.projectId;
  } else if (provider === "openai-codex") {
    await ensureOpenAICodexOAuthCredential({
      options,
      prompts,
      credentialStore,
      dependencies,
    });
  } else {
    throw new Error(`${provider} does not support OAuth2`);
  }

  syncAnalyzerConfiguration(dataDir, provider, authMethod, model, projectId);
  setToolConfig(config, provider, {
    added: true,
    auth: authMethod,
    model,
    ...(projectId ? { "project-id": projectId } : {}),
  });
  maybeSetDefaultAnalyzer(config, provider);

  return {
    status: "added",
    tool: provider,
    message: `Added ${provider} analyzer (${formatAnalyzerAuthLabel(authMethod) ?? authMethod}).`,
    warning: buildWarning(credentialStore),
  };
}

export async function authenticateTool(
  dataDir: string,
  toolName: string,
  options: AddToolOptions = {},
  dependencies: ToolServiceDependencies = {},
): Promise<ToolMutationResult> {
  const definition = getToolDefinition(toolName);

  if (!definition) {
    throw new Error(`Unknown tool: ${toolName}`);
  }

  if (definition.category === "collector") {
    if (definition.name === "gws") {
      return {
        status: "authenticated",
        tool: "gws",
        message: "Use `gws auth login` to authenticate the gws CLI.",
      };
    }

    if (definition.name === "gh") {
      return {
        status: "authenticated",
        tool: "gh",
        message: "Use `gh auth login` to authenticate GitHub CLI.",
      };
    }

    return {
      status: "authenticated",
      tool: "git",
      message: "Git does not require a separate authentication step.",
    };
  }

  const result = await addTool(dataDir, toolName, options, dependencies);

  return {
    ...result,
    status: result.status === "added" ? "authenticated" : result.status,
    message: result.status === "added"
      ? `Re-authenticated ${toolName}.`
      : result.message,
  };
}

export async function refreshTool(
  _dataDir: string,
  toolName: string,
  dependencies: ToolServiceDependencies = {},
): Promise<ToolMutationResult> {
  if (toolName !== "gemini") {
    throw new Error("Only gemini exposes an OAuth refresh flow");
  }

  const credentialStore = resolveCredentialStoreWithFallback(dependencies);
  const credentials = getGeminiOAuthCredentials(credentialStore);

  if (!credentials) {
    throw new Error("Gemini OAuth credentials not found. Run tools auth gemini first.");
  }

  const refreshOAuthCredentialsFn =
    dependencies.refreshOAuthCredentials ?? refreshGoogleOAuthCredentials;
  const refreshed = await refreshOAuthCredentialsFn({
    credentials,
  });
  setGeminiOAuthCredentials(credentialStore, refreshed);

  return {
    status: "refreshed",
    tool: "gemini",
    message: `Refreshed gemini OAuth credentials (expires ${refreshed.expiresAt}).`,
    warning: buildWarning(credentialStore),
  };
}

function deleteManagedCredentials(
  credentialStore: CredentialStore,
  toolName: ToolName,
): void {
  if (toolName === "gemini") {
    deleteLLMApiKey(credentialStore, "gemini");
    deleteGeminiOAuthCredentials(credentialStore);
    return;
  }

  if (toolName === "openai-codex") {
    deleteOpenAICodexOAuthCredentials(credentialStore);
    return;
  }

  if (isAnalyzerToolName(toolName)) {
    deleteLLMApiKey(credentialStore, toolName);
  }
}

function pickFallbackDefaultAnalyzer(config: WidConfig): LLMProvider | undefined {
  for (const definition of listToolDefinitions("analyzer")) {
    if (config.tools[definition.name]?.added === true) {
      return definition.name as LLMProvider;
    }
  }

  return undefined;
}

export async function removeTool(
  dataDir: string,
  toolName: string,
  options: RemoveToolOptions = {},
  dependencies: ToolServiceDependencies = {},
): Promise<ToolMutationResult> {
  const definition = getToolDefinition(toolName);

  if (!definition) {
    throw new Error(`Unknown tool: ${toolName}`);
  }

  const config = ConfigManager.load(dataDir);
  const prompts = dependencies.prompts;
  const credentialStore = resolveCredentialStoreWithFallback(dependencies);
  const shouldDeleteCredentials =
    options.deleteCredentials ??
    (prompts && isAnalyzerToolName(definition.name)
      ? await prompts.confirm("Also remove stored credentials?", false)
      : false);

  removeToolConfig(config, definition.name);

  if (config.llm.default === definition.name) {
    config.llm.default = pickFallbackDefaultAnalyzer(config);
    saveConfig(config);
    syncFallbackAnalyzerConfiguration(dataDir, config);
  }

  if (shouldDeleteCredentials) {
    deleteManagedCredentials(credentialStore, definition.name);
  }

  return {
    status: "removed",
    tool: definition.name,
    message: `Removed ${definition.name}.${shouldDeleteCredentials ? " Stored credentials were deleted." : ""}`,
    warning: shouldDeleteCredentials ? buildWarning(credentialStore) : undefined,
  };
}

export function syncConfiguredAnalyzerTool(args: {
  dataDir: string;
  provider: LLMProvider;
  authMethod: LLMAuthMethod;
  model: string;
  projectId?: string | undefined;
}): void {
  const config = ConfigManager.load(args.dataDir);

  setToolConfig(config, args.provider, {
    added: true,
    auth: args.authMethod,
    model: args.model,
    ...(args.projectId ? { "project-id": args.projectId } : {}),
  });
  maybeSetDefaultAnalyzer(config, args.provider);
}
