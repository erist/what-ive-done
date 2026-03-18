import type { LLMAuthMethod, LLMProvider } from "../llm/catalog.js";
import {
  detectClaude,
  detectGemini,
  detectGh,
  detectGit,
  detectGitRepo,
  detectGws,
  detectOpenaiCodex,
  detectOpenai,
  type DetectionResult,
} from "./detect.js";

export type ToolCategory = "collector" | "analyzer";
export type ToolName = "gws" | "git" | "gh" | LLMProvider;

export interface ToolPromptDefinition {
  key: string;
  message: string;
  defaultValue?: string | undefined;
  detectDefault?: ((cwd: string) => Promise<string | null>) | undefined;
}

export interface ToolDefinition {
  name: ToolName;
  category: ToolCategory;
  displayName: string;
  description: string;
  detect: (context?: { cwd?: string | undefined }) => Promise<DetectionResult>;
  prompts?: ToolPromptDefinition[] | undefined;
  authMethods?: LLMAuthMethod[] | undefined;
}

export const TOOL_REGISTRY: ToolDefinition[] = [
  {
    name: "gws",
    category: "collector",
    displayName: "Google Workspace",
    description: "Calendar/Drive/Sheets context via gws CLI",
    detect: () => detectGws(),
  },
  {
    name: "git",
    category: "collector",
    displayName: "Git",
    description: "Commit and branch context from one local repository",
    detect: (context) => detectGit(context?.cwd),
    prompts: [
      {
        key: "repo-path",
        message: "Git repo path",
        detectDefault: (cwd) => detectGitRepo(cwd),
      },
    ],
  },
  {
    name: "gh",
    category: "collector",
    displayName: "GitHub CLI",
    description: "GitHub CLI authentication and issue/PR context readiness",
    detect: () => detectGh(),
  },
  {
    name: "gemini",
    category: "analyzer",
    displayName: "Gemini",
    description: "Gemini workflow analysis",
    detect: () => detectGemini(),
    authMethods: ["oauth2", "api-key"],
    prompts: [
      {
        key: "model",
        message: "Model",
        defaultValue: "gemini-2.5-flash",
      },
    ],
  },
  {
    name: "claude",
    category: "analyzer",
    displayName: "Claude",
    description: "Claude workflow analysis",
    detect: () => detectClaude(),
    authMethods: ["api-key"],
    prompts: [
      {
        key: "model",
        message: "Model",
        defaultValue: "claude-sonnet-4-5",
      },
    ],
  },
  {
    name: "openai",
    category: "analyzer",
    displayName: "OpenAI",
    description: "ChatGPT workflow analysis",
    detect: () => detectOpenai(),
    authMethods: ["api-key"],
    prompts: [
      {
        key: "model",
        message: "Model",
        defaultValue: "gpt-5-mini",
      },
    ],
  },
  {
    name: "openai-codex",
    category: "analyzer",
    displayName: "OpenAI Codex",
    description: "ChatGPT/Codex OAuth workflow analysis",
    detect: () => detectOpenaiCodex(),
    authMethods: ["oauth2"],
    prompts: [
      {
        key: "model",
        message: "Model",
        defaultValue: "gpt-5.4",
      },
    ],
  },
];

export function getToolDefinition(name: string): ToolDefinition | undefined {
  return TOOL_REGISTRY.find((tool) => tool.name === name);
}

export function listToolDefinitions(category?: ToolCategory): ToolDefinition[] {
  if (!category) {
    return [...TOOL_REGISTRY];
  }

  return TOOL_REGISTRY.filter((tool) => tool.category === category);
}

export function isAnalyzerToolName(name: string): name is LLMProvider {
  return listToolDefinitions("analyzer").some((tool) => tool.name === name);
}
