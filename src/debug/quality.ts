import type {
  AnalysisRun,
  EventSource,
  NormalizedEvent,
  RawEvent,
  SessionSummary,
  WorkflowCluster,
} from "../domain/types.js";
import type { AppDatabase } from "../storage/database.js";

export interface DatasetQualityCount {
  key: string;
  count: number;
}

export interface DatasetQualityIssue {
  code: string;
  severity: "warn" | "error";
  message: string;
  details?: Record<string, boolean | number | string>;
}

export interface DatasetQualityReport {
  generatedAt: string;
  rawEvents: {
    total: number;
    latestTimestamp?: string | undefined;
    bySource: DatasetQualityCount[];
    bySourceEventType: DatasetQualityCount[];
    unanalyzedCount: number;
    firstUnanalyzedTimestamp?: string | undefined;
    lastUnanalyzedTimestamp?: string | undefined;
  };
  browserContext: {
    browserAppSwitchEvents: number;
    chromeExtensionEvents: number;
    browserNavigationEvents: number;
    rawWithBrowserSchema: number;
    rawWithCanonicalUrl: number;
    rawWithRouteTemplate: number;
    rawSchemaWithoutRouteContext: number;
    normalizedChromeEvents: number;
    normalizedWithDomain: number;
    normalizedWithRouteFamily: number;
    normalizedWithDomainPack: number;
  };
  actionQuality: {
    totalNormalizedEvents: number;
    switchActions: number;
    switchActionPct: number;
    emptySwitchActions: number;
    nonSwitchActions: number;
    topActions: DatasetQualityCount[];
  };
  sessionQuality: {
    totalSessions: number;
    latestEndTime?: string | undefined;
    negativeDurationSessions: number;
    zeroOrSubsecondSessions: number;
    lte5SecondSessions: number;
    shortFormEligibleSessions: number;
    byBoundaryReason: DatasetQualityCount[];
  };
  workflowQuality: {
    totalClusters: number;
    byDetectionMode: DatasetQualityCount[];
    genericClusters: number;
    genericShortFormClusters: number;
    userLabeledClusters: number;
  };
  freshness: {
    latestRawEventTimestamp?: string | undefined;
    latestNormalizedEventTimestamp?: string | undefined;
    latestSnapshotGeneratedAt?: string | undefined;
    latestLLMAnalysisRunCompletedAt?: string | undefined;
  };
  runtime?: {
    status?: string | undefined;
    collectorIds: string[];
  };
  issues: DatasetQualityIssue[];
}

const BROWSER_APPLICATIONS = new Set(["chrome", "google chrome", "chrome browser", "firefox", "safari"]);
const BROWSER_SOURCE_EVENT_TYPE = /^(?:browser|chrome|dom|form|tab)\./u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeApplication(value: string): string {
  return value.trim().toLowerCase();
}

function countBy<T>(values: T[], toKey: (value: T) => string): DatasetQualityCount[] {
  const counts = new Map<string, number>();

  for (const value of values) {
    const key = toKey(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
}

function latestTimestamp(values: Array<string | undefined>): string | undefined {
  const validValues = values.filter(
    (value): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value)),
  );

  return validValues.sort((left, right) => Date.parse(right) - Date.parse(left))[0];
}

function sequenceIsGeneric(sequence: string[]): boolean {
  return sequence.length > 0 && sequence.every((action) => action === "unknown_action" || action.startsWith("switch_to_"));
}

function sessionDurationSeconds(session: SessionSummary): number {
  return (new Date(session.endTime).getTime() - new Date(session.startTime).getTime()) / 1000;
}

function latestCompletedAnalysisRun(run: AnalysisRun | undefined): string | undefined {
  if (!run || run.status === "running") {
    return undefined;
  }

  return run.completedAt;
}

