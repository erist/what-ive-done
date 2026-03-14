import type { ReportEntry, WorkflowCluster } from "../domain/types.js";

export interface BuildReportOptions {
  includeExcluded?: boolean | undefined;
  includeHidden?: boolean | undefined;
}

export function buildReportEntries(
  clusters: WorkflowCluster[],
  options: BuildReportOptions = {},
): ReportEntry[] {
  const includeExcluded = options.includeExcluded ?? false;
  const includeHidden = options.includeHidden ?? false;

  return clusters
    .filter((cluster) => (includeExcluded || !cluster.excluded) && (includeHidden || !cluster.hidden))
    .map((cluster) => ({
    workflowClusterId: cluster.id,
    workflowName: cluster.name,
    frequency: cluster.frequency,
    averageDurationSeconds: cluster.averageDurationSeconds,
    totalDurationSeconds: cluster.totalDurationSeconds,
    automationSuitability: cluster.automationSuitability,
    recommendedApproach: cluster.recommendedApproach,
    }));
}

export function formatDuration(seconds: number): string {
  const rounded = Math.round(seconds);
  const minutes = Math.floor(rounded / 60);
  const remainingSeconds = rounded % 60;

  if (minutes === 0) {
    return `${remainingSeconds}s`;
  }

  return `${minutes}m ${remainingSeconds}s`;
}
