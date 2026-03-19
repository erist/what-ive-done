import { resolveAppPaths } from "../app-paths.js";
import { isOpenAICodexOAuthAccessTokenExpired, refreshOpenAICodexOAuthCredentials } from "../auth/openai-oauth.js";
import {
  isGoogleOAuthAccessTokenExpired,
  refreshGoogleOAuthCredentials,
} from "../auth/google-oauth.js";
import { ConfigManager } from "../config/manager.js";
import {
  getGeminiOAuthCredentials,
  getLLMApiKey,
  getOpenAICodexOAuthCredentials,
  hasGeminiOAuthCredentials,
  hasLLMApiKey,
  hasOpenAICodexOAuthCredentials,
  setGeminiOAuthCredentials,
  setOpenAICodexOAuthCredentials,
} from "../credentials/llm.js";
import { resolveCredentialStore } from "../credentials/store.js";
import type { WorkflowLLMAnalysis, WorkflowSummaryPayloadRecord } from "../domain/types.js";
import { analyzeRawEvents } from "../pipeline/analyze.js";
import { AppDatabase } from "../storage/database.js";
import {
  getDefaultLLMAuthMethod,
  getLLMProviderDescriptor,
  LLM_PROVIDERS,
  normalizeLLMAuthMethod,
  normalizeLLMProvider,
  supportsLLMAuthMethod,
  type LLMProvider,
} from "./catalog.js";
import { getStoredLLMConfiguration, type LLMConfiguration } from "./config.js";
import { createWorkflowAnalyzer } from "./factory.js";

function withDatabase<T>(dataDir: string | undefined, fn: (database: AppDatabase) => T): T {
  const resolvedDataDir = ConfigManager.resolveDataDir(dataDir);
  const database = new AppDatabase(resolveAppPaths(resolvedDataDir));
  database.initialize();

  try {
    return fn(database);
  } finally {
    database.close();
  }
}

function getStoredAnalysisConfiguration(dataDir?: string): LLMConfiguration {
  return withDatabase(dataDir, (database) => getStoredLLMConfiguration(database));
}

