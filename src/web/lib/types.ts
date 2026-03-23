export interface DashboardData {
  generatedAt: string;
  timeWindow: TimeWindow;
  rawEventCount: number;
  latestEventAt?: string;
  report: WorkflowReport;
  comparison?: ComparisonData;
  reviewableWorkflows: WorkflowSummary[];
  sessionSummaries: SessionSummary[];
  agentHealth: AgentHealth;
  latestSnapshots: SnapshotSummary[];
}

export interface TimeWindow {
  window: string;
  reportDate: string;
  timezone: string;
}

export interface WorkflowReport {
  totalSessions: number;
  totalTrackedDurationSeconds: number;
  workflows: WorkflowSummary[];
  emergingWorkflows: EmergingWorkflow[];
  summary: ReportSummary;
}

export interface ReportSummary {
  topRepetitiveWorkflows: WorkflowHighlight[];
  highestTimeConsumingRepetitiveWorkflows: WorkflowHighlight[];
  quickWinAutomationCandidates: WorkflowHighlight[];
  workflowsNeedingHumanJudgment: WorkflowHighlight[];
}

export interface WorkflowHighlight {
  workflowName: string;
  frequency: number;
  totalDurationSeconds: number;
  automationSuitability: string;
  confidenceScore: number;
  userLabeled: boolean;
}

export interface WorkflowSummary {
  id: string;
  workflowSignature: string;
  detectionMode: "standard" | "short_form";
  workflowName: string;
  baselineWorkflowName: string;
  workflowNameSource: string;
  llmSuggestedWorkflowName?: string;
  businessPurpose?: string;
  frequency: number;
  averageDurationSeconds: number;
  totalDurationSeconds: number;
  representativeSteps: string[];
  involvedApps: string[];
  confidenceScore: number;
  automationSuitability: string;
  recommendedApproach: string;
  automationHints: AutomationHint[];
  excluded: boolean;
  hidden: boolean;
  userLabeled: boolean;
  repetitive?: boolean;
  automationCandidate?: boolean;
  automationDifficulty?: string;
  approvedAutomationCandidate?: boolean;
  sessionSummaries: SessionSummary[];
  visibleInReport: boolean;
}

export interface AutomationHint {
  suggestedApproach: string;
  whyThisFits: string;
  estimatedDifficulty: string;
  expectedTimeSavings: string;
  prerequisites: string[];
}

export interface EmergingWorkflow {
  workflowName: string;
  frequency: number;
  averageDurationSeconds: number;
  totalDurationSeconds: number;
  representativeSteps: string[];
  confidence: string;
}

export interface SessionSummary {
  id: string;
  startTime: string;
  endTime: string;
  durationSeconds: number;
  primaryApplication: string;
  primaryDomain?: string;
  sessionBoundaryReason: string;
  stepCount: number;
}

export interface SessionDetail extends SessionSummary {
  steps: SessionStep[];
}

export interface SessionStep {
  order: number;
  action: string;
  actionName?: string;
  application: string;
  target?: string;
  domain?: string;
  titlePattern?: string;
  timestamp: string;
}

export interface AgentHealth {
  status: string;
  runtime: {
    state?: {
      ingestServer?: {
        status: string;
        host?: string;
        port?: number;
      };
    };
  };
  collectors: Array<{
    id: string;
    status: string;
  }>;
}

export interface SnapshotSummary {
  window: string;
  reportDate: string;
  timezone: string;
  totalSessions: number;
  workflowCount: number;
  emergingWorkflowCount: number;
  generatedAt: string;
}

export interface ComparisonData {
  previousTimeWindow: TimeWindow;
  summary: {
    sessionDelta: number;
    trackedDurationDeltaSeconds: number;
    approvedCandidateTimeDeltaSeconds: number;
  };
  newlyAppearedWorkflows: ComparisonEntry[];
  disappearedWorkflows: ComparisonEntry[];
  approvedCandidateChanges: ComparisonEntry[];
}

export interface ComparisonEntry {
  workflowName: string;
  previousWorkflowName?: string;
  frequencyDelta: number;
  totalDurationDeltaSeconds: number;
}

export interface AnalysisStatus {
  running: boolean;
  workflowCount: number;
  payloadCount: number;
  shortFormExcludedCount: number;
  includeShortForm: boolean;
  latestRun?: AnalysisRun;
  latestResultCount?: number;
  credentialStatus: {
    backend?: string;
    warning?: string;
    configuration?: {
      model?: string;
      authMethod?: string;
    };
    providers?: Array<{
      label: string;
      selected: boolean;
      defaultModel: string;
      hasApiKey: boolean;
      hasOAuthCredentials: boolean;
      envApiKeyAvailable: boolean;
    }>;
  };
}

export interface AnalysisResults {
  latestRun?: AnalysisRun;
  analyses: AnalysisEntry[];
}

export interface AnalysisRun {
  status: string;
  startedAt?: string;
  completedAt?: string;
  summary?: {
    error?: string;
  };
}

export interface AnalysisEntry {
  workflowName: string;
  workflowSummary: string;
  provider: string;
  model: string;
  automationSuitability: string;
  recommendedApproach: string;
  rationale: string;
}

export type ViewName = "review" | "insights" | "analysis";
export type WindowName = "day" | "week" | "all";

export interface AppState {
  window: WindowName;
  date: string;
  view: ViewName;
  selectedSessionId: string | null;
  selectedWorkflowId: string | null;
  workflowActionMessage: string;
  analysisActionMessage: string;
  analysisApplyNames: boolean;
  analysisIncludeShortForm: boolean;
  analysisPollTimer: number | null;
  analysisRefreshing: boolean;
  latestDashboard: DashboardData | null;
  refreshTimer: number | null;
}
