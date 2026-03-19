import type { LLMWorkflowSummaryPayload, WorkflowCluster } from "../domain/types.js";

export interface WorkflowSummaryPayloadInput {
  representativeSteps: string[];
  frequency: number;
  averageDurationSeconds: number;
  applications: string[];
  domains: string[];
}

export interface WorkflowPayloadFilterOptions {
  includeExcluded?: boolean | undefined;
  includeHidden?: boolean | undefined;
  includeShortForm?: boolean | undefined;
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

export function filterWorkflowClustersForPayloads(
  clusters: WorkflowCluster[],
  options: WorkflowPayloadFilterOptions = {},
): WorkflowCluster[] {
  const includeExcluded = options.includeExcluded ?? false;
  const includeHidden = options.includeHidden ?? false;
  const includeShortForm = options.includeShortForm ?? false;

  return clusters.filter(
    (cluster) =>
      (includeExcluded || !cluster.excluded) &&
      (includeHidden || !cluster.hidden) &&
      (includeShortForm || cluster.detectionMode !== "short_form"),
  );
}
