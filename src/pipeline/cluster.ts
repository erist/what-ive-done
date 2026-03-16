import type {
  AutomationHint,
  AutomationSuitability,
  Session,
  SessionStep,
  WorkflowCluster,
  WorkflowVariant,
} from "../domain/types.js";
import { stableId } from "../domain/ids.js";

export interface ClusterOptions {
  similarityThreshold?: number;
  minSessionDurationSeconds?: number;
  minimumWorkflowFrequency?: number;
}

interface SessionDescriptor {
  session: Session;
  tokens: string[];
  actionSequence: string[];
  durationSeconds: number;
  involvedApps: string[];
}

interface MutableCluster {
  prototypeTokens: string[];
  descriptors: SessionDescriptor[];
}

const DEFAULT_SIMILARITY_THRESHOLD = 0.62;
const DEFAULT_MIN_SESSION_DURATION_SECONDS = 45;
const DEFAULT_MINIMUM_WORKFLOW_FREQUENCY = 3;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

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

function compactStepTokens(steps: SessionStep[]): string[] {
  const tokens = steps.map((step) => `${step.application}|${step.actionName}`);

  return tokens.filter((token, index) => token !== tokens[index - 1]);
}

function compactActionSequence(steps: SessionStep[]): string[] {
  const actions = steps.map((step) => step.actionName);

  return actions.filter((action, index) => action !== actions[index - 1]);
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

function hasMinimumFrequencyWithinSevenDays(descriptors: SessionDescriptor[], minimumFrequency: number): boolean {
  const timestamps = descriptors
    .map((descriptor) => new Date(descriptor.session.startTime).getTime())
    .sort((left, right) => left - right);

  for (let startIndex = 0; startIndex < timestamps.length; startIndex += 1) {
    let endIndex = startIndex;

    while (endIndex < timestamps.length && timestamps[endIndex]! - timestamps[startIndex]! <= SEVEN_DAYS_MS) {
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
    representativeSequence.find((action) => !action.startsWith("open_") && !action.startsWith("switch_to_")) ??
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

function computeConfidenceScore(descriptors: SessionDescriptor[], topVariants: WorkflowVariant[]): number {
  const prototype = topVariants[0]?.sequence ?? descriptors[0]?.actionSequence ?? [];
  const consistency = average(
    descriptors.map((descriptor) => sequenceSimilarity(descriptor.actionSequence, prototype)),
  );
  const concentration = (topVariants[0]?.occurrenceCount ?? 0) / Math.max(1, descriptors.length);
  const repetition = Math.min(1, descriptors.length / 5);

  return Math.round((consistency * 0.5 + concentration * 0.3 + repetition * 0.2) * 100) / 100;
}

export function clusterSessions(sessions: Session[], options: ClusterOptions = {}): WorkflowCluster[] {
  const similarityThreshold = options.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;
  const minimumWorkflowFrequency = options.minimumWorkflowFrequency ?? DEFAULT_MINIMUM_WORKFLOW_FREQUENCY;
  const minSessionDurationSeconds =
    options.minSessionDurationSeconds ?? DEFAULT_MIN_SESSION_DURATION_SECONDS;

  const descriptors: SessionDescriptor[] = sessions
    .map((session) => ({
      session,
      tokens: compactStepTokens(session.steps),
      actionSequence: compactActionSequence(session.steps),
      durationSeconds: secondsBetween(session.startTime, session.endTime),
      involvedApps: unique(session.steps.map((step) => step.application)),
    }))
    .filter(
      (descriptor) =>
        descriptor.durationSeconds >= minSessionDurationSeconds && descriptor.actionSequence.length > 0,
    );

  const mutableClusters: MutableCluster[] = [];

  for (const descriptor of descriptors) {
    let bestCluster: MutableCluster | undefined;
    let bestScore = 0;

    for (const cluster of mutableClusters) {
      const score = sequenceSimilarity(cluster.prototypeTokens, descriptor.tokens);

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
      prototypeTokens: descriptor.tokens,
      descriptors: [descriptor],
    });
  }

  return mutableClusters
    .filter(
      (cluster) =>
        cluster.descriptors.length >= minimumWorkflowFrequency &&
        hasMinimumFrequencyWithinSevenDays(cluster.descriptors, minimumWorkflowFrequency),
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
      const similarities = cluster.descriptors.map((descriptor) =>
        sequenceSimilarity(representativeSequence, descriptor.actionSequence),
      );
      const involvedApps = unique(cluster.descriptors.flatMap((descriptor) => descriptor.involvedApps));
      const workflowSignature = stableId("workflow_signature", representativeSequence.join(">"));
      const suitability = determineSuitability(cluster.descriptors, average(similarities));
      const confidenceScore = computeConfidenceScore(cluster.descriptors, topVariants);
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
        name: buildWorkflowName(representativeSequence, involvedApps),
        sessionIds: unique(cluster.descriptors.map((descriptor) => descriptor.session.id)),
        occurrenceCount: cluster.descriptors.length,
        frequency: cluster.descriptors.length,
        averageDurationSeconds: average(durations),
        totalDurationSeconds: durations.reduce((sum, value) => sum + value, 0),
        representativeSequence,
        representativeSteps: representativeSteps(representativeDescriptor?.session.steps ?? []),
        involvedApps,
        confidenceScore,
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
