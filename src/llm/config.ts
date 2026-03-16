import type { AppDatabase } from "../storage/database.js";
import {
  getDefaultLLMAuthMethod,
  normalizeLLMAuthMethod,
  normalizeLLMProvider,
  supportsLLMAuthMethod,
  type LLMAuthMethod,
  type LLMProvider,
} from "./catalog.js";

const LLM_CONFIG_SETTING_KEY = "llm.config";

export interface LLMConfiguration {
  provider: LLMProvider;
  authMethod: LLMAuthMethod;
  model?: string;
  baseUrl?: string;
  googleProjectId?: string;
}

export interface LLMConfigurationPatch {
  provider?: string | LLMProvider | undefined;
  authMethod?: string | LLMAuthMethod | undefined;
  model?: string | null | undefined;
  baseUrl?: string | null | undefined;
  googleProjectId?: string | null | undefined;
}

export function getDefaultLLMConfiguration(): LLMConfiguration {
  return {
    provider: "openai",
    authMethod: "api-key",
  };
}

function trimOptionalString(value: string | null | undefined): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function buildLLMConfiguration(input: {
  provider: LLMProvider;
  authMethod: LLMAuthMethod;
  model?: string | undefined;
  baseUrl?: string | undefined;
  googleProjectId?: string | undefined;
}): LLMConfiguration {
  const configuration: LLMConfiguration = {
    provider: input.provider,
    authMethod: input.authMethod,
  };

  if (input.model) {
    configuration.model = input.model;
  }

  if (input.baseUrl) {
    configuration.baseUrl = input.baseUrl;
  }

  if (input.googleProjectId) {
    configuration.googleProjectId = input.googleProjectId;
  }

  return configuration;
}

export function coerceLLMConfiguration(value: unknown): LLMConfiguration {
  const candidate = (value ?? {}) as Partial<LLMConfiguration>;
  const provider = candidate.provider ? normalizeLLMProvider(candidate.provider) : "openai";
  const authMethod = candidate.authMethod
    ? normalizeLLMAuthMethod(candidate.authMethod)
    : getDefaultLLMAuthMethod(provider);

  if (!supportsLLMAuthMethod(provider, authMethod)) {
    throw new Error(`Provider ${provider} does not support auth method ${authMethod}`);
  }

  return buildLLMConfiguration({
    provider,
    authMethod,
    model: trimOptionalString(candidate.model),
    baseUrl: trimOptionalString(candidate.baseUrl),
    googleProjectId:
      provider === "gemini" ? trimOptionalString(candidate.googleProjectId) : undefined,
  });
}

export function getStoredLLMConfiguration(database: AppDatabase): LLMConfiguration {
  const stored = database.getSetting<LLMConfiguration>(LLM_CONFIG_SETTING_KEY);

  if (!stored) {
    return getDefaultLLMConfiguration();
  }

  return coerceLLMConfiguration(stored);
}

export function saveLLMConfiguration(database: AppDatabase, configuration: LLMConfiguration): void {
  database.setSetting(LLM_CONFIG_SETTING_KEY, configuration);
}

export function updateLLMConfiguration(
  database: AppDatabase,
  patch: LLMConfigurationPatch,
): LLMConfiguration {
  const current = getStoredLLMConfiguration(database);
  const provider = patch.provider ? normalizeLLMProvider(patch.provider) : current.provider;
  const providerChanged = provider !== current.provider;
  const authMethod = patch.authMethod
    ? normalizeLLMAuthMethod(patch.authMethod)
    : providerChanged && !supportsLLMAuthMethod(provider, current.authMethod)
      ? getDefaultLLMAuthMethod(provider)
      : current.authMethod;

  if (!supportsLLMAuthMethod(provider, authMethod)) {
    throw new Error(`Provider ${provider} does not support auth method ${authMethod}`);
  }

  const model =
    patch.model !== undefined
      ? trimOptionalString(patch.model)
      : providerChanged
        ? undefined
        : current.model;
  const baseUrl =
    patch.baseUrl !== undefined
      ? trimOptionalString(patch.baseUrl)
      : providerChanged
        ? undefined
        : current.baseUrl;
  const googleProjectId =
    provider === "gemini"
      ? patch.googleProjectId !== undefined
        ? trimOptionalString(patch.googleProjectId)
        : providerChanged
          ? undefined
          : current.googleProjectId
      : undefined;

  const nextConfiguration = buildLLMConfiguration({
    provider,
    authMethod,
    model,
    baseUrl,
    googleProjectId,
  });

  saveLLMConfiguration(database, nextConfiguration);
  return nextConfiguration;
}
