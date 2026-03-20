import type {
  ClusterMembershipExplanation,
} from "../pipeline/cluster.js";
import { explainClusterMembership } from "../pipeline/cluster.js";
import type {
  NormalizedEvent,
  RawEvent,
  Session,
  WorkflowCluster,
  WorkflowConfidenceDetails,
  WorkflowDetectionMode,
  WorkflowVariant,
} from "../domain/types.js";
import type { AppDatabase } from "../storage/database.js";

interface WorkflowClusterSummary {
  id: string;
  workflowSignature: string;
  detectionMode: WorkflowDetectionMode;
  name: string;
  frequency: number;
  involvedApps: string[];
  representativeSteps: string[];
  confidenceScore: number;
  confidenceDetails: WorkflowConfidenceDetails;
  representativeSequence: string[];
  topVariants: WorkflowVariant[];
  sessionIds: string[];
}

interface SessionSummary {
  id: string;
  startTime: string;
  endTime: string;
  primaryApplication: string;
  primaryDomain?: string | undefined;
  sessionBoundaryReason: Session["sessionBoundaryReason"];
  sessionBoundaryDetails: Record<string, unknown>;
  matchingStepOrder?: number | undefined;
  steps: Session["steps"];
  workflowMembership?: ClusterMembershipExplanation | undefined;
}

export interface RawEventTrace {
  rawEvent: RawEvent;
  normalizedEvent?: NormalizedEvent | undefined;
  action: {
    actionName?: string | undefined;
    actionConfidence?: number | undefined;
    actionSource?: NormalizedEvent["actionSource"] | undefined;
  };
  session?: SessionSummary | undefined;
  workflowCluster?: WorkflowClusterSummary | undefined;
}

export interface SessionTrace {
  session: SessionSummary;
  rawEvents: RawEvent[];
  workflowCluster?: WorkflowClusterSummary | undefined;
}

export interface WorkflowClusterTrace {
  workflowCluster: WorkflowClusterSummary;
  sessions: SessionSummary[];
}

function summarizeWorkflowCluster(cluster: WorkflowCluster): WorkflowClusterSummary {
  return {
    id: cluster.id,
    workflowSignature: cluster.workflowSignature,
    detectionMode: cluster.detectionMode,
    name: cluster.name,
    frequency: cluster.frequency,
    involvedApps: cluster.involvedApps,
    representativeSteps: cluster.representativeSteps,
    confidenceScore: cluster.confidenceScore,
    confidenceDetails: cluster.confidenceDetails,
    representativeSequence: cluster.representativeSequence,
    topVariants: cluster.topVariants,
    sessionIds: cluster.sessionIds,
  };
}

function buildSessionMembershipExplanation(
  database: AppDatabase,
  session: Session,
  workflowCluster: WorkflowCluster,
): ClusterMembershipExplanation {
  const peerSessions = workflowCluster.sessionIds
    .filter((sessionId) => sessionId !== session.id)
    .map((sessionId) => database.getSessionById(sessionId))
    .filter((value): value is Session => Boolean(value));

  return explainClusterMembership({
    session,
    peerSessions,
    similarityWeights: workflowCluster.confidenceDetails.similarityWeights,
  });
}

function summarizeSession(
  session: Session,
  options: {
    normalizedEventId?: string | undefined;
    workflowMembership?: ClusterMembershipExplanation | undefined;
  } = {},
): SessionSummary {
  return {
    id: session.id,
    startTime: session.startTime,
    endTime: session.endTime,
    primaryApplication: session.primaryApplication,
    primaryDomain: session.primaryDomain,
    sessionBoundaryReason: session.sessionBoundaryReason,
    sessionBoundaryDetails: session.sessionBoundaryDetails,
    matchingStepOrder: session.steps.find(
      (step) => step.normalizedEventId === options.normalizedEventId,
    )?.order,
    steps: session.steps,
    workflowMembership: options.workflowMembership,
  };
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>();

  return items.filter((item) => {
    if (seen.has(item.id)) {
      return false;
    }

    seen.add(item.id);
    return true;
  });
}

export function buildRawEventTrace(
  database: AppDatabase,
  rawEventId: string,
): RawEventTrace | undefined {
  const rawEvent = database.getRawEventById(rawEventId);

  if (!rawEvent) {
    return undefined;
  }

  const normalizedEvent = database.getNormalizedEventByRawEventId(rawEventId);
  const session = normalizedEvent
    ? database.getSessionByNormalizedEventId(normalizedEvent.id)
    : undefined;
  const workflowCluster = session ? database.getWorkflowClusterBySessionId(session.id) : undefined;

  return {
    rawEvent,
    normalizedEvent,
    action: normalizedEvent
      ? {
          actionName: normalizedEvent.actionName,
          actionConfidence: normalizedEvent.actionConfidence,
          actionSource: normalizedEvent.actionSource,
        }
      : {},
    session: session
      ? summarizeSession(session, {
          normalizedEventId: normalizedEvent?.id,
          workflowMembership: workflowCluster
            ? buildSessionMembershipExplanation(database, session, workflowCluster)
            : undefined,
        })
      : undefined,
    workflowCluster: workflowCluster ? summarizeWorkflowCluster(workflowCluster) : undefined,
  };
}

export function buildSessionTrace(
  database: AppDatabase,
  sessionId: string,
): SessionTrace | undefined {
  const session = database.getSessionById(sessionId);

  if (!session) {
    return undefined;
  }

  const rawEvents = uniqueById(
    session.steps
      .map((step) => database.getNormalizedEventById(step.normalizedEventId)?.rawEventId)
      .filter((value): value is string => Boolean(value))
      .map((rawEventId) => database.getRawEventById(rawEventId))
      .filter((value): value is RawEvent => Boolean(value)),
  );
  const workflowCluster = database.getWorkflowClusterBySessionId(sessionId);

  return {
    session: summarizeSession(session, {
      workflowMembership: workflowCluster
        ? buildSessionMembershipExplanation(database, session, workflowCluster)
        : undefined,
    }),
    rawEvents,
    workflowCluster: workflowCluster ? summarizeWorkflowCluster(workflowCluster) : undefined,
  };
}

export function buildWorkflowClusterTrace(
  database: AppDatabase,
  workflowClusterId: string,
): WorkflowClusterTrace | undefined {
  const workflowCluster = database.getWorkflowClusterById(workflowClusterId);

  if (!workflowCluster) {
    return undefined;
  }

  const sessions = workflowCluster.sessionIds
    .map((sessionId) => database.getSessionById(sessionId))
    .filter((value): value is Session => Boolean(value))
    .map((session) =>
      summarizeSession(session, {
        workflowMembership: buildSessionMembershipExplanation(database, session, workflowCluster),
      }),
    );

  return {
    workflowCluster: summarizeWorkflowCluster(workflowCluster),
    sessions,
  };
}
