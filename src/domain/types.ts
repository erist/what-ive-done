export type EventSource = "desktop" | "chrome_extension" | "mock";

export type AutomationSuitability = "high" | "medium" | "low";

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
  domain?: string | undefined;
  action: string;
  target?: string | undefined;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface SessionStep {
  order: number;
  normalizedEventId: string;
  timestamp: string;
  action: string;
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
  steps: SessionStep[];
}

export interface SessionSummary {
  id: string;
  startTime: string;
  endTime: string;
  primaryApplication: string;
  primaryDomain?: string | undefined;
  stepCount: number;
}

export interface WorkflowCluster {
  id: string;
  name: string;
  sessionIds: string[];
  frequency: number;
  averageDurationSeconds: number;
  totalDurationSeconds: number;
  representativeSteps: string[];
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

export interface ReportEntry {
  workflowClusterId: string;
  workflowName: string;
  frequency: number;
  averageDurationSeconds: number;
  totalDurationSeconds: number;
  automationSuitability: AutomationSuitability;
  recommendedApproach: string;
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
