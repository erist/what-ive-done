import { createClaudeWorkflowAnalyzer } from "./claude.js";
import type { LLMAuthMethod, LLMProvider } from "./catalog.js";
import { createGeminiWorkflowAnalyzer } from "./gemini.js";
import { createOpenAIWorkflowAnalyzer } from "./openai.js";

export interface CreateWorkflowAnalyzerOptions {
  provider: LLMProvider;
  authMethod: LLMAuthMethod;
  apiKey?: string | undefined;
  accessToken?: string | undefined;
  projectId?: string | undefined;
  model?: string | undefined;
  baseUrl?: string | undefined;
}

export function createWorkflowAnalyzer(options: CreateWorkflowAnalyzerOptions) {
  switch (options.provider) {
    case "openai":
      if (options.authMethod !== "api-key") {
        throw new Error("OpenAI workflow analysis currently supports API key authentication only");
      }

      if (!options.apiKey) {
        throw new Error("OpenAI workflow analysis requires an API key");
      }

      return createOpenAIWorkflowAnalyzer({
        apiKey: options.apiKey,
        model: options.model,
        baseUrl: options.baseUrl,
      });

    case "openai-codex":
      throw new Error("OpenAI Codex workflow analysis is not available until the OAuth runtime milestone");

    case "gemini":
      if (options.authMethod === "oauth2") {
        return createGeminiWorkflowAnalyzer({
          accessToken: options.accessToken,
          projectId: options.projectId,
          model: options.model,
          baseUrl: options.baseUrl,
        });
      }

      return createGeminiWorkflowAnalyzer({
        apiKey: options.apiKey,
        model: options.model,
        baseUrl: options.baseUrl,
      });

    case "claude":
      if (options.authMethod !== "api-key") {
        throw new Error("Claude workflow analysis currently supports API key authentication only");
      }

      if (!options.apiKey) {
        throw new Error("Claude workflow analysis requires an API key");
      }

      return createClaudeWorkflowAnalyzer({
        apiKey: options.apiKey,
        model: options.model,
        baseUrl: options.baseUrl,
      });
  }
}
