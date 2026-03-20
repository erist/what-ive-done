import type {
  AutomationHint,
  AutomationSuitability,
  Session,
  SessionStep,
  WorkflowCluster,
  WorkflowConfidenceDetails,
  WorkflowConfidenceWeights,
  WorkflowDetectionMode,
  WorkflowSimilarityWeights,
  WorkflowVariant,
} from "../domain/types.js";
import {
  DEFAULT_WORKFLOW_CONFIRMATION_CONFIG,
  DEFAULT_WORKFLOW_SHORT_FORM_CONFIG,
} from "../config/analysis.js";
import { stableId } from "../domain/ids.js";

export type ClusterScoringStrategy = "legacy" | "hybrid_v2";

export interface ClusterOptions {
  detectionMode?: WorkflowDetectionMode | undefined;
  similarityThreshold?: number;
  minSessionDurationSeconds?: number;
  maxSessionDurationSeconds?: number | undefined;
  maxActionSequenceLength?: number | undefined;
  minimumWorkflowFrequency?: number;
  confirmationWindowDays?: number;
  scoringStrategy?: ClusterScoringStrategy | undefined;
  similarityWeights?: Partial<WorkflowSimilarityWeights> | undefined;
  confidenceWeights?: Partial<WorkflowConfidenceWeights> | undefined;
}

interface SessionDescriptor {
  session: Session;
  tokenSequence: string[];
  actionSequence: string[];
  actionSet: string[];
  contextTokens: string[];
  durationSeconds: number;
  involvedApps: string[];
  startMinutesOfDay: number;
}

interface MutableCluster {
  descriptors: SessionDescriptor[];
}

interface SimilarityBreakdown {
  sequence: number;
  actionSet: number;
  context: number;
  timeOfDay: number;
  total: number;
}

export interface ClusterPeerComparison {
  sessionId: string;
  startTime: string;
  actionSequence: string[];
  contextTokens: string[];
  sequenceSimilarity: number;
  actionSetSimilarity: number;
  contextSimilarity: number;
  timeOfDaySimilarity: number;
  compositeSimilarity: number;
}

export interface ClusterMembershipExplanation {
  scoringStrategy: ClusterScoringStrategy;
  comparisonWindowSize: number;
  membershipScore: number;
  candidateActionSequence: string[];
  candidateContextTokens: string[];
  peerComparisons: ClusterPeerComparison[];
}

export const DEFAULT_CLUSTER_SIMILARITY_THRESHOLD = 0.74;
const DEFAULT_MINIMUM_WORKFLOW_FREQUENCY = 3;

export const DEFAULT_CLUSTER_SIMILARITY_WEIGHTS: WorkflowSimilarityWeights = {
  sequence: 0.35,
  actionSet: 0.25,
  context: 0.25,
  timeOfDay: 0.15,
};

export const DEFAULT_CLUSTER_CONFIDENCE_WEIGHTS: WorkflowConfidenceWeights = {
  compositeSimilarity: 0.55,
  topVariantConcentration: 0.25,
  repetition: 0.2,
};