function buildIssues(args: {
  browserAppSwitchEvents: number;
  chromeExtensionEvents: number;
  browserNavigationEvents: number;
  rawSchemaWithoutRouteContext: number;
  unanalyzedCount: number;
  switchActionPct: number;
  emptySwitchActions: number;
  negativeDurationSessions: number;
  genericShortFormClusters: number;
}): DatasetQualityIssue[] {
  const issues: DatasetQualityIssue[] = [];

  if (
    args.browserAppSwitchEvents > 0 &&
    args.chromeExtensionEvents === 0 &&
    args.browserNavigationEvents === 0
  ) {
    issues.push({
      code: "browser_context_missing",
      severity: "error",
      message: "Browser app-switch activity exists, but no browser extension context events were stored.",
      details: {
        browserAppSwitchEvents: args.browserAppSwitchEvents,
      },
    });
  }

  if (args.rawSchemaWithoutRouteContext > 0) {
    issues.push({
      code: "browser_schema_without_route_context",
      severity: "warn",
      message: "Browser schema version was stamped on events that still have no canonical URL or route template.",
      details: {
        affectedEvents: args.rawSchemaWithoutRouteContext,
      },
    });
  }

  if (args.unanalyzedCount > 0) {
    issues.push({
      code: "analysis_artifacts_stale",
      severity: "warn",
      message: "Raw events exist that have not been normalized into stored analysis artifacts yet.",
      details: {
        unanalyzedRawEvents: args.unanalyzedCount,
      },
    });
  }

  if (args.switchActionPct >= 80) {
    issues.push({
      code: "action_abstraction_switch_heavy",
      severity: "warn",
      message: "Most normalized events still collapse to switch_to_* actions.",
      details: {
        switchActionPct: args.switchActionPct,
      },
    });
  }

  if (args.emptySwitchActions > 0) {
    issues.push({
      code: "broken_application_identifier_actions",
      severity: "error",
      message: "One or more inferred switch_to_* actions lost the application identifier entirely.",
      details: {
        emptySwitchActions: args.emptySwitchActions,
      },
    });
  }

  if (args.negativeDurationSessions > 0) {
    issues.push({
      code: "negative_session_durations",
      severity: "error",
      message: "One or more sessions ended before they started after timestamp parsing.",
      details: {
        negativeDurationSessions: args.negativeDurationSessions,
      },
    });
  }

  if (args.genericShortFormClusters > 0) {
    issues.push({
      code: "generic_short_form_clusters",
      severity: "warn",
      message: "Short-form workflow detection is promoting generic switch-only clusters.",
      details: {
        genericShortFormClusters: args.genericShortFormClusters,
      },
    });
  }

  return issues;
}

