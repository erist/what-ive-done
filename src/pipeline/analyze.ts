import type {
  NormalizedEvent,
  RawEvent,
  Session,
  WorkflowCluster,
  WorkflowFeedbackSummary,
} from "../domain/types.js";
import { stableId } from "../domain/ids.js";
import { buildWorkflowSignatureFromSteps, clusterSessions } from "./cluster.js";
import { normalizeRawEvents } from "./normalize.js";
import { sessionizeNormalizedEvents } from "./sessionize.js";

export interface AnalysisResult {
  normalizedEvents: NormalizedEvent[];
  sessions: Session[];
  workflowClusters: WorkflowCluster[];
}

export interface AnalyzeOptions {
  inactivityThresholdMs?: number;
  contextShiftThresholdMs?: number;
  interruptionResetThresholdMs?: number;
  significantContextScore?: number;
  similarityThreshold?: number;
  minSessionDurationSeconds?: number;
  minimumWorkflowFrequency?: number;
  feedbackByWorkflowSignature?: Map<string, WorkflowFeedbackSummary> | undefined;
}

function compactActionSequenceForLegacy(steps: Session["steps"]): string[] {
  const actions = steps.map((step) => step.actionName);

  return actions.filter((action, index) => action !== actions[index - 1]);
}

function buildLegacyWorkflowSignature(steps: Session["steps"]): string {
  return stableId("workflow_signature", compactActionSequenceForLegacy(steps).join(">"));
}

function resolveWorkflowFeedbackSummary(args: {
  workflowSignature: string;
  legacyWorkflowSignature?: string | undefined;
  feedbackByWorkflowSignature: Map<string, WorkflowFeedbackSummary>;
}): WorkflowFeedbackSummary | undefined {
  return (
    args.feedbackByWorkflowSignature.get(args.workflowSignature) ??
    (args.legacyWorkflowSignature
      ? args.feedbackByWorkflowSignature.get(args.legacyWorkflowSignature)
      : undefined)
  );
}

function countMostCommon(values: string[]): string {
  const counts = new Map<string, number>();

  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? values[0] ?? "unknown";
}

function countMostCommonOptional(values: string[]): string | undefined {
  if (values.length === 0) {
    return undefined;
  }

  return countMostCommon(values);
}

function splitSessionsWithFeedback(
  sessions: Session[],
  feedbackByWorkflowSignature: Map<string, WorkflowFeedbackSummary> | undefined,
): Session[] {
  if (!feedbackByWorkflowSignature || feedbackByWorkflowSignature.size === 0) {
    return sessions;
  }

  const splitSessions: Session[] = [];

  for (const session of sessions) {
    const signature = buildWorkflowSignatureFromSteps(session.steps);
    const splitAfterActionName = resolveWorkflowFeedbackSummary({
      workflowSignature: signature,
      legacyWorkflowSignature: buildLegacyWorkflowSignature(session.steps),
      feedbackByWorkflowSignature,
    })?.splitAfterActionName;

    if (!splitAfterActionName) {
      splitSessions.push(session);
      continue;
    }

    const splitIndex = session.steps.findIndex((step) => step.actionName === splitAfterActionName);

    if (splitIndex <= 0 || splitIndex >= session.steps.length - 1) {
      splitSessions.push(session);
      continue;
    }

    const fragments = [session.steps.slice(0, splitIndex + 1), session.steps.slice(splitIndex + 1)];

    fragments.forEach((steps, fragmentIndex) => {
      const startTime = steps[0]?.timestamp ?? session.startTime;
      const endTime = steps[steps.length - 1]?.timestamp ?? session.endTime;
      const fragmentSeed = `${session.id}:${fragmentIndex + 1}:${startTime}:${endTime}`;

      splitSessions.push({
        id: stableId("session_fragment", fragmentSeed),
        startTime,
        endTime,
        primaryApplication: countMostCommon(steps.map((step) => step.application)),
        primaryDomain: countMostCommonOptional(
          steps.map((step) => step.domain).filter((value): value is string => Boolean(value)),
        ),
        sessionBoundaryReason:
          fragmentIndex === 0 ? session.sessionBoundaryReason : "context_shift",
        sessionBoundaryDetails:
          fragmentIndex === 0
            ? session.sessionBoundaryDetails
            : {
                reason: "user_split_rule",
                originalSessionId: session.id,
                splitAfterActionName,
              },
        steps: steps.map((step, index) => ({
          ...step,
          order: index + 1,
        })),
      });
    });
  }

  return splitSessions;
}

