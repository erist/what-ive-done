import type { AutomationSuitability, WorkflowLLMAnalysis, WorkflowSummaryPayloadRecord } from "../domain/types.js";

export interface OpenAIWorkflowAnalyzerOptions {
  apiKey: string;
  model?: string | undefined;
  baseUrl?: string | undefined;
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

interface OpenAIWorkflowAnalysisResponse {
  workflow_name: string;
  workflow_summary: string;
  automation_suitability: AutomationSuitability;
  recommended_approach: string;
  rationale: string;
}

const DEFAULT_OPENAI_MODEL = "gpt-5-mini";
const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const RESPONSE_FORMAT_SCHEMA = {
  type: "json_schema",
  name: "workflow_analysis",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      workflow_name: {
        type: "string",
        minLength: 1,
      },
      workflow_summary: {
        type: "string",
        minLength: 1,
      },
      automation_suitability: {
        type: "string",
        enum: ["high", "medium", "low"],
      },
      recommended_approach: {
        type: "string",
        minLength: 1,
      },
      rationale: {
        type: "string",
        minLength: 1,
      },
    },
    required: [
      "workflow_name",
      "workflow_summary",
      "automation_suitability",
      "recommended_approach",
      "rationale",
    ],
  },
} as const;

function buildInstructions(): string {
  return [
    "You analyze summarized employee workflows to identify repetitive work.",
    "Return only structured JSON.",
    "Do not invent raw user actions, raw URLs, or raw window titles.",
    "Use the summarized payload only.",
    "Keep workflow_name concise and human-readable.",
    "Set automation_suitability to high, medium, or low.",
    "Keep workflow_summary and rationale concise.",
  ].join(" ");
}

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

function parseStructuredAnalysis(response: OpenAIResponsesApiResponse): OpenAIWorkflowAnalysisResponse {
  const outputText = extractOutputText(response);
  const parsed = JSON.parse(outputText) as Partial<OpenAIWorkflowAnalysisResponse>;

  if (
    !parsed.workflow_name ||
    !parsed.workflow_summary ||
    !parsed.automation_suitability ||
    !parsed.recommended_approach ||
    !parsed.rationale
  ) {
    throw new Error("OpenAI structured analysis response was missing required fields");
  }

  return {
    workflow_name: parsed.workflow_name,
    workflow_summary: parsed.workflow_summary,
    automation_suitability: parsed.automation_suitability,
    recommended_approach: parsed.recommended_approach,
    rationale: parsed.rationale,
  };
}

export function createOpenAIWorkflowAnalyzer(
  options: OpenAIWorkflowAnalyzerOptions,
): OpenAIWorkflowAnalyzer {
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async analyze(record: WorkflowSummaryPayloadRecord): Promise<WorkflowLLMAnalysis> {
      const response = await fetchImpl(`${options.baseUrl ?? DEFAULT_OPENAI_BASE_URL}/responses`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: options.model ?? DEFAULT_OPENAI_MODEL,
          store: false,
          instructions: buildInstructions(),
          input: JSON.stringify(record.payload),
          text: {
            format: RESPONSE_FORMAT_SCHEMA,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`OpenAI Responses API request failed with status ${response.status}`);
      }

      const parsed = parseStructuredAnalysis(
        (await response.json()) as OpenAIResponsesApiResponse,
      );

      return {
        workflowClusterId: record.workflowClusterId,
        provider: "openai",
        model: options.model ?? DEFAULT_OPENAI_MODEL,
        workflowName: parsed.workflow_name,
        workflowSummary: parsed.workflow_summary,
        automationSuitability: parsed.automation_suitability,
        recommendedApproach: parsed.recommended_approach,
        rationale: parsed.rationale,
        createdAt: new Date().toISOString(),
      };
    },
  };
}
