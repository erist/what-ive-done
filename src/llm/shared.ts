import type { AutomationSuitability, WorkflowLLMAnalysis, WorkflowSummaryPayloadRecord } from "../domain/types.js";

export interface WorkflowAnalysisResponse {
  workflow_name: string;
  workflow_summary: string;
  automation_suitability: AutomationSuitability;
  recommended_approach: string;
  rationale: string;
}

export const WORKFLOW_ANALYSIS_JSON_SCHEMA = {
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
} as const;

export function buildWorkflowAnalysisInstructions(): string {
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

export function parseWorkflowAnalysisText(text: string): WorkflowAnalysisResponse {
  const parsed = JSON.parse(text) as Partial<WorkflowAnalysisResponse>;

  if (
    !parsed.workflow_name ||
    !parsed.workflow_summary ||
    !parsed.automation_suitability ||
    !parsed.recommended_approach ||
    !parsed.rationale
  ) {
    throw new Error("Structured workflow analysis response was missing required fields");
  }

  return {
    workflow_name: parsed.workflow_name,
    workflow_summary: parsed.workflow_summary,
    automation_suitability: parsed.automation_suitability,
    recommended_approach: parsed.recommended_approach,
    rationale: parsed.rationale,
  };
}

export function toWorkflowLLMAnalysis(
  record: WorkflowSummaryPayloadRecord,
  provider: string,
  model: string,
  response: WorkflowAnalysisResponse,
): WorkflowLLMAnalysis {
  return {
    workflowClusterId: record.workflowClusterId,
    provider,
    model,
    workflowName: response.workflow_name,
    workflowSummary: response.workflow_summary,
    automationSuitability: response.automation_suitability,
    recommendedApproach: response.recommended_approach,
    rationale: response.rationale,
    createdAt: new Date().toISOString(),
  };
}

export function createOpenAIResponseFormat() {
  return {
    type: "json_schema",
    name: "workflow_analysis",
    strict: true,
    schema: WORKFLOW_ANALYSIS_JSON_SCHEMA,
  } as const;
}

export function createGeminiResponseSchema() {
  return {
    type: "OBJECT",
    properties: {
      workflow_name: {
        type: "STRING",
      },
      workflow_summary: {
        type: "STRING",
      },
      automation_suitability: {
        type: "STRING",
        enum: ["high", "medium", "low"],
      },
      recommended_approach: {
        type: "STRING",
      },
      rationale: {
        type: "STRING",
      },
    },
    required: [
      "workflow_name",
      "workflow_summary",
      "automation_suitability",
      "recommended_approach",
      "rationale",
    ],
    propertyOrdering: [
      "workflow_name",
      "workflow_summary",
      "automation_suitability",
      "recommended_approach",
      "rationale",
    ],
  } as const;
}