function mergeWorkflowClusters(
  clusters: WorkflowCluster[],
  feedbackByWorkflowSignature: Map<string, WorkflowFeedbackSummary> | undefined,
): WorkflowCluster[] {
  if (!feedbackByWorkflowSignature || feedbackByWorkflowSignature.size === 0) {
    return clusters;
  }

  const grouped = new Map<string, WorkflowCluster[]>();

  for (const cluster of clusters) {
    const mergeIntoWorkflowSignature = resolveWorkflowFeedbackSummary({
      workflowSignature: cluster.workflowSignature,
      legacyWorkflowSignature: stableId(
        "workflow_signature",
        cluster.representativeSequence.join(">"),
      ),
      feedbackByWorkflowSignature,
    })?.mergeIntoWorkflowSignature;
    const targetSignature = mergeIntoWorkflowSignature ?? cluster.workflowSignature;
    grouped.set(targetSignature, [...(grouped.get(targetSignature) ?? []), cluster]);
  }

  return [...grouped.entries()]
    .map(([targetSignature, members]) => {
      if (members.length === 1) {
        const onlyCluster = members[0];

        if (!onlyCluster) {
          throw new Error(`Expected a workflow cluster for signature ${targetSignature}`);
        }

        return {
          ...onlyCluster,
          id: stableId("workflow_cluster", targetSignature),
          workflowSignature: targetSignature,
        };
      }

      const representative =
        [...members].sort(
          (left, right) =>
            right.occurrenceCount - left.occurrenceCount || right.confidenceScore - left.confidenceScore,
        )[0] ?? members[0];

      if (!representative) {
        throw new Error(`Expected representative workflow cluster for ${targetSignature}`);
      }
      const totalDurationSeconds = members.reduce((sum, cluster) => sum + cluster.totalDurationSeconds, 0);
      const occurrenceCount = members.reduce((sum, cluster) => sum + cluster.occurrenceCount, 0);
      const frequency = members.reduce((sum, cluster) => sum + cluster.frequency, 0);
      const topVariants = [...members]
        .flatMap((cluster) => cluster.topVariants)
        .reduce<Map<string, { sequence: string[]; occurrenceCount: number; totalDurationSeconds: number }>>(
          (map, variant) => {
            const key = variant.sequence.join(">");
            const current = map.get(key) ?? {
              sequence: variant.sequence,
              occurrenceCount: 0,
              totalDurationSeconds: 0,
            };

            current.occurrenceCount += variant.occurrenceCount;
            current.totalDurationSeconds +=
              variant.averageDurationSeconds * variant.occurrenceCount;
            map.set(key, current);

            return map;
          },
          new Map(),
        );

      return {
        ...representative,
        id: stableId("workflow_cluster", targetSignature),
        workflowSignature: targetSignature,
        sessionIds: [...new Set(members.flatMap((cluster) => cluster.sessionIds))],
        occurrenceCount,
        frequency,
        averageDurationSeconds: occurrenceCount === 0 ? 0 : totalDurationSeconds / occurrenceCount,
        totalDurationSeconds,
        involvedApps: [...new Set(members.flatMap((cluster) => cluster.involvedApps))],
        confidenceScore:
          members.reduce(
            (sum, cluster) => sum + cluster.confidenceScore * cluster.occurrenceCount,
            0,
          ) / Math.max(1, occurrenceCount),
        confidenceDetails: {
          similarityWeights: representative.confidenceDetails.similarityWeights,
          confidenceWeights: representative.confidenceDetails.confidenceWeights,
          averageSequenceSimilarity:
            members.reduce(
              (sum, cluster) =>
                sum + cluster.confidenceDetails.averageSequenceSimilarity * cluster.occurrenceCount,
              0,
            ) / Math.max(1, occurrenceCount),
          averageActionSetSimilarity:
            members.reduce(
              (sum, cluster) =>
                sum + cluster.confidenceDetails.averageActionSetSimilarity * cluster.occurrenceCount,
              0,
            ) / Math.max(1, occurrenceCount),
          averageContextSimilarity:
            members.reduce(
              (sum, cluster) =>
                sum + cluster.confidenceDetails.averageContextSimilarity * cluster.occurrenceCount,
              0,
            ) / Math.max(1, occurrenceCount),
          averageTimeOfDaySimilarity:
            members.reduce(
              (sum, cluster) =>
                sum + cluster.confidenceDetails.averageTimeOfDaySimilarity * cluster.occurrenceCount,
              0,
            ) / Math.max(1, occurrenceCount),
          averageCompositeSimilarity:
            members.reduce(
              (sum, cluster) =>
                sum + cluster.confidenceDetails.averageCompositeSimilarity * cluster.occurrenceCount,
              0,
            ) / Math.max(1, occurrenceCount),
          topVariantConcentration:
            members.reduce(
              (sum, cluster) =>
                sum + cluster.confidenceDetails.topVariantConcentration * cluster.occurrenceCount,
              0,
            ) / Math.max(1, occurrenceCount),
          repetitionScore:
            members.reduce(
              (sum, cluster) =>
                sum + cluster.confidenceDetails.repetitionScore * cluster.occurrenceCount,
              0,
            ) / Math.max(1, occurrenceCount),
        },
        topVariants: [...topVariants.values()]
          .map((variant) => ({
            sequence: variant.sequence,
            occurrenceCount: variant.occurrenceCount,
            averageDurationSeconds:
              variant.occurrenceCount === 0
                ? 0
                : variant.totalDurationSeconds / variant.occurrenceCount,
          }))
          .sort(
            (left, right) =>
              right.occurrenceCount - left.occurrenceCount ||
              right.averageDurationSeconds - left.averageDurationSeconds,
          )
          .slice(0, 3),
      };
    })
    .sort(
      (left, right) =>
        right.frequency - left.frequency ||
        right.confidenceScore - left.confidenceScore ||
        right.totalDurationSeconds - left.totalDurationSeconds,
    );
}

