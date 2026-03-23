import { resolveConfiguredAnalyzeOptions } from "../config/workflow-analysis.js";
import type { WorkflowCluster, WorkflowFeedback, WorkflowFeedbackSummary } from "../domain/types.js";
import { analyzeRawEvents } from "../pipeline/analyze.js";
import type { AppDatabase } from "../storage/database.js";

export interface SaveWorkflowReviewInput {
  workflowId: string;
  name?: string | undefined;
  purpose?: string | undefined;
  repetitive?: boolean | undefined;
  automationCandidate?: boolean | undefined;
  difficulty?: WorkflowFeedback["automationDifficulty"] | undefined;
  approvedAutomationCandidate?: boolean | undefined;
  excluded?: boolean | undefined;
  hidden?: boolean | undefined;
  mergeIntoWorkflowId?: string | undefined;
  splitAfterActionName?: string | undefined;
}

export interface SaveWorkflowReviewResult {
  feedback: WorkflowFeedback;
  workflow?: WorkflowCluster | undefined;
  affectedWorkflows: WorkflowCluster[];
  resolvedWorkflowId?: string | undefined;
  analysisRefreshed: boolean;
}

function hasUserFeedback(feedback: WorkflowFeedbackSummary | undefined): boolean {
  if (!feedback) {
    return false;
  }

  return Boolean(
    feedback.renameTo ??
      feedback.businessPurpose ??
      feedback.excluded ??
      feedback.hidden ??
      feedback.repetitive ??
      feedback.automationCandidate ??
      feedback.automationDifficulty ??
      feedback.approvedAutomationCandidate ??
      feedback.mergeIntoWorkflowId ??
      feedback.mergeIntoWorkflowSignature ??
      feedback.splitAfterActionName,
  );
}

export function applyWorkflowFeedbackToCluster(
  cluster: WorkflowCluster,
  feedbackByClusterId: Map<string, WorkflowFeedbackSummary>,
): WorkflowCluster {
  const feedback =
    feedbackByClusterId.get(cluster.id) ?? feedbackByClusterId.get(cluster.workflowSignature);

  if (!feedback) {
    return cluster;
  }

  return {
    ...cluster,
    name: feedback.renameTo ?? cluster.name,
    businessPurpose: feedback.businessPurpose ?? cluster.businessPurpose,
    excluded: feedback.excluded ?? cluster.excluded,
    hidden: feedback.hidden ?? cluster.hidden,
    repetitive: feedback.repetitive ?? cluster.repetitive,
    automationCandidate: feedback.automationCandidate ?? cluster.automationCandidate,
    automationDifficulty: feedback.automationDifficulty ?? cluster.automationDifficulty,
    approvedAutomationCandidate:
      feedback.approvedAutomationCandidate ?? cluster.approvedAutomationCandidate,
    mergeIntoWorkflowId: feedback.mergeIntoWorkflowId ?? cluster.mergeIntoWorkflowId,
    mergeIntoWorkflowSignature:
      feedback.mergeIntoWorkflowSignature ?? cluster.mergeIntoWorkflowSignature,
    splitAfterActionName: feedback.splitAfterActionName ?? cluster.splitAfterActionName,
    userLabeled: cluster.userLabeled || hasUserFeedback(feedback),
  };
}

export function applyWorkflowFeedbackToClusters(
  clusters: WorkflowCluster[],
  feedbackByClusterId: Map<string, WorkflowFeedbackSummary>,
): WorkflowCluster[] {
  return clusters.map((cluster) => applyWorkflowFeedbackToCluster(cluster, feedbackByClusterId));
}

export function getWorkflowClusterForReview(
  database: AppDatabase,
  workflowId: string,
): WorkflowCluster {
  const workflow = database.getWorkflowClusterById(workflowId);

  if (!workflow) {
    throw new Error(`Workflow cluster not found: ${workflowId}`);
  }

  return applyWorkflowFeedbackToCluster(workflow, database.listWorkflowFeedbackSummary());
}

function ensureWorkflowArtifacts(
  database: AppDatabase,
  workflowId: string,
): void {
  if (database.getWorkflowClusterById(workflowId)) {
    return;
  }

  const feedbackByWorkflowSignature = database.listWorkflowFeedbackSummary();
  const analysisResult = analyzeRawEvents(database.getRawEventsChronological(), {
    ...resolveConfiguredAnalyzeOptions(database.paths.dataDir),
    feedbackByWorkflowSignature,
  });

  database.replaceAnalysisArtifacts(analysisResult);
}