function secondsBetween(startTime: string, endTime: string): number {
  return Math.max(0, (new Date(endTime).getTime() - new Date(startTime).getTime()) / 1000);
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function average(numbers: number[]): number {
  if (numbers.length === 0) {
    return 0;
  }

  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

function roundScore(value: number): number {
  return Math.round(value * 100) / 100;
}

function compactStepTokens(steps: SessionStep[]): string[] {
  const tokens = steps.map((step) => `${step.application}|${step.actionName}`);

  return tokens.filter((token, index) => token !== tokens[index - 1]);
}

function compactActionSequence(steps: SessionStep[]): string[] {
  const actions = steps.map((step) => step.actionName);

  return actions.filter((action, index) => action !== actions[index - 1]);
}

function buildContextTokens(steps: SessionStep[]): string[] {
  const domains = unique(
    steps
      .map((step) => step.domain)
      .filter((value): value is string => Boolean(value))
      .map((domain) => `domain:${domain}`),
  ).sort();

  if (domains.length > 0) {
    return domains;
  }

  return unique(steps.map((step) => `app:${step.application}`)).sort();
}

function startMinutesOfDay(timestamp: string): number {
  const date = new Date(timestamp);

  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

export function buildWorkflowSignatureFromSteps(steps: SessionStep[]): string {
  const actionSignature = compactActionSequence(steps).join(">");
  const contextSignature = buildContextTokens(steps).join(">");

  return stableId("workflow_signature", `${actionSignature}||${contextSignature}`);
}

export function buildWorkflowSignatureForDetectionMode(
  workflowSignature: string,
  detectionMode: WorkflowDetectionMode,
): string {
  if (detectionMode === "standard") {
    return workflowSignature;
  }

  return stableId("workflow_signature", `${detectionMode}:${workflowSignature}`);
}

export function buildWorkflowSignatureFromStepsForDetectionMode(
  steps: SessionStep[],
  detectionMode: WorkflowDetectionMode,
): string {
  return buildWorkflowSignatureForDetectionMode(
    buildWorkflowSignatureFromSteps(steps),
    detectionMode,
  );
}

function buildDescriptor(session: Session): SessionDescriptor {
  return {
    session,
    tokenSequence: compactStepTokens(session.steps),
    actionSequence: compactActionSequence(session.steps),
    actionSet: unique(compactActionSequence(session.steps)).sort(),
    contextTokens: buildContextTokens(session.steps),
    durationSeconds: secondsBetween(session.startTime, session.endTime),
    involvedApps: unique(session.steps.map((step) => step.application)),
    startMinutesOfDay: startMinutesOfDay(session.startTime),
  };
}

function longestCommonSubsequenceLength(left: string[], right: string[]): number {
  const matrix = Array.from({ length: left.length + 1 }, () => Array<number>(right.length + 1).fill(0));

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const currentRow = matrix[leftIndex];
      const previousRow = matrix[leftIndex - 1];

      if (!currentRow || !previousRow) {
        continue;
      }

      if (left[leftIndex - 1] === right[rightIndex - 1]) {
        currentRow[rightIndex] = (previousRow[rightIndex - 1] ?? 0) + 1;
      } else {
        currentRow[rightIndex] = Math.max(previousRow[rightIndex] ?? 0, currentRow[rightIndex - 1] ?? 0);
      }
    }
  }

  return matrix[left.length]?.[right.length] ?? 0;
}

function buildNgrams(values: string[], size: number): string[] {
  if (values.length < size) {
    return values.length === 0 ? [] : [values.join(">")];
  }

  return values.slice(0, values.length - size + 1).map((_, index) => values.slice(index, index + size).join(">"));
}

function jaccardSimilarity(left: string[], right: string[]): number {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const union = new Set([...leftSet, ...rightSet]);

  if (union.size === 0) {
    return 1;
  }

  let intersection = 0;

  for (const value of leftSet) {
    if (rightSet.has(value)) {
      intersection += 1;
    }
  }

  return intersection / union.size;
}

function sequenceSimilarity(left: string[], right: string[]): number {
  if (left.length === 0 && right.length === 0) {
    return 1;
  }

  const lcsScore = longestCommonSubsequenceLength(left, right) / Math.max(left.length, right.length);
  const ngramSize = Math.min(2, Math.max(1, Math.min(left.length, right.length)));
  const ngramScore = jaccardSimilarity(buildNgrams(left, ngramSize), buildNgrams(right, ngramSize));

  return lcsScore * 0.75 + ngramScore * 0.25;
}

function timeOfDaySimilarity(leftMinutes: number, rightMinutes: number): number {
  const difference = Math.abs(leftMinutes - rightMinutes);
  const wrappedDifference = Math.min(difference, 24 * 60 - difference);

  return Math.max(0, 1 - wrappedDifference / (12 * 60));
}

function normalizeSimilarityWeights(
  weights: Partial<WorkflowSimilarityWeights> | undefined,
): WorkflowSimilarityWeights {
  const merged = {
    ...DEFAULT_CLUSTER_SIMILARITY_WEIGHTS,
    ...weights,
  };
  const total = merged.sequence + merged.actionSet + merged.context + merged.timeOfDay;

  if (total <= 0) {
    return DEFAULT_CLUSTER_SIMILARITY_WEIGHTS;
  }

  return {
    sequence: merged.sequence / total,
    actionSet: merged.actionSet / total,
    context: merged.context / total,
    timeOfDay: merged.timeOfDay / total,
  };
}

function normalizeConfidenceWeights(
  weights: Partial<WorkflowConfidenceWeights> | undefined,
): WorkflowConfidenceWeights {
  const merged = {
    ...DEFAULT_CLUSTER_CONFIDENCE_WEIGHTS,
    ...weights,
  };
  const total = merged.compositeSimilarity + merged.topVariantConcentration + merged.repetition;

  if (total <= 0) {
    return DEFAULT_CLUSTER_CONFIDENCE_WEIGHTS;
  }

  return {
    compositeSimilarity: merged.compositeSimilarity / total,
    topVariantConcentration: merged.topVariantConcentration / total,
    repetition: merged.repetition / total,
  };
}

function buildSimilarityBreakdown(args: {
  left: SessionDescriptor;
  right: SessionDescriptor;
  scoringStrategy: ClusterScoringStrategy;
  similarityWeights: WorkflowSimilarityWeights;
}): SimilarityBreakdown {
  const sequence = sequenceSimilarity(args.left.tokenSequence, args.right.tokenSequence);

  if (args.scoringStrategy === "legacy") {
    return {
      sequence,
      actionSet: 0,
      context: 0,
      timeOfDay: 0,
      total: sequence,
    };
  }

  const actionSet = jaccardSimilarity(args.left.actionSet, args.right.actionSet);
  const context = jaccardSimilarity(args.left.contextTokens, args.right.contextTokens);
  const timeOfDay = timeOfDaySimilarity(args.left.startMinutesOfDay, args.right.startMinutesOfDay);

  return {
    sequence,
    actionSet,
    context,
    timeOfDay,
    total:
      sequence * args.similarityWeights.sequence +
      actionSet * args.similarityWeights.actionSet +
      context * args.similarityWeights.context +
      timeOfDay * args.similarityWeights.timeOfDay,
  };
}

function clusterMembershipScore(args: {
  cluster: MutableCluster;
  candidate: SessionDescriptor;
  scoringStrategy: ClusterScoringStrategy;
  similarityWeights: WorkflowSimilarityWeights;
}): number {
  const scores = args.cluster.descriptors
    .map((descriptor) =>
      buildSimilarityBreakdown({
        left: descriptor,
        right: args.candidate,
        scoringStrategy: args.scoringStrategy,
        similarityWeights: args.similarityWeights,
      }).total,
    )
    .sort((left, right) => right - left);
  const windowSize = Math.min(2, scores.length);

  return average(scores.slice(0, windowSize));
}

export function explainClusterMembership(args: {
  session: Session;
  peerSessions: Session[];
  scoringStrategy?: ClusterScoringStrategy | undefined;
  similarityWeights?: Partial<WorkflowSimilarityWeights> | undefined;
}): ClusterMembershipExplanation {
  const scoringStrategy = args.scoringStrategy ?? "hybrid_v2";
  const similarityWeights = normalizeSimilarityWeights(args.similarityWeights);
  const candidate = buildDescriptor(args.session);
  const peerComparisons = args.peerSessions
    .map((peerSession) => {
      const peerDescriptor = buildDescriptor(peerSession);
      const breakdown = buildSimilarityBreakdown({
        left: peerDescriptor,
        right: candidate,
        scoringStrategy,
        similarityWeights,
      });

      return {
        sessionId: peerSession.id,
        startTime: peerSession.startTime,
        actionSequence: peerDescriptor.actionSequence,
        contextTokens: peerDescriptor.contextTokens,
        sequenceSimilarity: roundScore(breakdown.sequence),
        actionSetSimilarity: roundScore(breakdown.actionSet),
        contextSimilarity: roundScore(breakdown.context),
        timeOfDaySimilarity: roundScore(breakdown.timeOfDay),
        compositeSimilarity: roundScore(breakdown.total),
      };
    })
    .sort(
      (left, right) =>
        right.compositeSimilarity - left.compositeSimilarity ||
        left.startTime.localeCompare(right.startTime),
    );
  const comparisonWindowSize = Math.min(2, peerComparisons.length);

  return {
    scoringStrategy,
    comparisonWindowSize,
    membershipScore: roundScore(
      average(
        peerComparisons
          .slice(0, comparisonWindowSize)
          .map((comparison) => comparison.compositeSimilarity),
      ),
    ),
    candidateActionSequence: candidate.actionSequence,
    candidateContextTokens: candidate.contextTokens,
    peerComparisons: peerComparisons.slice(0, 3),
  };
}

function hasMinimumFrequencyWithinWindow(
  descriptors: SessionDescriptor[],
  minimumFrequency: number,
  confirmationWindowMs: number,
): boolean {
  const timestamps = descriptors
    .map((descriptor) => new Date(descriptor.session.startTime).getTime())
    .sort((left, right) => left - right);

  for (let startIndex = 0; startIndex < timestamps.length; startIndex += 1) {
    let endIndex = startIndex;

    while (
      endIndex < timestamps.length &&
      timestamps[endIndex]! - timestamps[startIndex]! <= confirmationWindowMs
    ) {
      endIndex += 1;
    }

    if (endIndex - startIndex >= minimumFrequency) {
      return true;
    }
  }

  return false;
}

function humanizeIdentifier(identifier: string | undefined): string | undefined {
  if (!identifier) {
    return undefined;
  }

  return identifier
    .replace(/^https?:\/\//, "")
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function normalizeForComparison(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function buildStepContext(step: SessionStep): string | undefined {
  const titlePattern = humanizeIdentifier(step.titlePattern);
  const application = humanizeIdentifier(step.application);

  if (titlePattern && normalizeForComparison(titlePattern) !== normalizeForComparison(application)) {
    return titlePattern;
  }

  return humanizeIdentifier(step.domain);
}

function shouldRenderApplication(step: SessionStep): boolean {
  return step.actionName !== `switch_to_${step.application}`;
}

function buildWorkflowName(representativeSequence: string[], involvedApps: string[]): string {
  const primaryAction =
    representativeSequence.find(
      (action) =>
        action !== "unknown_action" &&
        !action.startsWith("open_") &&
        !action.startsWith("switch_to_"),
    ) ??
    representativeSequence[0];
  const actionName = humanizeIdentifier(primaryAction);

  if (actionName) {
    return `${actionName} workflow`;
  }

  return `${humanizeIdentifier(involvedApps[0]) ?? "Workflow"} flow`;
}

function determineSuitability(
  descriptors: SessionDescriptor[],
  averageSimilarity: number,
): { automationSuitability: AutomationSuitability; recommendedApproach: string } {
  const frequency = descriptors.length;
  const applications = descriptors.flatMap((descriptor) => descriptor.involvedApps);
  const browserSteps = applications.filter((application) =>
    ["chrome", "safari", "firefox"].includes(application),
  ).length;
  const browserDominance = applications.length === 0 ? 0 : browserSteps / applications.length;
  const averageSteps = average(descriptors.map((descriptor) => descriptor.actionSequence.length));
  const uniqueApplications = unique(applications);

  let score = 0;

  if (frequency >= 5) {
    score += 2;
  } else if (frequency >= 3) {
    score += 1;
  }

  if (averageSimilarity >= 0.9) {
    score += 2;
  } else if (averageSimilarity >= 0.75) {
    score += 1;
  }

  if (browserDominance >= 0.7) {
    score += 1;
  }

  if (averageSteps <= 8) {
    score += 1;
  }

  if (uniqueApplications.length > 3) {
    score -= 1;
  }

  const automationSuitability: AutomationSuitability =
    score >= 4 ? "high" : score >= 2 ? "medium" : "low";

  const recommendedApproach =
    automationSuitability === "low"
      ? "Manual review before automation"
      : browserDominance >= 0.75
        ? "Browser automation"
        : uniqueApplications.includes("chrome")
          ? "Hybrid desktop and browser automation"
          : "Desktop workflow automation";

  return {
    automationSuitability,
    recommendedApproach,
  };
}

function representativeSteps(steps: SessionStep[]): string[] {
  const result: string[] = [];
  let previousToken: string | undefined;

  for (const step of steps) {
    const context = buildStepContext(step);
    const token = `${step.application}|${step.actionName}|${context ?? ""}`;

    if (token === previousToken) {
      continue;
    }

    result.push(
      [
        humanizeIdentifier(step.actionName) ?? step.actionName,
        shouldRenderApplication(step) && humanizeIdentifier(step.application)
          ? `in ${humanizeIdentifier(step.application)}`
          : undefined,
        context ? `(${context})` : undefined,
      ]
        .filter((value): value is string => Boolean(value))
        .join(" "),
    );
    previousToken = token;
  }

  return result;
}

function formatTimeSavings(seconds: number): string {
  const roundedMinutes = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(roundedMinutes / 60);
  const minutes = roundedMinutes % 60;

  if (hours === 0) {
    return `about ${minutes}m per similar week`;
  }

  if (minutes === 0) {
    return `about ${hours}h per similar week`;
  }

  return `about ${hours}h ${minutes}m per similar week`;
}

function buildAutomationHints(args: {
  involvedApps: string[];
  representativeSequence: string[];
  descriptors: SessionDescriptor[];
  automationSuitability: AutomationSuitability;
  recommendedApproach: string;
}): AutomationHint[] {
  const hints: AutomationHint[] = [];
  const weeklySavingsSeconds =
    average(args.descriptors.map((descriptor) => descriptor.durationSeconds)) *
    args.descriptors.length *
    0.6;
  const browserOnly =
    args.involvedApps.length > 0 &&
    args.involvedApps.every((application) => ["chrome", "safari", "firefox"].includes(application));
  const includesExcel = args.involvedApps.includes("excel");
  const includesSlack = args.involvedApps.includes("slack");
  const includesOutlook = args.involvedApps.includes("outlook");
  const hasStructuredUpdate = args.representativeSequence.some((action) =>
    /^(edit|update|verify|review)_/.test(action),
  );

  if (browserOnly) {
    hints.push({
      suggestedApproach: "Playwright",
      whyThisFits: "The workflow is mostly browser-based and the step sequence is stable enough for scripted navigation.",
      estimatedDifficulty: hasStructuredUpdate ? "medium" : "low",
      prerequisites: ["Stable page selectors or URLs", "A safe test account for the target workflow"],
      expectedTimeSavings: formatTimeSavings(weeklySavingsSeconds),
    });
  }

  if (browserOnly && hasStructuredUpdate) {
    hints.push({
      suggestedApproach: "Internal admin API integration",
      whyThisFits: "This workflow repeatedly updates structured records, which is often safer and faster through APIs than UI clicks.",
      estimatedDifficulty: "medium",
      prerequisites: ["Access to the internal API", "Documented request/response contracts"],
      expectedTimeSavings: formatTimeSavings(weeklySavingsSeconds * 1.1),
    });
  }

  if (includesExcel) {
    hints.push({
      suggestedApproach: "Excel macro",
      whyThisFits: "A meaningful part of the workflow happens in spreadsheets, so a macro can remove repetitive edits and saves.",
      estimatedDifficulty: includesSlack || browserOnly ? "medium" : "low",
      prerequisites: ["The workbook structure should be stable", "Known input and output columns"],
      expectedTimeSavings: formatTimeSavings(weeklySavingsSeconds * 0.8),
    });
  }

  if (includesSlack) {
    hints.push({
      suggestedApproach: "n8n workflow",
      whyThisFits: "Slack notifications and follow-up steps map well to an orchestration tool that can coordinate multiple apps.",
      estimatedDifficulty: "medium",
      prerequisites: ["Slack app or webhook access", "A trigger or polling source for the upstream step"],
      expectedTimeSavings: formatTimeSavings(weeklySavingsSeconds * 0.7),
    });
  }

  if (includesOutlook) {
    hints.push({
      suggestedApproach: "PowerShell",
      whyThisFits: "Desktop email and office tooling often fit well with a small script that automates repetitive message handling.",
      estimatedDifficulty: "medium",
      prerequisites: ["Local execution permissions", "A documented mail or file handling flow"],
      expectedTimeSavings: formatTimeSavings(weeklySavingsSeconds * 0.7),
    });
  }

  if (hints.length === 0) {
    hints.push({
      suggestedApproach: args.recommendedApproach === "Browser automation" ? "Playwright" : "Python script",
      whyThisFits: "The workflow is repetitive enough to justify a scripted MVP even before deeper integrations are available.",
      estimatedDifficulty: args.automationSuitability === "high" ? "low" : "medium",
      prerequisites: ["A reproducible input/output example", "A safe place to test the automation"],
      expectedTimeSavings: formatTimeSavings(weeklySavingsSeconds),
    });
  }

  return hints
    .filter(
      (hint, index, collection) =>
        collection.findIndex((entry) => entry.suggestedApproach === hint.suggestedApproach) === index,
    )
    .slice(0, 3);
}

function buildTopVariants(descriptors: SessionDescriptor[]): WorkflowVariant[] {
  const bySequence = new Map<
    string,
    { sequence: string[]; occurrenceCount: number; durations: number[] }
  >();

  for (const descriptor of descriptors) {
    const key = descriptor.actionSequence.join(">");
    const current = bySequence.get(key) ?? {
      sequence: descriptor.actionSequence,
      occurrenceCount: 0,
      durations: [],
    };

    current.occurrenceCount += 1;
    current.durations.push(descriptor.durationSeconds);
    bySequence.set(key, current);
  }

  return [...bySequence.values()]
    .map((variant) => ({
      sequence: variant.sequence,
      occurrenceCount: variant.occurrenceCount,
      averageDurationSeconds: average(variant.durations),
    }))
    .sort(
      (left, right) =>
        right.occurrenceCount - left.occurrenceCount ||
        right.averageDurationSeconds - left.averageDurationSeconds,
    )
    .slice(0, 3);
}

function computeConfidence(args: {
  descriptors: SessionDescriptor[];
  representativeDescriptor: SessionDescriptor;
  topVariants: WorkflowVariant[];
  scoringStrategy: ClusterScoringStrategy;
  similarityWeights: WorkflowSimilarityWeights;
  confidenceWeights: WorkflowConfidenceWeights;
}): {
  confidenceScore: number;
  confidenceDetails: WorkflowConfidenceDetails;
} {
  const breakdowns = args.descriptors.map((descriptor) =>
    buildSimilarityBreakdown({
      left: args.representativeDescriptor,
      right: descriptor,
      scoringStrategy: args.scoringStrategy,
      similarityWeights: args.similarityWeights,
    }),
  );
  const averageSequenceSimilarity = average(breakdowns.map((breakdown) => breakdown.sequence));
  const averageActionSetSimilarity = average(breakdowns.map((breakdown) => breakdown.actionSet));
  const averageContextSimilarity = average(breakdowns.map((breakdown) => breakdown.context));
  const averageTimeOfDaySimilarity = average(breakdowns.map((breakdown) => breakdown.timeOfDay));
  const averageCompositeSimilarity = average(breakdowns.map((breakdown) => breakdown.total));
  const topVariantConcentration = (args.topVariants[0]?.occurrenceCount ?? 0) / Math.max(1, args.descriptors.length);
  const repetitionScore = Math.min(1, args.descriptors.length / 5);
  const confidenceScore = roundScore(
    averageCompositeSimilarity * args.confidenceWeights.compositeSimilarity +
      topVariantConcentration * args.confidenceWeights.topVariantConcentration +
      repetitionScore * args.confidenceWeights.repetition,
  );

  return {
    confidenceScore,
    confidenceDetails: {
      similarityWeights: {
        sequence: roundScore(args.similarityWeights.sequence),
        actionSet: roundScore(args.similarityWeights.actionSet),
        context: roundScore(args.similarityWeights.context),
        timeOfDay: roundScore(args.similarityWeights.timeOfDay),
      },
      confidenceWeights: {
        compositeSimilarity: roundScore(args.confidenceWeights.compositeSimilarity),
        topVariantConcentration: roundScore(args.confidenceWeights.topVariantConcentration),
        repetition: roundScore(args.confidenceWeights.repetition),
      },
      averageSequenceSimilarity: roundScore(averageSequenceSimilarity),
      averageActionSetSimilarity: roundScore(averageActionSetSimilarity),
      averageContextSimilarity: roundScore(averageContextSimilarity),
      averageTimeOfDaySimilarity: roundScore(averageTimeOfDaySimilarity),
      averageCompositeSimilarity: roundScore(averageCompositeSimilarity),
      topVariantConcentration: roundScore(topVariantConcentration),
      repetitionScore: roundScore(repetitionScore),
    },
  };
}

export function clusterSessions(sessions: Session[], options: ClusterOptions = {}): WorkflowCluster[] {
  const detectionMode = options.detectionMode ?? "standard";
  const similarityThreshold = options.similarityThreshold ?? DEFAULT_CLUSTER_SIMILARITY_THRESHOLD;
  const minimumWorkflowFrequency = options.minimumWorkflowFrequency ?? DEFAULT_MINIMUM_WORKFLOW_FREQUENCY;
  const minSessionDurationSeconds =
    options.minSessionDurationSeconds ??
    DEFAULT_WORKFLOW_CONFIRMATION_CONFIG.minSessionDurationSeconds;
  const maxSessionDurationSeconds = options.maxSessionDurationSeconds ?? Number.POSITIVE_INFINITY;
  const maxActionSequenceLength =
    options.maxActionSequenceLength ??
    (detectionMode === "short_form"
      ? DEFAULT_WORKFLOW_SHORT_FORM_CONFIG.maxActionSequenceLength
      : Number.POSITIVE_INFINITY);
  const confirmationWindowDays =
    options.confirmationWindowDays ??
    DEFAULT_WORKFLOW_CONFIRMATION_CONFIG.confirmationWindowDays;
  const confirmationWindowMs = confirmationWindowDays * 24 * 60 * 60 * 1000;
  const scoringStrategy = options.scoringStrategy ?? "hybrid_v2";
  const similarityWeights = normalizeSimilarityWeights(options.similarityWeights);
  const confidenceWeights = normalizeConfidenceWeights(options.confidenceWeights);

  const descriptors: SessionDescriptor[] = [...sessions]
    .sort((left, right) => left.startTime.localeCompare(right.startTime))
    .map((session) => buildDescriptor(session))
    .filter(
      (descriptor) =>
        descriptor.durationSeconds >= minSessionDurationSeconds &&
        descriptor.durationSeconds <= maxSessionDurationSeconds &&
        descriptor.actionSequence.length > 0 &&
        descriptor.actionSequence.length <= maxActionSequenceLength,
    );

  const mutableClusters: MutableCluster[] = [];

  for (const descriptor of descriptors) {
    let bestCluster: MutableCluster | undefined;
    let bestScore = 0;

    for (const cluster of mutableClusters) {
      const score = clusterMembershipScore({
        cluster,
        candidate: descriptor,
        scoringStrategy,
        similarityWeights,
      });

      if (score >= similarityThreshold && score > bestScore) {
        bestCluster = cluster;
        bestScore = score;
      }
    }

    if (bestCluster) {
      bestCluster.descriptors.push(descriptor);
      continue;
    }

    mutableClusters.push({
      descriptors: [descriptor],
    });
  }

  return mutableClusters
    .filter(
      (cluster) =>
        cluster.descriptors.length >= minimumWorkflowFrequency &&
        hasMinimumFrequencyWithinWindow(
          cluster.descriptors,
          minimumWorkflowFrequency,
          confirmationWindowMs,
        ),
    )
    .map((cluster) => {
      const durations = cluster.descriptors.map((descriptor) => descriptor.durationSeconds);
      const topVariants = buildTopVariants(cluster.descriptors);
      const representativeSequence =
        topVariants[0]?.sequence ?? cluster.descriptors[0]?.actionSequence ?? [];
      const representativeDescriptor =
        cluster.descriptors.find(
          (descriptor) =>
            descriptor.actionSequence.join(">") === representativeSequence.join(">"),
        ) ?? cluster.descriptors[0];
      if (!representativeDescriptor) {
        throw new Error("Expected a representative descriptor for a non-empty cluster");
      }
      const involvedApps = unique(cluster.descriptors.flatMap((descriptor) => descriptor.involvedApps));
      const confidence = computeConfidence({
        descriptors: cluster.descriptors,
        representativeDescriptor,
        topVariants,
        scoringStrategy,
        similarityWeights,
        confidenceWeights,
      });
      const workflowSignature = buildWorkflowSignatureFromStepsForDetectionMode(
        representativeDescriptor.session.steps,
        detectionMode,
      );
      const suitability = determineSuitability(
        cluster.descriptors,
        confidence.confidenceDetails.averageCompositeSimilarity,
      );
      const automationHints = buildAutomationHints({
        involvedApps,
        representativeSequence,
        descriptors: cluster.descriptors,
        automationSuitability: suitability.automationSuitability,
        recommendedApproach: suitability.recommendedApproach,
      });

      return {
        id: stableId("workflow_cluster", workflowSignature),
        workflowSignature,
        detectionMode,
        name: buildWorkflowName(representativeSequence, involvedApps),
        sessionIds: unique(cluster.descriptors.map((descriptor) => descriptor.session.id)),
        occurrenceCount: cluster.descriptors.length,
        frequency: cluster.descriptors.length,
        averageDurationSeconds: average(durations),
        totalDurationSeconds: durations.reduce((sum, value) => sum + value, 0),
        representativeSequence,
        representativeSteps: representativeSteps(representativeDescriptor.session.steps),
        involvedApps,
        confidenceScore: confidence.confidenceScore,
        confidenceDetails: confidence.confidenceDetails,
        topVariants,
        automationSuitability: suitability.automationSuitability,
        recommendedApproach: automationHints[0]?.suggestedApproach ?? suitability.recommendedApproach,
        automationHints,
        excluded: false,
        hidden: false,
        userLabeled: false,
      };
    })
    .sort(
      (left, right) =>
        right.frequency - left.frequency ||
        right.confidenceScore - left.confidenceScore ||
        right.totalDurationSeconds - left.totalDurationSeconds,
    );
}
