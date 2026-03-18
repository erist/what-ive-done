export const LLM_PROVIDERS = ["openai", "openai-codex", "gemini", "claude"] as const;
export type LLMProvider = (typeof LLM_PROVIDERS)[number];

export const LLM_AUTH_METHODS = ["api-key", "oauth2"] as const;
export type LLMAuthMethod = (typeof LLM_AUTH_METHODS)[number];

export interface LLMProviderDescriptor {
  provider: LLMProvider;
  label: string;
  defaultModel: string;
  supportedAuthMethods: LLMAuthMethod[];
  apiKeyEnvVars: string[];
  supportsBaseUrl: boolean;
}

export const LLM_PROVIDER_DESCRIPTORS: Record<LLMProvider, LLMProviderDescriptor> = {
  openai: {
    provider: "openai",
    label: "ChatGPT (OpenAI)",
    defaultModel: "gpt-5-mini",
    supportedAuthMethods: ["api-key"],
    apiKeyEnvVars: ["OPENAI_API_KEY"],
    supportsBaseUrl: true,
  },
  "openai-codex": {
    provider: "openai-codex",
    label: "OpenAI Codex (ChatGPT)",
    defaultModel: "gpt-5.4",
    supportedAuthMethods: ["oauth2"],
    apiKeyEnvVars: [],
    supportsBaseUrl: true,
  },
  gemini: {
    provider: "gemini",
    label: "Gemini",
    defaultModel: "gemini-2.5-flash",
    supportedAuthMethods: ["api-key", "oauth2"],
    apiKeyEnvVars: ["GEMINI_API_KEY", "GOOGLE_API_KEY"],
    supportsBaseUrl: true,
  },
  claude: {
    provider: "claude",
    label: "Claude (Anthropic)",
    defaultModel: "claude-sonnet-4-5",
    supportedAuthMethods: ["api-key"],
    apiKeyEnvVars: ["ANTHROPIC_API_KEY"],
    supportsBaseUrl: true,
  },
};

export function normalizeLLMProvider(value: string): LLMProvider {
  const normalized = value.trim().toLowerCase();

  if (normalized === "openai" || normalized === "chatgpt") {
    return "openai";
  }

  if (normalized === "openai-codex" || normalized === "openaicodex" || normalized === "codex") {
    return "openai-codex";
  }

  if (normalized === "gemini" || normalized === "google") {
    return "gemini";
  }

  if (normalized === "claude" || normalized === "anthropic") {
    return "claude";
  }

  throw new Error(`Unsupported LLM provider: ${value}`);
}

export function normalizeLLMAuthMethod(value: string): LLMAuthMethod {
  const normalized = value.trim().toLowerCase();

  if (normalized === "api-key" || normalized === "apikey" || normalized === "key") {
    return "api-key";
  }

  if (normalized === "oauth2" || normalized === "oauth") {
    return "oauth2";
  }

  throw new Error(`Unsupported LLM auth method: ${value}`);
}

export function getLLMProviderDescriptor(provider: LLMProvider): LLMProviderDescriptor {
  return LLM_PROVIDER_DESCRIPTORS[provider];
}

export function getDefaultLLMAuthMethod(provider: LLMProvider): LLMAuthMethod {
  return getLLMProviderDescriptor(provider).supportedAuthMethods[0] ?? "api-key";
}

export function supportsLLMAuthMethod(provider: LLMProvider, authMethod: LLMAuthMethod): boolean {
  return getLLMProviderDescriptor(provider).supportedAuthMethods.includes(authMethod);
}