function rebuildWorkflowArtifacts(database: AppDatabase): WorkflowCluster[] {
  const feedbackByWorkflowSignature = database.listWorkflowFeedbackSummary();
  const analysisResult = analyzeRawEvents(database.getRawEventsChronological(), {
    ...resolveConfiguredAnalyzeOptions(database.paths.dataDir),
    feedbackByWorkflowSignature,
  });

  database.replaceAnalysisArtifacts(analysisResult);

  return applyWorkflowFeedbackToClusters(
    database.listWorkflowClusters(),
    database.listWorkflowFeedbackSummary(),
  );
}

function collectNormalizedEventIdsForWorkflow(
  database: AppDatabase,
  workflow: WorkflowCluster,
): Set<string> {
  const normalizedEventIds = new Set<string>();

  for (const sessionId of workflow.sessionIds) {
    const session = database.getSessionById(sessionId);

    for (const step of session?.steps ?? []) {
      if (step.normalizedEventId) {
        normalizedEventIds.add(step.normalizedEventId);
      }
    }
  }

  return normalizedEventIds;
}

function workflowOverlapsNormalizedEvents(
  database: AppDatabase,
  workflow: WorkflowCluster,
  normalizedEventIds: Set<string>,
): boolean {
  if (normalizedEventIds.size === 0) {
    return false;
  }

  for (const sessionId of workflow.sessionIds) {
    const session = database.getSessionById(sessionId);

    if (session?.steps.some((step) => normalizedEventIds.has(step.normalizedEventId))) {
      return true;
    }
  }

  return false;
}

function sortAffectedWorkflows(workflows: WorkflowCluster[]): WorkflowCluster[] {
  return [...workflows].sort(
    (left, right) =>
      right.frequency - left.frequency ||
      right.totalDurationSeconds - left.totalDurationSeconds ||
      left.name.localeCompare(right.name),
  );
}

function deriveSplitSequences(
  workflow: WorkflowCluster,
  splitAfterActionName: string | undefined,
): string[][] {
  if (!splitAfterActionName) {
    return [];
  }

  const splitIndex = workflow.representativeSequence.findIndex(
    (actionName) => actionName === splitAfterActionName,
  );

  if (splitIndex < 0) {
    return [];
  }

  return [
    workflow.representativeSequence.slice(0, splitIndex + 1),
    workflow.representativeSequence.slice(splitIndex + 1),
  ].filter((sequence) => sequence.length > 0);
}

function matchesAnyRepresentativeSequence(
  workflow: WorkflowCluster,
  expectedSequences: string[][],
): boolean {
  const sequence = workflow.representativeSequence.join(">");

  return expectedSequences.some((candidate) => candidate.join(">") === sequence);
}

export function saveWorkflowReview(
  database: AppDatabase,
  input: SaveWorkflowReviewInput,
): SaveWorkflowReviewResult {
  ensureWorkflowArtifacts(database, input.workflowId);
  const sourceWorkflow = getWorkflowClusterForReview(database, input.workflowId);
  const sourceNormalizedEventIds = collectNormalizedEventIdsForWorkflow(database, sourceWorkflow);
  const expectedSplitSequences = deriveSplitSequences(sourceWorkflow, input.splitAfterActionName);

  const feedback = database.saveWorkflowFeedback({
    workflowClusterId: input.workflowId,
    renameTo: input.name,
    businessPurpose: input.purpose,
    repetitive: input.repetitive,
    automationCandidate: input.automationCandidate,
    automationDifficulty: input.difficulty,
    approvedAutomationCandidate: input.approvedAutomationCandidate,
    excluded: input.excluded,
    hidden: input.hidden,
    mergeIntoWorkflowId: input.mergeIntoWorkflowId,
    splitAfterActionName: input.splitAfterActionName,
  });
  const refreshedWorkflows = rebuildWorkflowArtifacts(database);
  const affectedWorkflows = sortAffectedWorkflows(
    refreshedWorkflows.filter(
      (workflow) =>
        workflow.id === input.workflowId ||
        workflow.id === input.mergeIntoWorkflowId ||
        workflow.workflowSignature === feedback.workflowSignature ||
        matchesAnyRepresentativeSequence(workflow, expectedSplitSequences) ||
        workflowOverlapsNormalizedEvents(database, workflow, sourceNormalizedEventIds),
    ),
  );
  const resolvedWorkflowId =
    refreshedWorkflows.find((workflow) => workflow.id === input.workflowId)?.id ??
    refreshedWorkflows.find((workflow) => workflow.id === input.mergeIntoWorkflowId)?.id ??
    affectedWorkflows[0]?.id;

  return {
    feedback,
    workflow: resolvedWorkflowId
      ? refreshedWorkflows.find((workflow) => workflow.id === resolvedWorkflowId)
      : undefined,
    affectedWorkflows,
    resolvedWorkflowId,
    analysisRefreshed: true,
  };
}
