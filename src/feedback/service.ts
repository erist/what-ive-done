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
  workflow: WorkflowCluster;
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
    userLabeled:
      cluster.userLabeled ||
      Boolean(
        feedback.renameTo ??
          feedback.businessPurpose ??
          feedback.repetitive ??
          feedback.automationCandidate ??
          feedback.automationDifficulty ??
          feedback.approvedAutomationCandidate,
      ),
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

export function saveWorkflowReview(
  database: AppDatabase,
  input: SaveWorkflowReviewInput,
): SaveWorkflowReviewResult {
  ensureWorkflowArtifacts(database, input.workflowId);

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

  return {
    feedback,
    workflow: getWorkflowClusterForReview(database, input.workflowId),
  };
}
