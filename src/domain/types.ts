export type EventSource = "desktop" | "chrome_extension" | "mock";

export type AutomationSuitability = "high" | "medium" | "low";

export type ReportWindow = "all" | "day" | "week";

export type ActionSource = "rule" | "inferred" | "user_labeled";

export type SessionBoundaryReason =
  | "stream_start"
  | "idle_gap"
  | "context_shift"
  | "idle_and_context_shift"
  | "reset_after_interruption";

export interface RawEvent {
  id: string;
  source: EventSource;
  sourceEventType: string;
  timestamp: string;
  application: string;
  windowTitle?: string | undefined;
  domain?: string | undefined;
  url?: string | undefined;
  action: string;
  target?: string | undefined;
  metadata: Record<string, unknown>;
  sensitiveFiltered: boolean;
  createdAt: string;
}

export interface RawEventInput {
  source: EventSource;
  sourceEventType: string;
  timestamp: string;
  application: string;
  windowTitle?: string | undefined;
  domain?: string | undefined;
  url?: string | undefined;
  action: string;
  target?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface NormalizedEvent {
  id: string;
  rawEventId: string;
  timestamp: string;
  application: string;
  appNameNormalized: string;
  domain?: string | undefined;
  url?: string | undefined;
  pathPattern?: string | undefined;
  pageType?: string | undefined;
  resourceHint?: string | undefined;
  titlePattern?: string | undefined;
  action: string;
  actionName: string;
  actionConfidence: number;
  actionSource: ActionSource;
  target?: string | undefined;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface SessionStep {
  order: number;
  normalizedEventId: string;
  timestamp: string;
  action: string;
  actionName: string;
  actionConfidence: number;
  actionSource: ActionSource;
  application: string;
  domain?: string | undefined;
  target?: string | undefined;
}

export interface Session {
  id: string;
  startTime: string;
  endTime: string;
  primaryApplication: string;
  primaryDomain?: string | undefined;
  sessionBoundaryReason: SessionBoundaryReason;
  sessionBoundaryDetails: Record<string, unknown>;
  steps: SessionStep[];
}

export interface SessionSummary {
  id: string;
  startTime: string;
  endTime: string;
  primaryApplication: string;
  primaryDomain?: string | undefined;
  sessionBoundaryReason: SessionBoundaryReason;
  stepCount: number;
}

export interface WorkflowVariant {
  sequence: string[];
  occurrenceCount: number;
  averageDurationSeconds: number;
}

export interface WorkflowCluster {
  id: string;
  workflowSignature: string;
  name: string;
  sessionIds: string[];
  occurrenceCount: number;
  frequency: number;
  averageDurationSeconds: number;
  totalDurationSeconds: number;
  representativeSequence: string[];
  representativeSteps: string[];
  involvedApps: string[];
  confidenceScore: number;
  topVariants: WorkflowVariant[];
  automationSuitability: AutomationSuitability;
  recommendedApproach: string;
  excluded: boolean;
  hidden: boolean;
}

export interface WorkflowFeedback {
  id: string;
  workflowClusterId: string;
  renameTo?: string | undefined;
  excluded?: boolean | undefined;
  hidden?: boolean | undefined;
  createdAt: string;
}

export interface WorkflowFeedbackSummary {
  renameTo?: string | undefined;
  excluded?: boolean | undefined;
  hidden?: boolean | undefined;
}

export interface ReportEntry {
  workflowClusterId: string;
  workflowName: string;
  frequency: number;
  averageDurationSeconds: number;
  totalDurationSeconds: number;
  automationSuitability: AutomationSuitability;
  recommendedApproach: string;
}

export interface ReportTimeWindow {
  window: ReportWindow;
  reportDate: string;
  timezone: string;
  timezoneOffsetMinutes: number;
  startTime?: string | undefined;
  endTime?: string | undefined;
}

export interface EmergingWorkflowEntry {
  workflowClusterId: string;
  workflowName: string;
  frequency: number;
  averageDurationSeconds: number;
  totalDurationSeconds: number;
  representativeSteps: string[];
  confidence: "provisional";
}

export interface WorkflowReport {
  timeWindow: ReportTimeWindow;
  totalSessions: number;
  totalTrackedDurationSeconds: number;
  workflows: ReportEntry[];
  emergingWorkflows: EmergingWorkflowEntry[];
}

export interface ReportSnapshot extends WorkflowReport {
  id: string;
  generatedAt: string;
}

export interface ReportSnapshotSummary {
  id: string;
  window: ReportWindow;
  reportDate: string;
  timezone: string;
  totalSessions: number;
  workflowCount: number;
  emergingWorkflowCount: number;
  generatedAt: string;
}

export interface LLMWorkflowSummaryPayload {
  workflowSteps: string[];
  frequency: number;
  averageDurationSeconds: number;
  applications: string[];
  domains: string[];
}

export interface WorkflowSummaryPayloadRecord {
  workflowClusterId: string;
  workflowName: string;
  payload: LLMWorkflowSummaryPayload;
}

export interface WorkflowLLMAnalysis {
  workflowClusterId: string;
  provider: string;
  model: string;
  workflowName: string;
  workflowSummary: string;
  automationSuitability: AutomationSuitability;
  recommendedApproach: string;
  rationale: string;
  createdAt: string;
}