export function buildDatasetQualityReport(database: AppDatabase): DatasetQualityReport {
  const rawEvents = database.getRawEventsChronological();
  const normalizedEvents = database.listNormalizedEvents(Number.MAX_SAFE_INTEGER);
  const sessions = database.listSessionSummaries();
  const workflowClusters = database.listWorkflowClusters();
  const latestSnapshot = database.listReportSnapshots({ limit: 1 })[0];
  const latestAnalysisRun = database.getLatestAnalysisRun();
  const runtimeSetting = database.getSetting<unknown>("agent.runtime");
  const normalizedRawEventIds = new Set(normalizedEvents.map((event) => event.rawEventId));
  const unanalyzedRawEvents = rawEvents.filter((event) => !normalizedRawEventIds.has(event.id));
  const browserAppSwitchEvents = rawEvents.filter(
    (event) =>
      ["app.switch", "application.switch"].includes(event.sourceEventType) &&
      BROWSER_APPLICATIONS.has(normalizeApplication(event.application)),
  ).length;
  const chromeExtensionEvents = rawEvents.filter((event) => event.source === "chrome_extension").length;
  const browserNavigationEvents = rawEvents.filter((event) =>
    BROWSER_SOURCE_EVENT_TYPE.test(event.sourceEventType),
  ).length;
  const rawWithBrowserSchema = rawEvents.filter((event) => event.browserSchemaVersion !== undefined).length;
  const rawWithCanonicalUrl = rawEvents.filter((event) => typeof event.canonicalUrl === "string").length;
  const rawWithRouteTemplate = rawEvents.filter((event) => typeof event.routeTemplate === "string").length;
  const rawSchemaWithoutRouteContext = rawEvents.filter(
    (event) =>
      event.browserSchemaVersion !== undefined &&
      !event.canonicalUrl &&
      !event.routeTemplate,
  ).length;
  const normalizedChromeEvents = normalizedEvents.filter(
    (event) => normalizeApplication(event.application) === "chrome",
  ).length;
  const normalizedWithDomain = normalizedEvents.filter((event) => typeof event.domain === "string").length;
  const normalizedWithRouteFamily = normalizedEvents.filter((event) => typeof event.routeFamily === "string").length;
  const normalizedWithDomainPack = normalizedEvents.filter((event) => typeof event.domainPackId === "string").length;
  const switchActions = normalizedEvents.filter((event) => event.actionName.startsWith("switch_to_")).length;
  const emptySwitchActions = normalizedEvents.filter((event) => event.actionName === "switch_to_").length;
  const totalNormalizedEvents = normalizedEvents.length;
  const switchActionPct =
    totalNormalizedEvents === 0
      ? 0
      : Math.round((switchActions / totalNormalizedEvents) * 1000) / 10;
  const nonSwitchActions = totalNormalizedEvents - switchActions;
  const topActions = countBy(normalizedEvents, (event) => event.actionName).slice(0, 10);
  const sessionDurations = sessions.map((session) => sessionDurationSeconds(session));
  const negativeDurationSessions = sessionDurations.filter((duration) => duration < 0).length;
  const zeroOrSubsecondSessions = sessionDurations.filter((duration) => Math.abs(duration) < 1).length;
  const lte5SecondSessions = sessionDurations.filter((duration) => duration <= 5).length;
  const shortFormEligibleSessions = sessions.filter((session) => {
    const duration = sessionDurationSeconds(session);
    return duration >= 0 && duration <= 20 && session.stepCount <= 3;
  }).length;
  const genericClusters = workflowClusters.filter((cluster) =>
    sequenceIsGeneric(cluster.representativeSequence),
  ).length;
  const genericShortFormClusters = workflowClusters.filter(
    (cluster) => cluster.detectionMode === "short_form" && sequenceIsGeneric(cluster.representativeSequence),
  ).length;
  const runtime = isRecord(runtimeSetting)
    ? {
        status:
          typeof runtimeSetting.status === "string" ? runtimeSetting.status : undefined,
        collectorIds: Array.isArray(runtimeSetting.collectors)
          ? runtimeSetting.collectors.flatMap((entry) =>
              isRecord(entry) && typeof entry.id === "string" ? [entry.id] : [],
            )
          : [],
      }
    : undefined;

  const report: DatasetQualityReport = {
    generatedAt: new Date().toISOString(),
    rawEvents: {
      total: rawEvents.length,
      latestTimestamp: latestTimestamp(rawEvents.map((event) => event.timestamp)),
      bySource: countBy(rawEvents, (event) => event.source as EventSource),
      bySourceEventType: countBy(rawEvents, (event) => event.sourceEventType),
      unanalyzedCount: unanalyzedRawEvents.length,
      firstUnanalyzedTimestamp: unanalyzedRawEvents[0]?.timestamp,
      lastUnanalyzedTimestamp: latestTimestamp(unanalyzedRawEvents.map((event) => event.timestamp)),
    },
    browserContext: {
      browserAppSwitchEvents,
      chromeExtensionEvents,
      browserNavigationEvents,
      rawWithBrowserSchema,
      rawWithCanonicalUrl,
      rawWithRouteTemplate,
      rawSchemaWithoutRouteContext,
      normalizedChromeEvents,
      normalizedWithDomain,
      normalizedWithRouteFamily,
      normalizedWithDomainPack,
    },
    actionQuality: {
      totalNormalizedEvents,
      switchActions,
      switchActionPct,
      emptySwitchActions,
      nonSwitchActions,
      topActions,
    },
    sessionQuality: {
      totalSessions: sessions.length,
      latestEndTime: latestTimestamp(sessions.map((session) => session.endTime)),
      negativeDurationSessions,
      zeroOrSubsecondSessions,
      lte5SecondSessions,
      shortFormEligibleSessions,
      byBoundaryReason: countBy(sessions, (session) => session.sessionBoundaryReason),
    },
    workflowQuality: {
      totalClusters: workflowClusters.length,
      byDetectionMode: countBy(workflowClusters, (cluster) => cluster.detectionMode),
      genericClusters,
      genericShortFormClusters,
      userLabeledClusters: workflowClusters.filter((cluster) => cluster.userLabeled).length,
    },
    freshness: {
      latestRawEventTimestamp: latestTimestamp(rawEvents.map((event) => event.timestamp)),
      latestNormalizedEventTimestamp: latestTimestamp(
        normalizedEvents.map((event) => event.timestamp),
      ),
      latestSnapshotGeneratedAt: latestSnapshot?.generatedAt,
      latestLLMAnalysisRunCompletedAt: latestCompletedAnalysisRun(latestAnalysisRun),
    },
    issues: buildIssues({
      browserAppSwitchEvents,
      chromeExtensionEvents,
      browserNavigationEvents,
      rawSchemaWithoutRouteContext,
      unanalyzedCount: unanalyzedRawEvents.length,
      switchActionPct,
      emptySwitchActions,
      negativeDurationSessions,
      genericShortFormClusters,
    }),
  };

  if (runtime) {
    report.runtime = runtime;
  }

  return report;
}