export function analyzeRawEvents(rawEvents: RawEvent[], options: AnalyzeOptions = {}): AnalysisResult {
  const normalizedEvents = normalizeRawEvents(rawEvents);
  const sessionizeOptions = {
    ...(options.inactivityThresholdMs !== undefined
      ? { inactivityThresholdMs: options.inactivityThresholdMs }
      : {}),
    ...(options.contextShiftThresholdMs !== undefined
      ? { contextShiftThresholdMs: options.contextShiftThresholdMs }
      : {}),
    ...(options.interruptionResetThresholdMs !== undefined
      ? { interruptionResetThresholdMs: options.interruptionResetThresholdMs }
      : {}),
    ...(options.significantContextScore !== undefined
      ? { significantContextScore: options.significantContextScore }
      : {}),
  };
  const clusterOptions = {
    ...(options.similarityThreshold !== undefined
      ? { similarityThreshold: options.similarityThreshold }
      : {}),
    ...(options.minSessionDurationSeconds !== undefined
      ? { minSessionDurationSeconds: options.minSessionDurationSeconds }
      : {}),
    ...(options.minimumWorkflowFrequency !== undefined
      ? { minimumWorkflowFrequency: options.minimumWorkflowFrequency }
      : {}),
  };
  const sessions = sessionizeNormalizedEvents(normalizedEvents, sessionizeOptions);
  const splitSessions = splitSessionsWithFeedback(
    sessions,
    options.feedbackByWorkflowSignature,
  );
  const workflowClusters = mergeWorkflowClusters(
    clusterSessions(splitSessions, clusterOptions),
    options.feedbackByWorkflowSignature,
  );

  return {
    normalizedEvents,
    sessions: splitSessions,
    workflowClusters,
  };
}
