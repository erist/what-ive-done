import type {
  Session,
  WorkflowConfidenceWeights,
  WorkflowSimilarityWeights,
} from "../domain/types.js";
import {
  clusterSessions,
  DEFAULT_CLUSTER_CONFIDENCE_WEIGHTS,
  DEFAULT_CLUSTER_SIMILARITY_THRESHOLD,
  DEFAULT_CLUSTER_SIMILARITY_WEIGHTS,
  type ClusterOptions,
} from "./cluster.js";

export interface ClusterBenchmarkFixture {
  expectedWorkflow: string;
  session: Session;
}

export interface ClusterBenchmarkMetrics {
  clusterCount: number;
  falseSplits: number;
  falseMerges: number;
  totalErrorCount: number;
  clusterLabels: Array<{
    clusterId: string;
    expectedWorkflows: string[];
    sessionIds: string[];
  }>;
}

export interface ClusterBenchmarkResult {
  similarityThreshold: number;
  similarityWeights: WorkflowSimilarityWeights;
  confidenceWeights: WorkflowConfidenceWeights;
  legacy: ClusterBenchmarkMetrics;
  hybridV2: ClusterBenchmarkMetrics;
  improvementRate: number;
}

function createSession(input: {
  id: string;
  startTime: string;
  endTime: string;
  application: string;
  domain: string;
  actions: string[];
}): Session {
  return {
    id: input.id,
    startTime: input.startTime,
    endTime: input.endTime,
    primaryApplication: input.application,
    primaryDomain: input.domain,
    sessionBoundaryReason: "stream_start",
    sessionBoundaryDetails: {},
    steps: input.actions.map((actionName, index) => ({
      order: index + 1,
      normalizedEventId: `${input.id}-event-${index + 1}`,
      timestamp: new Date(new Date(input.startTime).getTime() + index * 30_000).toISOString(),
      action: "button_click",
      actionName,
      actionConfidence: 0.9,
      actionSource: "rule",
      application: input.application,
      domain: input.domain,
      target: actionName,
    })),
  };
}

export function getClusterBenchmarkFixtures(): ClusterBenchmarkFixture[] {
  return [
    {
      expectedWorkflow: "admin-order-status",
      session: createSession({
        id: "admin-session-1",
        startTime: "2026-03-10T09:00:00.000Z",
        endTime: "2026-03-10T09:03:00.000Z",
        application: "chrome",
        domain: "admin.internal",
        actions: ["open_admin", "search_order", "review_order", "update_status"],
      }),
    },
    {
      expectedWorkflow: "admin-order-status",
      session: createSession({
        id: "admin-session-2",
        startTime: "2026-03-12T09:10:00.000Z",
        endTime: "2026-03-12T09:13:00.000Z",
        application: "chrome",
        domain: "admin.internal",
        actions: ["open_admin", "review_order", "search_order", "update_status"],
      }),
    },
    {
      expectedWorkflow: "support-ticket-status",
      session: createSession({
        id: "support-session-1",
        startTime: "2026-03-10T15:00:00.000Z",
        endTime: "2026-03-10T15:03:00.000Z",
        application: "chrome",
        domain: "support.internal",
        actions: ["open_admin", "search_order", "review_order", "update_status"],
      }),
    },
    {
      expectedWorkflow: "support-ticket-status",
      session: createSession({
        id: "support-session-2",
        startTime: "2026-03-12T15:10:00.000Z",
        endTime: "2026-03-12T15:13:00.000Z",
        application: "chrome",
        domain: "support.internal",
        actions: ["open_admin", "review_order", "search_order", "update_status"],
      }),
    },
  ];
}

function calculateBenchmarkMetrics(
  fixtures: ClusterBenchmarkFixture[],
  clusters: ReturnType<typeof clusterSessions>,
): ClusterBenchmarkMetrics {
  const expectedWorkflowBySessionId = new Map(
    fixtures.map((fixture) => [fixture.session.id, fixture.expectedWorkflow]),
  );
  const falseMerges = clusters.reduce((sum, cluster) => {
    const expectedWorkflows = new Set(
      cluster.sessionIds
        .map((sessionId) => expectedWorkflowBySessionId.get(sessionId))
        .filter((value): value is string => Boolean(value)),
    );

    return sum + Math.max(0, expectedWorkflows.size - 1);
  }, 0);
  const falseSplits = [...new Set(fixtures.map((fixture) => fixture.expectedWorkflow))]
    .map((expectedWorkflow) => {
      const clusterIds = new Set(
        clusters
          .filter((cluster) =>
            cluster.sessionIds.some((sessionId) => expectedWorkflowBySessionId.get(sessionId) === expectedWorkflow),
          )
          .map((cluster) => cluster.id),
      );

      return Math.max(0, clusterIds.size - 1);
    })
    .reduce((sum, value) => sum + value, 0);

  return {
    clusterCount: clusters.length,
    falseSplits,
    falseMerges,
    totalErrorCount: falseSplits + falseMerges,
    clusterLabels: clusters.map((cluster) => ({
      clusterId: cluster.id,
      expectedWorkflows: [...new Set(
        cluster.sessionIds
          .map((sessionId) => expectedWorkflowBySessionId.get(sessionId))
          .filter((value): value is string => Boolean(value)),
      )],
      sessionIds: cluster.sessionIds,
    })),
  };
}

export function runClusterBenchmark(
  options: ClusterOptions = {},
): ClusterBenchmarkResult {
  const fixtures = getClusterBenchmarkFixtures();
  const benchmarkOptions: ClusterOptions = {
    similarityThreshold: options.similarityThreshold ?? DEFAULT_CLUSTER_SIMILARITY_THRESHOLD,
    minSessionDurationSeconds: options.minSessionDurationSeconds ?? 0,
    minimumWorkflowFrequency: options.minimumWorkflowFrequency ?? 2,
    similarityWeights: options.similarityWeights,
    confidenceWeights: options.confidenceWeights,
  };
  const legacyClusters = clusterSessions(
    fixtures.map((fixture) => fixture.session),
    {
      ...benchmarkOptions,
      scoringStrategy: "legacy",
    },
  );
  const hybridClusters = clusterSessions(
    fixtures.map((fixture) => fixture.session),
    {
      ...benchmarkOptions,
      scoringStrategy: "hybrid_v2",
    },
  );
  const legacy = calculateBenchmarkMetrics(fixtures, legacyClusters);
  const hybridV2 = calculateBenchmarkMetrics(fixtures, hybridClusters);
  const similarityWeights =
    hybridClusters[0]?.confidenceDetails.similarityWeights ?? DEFAULT_CLUSTER_SIMILARITY_WEIGHTS;
  const confidenceWeights =
    hybridClusters[0]?.confidenceDetails.confidenceWeights ?? DEFAULT_CLUSTER_CONFIDENCE_WEIGHTS;
  const improvementRate =
    legacy.totalErrorCount === 0
      ? hybridV2.totalErrorCount === 0
        ? 1
        : 0
      : Math.max(0, (legacy.totalErrorCount - hybridV2.totalErrorCount) / legacy.totalErrorCount);

  return {
    similarityThreshold: benchmarkOptions.similarityThreshold ?? DEFAULT_CLUSTER_SIMILARITY_THRESHOLD,
    similarityWeights,
    confidenceWeights,
    legacy,
    hybridV2,
    improvementRate: Math.round(improvementRate * 100) / 100,
  };
}
