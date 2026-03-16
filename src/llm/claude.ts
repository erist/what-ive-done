import type { WorkflowLLMAnalysis, WorkflowSummaryPayloadRecord } from "../domain/types.js";
import {
  buildWorkflowAnalysisInstructions,
  parseWorkflowAnalysisText,
  toWorkflowLLMAnalysis,
  WORKFLOW_ANALYSIS_JSON_SCHEMA,
} from "./shared.js";

export interface ClaudeWorkflowAnalyzerOptions {
  apiKey: string;
  model?: string | undefined;
  baseUrl?: string | undefined;
  anthropicVersion?: string | undefined;
  fetchImpl?: typeof fetch | undefined;
}

export interface ClaudeWorkflowAnalyzer {
  analyze(record: WorkflowSummaryPayloadRecord): Promise<WorkflowLLMAnalysis>;
}

interface ClaudeMessagesResponse {
  content?: Array<{
    type?: string | undefined;
    input?: unknown;
  }> | undefined;
}

const DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-5";
const DEFAULT_CLAUDE_BASE_URL = "https://api.anthropic.com/v1";
const DEFAULT_ANTHROPIC_VERSION = "2023-06-01";
const TOOL_NAME = "workflow_analysis";

function extractToolInput(response: ClaudeMessagesResponse): string {
  const toolUse = response.content?.find(
    (item) => item.type === "tool_use" && item.input !== undefined,
  );

  if (!toolUse) {
    throw new Error("Claude response did not contain a workflow_analysis tool call");
  }

  return JSON.stringify(toolUse.input);
}

export function createClaudeWorkflowAnalyzer(
  options: ClaudeWorkflowAnalyzerOptions,
): ClaudeWorkflowAnalyzer {
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async analyze(record: WorkflowSummaryPayloadRecord): Promise<WorkflowLLMAnalysis> {
      const response = await fetchImpl(`${options.baseUrl ?? DEFAULT_CLAUDE_BASE_URL}/messages`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": options.apiKey,
          "anthropic-version": options.anthropicVersion ?? DEFAULT_ANTHROPIC_VERSION,
        },
        body: JSON.stringify({
          model: options.model ?? DEFAULT_CLAUDE_MODEL,
          max_tokens: 512,
          system: `${buildWorkflowAnalysisInstructions()} Always call the workflow_analysis tool.`,
          messages: [
            {
              role: "user",
              content: JSON.stringify(record.payload),
            },
          ],
          tools: [
            {
              name: TOOL_NAME,
              description: "Return the structured workflow analysis result.",
              input_schema: WORKFLOW_ANALYSIS_JSON_SCHEMA,
            },
          ],
          tool_choice: {
            type: "tool",
            name: TOOL_NAME,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Claude Messages API request failed with status ${response.status}`);
      }

      const parsed = parseWorkflowAnalysisText(
        extractToolInput((await response.json()) as ClaudeMessagesResponse),
      );

      return toWorkflowLLMAnalysis(record, "claude", options.model ?? DEFAULT_CLAUDE_MODEL, parsed);
    },
  };
}
