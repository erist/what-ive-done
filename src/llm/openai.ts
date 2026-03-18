import type { WorkflowLLMAnalysis, WorkflowSummaryPayloadRecord } from "../domain/types.js";
import {
  buildWorkflowAnalysisInstructions,
  createOpenAIResponseFormat,
  parseWorkflowAnalysisText,
  toWorkflowLLMAnalysis,
} from "./shared.js";

export interface OpenAIWorkflowAnalyzerOptions {
  apiKey: string;
  provider?: "openai" | "openai-codex" | undefined;
  model?: string | undefined;
  baseUrl?: string | undefined;
  onUnauthorized?: (() => Promise<string>) | undefined;
  fetchImpl?: typeof fetch | undefined;
}

export interface OpenAIWorkflowAnalyzer {
  analyze(record: WorkflowSummaryPayloadRecord): Promise<WorkflowLLMAnalysis>;
}

interface OpenAIResponsesApiResponse {
  output_text?: string | undefined;
  output?: Array<{
    content?: Array<{
      type?: string | undefined;
      text?: string | undefined;
    }> | undefined;
  }> | undefined;
}

const DEFAULT_OPENAI_MODEL = "gpt-5-mini";
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

function extractOutputText(response: OpenAIResponsesApiResponse): string {
  if (typeof response.output_text === "string" && response.output_text.trim().length > 0) {
    return response.output_text;
  }

  const contentText = response.output
    ?.flatMap((item) => item.content ?? [])
    .map((item) => item.text)
    .find((text): text is string => typeof text === "string" && text.trim().length > 0);

  if (!contentText) {
    throw new Error("OpenAI response did not contain structured output text");
  }

  return contentText;
}

function parseStructuredAnalysis(response: OpenAIResponsesApiResponse) {
  const outputText = extractOutputText(response);
  return parseWorkflowAnalysisText(outputText);
}

export function createOpenAIWorkflowAnalyzer(
  options: OpenAIWorkflowAnalyzerOptions,
): OpenAIWorkflowAnalyzer {
  const fetchImpl = options.fetchImpl ?? fetch;
  const provider = options.provider ?? "openai";
  const model = options.model ?? DEFAULT_OPENAI_MODEL;

  async function requestAnalysis(
    record: WorkflowSummaryPayloadRecord,
    apiKey: string,
  ): Promise<Response> {
    return fetchImpl(`${options.baseUrl ?? DEFAULT_OPENAI_BASE_URL}/responses`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        store: false,
        instructions: buildWorkflowAnalysisInstructions(),
        input: JSON.stringify(record.payload),
        text: {
          format: createOpenAIResponseFormat(),
        },
      }),
    });
  }

  return {
    async analyze(record: WorkflowSummaryPayloadRecord): Promise<WorkflowLLMAnalysis> {
      let apiKey = options.apiKey;
      let response = await requestAnalysis(record, apiKey);

      if (response.status === 401 && options.onUnauthorized) {
        apiKey = await options.onUnauthorized();
        response = await requestAnalysis(record, apiKey);
      }

      if (!response.ok) {
        throw new Error(`OpenAI Responses API request failed with status ${response.status}`);
      }

      const parsed = parseStructuredAnalysis(
        (await response.json()) as OpenAIResponsesApiResponse,
      );

      return toWorkflowLLMAnalysis(record, provider, model, parsed);
    },
  };
}
