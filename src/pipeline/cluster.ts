import type { AutomationSuitability, Session, SessionStep, WorkflowCluster } from "../domain/types.js";
import { stableId } from "../domain/ids.js";

export interface ClusterOptions {
  similarityThreshold?: number;
  minSessionDurationSeconds?: number;
  minimumWorkflowFrequency?: number;
}

interface SessionDescriptor {
  session: Session;
  tokens: string[];
  durationSeconds: number;
}

interface MutableCluster {
  prototypeTokens: string[];
  descriptors: SessionDescriptor[];
}

const DEFAULT_SIMILARITY_THRESHOLD = 0.74;
const DEFAULT_MIN_SESSION_DURATION_SECONDS = 60;
const DEFAULT_MINIMUM_WORKFLOW_FREQUENCY = 3;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function secondsBetween(startTime: string, endTime: string): number {
  return Math.max(0, (new Date(endTime).getTime() - new Date(startTime).getTime()) / 1000);
}

function compactStepTokens(steps: SessionStep[]): string[] {
  const tokens = steps.map((step) => `${step.application}|${step.domain ?? "-"}|${step.action}`);

  return tokens.filter((token, index) => token !== tokens[index - 1]);
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

function sequenceSimilarity(left: string[], right: string[]): number {
  if (left.length === 0 && right.length === 0) {
    return 1;
  }

  return longestCommonSubsequenceLength(left, right) / Math.max(left.length, right.length);
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

function average(numbers: number[]): number {
  if (numbers.length === 0) {
    return 0;
  }

  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
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

function buildWorkflowName(session: Session): string {
  const prominentTarget = session.steps.find((step) => step.target)?.target;
  const targetName = humanizeIdentifier(prominentTarget);

  if (targetName) {
    return `${targetName} workflow`;
  }

  const domainName = humanizeIdentifier(session.primaryDomain);

  if (domainName) {
    return `${domainName} workflow`;
  }

  return `${humanizeIdentifier(session.primaryApplication) ?? "Workflow"} flow`;
}

function determineSuitability(
  descriptors: SessionDescriptor[],
  averageSimilarity: number,
): { automationSuitability: AutomationSuitability; recommendedApproach: string } {
  const frequency = descriptors.length;
  const applications = descriptors.flatMap((descriptor) =>
    descriptor.session.steps.map((step) => step.application),
  );
  const browserSteps = applications.filter((application) => application === "chrome").length;
  const browserDominance = applications.length === 0 ? 0 : browserSteps / applications.length;
  const averageSteps = average(descriptors.map((descriptor) => descriptor.session.steps.length));
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

function representativeSteps(descriptor: SessionDescriptor): string[] {
  return descriptor.session.steps.map((step) => {
    const parts = [humanizeIdentifier(step.application) ?? step.application, step.action.replaceAll("_", " ")];

    if (step.domain) {
      parts.push(`on ${step.domain}`);
    }

    return parts.join(" ");
  });
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
      durationSeconds: secondsBetween(session.startTime, session.endTime),
    }))
    .filter((descriptor) => descriptor.durationSeconds >= minSessionDurationSeconds);

  const mutableClusters: MutableCluster[] = [];

  for (const descriptor of descriptors) {
    const matchingCluster = mutableClusters.find(
      (cluster) => sequenceSimilarity(cluster.prototypeTokens, descriptor.tokens) >= similarityThreshold,
    );

    if (matchingCluster) {
      matchingCluster.descriptors.push(descriptor);
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
      const similarities = cluster.descriptors.map((descriptor) =>
        sequenceSimilarity(cluster.prototypeTokens, descriptor.tokens),
      );
      const prototypeDescriptor = cluster.descriptors[0] as SessionDescriptor;
      const signature = cluster.prototypeTokens.join(">");
      const suitability = determineSuitability(cluster.descriptors, average(similarities));

      return {
        id: stableId("workflow_cluster", signature),
        name: buildWorkflowName(prototypeDescriptor.session),
        sessionIds: cluster.descriptors.map((descriptor) => descriptor.session.id),
        frequency: cluster.descriptors.length,
        averageDurationSeconds: average(durations),
        totalDurationSeconds: durations.reduce((sum, value) => sum + value, 0),
        representativeSteps: representativeSteps(prototypeDescriptor),
        automationSuitability: suitability.automationSuitability,
        recommendedApproach: suitability.recommendedApproach,
        excluded: false,
      };
    })
    .sort((left, right) => right.frequency - left.frequency || right.totalDurationSeconds - left.totalDurationSeconds);
}
