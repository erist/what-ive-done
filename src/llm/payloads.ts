import type { LLMWorkflowSummaryPayload } from "../domain/types.js";

export interface WorkflowSummaryPayloadInput {
  representativeSteps: string[];
  frequency: number;
  averageDurationSeconds: number;
  applications: string[];
  domains: string[];
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function buildWorkflowSummaryPayload(
  input: WorkflowSummaryPayloadInput,
): LLMWorkflowSummaryPayload {
  return {
    workflowSteps: input.representativeSteps,
    frequency: input.frequency,
    averageDurationSeconds: input.averageDurationSeconds,
    applications: unique(input.applications),
    domains: unique(input.domains.filter((domain) => domain.length > 0)),
  };
}
