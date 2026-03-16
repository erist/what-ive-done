import type { WorkflowLLMAnalysis, WorkflowSummaryPayloadRecord } from "../domain/types.js";
import {
  buildWorkflowAnalysisInstructions,
  createGeminiResponseSchema,
  parseWorkflowAnalysisText,
  toWorkflowLLMAnalysis,
} from "./shared.js";

export interface GeminiWorkflowAnalyzerOptions {
  apiKey?: string | undefined;
  accessToken?: string | undefined;
  projectId?: string | undefined;
  model?: string | undefined;
  baseUrl?: string | undefined;
  fetchImpl?: typeof fetch | undefined;
}

export interface GeminiWorkflowAnalyzer {
  analyze(record: WorkflowSummaryPayloadRecord): Promise<WorkflowLLMAnalysis>;
}

interface GeminiGenerateContentResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string | undefined;
      }> | undefined;
    } | undefined;
  }> | undefined;
}

const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

function extractOutputText(response: GeminiGenerateContentResponse): string {
  const outputText = response.candidates
    ?.flatMap((candidate) => candidate.content?.parts ?? [])
    .map((part) => part.text)
    .find((text): text is string => typeof text === "string" && text.trim().length > 0);

  if (!outputText) {
    throw new Error("Gemini response did not contain structured output text");
  }

  return outputText;
}

export function createGeminiWorkflowAnalyzer(
  options: GeminiWorkflowAnalyzerOptions,
): GeminiWorkflowAnalyzer {
  const fetchImpl = options.fetchImpl ?? fetch;

  if (!options.apiKey && !options.accessToken) {
    throw new Error("Gemini analysis requires either an API key or an OAuth access token");
  }

  if (options.accessToken && !options.projectId) {
    throw new Error("Gemini OAuth analysis requires a Google Cloud project id");
  }

  return {
    async analyze(record: WorkflowSummaryPayloadRecord): Promise<WorkflowLLMAnalysis> {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      if (options.apiKey) {
        headers["x-goog-api-key"] = options.apiKey;
      }

      if (options.accessToken) {
        headers.Authorization = `Bearer ${options.accessToken}`;
        headers["x-goog-user-project"] = options.projectId ?? "";
      }

      const response = await fetchImpl(
        `${options.baseUrl ?? DEFAULT_GEMINI_BASE_URL}/models/${options.model ?? DEFAULT_GEMINI_MODEL}:generateContent`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            systemInstruction: {
              parts: [
                {
                  text: buildWorkflowAnalysisInstructions(),
                },
              ],
            },
            contents: [
              {
                role: "user",
                parts: [
                  {
                    text: JSON.stringify(record.payload),
                  },
                ],
              },
            ],
            generationConfig: {
              responseMimeType: "application/json",
              responseSchema: createGeminiResponseSchema(),
            },
          }),
        },
      );

      if (!response.ok) {
        throw new Error(`Gemini generateContent request failed with status ${response.status}`);
      }

      const parsed = parseWorkflowAnalysisText(
        extractOutputText((await response.json()) as GeminiGenerateContentResponse),
      );

      return toWorkflowLLMAnalysis(record, "gemini", options.model ?? DEFAULT_GEMINI_MODEL, parsed);
    },
  };
}
