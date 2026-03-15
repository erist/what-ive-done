import type { CredentialStore } from "./store.js";
import type { LLMProvider } from "../llm/catalog.js";

const DEFAULT_ACCOUNT_NAME = "default";

export interface GeminiOAuthCredentials {
  provider: "gemini";
  clientId: string;
  clientSecret: string;
  projectId: string;
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  scope: string[];
  expiresAt: string;
}

function apiKeyServiceName(provider: LLMProvider): string {
  return `what-ive-done.llm.${provider}.api-key`;
}

function oauthServiceName(provider: LLMProvider): string {
  return `what-ive-done.llm.${provider}.oauth`;
}

export function hasLLMApiKey(credentialStore: CredentialStore, provider: LLMProvider): boolean {
  return credentialStore.hasSecret(apiKeyServiceName(provider), DEFAULT_ACCOUNT_NAME);
}

export function getLLMApiKey(
  credentialStore: CredentialStore,
  provider: LLMProvider,
): string | undefined {
  return credentialStore.getSecret(apiKeyServiceName(provider), DEFAULT_ACCOUNT_NAME);
}

export function setLLMApiKey(
  credentialStore: CredentialStore,
  provider: LLMProvider,
  apiKey: string,
): void {
  credentialStore.setSecret(apiKeyServiceName(provider), apiKey, DEFAULT_ACCOUNT_NAME);
}

export function deleteLLMApiKey(credentialStore: CredentialStore, provider: LLMProvider): void {
  credentialStore.deleteSecret(apiKeyServiceName(provider), DEFAULT_ACCOUNT_NAME);
}

export function hasGeminiOAuthCredentials(credentialStore: CredentialStore): boolean {
  return credentialStore.hasSecret(oauthServiceName("gemini"), DEFAULT_ACCOUNT_NAME);
}

export function getGeminiOAuthCredentials(
  credentialStore: CredentialStore,
): GeminiOAuthCredentials | undefined {
  const secret = credentialStore.getSecret(oauthServiceName("gemini"), DEFAULT_ACCOUNT_NAME);

  if (!secret) {
    return undefined;
  }

  return JSON.parse(secret) as GeminiOAuthCredentials;
}

export function setGeminiOAuthCredentials(
  credentialStore: CredentialStore,
  credentials: GeminiOAuthCredentials,
): void {
  credentialStore.setSecret(
    oauthServiceName("gemini"),
    JSON.stringify(credentials),
    DEFAULT_ACCOUNT_NAME,
  );
}

export function deleteGeminiOAuthCredentials(credentialStore: CredentialStore): void {
  credentialStore.deleteSecret(oauthServiceName("gemini"), DEFAULT_ACCOUNT_NAME);
}