function resolveApiKeyFromEnv(provider: LLMProvider): string | undefined {
  const descriptor = getLLMProviderDescriptor(provider);

  for (const envVar of descriptor.apiKeyEnvVars) {
    const value = process.env[envVar];

    if (value?.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

export function resolveProviderApiKey(provider: LLMProvider): string {
  if (!supportsLLMAuthMethod(provider, "api-key")) {
    throw new Error(`${provider} does not support API key authentication`);
  }

  const credentialStore = resolveCredentialStore();
  const storedKey = getLLMApiKey(credentialStore, provider);

  if (storedKey) {
    return storedKey;
  }

  const envKey = resolveApiKeyFromEnv(provider);

  if (envKey) {
    return envKey;
  }

  const descriptor = getLLMProviderDescriptor(provider);
  throw new Error(
    `${descriptor.label} API key is required. Use credential:set ${provider} or set ${descriptor.apiKeyEnvVars.join(", ")}`,
  );
}

export interface ResolveLLMConfigurationOptions {
  provider?: string | undefined;
  auth?: string | undefined;
  model?: string | undefined;
  baseUrl?: string | undefined;
  projectId?: string | undefined;
}

export function resolveLLMAnalysisConfiguration(
  dataDir: string | undefined,
  options: ResolveLLMConfigurationOptions,
): LLMConfiguration {
  const stored = getStoredAnalysisConfiguration(dataDir);
  const provider = options.provider ? normalizeLLMProvider(options.provider) : stored.provider;
  const providerChanged = provider !== stored.provider;
  const authMethod = options.auth
    ? normalizeLLMAuthMethod(options.auth)
    : providerChanged && !supportsLLMAuthMethod(provider, stored.authMethod)
      ? getDefaultLLMAuthMethod(provider)
      : stored.authMethod;

  if (!supportsLLMAuthMethod(provider, authMethod)) {
    throw new Error(`Provider ${provider} does not support auth method ${authMethod}`);
  }

  const configuration: LLMConfiguration = {
    provider,
    authMethod,
  };

  const model = options.model ?? (providerChanged ? undefined : stored.model);
  const baseUrl = options.baseUrl ?? (providerChanged ? undefined : stored.baseUrl);
  const googleProjectId =
    provider === "gemini"
      ? options.projectId ?? (providerChanged ? undefined : stored.googleProjectId)
      : undefined;

  if (model) {
    configuration.model = model;
  }

  if (baseUrl) {
    configuration.baseUrl = baseUrl;
  }

  if (googleProjectId) {
    configuration.googleProjectId = googleProjectId;
  }

  return configuration;
}

export async function resolveGeminiOAuthRuntime(
  dataDir?: string,
): Promise<{ accessToken: string; projectId: string }> {
  const credentialStore = resolveCredentialStore();
  const storedCredentials = getGeminiOAuthCredentials(credentialStore);

  if (!storedCredentials) {
    throw new Error("Gemini OAuth credentials not found. Run auth:login gemini first.");
  }

  const credentials = isGoogleOAuthAccessTokenExpired(storedCredentials)
    ? await refreshGoogleOAuthCredentials({
        credentials: storedCredentials,
      })
    : storedCredentials;

  if (credentials !== storedCredentials) {
    setGeminiOAuthCredentials(credentialStore, credentials);
  }

  const configuredProjectId = getStoredAnalysisConfiguration(dataDir).googleProjectId;
  const projectId = configuredProjectId ?? credentials.projectId;

  if (!projectId) {
    throw new Error("Gemini OAuth analysis requires a Google Cloud project id");
  }

  return {
    accessToken: credentials.accessToken,
    projectId,
  };
}

export async function resolveOpenAICodexOAuthRuntime(): Promise<{
  apiKey: string;
  refreshApiKey: () => Promise<string>;
}> {
  const credentialStore = resolveCredentialStore();

  const refreshRuntimeCredentials = async (): Promise<string> => {
    const latestCredentials = getOpenAICodexOAuthCredentials(credentialStore);

    if (!latestCredentials) {
      throw new Error("OpenAI Codex OAuth credentials not found. Run auth:login openai-codex first.");
    }

    const refreshed = await refreshOpenAICodexOAuthCredentials({
      credentials: latestCredentials,
    });

    setOpenAICodexOAuthCredentials(credentialStore, refreshed);

    if (!refreshed.apiKey) {
      throw new Error("OpenAI Codex OAuth refresh did not yield an API token. Run auth:login openai-codex again.");
    }

    return refreshed.apiKey;
  };

  const storedCredentials = getOpenAICodexOAuthCredentials(credentialStore);

  if (!storedCredentials) {
    throw new Error("OpenAI Codex OAuth credentials not found. Run auth:login openai-codex first.");
  }

  const apiKey =
    !storedCredentials.apiKey || isOpenAICodexOAuthAccessTokenExpired(storedCredentials)
      ? await refreshRuntimeCredentials()
      : storedCredentials.apiKey;

  return {
    apiKey,
    refreshApiKey: refreshRuntimeCredentials,
  };
}

export interface ProviderCredentialStatus {
  backend: string;
  warning?: string | undefined;
  supported: boolean;
  configuration: LLMConfiguration;
  providers: Array<{
    provider: LLMProvider;
    label: string;
    defaultModel: string;
    supportedAuthMethods: ReturnType<typeof getLLMProviderDescriptor>["supportedAuthMethods"];
    hasApiKey: boolean;
    envApiKeyAvailable: boolean;
    hasOAuthCredentials: boolean;
    selected: boolean;
  }>;
}

export function buildProviderCredentialStatus(dataDir?: string): ProviderCredentialStatus {
  const credentialStore = resolveCredentialStore();
  const configuration = getStoredAnalysisConfiguration(dataDir);

  return {
    backend: credentialStore.backend,
    warning: credentialStore.warning,
    supported: credentialStore.isSupported(),
    configuration,
    providers: LLM_PROVIDERS.map((provider) => {
      const descriptor = getLLMProviderDescriptor(provider);
      return {
        provider,
        label: descriptor.label,
        defaultModel: descriptor.defaultModel,
        supportedAuthMethods: descriptor.supportedAuthMethods,
        hasApiKey: hasLLMApiKey(credentialStore, provider),
        envApiKeyAvailable: Boolean(resolveApiKeyFromEnv(provider)),
        hasOAuthCredentials:
          provider === "gemini"
            ? hasGeminiOAuthCredentials(credentialStore)
            : provider === "openai-codex"
              ? hasOpenAICodexOAuthCredentials(credentialStore)
              : false,
        selected: configuration.provider === provider,
      };
    }),
  };
}

export interface AnalyzeWorkflowPayloadRecordsOptions extends ResolveLLMConfigurationOptions {
  dataDir?: string | undefined;
  payloadRecords: WorkflowSummaryPayloadRecord[];
}

export async function analyzeWorkflowPayloadRecords(
  options: AnalyzeWorkflowPayloadRecordsOptions,
): Promise<{ configuration: LLMConfiguration; analyses: WorkflowLLMAnalysis[] }> {
  const configuration = resolveLLMAnalysisConfiguration(options.dataDir, options);
  let apiKey: string | undefined;
  let accessToken: string | undefined;
  let projectId = configuration.googleProjectId;
  let refreshApiKey: (() => Promise<string>) | undefined;

  if (configuration.provider === "gemini" && configuration.authMethod === "oauth2") {
    const runtimeAuth = await resolveGeminiOAuthRuntime(options.dataDir);
    accessToken = runtimeAuth.accessToken;
    projectId = projectId ?? runtimeAuth.projectId;
  } else if (configuration.provider === "openai-codex" && configuration.authMethod === "oauth2") {
    const runtimeAuth = await resolveOpenAICodexOAuthRuntime();
    apiKey = runtimeAuth.apiKey;
    refreshApiKey = runtimeAuth.refreshApiKey;
  } else if (configuration.authMethod === "api-key") {
    apiKey = resolveProviderApiKey(configuration.provider);
  }

  const analyzer = createWorkflowAnalyzer({
    provider: configuration.provider,
    authMethod: configuration.authMethod,
    apiKey,
    accessToken,
    projectId,
    refreshApiKey,
    model: configuration.model,
    baseUrl: configuration.baseUrl,
  });
  const analyses: WorkflowLLMAnalysis[] = [];

  for (const record of options.payloadRecords) {
    analyses.push(await analyzer.analyze(record));
  }

  return {
    configuration,
    analyses,
  };
}

export function persistWorkflowLLMAnalysisResults(
  dataDir: string | undefined,
  analyses: WorkflowLLMAnalysis[],
  options: { applyNames?: boolean | undefined } = {},
): void {
  withDatabase(dataDir, (database) => {
    database.replaceWorkflowLLMAnalyses(analyses);

    if (!options.applyNames) {
      return;
    }

    const hasAllWorkflowArtifacts = analyses.every((analysis) =>
      database.getWorkflowClusterById(analysis.workflowClusterId),
    );

    if (!hasAllWorkflowArtifacts) {
      const analysisResult = analyzeRawEvents(database.getRawEventsChronological(), {
        feedbackByWorkflowSignature: database.listWorkflowFeedbackSummary(),
      });

      database.replaceAnalysisArtifacts(analysisResult);
    }

    for (const analysis of analyses) {
      database.saveWorkflowFeedback({
        workflowClusterId: analysis.workflowClusterId,
        renameTo: analysis.workflowName,
      });
    }
  });
}
