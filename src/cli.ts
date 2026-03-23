#!/usr/bin/env node
import { Command } from "commander";

import { getAgentHealthReport, listLatestAgentSnapshots, runAgentOnce } from "./agent/control.js";
import {
  getAgentAutostartStatus,
  installAgentAutostart,
  uninstallAgentAutostart,
} from "./agent/autostart/index.js";
import { getAgentStatusSnapshot } from "./agent/state.js";
import { startAgentRuntime, stopAgentRuntime } from "./agent/runtime.js";
import { resolveAppPaths } from "./app-paths.js";
import { openSystemBrowser } from "./auth/browser.js";
import {
  DEFAULT_OPENAI_CODEX_ISSUER,
  runOpenAICodexOAuthInteractiveLogin,
} from "./auth/openai-oauth.js";
import {
  runGoogleOAuthInteractiveLogin,
} from "./auth/google-oauth.js";
import { getAvailableCollectors } from "./collectors/index.js";
import {
  DEFAULT_GWS_CALENDAR_ID,
  DEFAULT_GWS_CALENDAR_POLL_INTERVAL_MS,
  getGWSCalendarCollectorInfo,
  getGWSCalendarCollectorStatus,
} from "./collectors/gws-calendar.js";
import {
  DEFAULT_GWS_DRIVE_POLL_INTERVAL_MS,
  getGWSDriveCollectorInfo,
  getGWSDriveCollectorStatus,
} from "./collectors/gws-drive.js";
import {
  DEFAULT_GWS_SHEETS_POLL_INTERVAL_MS,
  getGWSSheetsCollectorInfo,
  getGWSSheetsCollectorStatus,
} from "./collectors/gws-sheets.js";
import {
  DEFAULT_GIT_CONTEXT_POLL_INTERVAL_MS,
  getGitContextCollectorInfo,
  getGitContextCollectorStatus,
} from "./collectors/git-context.js";
import { getMacOSActiveWindowCollectorInfo, resolveMacOSCollectorRunner } from "./collectors/macos.js";
import { getWindowsActiveWindowCollectorInfo } from "./collectors/windows.js";
import {
  deleteOpenAICodexOAuthCredentials,
  deleteGeminiOAuthCredentials,
  deleteLLMApiKey,
  setOpenAICodexOAuthCredentials,
  setGeminiOAuthCredentials,
  setLLMApiKey,
} from "./credentials/llm.js";
import { resolveCredentialStore } from "./credentials/store.js";
import { ConfigManager } from "./config/manager.js";
import { resolveConfiguredAnalyzeOptions } from "./config/workflow-analysis.js";
import {
  DEFAULT_WID_SERVER_HOST,
  DEFAULT_WID_SERVER_PORT,
  type WidConfig,
} from "./config/schema.js";
import { normalizeCliArgv } from "./cli/aliases.js";
import {
  createPromptSessionForCommand,
  type InteractiveCommandOptions,
} from "./cli/interaction.js";
import { runInit, runInteractiveInit } from "./init/flow.js";
import { isMissingDataDirError, runSetup } from "./setup/flow.js";
import { buildDatasetQualityReport } from "./debug/quality.js";
import {
  buildRawEventTrace,
  buildSessionTrace,
  buildWorkflowClusterTrace,
} from "./debug/trace.js";
import {
  buildActionSuggestionPrompt,
  describeActionMatchMetadata,
  inspectActionCoverage,
} from "./action-packs/service.js";
import { saveWorkflowReview, type SaveWorkflowReviewResult } from "./feedback/service.js";
import {
  runClusterBenchmark,
} from "./pipeline/cluster-benchmark.js";
import {
  inspectDomainPackCoverage,
  rawEventInputsToRawEvents,
} from "./domain-packs/service.js";
import { generateMockRawEvents } from "./collectors/mock.js";
import { importEventsFromFile } from "./importers/events.js";
import {
  getLLMProviderDescriptor,
  LLM_PROVIDERS,
  normalizeLLMProvider,
  supportsLLMAuthMethod,
} from "./llm/catalog.js";
import {
  getStoredLLMConfiguration,
  updateLLMConfiguration,
} from "./llm/config.js";
import {
  analyzeWorkflowPayloadRecords,
  buildProviderCredentialStatus,
  persistWorkflowLLMAnalysisResults,
} from "./llm/service.js";
import { analyzeRawEvents } from "./pipeline/analyze.js";
import {
  DEFAULT_CLUSTER_CONFIDENCE_WEIGHTS,
  DEFAULT_CLUSTER_SIMILARITY_THRESHOLD,
  DEFAULT_CLUSTER_SIMILARITY_WEIGHTS,
} from "./pipeline/cluster.js";
import { buildWorkflowReport, formatDuration } from "./reporting/report.js";
import {
  buildWorkflowReportFromDatabase,
  buildWorkflowReportComparisonFromDatabase,
  generateReportSnapshot,
  runReportSchedulerCycle,
} from "./reporting/service.js";
import { parseReportWindow, parseReportWindowList, resolveReportTimeWindow } from "./reporting/windows.js";
import { startIngestServer } from "./server/ingest-server.js";
import {
  buildIngestSecurityState,
  DEFAULT_INGEST_RATE_LIMIT_MAX_REQUESTS,
  DEFAULT_INGEST_RATE_LIMIT_WINDOW_MS,
  getIngestAuthToken,
  rotateIngestAuthToken,
} from "./server/security.js";
import { AppDatabase } from "./storage/database.js";
import {
  addTool,
  authenticateTool,
  formatToolList,
  listTools,
  refreshTool,
  removeTool,
} from "./tools/service.js";
import { resolveCollectorRuntimeOptions } from "./tools/runtime.js";
import type {
  ReportEntry,
  ReportSnapshot,
  ReportSnapshotSummary,
  ReportWindow,
  WorkflowLLMAnalysis,
  WorkflowReportComparison,
  WorkflowReport,
} from "./domain/types.js";

const program = new Command("wid");

function withDatabase<T>(dataDir: string | undefined, fn: (database: AppDatabase) => T): T {
  const resolvedDataDir = ConfigManager.resolveDataDir(dataDir);
  const database = new AppDatabase(resolveAppPaths(resolvedDataDir));
  database.initialize();

  try {
    return fn(database);
  } finally {
    database.close();
  }
}

function resolveCommandDataDir(dataDir?: string): string {
  return ConfigManager.resolveDataDir(dataDir);
}

function resolvePreferredDataDir(positionalDataDir?: string, optionDataDir?: string): string | undefined {
  return positionalDataDir ?? optionDataDir;
}

function mergeActionOptions<T extends object>(
  options: T,
  command?: Command,
): T {
  return {
    ...(command?.optsWithGlobals<T>() ?? {}),
    ...options,
  };
}

function resolveActionDataDir(
  options: { dataDir?: string },
  command?: Command,
): string | undefined {
  return mergeActionOptions(options, command).dataDir;
}

function loadActionCommandConfig(
  options: { dataDir?: string },
  command?: Command,
): { dataDir: string; config: WidConfig } {
  return loadCommandConfig(resolveActionDataDir(options, command));
}

function loadCommandConfig(dataDir?: string): { dataDir: string; config: WidConfig } {
  const resolvedDataDir = resolveCommandDataDir(dataDir);

  return {
    dataDir: resolvedDataDir,
    config: ConfigManager.load(resolvedDataDir),
  };
}

function normalizeOptionalConfigString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isToolAdded(config: WidConfig, toolName: string): boolean {
  return config.tools[toolName]?.added === true;
}

const BROWSER_DIAGNOSTIC_APPLICATIONS = new Set([
  "chrome",
  "google chrome",
  "chrome browser",
  "firefox",
  "safari",
]);
const BROWSER_DIAGNOSTIC_EVENT_TYPE = /^(?:browser|chrome|dom|form|tab)\./u;

interface ToolCommandCliOptions extends InteractiveCommandOptions {
  dataDir?: string;
}

interface AuthLoginCommandOptions extends InteractiveCommandOptions {
  dataDir?: string;
  clientId?: string;
  clientSecret?: string;
  projectId?: string;
  issuerUrl?: string;
  port: string;
}

async function resolvePromptedText(
  question: string,
  prompts: ReturnType<typeof createPromptSessionForCommand>,
  value?: string,
  defaultValue?: string,
): Promise<string | undefined> {
  const resolvedValue = normalizeOptionalConfigString(value) ?? normalizeOptionalConfigString(defaultValue);

  if (resolvedValue) {
    return resolvedValue;
  }

  if (!prompts) {
    return undefined;
  }

  return normalizeOptionalConfigString(await prompts.text(question, defaultValue));
}

async function resolvePromptedSecret(
  question: string,
  prompts: ReturnType<typeof createPromptSessionForCommand>,
  value?: string,
  defaultValue?: string,
): Promise<string | undefined> {
  const resolvedValue = normalizeOptionalConfigString(value) ?? normalizeOptionalConfigString(defaultValue);

  if (resolvedValue) {
    return resolvedValue;
  }

  if (!prompts) {
    return undefined;
  }

  return normalizeOptionalConfigString(await prompts.secret(question, defaultValue));
}

async function runAuthLoginCommand(
  providerName: string,
  options: AuthLoginCommandOptions,
): Promise<void> {
  const provider = normalizeLLMProvider(providerName);
  const credentialStore = resolveCredentialStore();

  if (provider !== "gemini" && provider !== "openai-codex") {
    throw new Error(`${provider} does not expose a public OAuth login flow for direct API usage`);
  }

  if (!credentialStore.isSupported()) {
    throw new Error("Secure credential storage is required for OAuth login on this platform");
  }

  const prompts = createPromptSessionForCommand(options);

  try {
    if (provider === "openai-codex") {
      const clientId = await resolvePromptedText(
        "OpenAI Codex OAuth client id",
        prompts,
        options.clientId,
        process.env.OPENAI_CODEX_CLIENT_ID,
      );

      if (!clientId) {
        throw new Error(
          "OpenAI Codex OAuth requires a client id. Provide --client-id or OPENAI_CODEX_CLIENT_ID.",
        );
      }

      let authorizationUrl = "";
      let redirectUri = "";
      const credentials = await runOpenAICodexOAuthInteractiveLogin({
        clientId,
        issuer:
          normalizeOptionalConfigString(options.issuerUrl) ??
          normalizeOptionalConfigString(process.env.OPENAI_CODEX_ISSUER) ??
          DEFAULT_OPENAI_CODEX_ISSUER,
        port: Number.parseInt(options.port, 10),
        openBrowser: openSystemBrowser,
        onAuthorizationUrl: (url, resolvedRedirectUri) => {
          authorizationUrl = url;
          redirectUri = resolvedRedirectUri;
          console.log(
            JSON.stringify(
              {
                status: "oauth2_login_started",
                provider: "openai-codex",
                authorizationUrl: url,
                redirectUri: resolvedRedirectUri,
              },
              null,
              2,
            ),
          );
        },
      });

      setOpenAICodexOAuthCredentials(credentialStore, credentials);
      withDatabase(options.dataDir, (database) =>
        updateLLMConfiguration(database, {
          provider: "openai-codex",
          authMethod: "oauth2",
        }),
      );

      console.log(
        JSON.stringify(
          {
            status: "oauth2_login_completed",
            provider: "openai-codex",
            authorizationUrl,
            redirectUri,
            expiresAt: credentials.expiresAt,
            email: credentials.email,
            scopes: credentials.scope,
          },
          null,
          2,
        ),
      );
      return;
    }

    const clientId = await resolvePromptedText(
      "Google OAuth client id",
      prompts,
      options.clientId,
      process.env.GOOGLE_CLIENT_ID,
    );
    const clientSecret = await resolvePromptedSecret(
      "Google OAuth client secret",
      prompts,
      options.clientSecret,
      process.env.GOOGLE_CLIENT_SECRET,
    );
    const projectId = await resolvePromptedText(
      "Google Cloud project id",
      prompts,
      options.projectId,
      process.env.GOOGLE_CLOUD_PROJECT,
    );

    if (!clientId || !clientSecret || !projectId) {
      throw new Error(
        "Gemini OAuth requires client id, client secret, and project id. Provide flags/env vars or run from a TTY without --non-interactive.",
      );
    }

    let authorizationUrl = "";
    let redirectUri = "";
    const credentials = await runGoogleOAuthInteractiveLogin({
      clientId,
      clientSecret,
      projectId,
      port: Number.parseInt(options.port, 10),
      openBrowser: openSystemBrowser,
      onAuthorizationUrl: (url, resolvedRedirectUri) => {
        authorizationUrl = url;
        redirectUri = resolvedRedirectUri;
        console.log(
          JSON.stringify(
            {
              status: "oauth2_login_started",
              provider: "gemini",
              authorizationUrl: url,
              redirectUri: resolvedRedirectUri,
            },
            null,
            2,
          ),
        );
      },
    });

    setGeminiOAuthCredentials(credentialStore, credentials);
    withDatabase(options.dataDir, (database) =>
      updateLLMConfiguration(database, {
        provider: "gemini",
        authMethod: "oauth2",
        googleProjectId: credentials.projectId,
      }),
    );

    console.log(
      JSON.stringify(
        {
          status: "oauth2_login_completed",
          provider: "gemini",
          authorizationUrl,
          redirectUri,
          expiresAt: credentials.expiresAt,
          scopes: credentials.scope,
        },
        null,
        2,
      ),
    );
  } finally {
    prompts?.close();
  }
}

function runAuthLogoutCommand(providerName: string, options: { dataDir?: string }): void {
  const provider = normalizeLLMProvider(providerName);

  if (provider !== "gemini" && provider !== "openai-codex") {
    throw new Error(`${provider} does not have stored OAuth credentials in this CLI`);
  }

  const credentialStore = resolveCredentialStore();

  if (provider === "openai-codex") {
    deleteOpenAICodexOAuthCredentials(credentialStore);

    console.log(
      JSON.stringify(
        {
          status: "oauth2_credentials_deleted",
          provider: "openai-codex",
        },
        null,
        2,
      ),
    );
    return;
  }

  deleteGeminiOAuthCredentials(credentialStore);
  withDatabase(options.dataDir, (database) => {
    const current = getStoredLLMConfiguration(database);

    if (current.provider === "gemini" && current.authMethod === "oauth2") {
      updateLLMConfiguration(database, {
        authMethod: "api-key",
      });
    }
  });

  console.log(
    JSON.stringify(
      {
        status: "oauth2_credentials_deleted",
        provider: "gemini",
      },
      null,
      2,
    ),
  );
}

interface AgentRuntimeCommandOptions {
  dataDir?: string;
  heartbeatIntervalMs: string;
  ingestHost?: string;
  ingestPort?: string;
  ingestAuthToken?: string;
  collectorPollIntervalMs: string;
  collectorRestartDelayMs: string;
  gwsCalendar?: boolean;
  gwsCalendarId?: string;
  gwsCalendarPollIntervalMs: string;
  gwsDrive?: boolean;
  gwsDrivePollIntervalMs: string;
  gwsSheets?: boolean;
  gwsSheetsPollIntervalMs: string;
  gitRepo?: string;
  gitPollIntervalMs: string;
  promptAccessibility: boolean;
  snapshotWindows: ReportWindow[];
  snapshotIntervalSeconds: string;
  collectors: boolean;
  snapshotScheduler: boolean;
  verbose?: boolean;
  openViewer?: boolean;
  disableGws?: boolean;
}

function parseConfigValue(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function printConfigValue(value: unknown): void {
  if (typeof value === "string") {
    console.log(value);
    return;
  }

  if (value === undefined) {
    console.log("undefined");
    return;
  }

  console.log(JSON.stringify(value, null, 2));
}

function describeIngestSecurity(dataDir?: string): {
  authTokenConfigured: boolean;
  authTokenPreview?: string | undefined;
  localOnly: true;
  authRequired: true;
  rateLimitWindowMs: number;
  rateLimitMaxRequests: number;
} {
  return withDatabase(dataDir, (database) => {
    const authToken = getIngestAuthToken(database);

    if (!authToken) {
      return {
        authTokenConfigured: false,
        localOnly: true as const,
        authRequired: true as const,
        rateLimitWindowMs: DEFAULT_INGEST_RATE_LIMIT_WINDOW_MS,
        rateLimitMaxRequests: DEFAULT_INGEST_RATE_LIMIT_MAX_REQUESTS,
      };
    }

    const security = buildIngestSecurityState({
      authToken,
    });

    return {
      authTokenConfigured: true,
      authTokenPreview: security.authTokenPreview,
      localOnly: security.localOnly,
      authRequired: security.authRequired,
      rateLimitWindowMs: security.rateLimitWindowMs,
      rateLimitMaxRequests: security.rateLimitMaxRequests,
    };
  });
}

function describeBrowserIngest(
  dataDir: string | undefined,
  ingestSecurity: ReturnType<typeof describeIngestSecurity>,
): {
  status: "ready" | "observed" | "attention";
  authTokenConfigured: boolean;
  runtimeStatus: "running" | "stopped" | "stale";
  ingestServerStatus?: string | undefined;
  ingestEventsUrl?: string | undefined;
  browserAppSwitchEvents: number;
  chromeExtensionEvents: number;
  browserNavigationEvents: number;
  latestChromeExtensionEventTimestamp?: string | undefined;
  rawSchemaWithoutRouteContext: number;
  issues: string[];
} {
  const runtime = getAgentStatusSnapshot(dataDir);

  return withDatabase(dataDir, (database) => {
    const rawEvents = database.getRawEventsChronological();
    let browserAppSwitchEvents = 0;
    let chromeExtensionEvents = 0;
    let browserNavigationEvents = 0;
    let latestChromeExtensionEventTimestamp: string | undefined;
    let rawSchemaWithoutRouteContext = 0;

    for (const event of rawEvents) {
      const normalizedApplication = event.application.trim().toLowerCase();

      if (
        (event.sourceEventType === "app.switch" || event.sourceEventType === "application.switch") &&
        BROWSER_DIAGNOSTIC_APPLICATIONS.has(normalizedApplication)
      ) {
        browserAppSwitchEvents += 1;
      }

      if (BROWSER_DIAGNOSTIC_EVENT_TYPE.test(event.sourceEventType)) {
        browserNavigationEvents += 1;
      }

      if (event.source === "chrome_extension") {
        chromeExtensionEvents += 1;
        latestChromeExtensionEventTimestamp = event.timestamp;
      }

      if (event.browserSchemaVersion !== undefined && !event.canonicalUrl && !event.routeTemplate) {
        rawSchemaWithoutRouteContext += 1;
      }
    }

    const issues: string[] = [];

    if (!ingestSecurity.authTokenConfigured) {
      issues.push("ingest_auth_token_missing");
    }

    if (
      browserAppSwitchEvents > 0 &&
      chromeExtensionEvents === 0 &&
      browserNavigationEvents === 0
    ) {
      issues.push("browser_context_missing");
    }

    if (rawSchemaWithoutRouteContext > 0) {
      issues.push("browser_schema_without_route_context");
    }

    if (
      runtime.status === "running" &&
      runtime.state?.ingestServer &&
      runtime.state.ingestServer.status !== "running"
    ) {
      issues.push("ingest_server_not_running");
    }

    return {
      status:
        issues.length > 0
          ? "attention"
          : chromeExtensionEvents > 0
            ? "observed"
            : "ready",
      authTokenConfigured: ingestSecurity.authTokenConfigured,
      runtimeStatus: runtime.status,
      ingestServerStatus: runtime.state?.ingestServer?.status,
      ingestEventsUrl: runtime.state?.ingestServer?.eventsUrl,
      browserAppSwitchEvents,
      chromeExtensionEvents,
      browserNavigationEvents,
      latestChromeExtensionEventTimestamp,
      rawSchemaWithoutRouteContext,
      issues,
    };
  });
}

function renderReportTable(reportEntries: ReportEntry[]): void {
  console.table(
    reportEntries.map((entry) => ({
      workflow: entry.workflowName,
      nameSource: entry.workflowNameSource,
      baselineWorkflow:
        entry.workflowNameSource === "baseline" ? "" : entry.baselineWorkflowName,
      frequency: entry.frequency,
      frequencyPerWeek: entry.frequencyPerWeek,
      averageDuration: formatDuration(entry.averageDurationSeconds),
      totalDuration: formatDuration(entry.totalDurationSeconds),
      apps: entry.involvedApps.join(", "),
      confidence: entry.confidenceScore,
      labeled: entry.userLabeled,
      automationSuitability: entry.automationSuitability,
      automationScore: entry.automationSuitabilityScore,
      recommendation: entry.recommendedApproach,
    })),
  );
}

function renderWorkflowSection(title: string, reportEntries: ReportEntry[]): void {
  if (reportEntries.length === 0) {
    return;
  }

  console.log(title);
  renderReportTable(reportEntries);
}

function renderWorkflowGraphs(reportEntries: ReportEntry[]): void {
  if (reportEntries.length === 0) {
    return;
  }

  console.log("Workflow graphs");

  for (const entry of reportEntries) {
    console.log(
      JSON.stringify(
        {
          workflow: entry.workflowName,
          graph: entry.graph.text,
          steps: entry.representativeSteps,
          businessPurpose: entry.businessPurpose ?? null,
          firstAutomationHint: entry.automationHints[0] ?? null,
        },
        null,
        2,
      ),
    );
  }
}

function renderSnapshotListTable(snapshots: ReportSnapshotSummary[]): void {
  console.table(
    snapshots.map((snapshot) => ({
      id: snapshot.id,
      window: snapshot.window,
      reportDate: snapshot.reportDate,
      timezone: snapshot.timezone,
      totalSessions: snapshot.totalSessions,
      workflows: snapshot.workflowCount,
      emergingWorkflows: snapshot.emergingWorkflowCount,
      generatedAt: snapshot.generatedAt,
    })),
  );
}

function renderSnapshotSummary(snapshot: ReportSnapshot): void {
  console.log(
    JSON.stringify(
      {
        id: snapshot.id,
        window: snapshot.timeWindow.window,
        reportDate: snapshot.timeWindow.reportDate,
        timezone: snapshot.timeWindow.timezone,
        windowStart: snapshot.timeWindow.startTime ?? null,
        windowEnd: snapshot.timeWindow.endTime ?? null,
        analysisSource: snapshot.freshness.analysisSource,
        snapshotStatus: snapshot.freshness.snapshotStatus,
        latestRawEventAt: snapshot.freshness.latestRawEventAt ?? null,
        latestSnapshotGeneratedAt: snapshot.freshness.latestStoredSnapshotGeneratedAt ?? null,
        reportGeneratedAt: snapshot.freshness.reportGeneratedAt,
        totalSessions: snapshot.totalSessions,
        totalTrackedDuration: formatDuration(snapshot.totalTrackedDurationSeconds),
        generatedAt: snapshot.generatedAt,
      },
      null,
      2,
    ),
  );
}

function renderComparisonTable(
  title: string,
  entries: WorkflowReportComparison["newlyAppearedWorkflows"],
): void {
  if (entries.length === 0) {
    return;
  }

  console.log(title);
  console.table(
    entries.map((entry) => ({
      workflow: entry.workflowName,
      previousWorkflow: entry.previousWorkflowName ?? "-",
      frequencyDelta: entry.frequencyDelta,
      timeDelta: formatDuration(Math.abs(entry.totalDurationDeltaSeconds)),
      direction: entry.totalDurationDeltaSeconds >= 0 ? "up_or_new" : "down_or_missing",
      approvedAutomationCandidate: entry.approvedAutomationCandidate ?? false,
    })),
  );
}

function buildStoredWorkflowReport(
  dataDir: string | undefined,
  options: {
    window?: ReportWindow | undefined;
    date?: string | undefined;
    includeExcluded?: boolean | undefined;
    includeHidden?: boolean | undefined;
  } = {},
): WorkflowReport {
  return withDatabase(dataDir, (database) =>
    buildWorkflowReportFromDatabase(database, {
      window: options.window,
      date: options.date,
      includeExcluded: options.includeExcluded,
      includeHidden: options.includeHidden,
    }),
  );
}

function buildStoredWorkflowReportComparison(
  dataDir: string | undefined,
  options: {
    window?: ReportWindow | undefined;
    date?: string | undefined;
    includeExcluded?: boolean | undefined;
    includeHidden?: boolean | undefined;
  } = {},
): WorkflowReportComparison {
  const comparison = withDatabase(dataDir, (database) =>
    buildWorkflowReportComparisonFromDatabase(database, {
      window: options.window,
      date: options.date,
      includeExcluded: options.includeExcluded,
      includeHidden: options.includeHidden,
    }),
  );

  if (!comparison) {
    throw new Error("Comparison is available only for day and week windows.");
  }

  return comparison;
}

function renderWorkflowReportComparison(
  comparison: WorkflowReportComparison,
  json = false,
): void {
  if (json) {
    console.log(JSON.stringify(comparison, null, 2));
    return;
  }

  console.log(
    JSON.stringify(
      {
        currentWindow: comparison.currentTimeWindow.window,
        currentReportDate: comparison.currentTimeWindow.reportDate,
        previousReportDate: comparison.previousTimeWindow.reportDate,
        sessionDelta: comparison.summary.sessionDelta,
        trackedDurationDelta: formatDuration(
          Math.abs(comparison.summary.trackedDurationDeltaSeconds),
        ),
        approvedCandidateTimeDelta: formatDuration(
          Math.abs(comparison.summary.approvedCandidateTimeDeltaSeconds),
        ),
      },
      null,
      2,
    ),
  );

  renderComparisonTable("Newly appeared workflows", comparison.newlyAppearedWorkflows);
  renderComparisonTable("Disappeared workflows", comparison.disappearedWorkflows);
  renderComparisonTable(
    "Approved automation candidate changes",
    comparison.approvedCandidateChanges,
  );
}

function renderWindowedWorkflowReport(report: WorkflowReport, json = false): void {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(
    JSON.stringify(
      {
        window: report.timeWindow.window,
        reportDate: report.timeWindow.reportDate,
        timezone: report.timeWindow.timezone,
        windowStart: report.timeWindow.startTime ?? null,
        windowEnd: report.timeWindow.endTime ?? null,
        analysisSource: report.freshness.analysisSource,
        snapshotStatus: report.freshness.snapshotStatus,
        latestRawEventAt: report.freshness.latestRawEventAt ?? null,
        latestSnapshotGeneratedAt: report.freshness.latestStoredSnapshotGeneratedAt ?? null,
        reportGeneratedAt: report.freshness.reportGeneratedAt,
        totalSessions: report.totalSessions,
        totalTrackedDuration: formatDuration(report.totalTrackedDurationSeconds),
      },
      null,
      2,
    ),
  );

  if (report.workflows.length === 0) {
    console.log("No confirmed workflows detected for this window.");
  } else {
    renderWorkflowSection("Top repetitive workflows", report.summary.topRepetitiveWorkflows);
    renderWorkflowSection(
      "Highest time-consuming repetitive workflows",
      report.summary.highestTimeConsumingRepetitiveWorkflows,
    );
    renderWorkflowSection(
      "Quick-win automation candidates",
      report.summary.quickWinAutomationCandidates,
    );
    renderWorkflowSection(
      "Workflows needing human judgment",
      report.summary.workflowsNeedingHumanJudgment,
    );
    console.log("All workflows");
    renderReportTable(report.workflows);
    renderWorkflowGraphs(report.workflows.slice(0, 5));
  }

  if (report.emergingWorkflows.length > 0) {
    console.log("Emerging workflows");
    console.table(
      report.emergingWorkflows.map((entry) => ({
        workflow: entry.workflowName,
        frequency: entry.frequency,
        averageDuration: formatDuration(entry.averageDurationSeconds),
        totalDuration: formatDuration(entry.totalDurationSeconds),
        confidence: entry.confidence,
      })),
    );
  }
}

function renderReport(
  json = false,
  dataDir?: string,
  options: {
    window?: ReportWindow | undefined;
    date?: string | undefined;
    includeExcluded?: boolean | undefined;
    includeHidden?: boolean | undefined;
  } = {},
): void {
  const report = buildStoredWorkflowReport(dataDir, options);
  renderWindowedWorkflowReport(report, json);
}

function renderReportComparison(
  json = false,
  dataDir?: string,
  options: {
    window?: ReportWindow | undefined;
    date?: string | undefined;
    includeExcluded?: boolean | undefined;
    includeHidden?: boolean | undefined;
  } = {},
): void {
  const comparison = buildStoredWorkflowReportComparison(dataDir, options);
  renderWorkflowReportComparison(comparison, json);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseBooleanOption(value: string): boolean {
  const normalized = value.trim().toLowerCase();

  if (["true", "yes", "y", "1"].includes(normalized)) {
    return true;
  }

  if (["false", "no", "n", "0"].includes(normalized)) {
    return false;
  }

  throw new Error(`Expected a boolean value, received: ${value}`);
}

function parseNumberOption(value: string, label: string): number {
  const parsed = Number.parseFloat(value);

  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }

  return parsed;
}

function printDeprecationWarning(
  command: string,
  options: {
    replacement?: string | undefined;
    note?: string | undefined;
  } = {},
): void {
  const message = [
    `[deprecated] ${command} is deprecated.`,
    options.replacement ? `Use ${options.replacement} instead.` : "",
    options.note ?? "",
  ]
    .filter((part) => part.length > 0)
    .join(" ");

  console.error(message);
}

function resolveEnvOverride(name: string): string | undefined {
  const value = process.env[name];

  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function resolveEnvBooleanOverride(name: string): boolean | undefined {
  const value = resolveEnvOverride(name);

  if (value === undefined) {
    return undefined;
  }

  return parseBooleanOption(value);
}

function resolveViewerUrl(
  dataDir?: string,
  fallback: { host?: string | undefined; port?: number | undefined } = {},
): string {
  const status = getAgentStatusSnapshot(dataDir);
  const viewerUrl = status.state?.ingestServer?.viewerUrl;

  if (viewerUrl) {
    return viewerUrl;
  }

  const host = status.state?.ingestServer?.host ?? fallback.host ?? "127.0.0.1";
  const port = status.state?.ingestServer?.port ?? fallback.port ?? 4318;

  return `http://${host}:${port}/`;
}

async function waitForAgentToStop(dataDir: string, pid: number, timeoutMs = 15_000): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const status = getAgentStatusSnapshot(dataDir);

    if (status.status !== "running" || status.pid !== pid) {
      return;
    }

    await sleep(250);
  }

  throw new Error(`Timed out waiting for agent pid ${pid} to stop`);
}

async function runAgentRuntimeCommand(
  options: AgentRuntimeCommandOptions,
  invokedAs: "agent:run" | "agent:restart",
): Promise<void> {
  let dataDir: string;
  let config: WidConfig;

  try {
    ({ dataDir, config } = loadCommandConfig(options.dataDir));
  } catch (error) {
    if (!isMissingDataDirError(error)) {
      throw error;
    }

    const prompts = createPromptSessionForCommand();

    if (!prompts) {
      throw new Error("Setup is required before starting the agent. Run: wid setup [path]");
    }

    try {
      const shouldRunSetup = await prompts.confirm("No data directory found. Run guided setup now?", true);

      if (!shouldRunSetup) {
        throw new Error("Setup is required before starting the agent. Run: wid setup [path]");
      }

      await runSetup(options.dataDir, {
        prompts,
      });
    } finally {
      prompts.close();
    }

    ({ dataDir, config } = loadCommandConfig(options.dataDir));
  }

  if (invokedAs === "agent:restart") {
    const stopResult = stopAgentRuntime(dataDir);

    if (stopResult.status === "stop_requested" && stopResult.pid !== undefined) {
      await waitForAgentToStop(dataDir, stopResult.pid);
    }
  }

  const ingestHost =
    options.ingestHost ??
    resolveEnvOverride("WID_SERVER_HOST") ??
    config.server.host ??
    DEFAULT_WID_SERVER_HOST;
  const ingestPort = Number.parseInt(
    options.ingestPort ??
      resolveEnvOverride("WID_SERVER_PORT") ??
      String(config.server.port ?? DEFAULT_WID_SERVER_PORT),
    10,
  );
  const collectorRuntime = resolveCollectorRuntimeOptions({
    config,
    gwsCalendar: options.disableGws ? false : options.gwsCalendar,
    gwsDrive: options.disableGws ? false : options.gwsDrive,
    gwsSheets: options.disableGws ? false : options.gwsSheets,
    gwsCalendarId: options.gwsCalendarId,
    gitRepo: options.gitRepo,
  });

  for (const warning of collectorRuntime.warnings) {
    console.error(`[tools] ${warning}`);
  }

  const runtime = await startAgentRuntime({
    dataDir,
    heartbeatIntervalMs: Number.parseInt(options.heartbeatIntervalMs, 10),
    ingestHost,
    ingestPort,
    ingestAuthToken: options.ingestAuthToken,
    collectorPollIntervalMs: Number.parseInt(options.collectorPollIntervalMs, 10),
    collectorRestartDelayMs: Number.parseInt(options.collectorRestartDelayMs, 10),
    enableGWSCalendar: collectorRuntime.enableGWSCalendar,
    gwsCalendarId: collectorRuntime.gwsCalendarId,
    gwsCalendarPollIntervalMs: Number.parseInt(options.gwsCalendarPollIntervalMs, 10),
    enableGWSDrive: collectorRuntime.enableGWSDrive,
    gwsDrivePollIntervalMs: Number.parseInt(options.gwsDrivePollIntervalMs, 10),
    enableGWSSheets: collectorRuntime.enableGWSSheets,
    gwsSheetsPollIntervalMs: Number.parseInt(options.gwsSheetsPollIntervalMs, 10),
    gitRepoPath: collectorRuntime.gitRepoPath,
    gitPollIntervalMs: Number.parseInt(options.gitPollIntervalMs, 10),
    promptAccessibility: options.promptAccessibility,
    enableCollectors: options.collectors,
    snapshotWindows: options.snapshotWindows,
    snapshotIntervalMs: Number.parseInt(options.snapshotIntervalSeconds, 10) * 1000,
    enableSnapshotScheduler: options.snapshotScheduler,
    verbose: options.verbose ?? resolveEnvBooleanOverride("WID_VERBOSE") ?? config.agent.verbose,
  });

  const status = getAgentStatusSnapshot(dataDir);

  if (options.openViewer) {
    openSystemBrowser(resolveViewerUrl(dataDir, {
      host: ingestHost,
      port: ingestPort,
    }));
  }

  console.log(JSON.stringify(status, null, 2));

  await runtime.waitForStop();
}

function configureAgentRuntimeCommand(command: Command): Command {
  return command
    .option("--data-dir <path>", "Override application data directory")
    .option("--heartbeat-interval-ms <ms>", "Heartbeat interval in milliseconds", "30000")
    .option("--ingest-host <host>", "Host to bind the local ingest server")
    .option("--ingest-port <port>", "Port to bind the local ingest server")
    .option("--ingest-auth-token <token>", "Override and persist the shared ingest auth token")
    .option("--collector-poll-interval-ms <ms>", "Collector polling interval in milliseconds", "1000")
    .option("--collector-restart-delay-ms <ms>", "Collector restart delay after failures", "5000")
    .option("--gws-calendar", "Enable the optional gws Calendar boundary collector")
    .option("--gws-calendar-id <id>", "Calendar id for the gws Calendar collector")
    .option(
      "--gws-calendar-poll-interval-ms <ms>",
      "gws Calendar polling interval in milliseconds",
      String(DEFAULT_GWS_CALENDAR_POLL_INTERVAL_MS),
    )
    .option("--gws-drive", "Enable the optional gws Drive context collector")
    .option(
      "--gws-drive-poll-interval-ms <ms>",
      "gws Drive polling interval in milliseconds",
      String(DEFAULT_GWS_DRIVE_POLL_INTERVAL_MS),
    )
    .option("--gws-sheets", "Enable the optional gws Sheets context collector")
    .option(
      "--gws-sheets-poll-interval-ms <ms>",
      "gws Sheets polling interval in milliseconds",
      String(DEFAULT_GWS_SHEETS_POLL_INTERVAL_MS),
    )
    .option("--git-repo <path>", "Enable the Git context collector for one local repository path")
    .option(
      "--git-poll-interval-ms <ms>",
      "Git context polling interval in milliseconds",
      String(DEFAULT_GIT_CONTEXT_POLL_INTERVAL_MS),
    )
    .option("--disable-gws", "Disable all gws collectors for this run (wid up alias: --no-gws)")
    .option(
      "--no-prompt-accessibility",
      "Don't ask macOS to show the Accessibility permission prompt when the collector starts",
    )
    .option(
      "--snapshot-windows <windows>",
      "Comma-separated snapshot windows",
      parseReportWindowList,
      ["day", "week"],
    )
    .option("--snapshot-interval-seconds <seconds>", "Snapshot scheduler interval in seconds", "300")
    .option("--no-collectors", "Disable collector supervision inside the agent")
    .option("--no-snapshot-scheduler", "Disable snapshot scheduling inside the agent")
    .option("--open-viewer", "Open the local viewer in the default browser after startup")
    .option("--verbose", "Enable verbose ingest and collector logging");
}

async function runServerCommand(
  options: {
    dataDir?: string;
    host?: string;
    port?: string;
    ingestAuthToken?: string;
    verbose?: boolean;
    open?: boolean;
  },
  invokedAs: "server:run" | "serve",
): Promise<void> {
  if (invokedAs === "serve") {
    printDeprecationWarning("serve", {
      replacement: "server:run",
    });
  }

  const { dataDir, config } = loadCommandConfig(options.dataDir);
  const host =
    options.host ??
    resolveEnvOverride("WID_SERVER_HOST") ??
    config.server.host ??
    DEFAULT_WID_SERVER_HOST;
  const port = Number.parseInt(
    options.port ??
      resolveEnvOverride("WID_SERVER_PORT") ??
      String(config.server.port ?? DEFAULT_WID_SERVER_PORT),
    10,
  );

  const server = await startIngestServer({
    dataDir,
    host,
    port,
    authToken: options.ingestAuthToken,
    verbose: options.verbose ?? resolveEnvBooleanOverride("WID_VERBOSE") ?? config.agent.verbose,
  });
  const opened = options.open ? openSystemBrowser(server.viewerUrl) : false;

  console.log(
    JSON.stringify(
      {
        status: "listening",
        host: server.host,
        port: server.port,
        viewerUrl: server.viewerUrl,
        healthUrl: `http://${server.host}:${server.port}/health`,
        eventsUrl: `http://${server.host}:${server.port}/events`,
        security: server.security,
        viewerOpened: opened,
      },
      null,
      2,
    ),
  );

  const stopServer = async () => {
    await server.close();
    process.exit(0);
  };

  process.on("SIGINT", stopServer);
  process.on("SIGTERM", stopServer);
}

async function runLegacyReportSchedulerCommand(options: {
  dataDir?: string;
  windows: ReportWindow[];
  intervalSeconds: string;
  once?: boolean;
  json?: boolean;
}): Promise<void> {
  printDeprecationWarning("report:scheduler", {
    note: "Prefer agent:run for the resident scheduler or agent:run-once for a single refresh cycle.",
  });

  const intervalMs = Number.parseInt(options.intervalSeconds, 10) * 1000;

  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error(`Invalid interval: ${options.intervalSeconds}`);
  }

  let stopped = false;
  const stop = () => {
    stopped = true;
  };

  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  do {
    const generatedSnapshots = withDatabase(options.dataDir, (database) =>
      runReportSchedulerCycle(database, {
        windows: options.windows,
      }),
    );
    const payload = {
      status: "report_scheduler_cycle_completed",
      generatedAt: new Date().toISOString(),
      windows: options.windows,
      snapshots: generatedSnapshots.map((snapshot) => ({
        id: snapshot.id,
        window: snapshot.timeWindow.window,
        reportDate: snapshot.timeWindow.reportDate,
        generatedAt: snapshot.generatedAt,
        totalSessions: snapshot.totalSessions,
        workflows: snapshot.workflows.length,
        emergingWorkflows: snapshot.emergingWorkflows.length,
      })),
    };

    console.log(JSON.stringify(payload, null, 2));

    if (options.once || stopped) {
      break;
    }

    await sleep(intervalMs);
  } while (!stopped);
}

function renderWorkflowList(json = false, dataDir?: string): void {
  const workflows = withDatabase(dataDir, (database) => database.listWorkflowClusters());

  if (json) {
    console.log(JSON.stringify(workflows, null, 2));
    return;
  }

  console.table(
    workflows.map((workflow) => ({
      id: workflow.id,
      workflow: workflow.name,
      mode: workflow.detectionMode,
      frequency: workflow.frequency,
      averageDuration: formatDuration(workflow.averageDurationSeconds),
      totalDuration: formatDuration(workflow.totalDurationSeconds),
      excluded: workflow.excluded,
      hidden: workflow.hidden,
      recommendation: workflow.recommendedApproach,
    })),
  );
}

function renderSessionList(json = false, dataDir?: string): void {
  const sessions = withDatabase(dataDir, (database) => database.listSessionSummaries());

  if (json) {
    console.log(JSON.stringify(sessions, null, 2));
    return;
  }

  console.table(
    sessions.map((session) => ({
      id: session.id,
      startTime: session.startTime,
      endTime: session.endTime,
      primaryApplication: session.primaryApplication,
      primaryDomain: session.primaryDomain ?? "",
      stepCount: session.stepCount,
    })),
  );
}

function renderSessionDetail(sessionId: string, dataDir?: string, json = false): void {
  const session = withDatabase(dataDir, (database) => database.getSessionById(sessionId));

  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  if (json) {
    console.log(JSON.stringify(session, null, 2));
    return;
  }

  console.log(
    JSON.stringify(
      {
        id: session.id,
        startTime: session.startTime,
        endTime: session.endTime,
        primaryApplication: session.primaryApplication,
        primaryDomain: session.primaryDomain,
      },
      null,
      2,
    ),
  );
  console.table(
    session.steps.map((step) => ({
      order: step.order,
      timestamp: step.timestamp,
      application: step.application,
      domain: step.domain ?? "",
      action: step.action,
      target: step.target ?? "",
    })),
  );
}

function renderRawEventList(options: {
  dataDir?: string | undefined;
  limit?: number | undefined;
  json?: boolean | undefined;
}): void {
  const events = withDatabase(options.dataDir, (database) => database.listRawEvents(options.limit ?? 25));

  if (options.json) {
    console.log(JSON.stringify(events, null, 2));
    return;
  }

  console.table(
    events.map((event) => ({
      id: event.id,
      timestamp: event.timestamp,
      source: event.source,
      sourceEventType: event.sourceEventType,
      application: event.application,
      domain: event.domain ?? "",
      target: event.target ?? "",
    })),
  );
}

function renderNormalizedEventList(options: {
  dataDir?: string | undefined;
  limit?: number | undefined;
  json?: boolean | undefined;
}): void {
  const events = withDatabase(options.dataDir, (database) =>
    database.listNormalizedEvents(options.limit ?? 25),
  );

  if (options.json) {
    console.log(JSON.stringify(events, null, 2));
    return;
  }

  console.table(
    events.map((event) => {
      const actionMatch = describeActionMatchMetadata(event);

      return {
        id: event.id,
        rawEventId: event.rawEventId,
        timestamp: event.timestamp,
        application: event.application,
        domainPackId: event.domainPackId ?? "",
        routeFamily: event.routeFamily ?? "",
        pageType: event.pageType ?? "",
        resourceHint: event.resourceHint ?? "",
        actionName: event.actionName,
        actionSource: event.actionSource,
        actionLayer: actionMatch?.layer ?? "",
        actionPackId: actionMatch?.packId ?? "",
      };
    }),
  );
}

function renderDomainPackInspection(
  result: ReturnType<typeof inspectDomainPackCoverage>,
  options: { json?: boolean | undefined; limit?: number | undefined } = {},
): void {
  const limit = options.limit ?? 20;

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(
    JSON.stringify(
      {
        totalBrowserEvents: result.coverage.totalBrowserEvents,
        matchedEvents: result.coverage.matchedEvents,
        unmatchedEvents: result.coverage.unmatchedEvents,
        matchRate: result.coverage.matchRate,
      },
      null,
      2,
    ),
  );

  if (result.coverage.domains.length > 0) {
    console.table(
      result.coverage.domains.map((entry) => ({
        domain: entry.domain,
        totalBrowserEvents: entry.totalBrowserEvents,
        matchedEvents: entry.matchedEvents,
        unmatchedEvents: entry.unmatchedEvents,
        matchRate: entry.matchRate.toFixed(2),
      })),
    );
  }

  if (result.events.length > 0) {
    console.table(
      result.events.slice(0, limit).map((event) => ({
        rawEventId: event.rawEventId,
        timestamp: event.timestamp,
        domain: event.domain ?? "",
        routeTemplate: event.routeTemplate ?? "",
        routeFamily: event.routeFamily ?? "",
        domainPackId: event.domainPackId ?? "",
        pageType: event.pageType ?? "",
      })),
    );
  }
}

function renderActionCoverage(
  result: ReturnType<typeof inspectActionCoverage>,
  options: { json?: boolean | undefined; limit?: number | undefined } = {},
): void {
  const limit = options.limit ?? 10;

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(
    JSON.stringify(
      {
        totalEvents: result.coverage.totalEvents,
        unknownEventCount: result.coverage.unknownEventCount,
        unknownRate: result.coverage.unknownRate,
      },
      null,
      2,
    ),
  );

  if (result.coverage.layers.length > 0) {
    console.table(
      result.coverage.layers.map((entry) => ({
        layer: entry.layer,
        eventCount: entry.eventCount,
        rate: entry.rate.toFixed(2),
      })),
    );
  }

  if (result.coverage.packs.length > 0) {
    console.table(
      result.coverage.packs.slice(0, limit).map((entry) => ({
        packId: entry.packId,
        eventCount: entry.eventCount,
        unknownEventCount: entry.unknownEventCount,
        unknownRate: entry.unknownRate.toFixed(2),
      })),
    );
  }

  if (result.coverage.topWorkflows.length > 0) {
    console.table(
      result.coverage.topWorkflows.slice(0, limit).map((entry) => ({
        workflow: entry.workflowName,
        frequency: entry.frequency,
        unknownActionCount: entry.unknownActionCount,
        totalActionCount: entry.totalActionCount,
        unknownRate: entry.unknownRate.toFixed(2),
        sequence: entry.representativeSequence.join(" -> "),
      })),
    );
  }

  if (result.reviewQueue.length > 0) {
    console.table(
      result.reviewQueue.slice(0, limit).map((entry) => ({
        queueId: entry.queueId,
        occurrences: entry.occurrences,
        application: entry.application,
        eventType: entry.eventType,
        domainPackId: entry.domainPackId ?? "",
        routeFamily: entry.routeFamily ?? "",
        pageType: entry.pageType ?? "",
        sampleTargets: entry.sampleTargets.join(", "),
      })),
    );
  }
}

function renderActionSuggestion(
  result: ReturnType<typeof inspectActionCoverage>,
  options: { json?: boolean | undefined; limit?: number | undefined } = {},
): void {
  const payload = {
    reviewQueue: result.reviewQueue.slice(0, options.limit ?? 10),
    prompt: buildActionSuggestionPrompt(result.reviewQueue, {
      limit: options.limit,
    }),
  };

  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  if (payload.reviewQueue.length === 0) {
    console.log(payload.prompt);
    return;
  }

  console.table(
    payload.reviewQueue.map((entry) => ({
      queueId: entry.queueId,
      occurrences: entry.occurrences,
      application: entry.application,
      eventType: entry.eventType,
      routeFamily: entry.routeFamily ?? "",
      pageType: entry.pageType ?? "",
      sampleTargets: entry.sampleTargets.join(", "),
    })),
  );
  console.log(payload.prompt);
}

function renderWorkflowSummaryPayloads(
  dataDir: string | undefined,
  options: {
    includeExcluded?: boolean | undefined;
    includeHidden?: boolean | undefined;
    includeShortForm?: boolean | undefined;
  },
): void {
  const payloadRecords = withDatabase(dataDir, (database) =>
    database.listWorkflowSummaryPayloadRecords(options),
  );

  console.log(JSON.stringify(payloadRecords, null, 2));
}

function renderWorkflowDetail(workflowId: string, dataDir?: string, json = false): void {
  const workflow = withDatabase(dataDir, (database) => database.getWorkflowClusterById(workflowId));

  if (!workflow) {
    throw new Error(`Workflow cluster not found: ${workflowId}`);
  }

  if (json) {
    console.log(JSON.stringify(workflow, null, 2));
    return;
  }

  console.log(
    JSON.stringify(
      {
        id: workflow.id,
        name: workflow.name,
        detectionMode: workflow.detectionMode,
        frequency: workflow.frequency,
        averageDurationSeconds: workflow.averageDurationSeconds,
        totalDurationSeconds: workflow.totalDurationSeconds,
        automationSuitability: workflow.automationSuitability,
        recommendedApproach: workflow.recommendedApproach,
        excluded: workflow.excluded,
        hidden: workflow.hidden,
      },
      null,
      2,
    ),
  );
  console.table(
    workflow.representativeSteps.map((step, index) => ({
      order: index + 1,
      step,
    })),
  );
}

function summarizeWorkflowFeedbackResult(result: SaveWorkflowReviewResult): Record<string, unknown> {
  return {
    analysisRefreshed: result.analysisRefreshed,
    resolvedWorkflowId: result.resolvedWorkflowId ?? null,
    affectedWorkflowCount: result.affectedWorkflows.length,
    affectedWorkflows: result.affectedWorkflows.map((workflow) => ({
      id: workflow.id,
      name: workflow.name,
      detectionMode: workflow.detectionMode,
      frequency: workflow.frequency,
      excluded: workflow.excluded,
      hidden: workflow.hidden,
    })),
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

program
  .name("wid")
  .description("Local workflow pattern analyzer CLI")
  .version("0.1.0");

program
  .command("config")
  .description("Show or update the persisted .wid config")
  .addCommand(
    new Command("show")
      .description("Print the full config as JSON")
      .option("--data-dir <path>", "Override application data directory")
      .action((options: { dataDir?: string }) => {
        const { dataDir, config } = loadCommandConfig(options.dataDir);

        console.log(
          JSON.stringify(
            {
              ...config,
              dataDir,
            },
            null,
            2,
          ),
        );
      }),
  )
  .addCommand(
    new Command("get")
      .description("Read one config value by dot notation")
      .argument("<key>", "Config key, for example server.port")
      .option("--data-dir <path>", "Override application data directory")
      .action((key: string, options: { dataDir?: string }) => {
        const dataDir = resolveCommandDataDir(options.dataDir);
        printConfigValue(ConfigManager.get(dataDir, key));
      }),
  )
  .addCommand(
    new Command("set")
      .description("Write one config value by dot notation")
      .argument("<key>", "Config key, for example server.port")
      .argument("<value>", "Config value. JSON values such as true, false, 4318, {}, [] are supported")
      .option("--data-dir <path>", "Override application data directory")
      .action((key: string, value: string, options: { dataDir?: string }) => {
        const dataDir = resolveCommandDataDir(options.dataDir);
        ConfigManager.set(dataDir, key, parseConfigValue(value));
        printConfigValue(ConfigManager.get(dataDir, key));
      }),
  )
  .addCommand(
    new Command("path")
      .description("Print the config file path")
      .option("--data-dir <path>", "Override application data directory")
      .action((options: { dataDir?: string }) => {
        const dataDir = resolveCommandDataDir(options.dataDir);
        console.log(ConfigManager.resolveConfigPath(dataDir));
      }),
  );

const toolsCommand = program
  .command("tools")
  .description("List or manage configured collectors and analyzers")
  .option("--data-dir <path>", "Override application data directory")
  .action(async (options: { dataDir?: string }) => {
    const { dataDir } = loadCommandConfig(options.dataDir);
    const report = await listTools(dataDir);

    console.log(formatToolList(report));
  });

toolsCommand.addCommand(
  new Command("list")
    .description("List configured collectors and analyzers")
    .option("--data-dir <path>", "Override application data directory")
    .action(async (options: { dataDir?: string }, command: Command) => {
      const { dataDir } = loadActionCommandConfig(options, command);
      const report = await listTools(dataDir);

      console.log(formatToolList(report));
    }),
);

toolsCommand.addCommand(
  new Command("add")
    .description("Add a collector or analyzer tool to the persisted config")
    .argument("<name>", "Tool name: gws|git|gh|gemini|claude|openai|openai-codex")
    .option("--data-dir <path>", "Override application data directory")
    .option("--interactive", "Force prompts for missing values")
    .option("--non-interactive", "Disable prompts and require explicit arguments")
    .option("--auth <method>", "Analyzer auth method: api-key|oauth2")
    .option("--model <name>", "Analyzer model override")
    .option("--repo-path <path>", "Git repository path")
    .option("--calendar-id <id>", "Default gws Calendar id", DEFAULT_GWS_CALENDAR_ID)
    .option("--api-key <value>", "Analyzer API key")
    .option("--client-id <id>", "OAuth client id")
    .option("--client-secret <secret>", "OAuth client secret for providers that require it")
    .option("--project-id <id>", "Gemini OAuth project id")
    .option("--issuer-url <url>", "OAuth issuer base URL for OpenAI Codex")
    .option("--port <port>", "Local callback port for OAuth", "0")
    .action(async (
      name: string,
      options: {
        dataDir?: string;
        nonInteractive?: boolean;
        auth?: string;
        model?: string;
        repoPath?: string;
        calendarId?: string;
        apiKey?: string;
        clientId?: string;
        clientSecret?: string;
        projectId?: string;
        issuerUrl?: string;
        port: string;
      },
      command: Command,
    ) => {
      const { dataDir } = loadActionCommandConfig(options, command);
      const prompts = createPromptSessionForCommand(options);

      try {
        const result = await addTool(
          dataDir,
          name,
          {
            authMethod: options.auth,
            model: options.model,
            repoPath: options.repoPath,
            calendarId: options.calendarId,
            apiKey: options.apiKey,
            clientId: options.clientId,
            clientSecret: options.clientSecret,
            projectId: options.projectId,
            issuerUrl: options.issuerUrl,
            port: Number.parseInt(options.port, 10),
          },
          {
            prompts,
          },
        );

        console.log(result.message);

        if (result.warning) {
          console.log(`Warning: ${result.warning}`);
        }
      } finally {
        prompts?.close();
      }
    }),
);

toolsCommand.addCommand(
  new Command("remove")
    .description("Remove a configured collector or analyzer tool")
    .argument("<name>", "Tool name: gws|git|gh|gemini|claude|openai|openai-codex")
    .option("--data-dir <path>", "Override application data directory")
    .option("--delete-credentials", "Also delete locally stored credentials when supported")
    .action(async (
      name: string,
      options: {
        dataDir?: string;
        deleteCredentials?: boolean;
      },
      command: Command,
    ) => {
      const { dataDir } = loadActionCommandConfig(options, command);
      const prompts = createPromptSessionForCommand();

      try {
        const result = await removeTool(
          dataDir,
          name,
          {
            deleteCredentials: options.deleteCredentials,
          },
          {
            prompts,
          },
        );

        console.log(result.message);

        if (result.warning) {
          console.log(`Warning: ${result.warning}`);
        }
      } finally {
        prompts?.close();
      }
    }),
);

toolsCommand.addCommand(
  new Command("refresh")
    .description("Refresh a managed OAuth token when supported")
    .argument("<name>", "Tool name")
    .option("--data-dir <path>", "Override application data directory")
    .action(async (name: string, options: { dataDir?: string }, command: Command) => {
      const { dataDir } = loadActionCommandConfig(options, command);
      const result = await refreshTool(dataDir, name);

      console.log(result.message);

      if (result.warning) {
        console.log(`Warning: ${result.warning}`);
      }
    }),
);

toolsCommand.addCommand(
  new Command("auth")
    .description("Authenticate or re-authenticate a managed tool")
    .argument("<name>", "Tool name")
    .option("--data-dir <path>", "Override application data directory")
    .option("--interactive", "Force prompts for missing values")
    .option("--non-interactive", "Disable prompts and require explicit arguments")
    .option("--auth <method>", "Analyzer auth method: api-key|oauth2")
    .option("--model <name>", "Analyzer model override")
    .option("--api-key <value>", "Analyzer API key")
    .option("--client-id <id>", "OAuth client id")
    .option("--client-secret <secret>", "OAuth client secret for providers that require it")
    .option("--project-id <id>", "Gemini OAuth project id")
    .option("--issuer-url <url>", "OAuth issuer base URL for OpenAI Codex")
    .option("--port <port>", "Local callback port for OAuth", "0")
    .action(async (
      name: string,
      options: {
        dataDir?: string;
        nonInteractive?: boolean;
        auth?: string;
        model?: string;
        apiKey?: string;
        clientId?: string;
        clientSecret?: string;
        projectId?: string;
        issuerUrl?: string;
        port: string;
      },
      command: Command,
    ) => {
      const { dataDir } = loadActionCommandConfig(options, command);
      const prompts = createPromptSessionForCommand(options);

      try {
        const result = await authenticateTool(
          dataDir,
          name,
          {
            authMethod: options.auth,
            model: options.model,
            apiKey: options.apiKey,
            clientId: options.clientId,
            clientSecret: options.clientSecret,
            projectId: options.projectId,
            issuerUrl: options.issuerUrl,
            port: Number.parseInt(options.port, 10),
          },
          {
            prompts,
          },
        );

        console.log(result.message);

        if (result.warning) {
          console.log(`Warning: ${result.warning}`);
        }
      } finally {
        prompts?.close();
      }
    }),
);

program
  .command("doctor")
  .description("Validate local runtime prerequisites")
  .option("--data-dir <path>", "Override application data directory")
  .option("--gws-calendar-id <id>", "Calendar id to inspect for gws Calendar collector diagnostics")
  .option("--git-repo <path>", "Local Git repository path to inspect for Git collector diagnostics")
  .action(async (options: { dataDir?: string; gwsCalendarId?: string; gitRepo?: string }) => {
    const { dataDir, config } = loadCommandConfig(options.dataDir);
    const paths = resolveAppPaths(dataDir);
    const gwsCalendarId =
      options.gwsCalendarId ??
      normalizeOptionalConfigString(config.tools.gws?.["calendar-id"]) ??
      DEFAULT_GWS_CALENDAR_ID;
    const gitRepo =
      options.gitRepo ??
      (isToolAdded(config, "git")
        ? normalizeOptionalConfigString(config.tools.git?.["repo-path"])
        : undefined);
    const tools = await listTools(dataDir);
    const ingestSecurity = describeIngestSecurity(dataDir);

    const result = {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      dataDir: paths.dataDir,
      databasePath: paths.databasePath,
      agentLockPath: paths.agentLockPath,
      configPath: ConfigManager.resolveConfigPath(dataDir),
      ingestSecurity,
      browserIngest: describeBrowserIngest(dataDir, ingestSecurity),
      gwsCalendar: getGWSCalendarCollectorStatus({
        calendarId: gwsCalendarId,
      }),
      gwsDrive: getGWSDriveCollectorStatus(),
      gwsSheets: getGWSSheetsCollectorStatus(),
      gitContext: getGitContextCollectorStatus({
        repoPath: gitRepo,
      }),
      tools,
    };

    console.log(JSON.stringify(result, null, 2));
  });

const agentCommand = program
  .command("agent")
  .description("Manage the resident local agent runtime");

configureAgentRuntimeCommand(
  agentCommand
    .command("run")
    .description("Run the resident local agent runtime"),
)
  .action(async (options: AgentRuntimeCommandOptions) => {
    await runAgentRuntimeCommand(options, "agent:run");
  });

configureAgentRuntimeCommand(
  agentCommand
    .command("restart")
    .description("Restart the resident local agent runtime"),
)
  .action(async (options: AgentRuntimeCommandOptions) => {
    await runAgentRuntimeCommand(options, "agent:restart");
  });

agentCommand
  .command("status")
  .description("Show resident agent runtime status")
  .option("--data-dir <path>", "Override application data directory")
  .action((options: { dataDir?: string }) => {
    const status = getAgentStatusSnapshot(options.dataDir);

    console.log(JSON.stringify(status, null, 2));
  });

agentCommand
  .command("health")
  .description("Show a concise health summary for the resident agent")
  .option("--data-dir <path>", "Override application data directory")
  .action((options: { dataDir?: string }) => {
    const report = getAgentHealthReport(options.dataDir);

    console.log(JSON.stringify(report, null, 2));
  });

agentCommand
  .command("stop")
  .description("Stop the resident local agent runtime if it is running")
  .option("--data-dir <path>", "Override application data directory")
  .action((options: { dataDir?: string }) => {
    const result = stopAgentRuntime(options.dataDir);

    console.log(JSON.stringify(result, null, 2));
  });

agentCommand
  .command("collectors")
  .description("Show collector states managed by the resident agent")
  .option("--data-dir <path>", "Override application data directory")
  .action((options: { dataDir?: string }) => {
    const report = getAgentHealthReport(options.dataDir);

    console.log(JSON.stringify(report.collectors, null, 2));
  });

agentCommand
  .command("snapshot")
  .description("Inspect stored snapshots for the resident local agent")
  .addCommand(
    new Command("latest")
      .description("Show the latest stored snapshots for the control plane")
      .option("--data-dir <path>", "Override application data directory")
      .action((options: { dataDir?: string }) => {
        const snapshots = listLatestAgentSnapshots(options.dataDir);

        console.log(JSON.stringify(snapshots, null, 2));
      }),
  );

const ingestCommand = program
  .command("ingest")
  .description("Manage local ingest server settings and auth");

ingestCommand
  .command("token")
  .description("Show or rotate the shared local ingest auth token")
  .option("--data-dir <path>", "Override application data directory")
  .option("--rotate", "Rotate the stored auth token before printing it")
  .option("--value <token>", "Persist this token instead of generating one when used with --rotate")
  .action((options: { dataDir?: string; rotate?: boolean; value?: string }) => {
    const token = withDatabase(options.dataDir, (database) =>
      options.rotate ? rotateIngestAuthToken(database, options.value) : getIngestAuthToken(database),
    );

    if (!token) {
      console.log(
        JSON.stringify(
          {
            configured: false,
            message: "No ingest auth token is configured yet. Start the server/agent once or run ingest token --rotate.",
          },
          null,
          2,
        ),
      );
      return;
    }

    console.log(
      JSON.stringify(
        {
          configured: true,
          rotated: options.rotate ?? false,
          authToken: token,
        },
        null,
        2,
      ),
    );
  });

configureAgentRuntimeCommand(
  program
    .command("agent:run")
    .description("Run the resident local agent runtime")
    .alias("up"),
)
  .action(async (options: AgentRuntimeCommandOptions) => {
    await runAgentRuntimeCommand(options, "agent:run");
  });

configureAgentRuntimeCommand(
  program
    .command("agent:restart")
    .description("Restart the resident local agent runtime")
    .alias("restart"),
)
  .action(async (options: AgentRuntimeCommandOptions) => {
    await runAgentRuntimeCommand(options, "agent:restart");
  });

program
  .command("ingest:token")
  .description("Show or rotate the shared local ingest auth token")
  .alias("token")
  .option("--data-dir <path>", "Override application data directory")
  .option("--rotate", "Rotate the stored auth token before printing it")
  .option("--value <token>", "Persist this token instead of generating one when used with --rotate")
  .action((options: { dataDir?: string; rotate?: boolean; value?: string }) => {
    const token = withDatabase(options.dataDir, (database) =>
      options.rotate ? rotateIngestAuthToken(database, options.value) : getIngestAuthToken(database),
    );

    if (!token) {
      console.log(
        JSON.stringify(
          {
            configured: false,
            message: "No ingest auth token is configured yet. Start the server/agent once or run ingest:token --rotate.",
          },
          null,
          2,
        ),
      );
      return;
    }

    console.log(
      JSON.stringify(
        {
          configured: true,
          rotated: options.rotate ?? false,
          authToken: token,
        },
        null,
        2,
      ),
    );
  });

program
  .command("agent:status")
  .description("Show resident agent runtime status")
  .option("--data-dir <path>", "Override application data directory")
  .action((options: { dataDir?: string }) => {
    const status = getAgentStatusSnapshot(options.dataDir);

    console.log(JSON.stringify(status, null, 2));
  });

program
  .command("agent:stop")
  .description("Stop the resident agent runtime if it is running")
  .alias("stop")
  .option("--data-dir <path>", "Override application data directory")
  .action((options: { dataDir?: string }) => {
    const result = stopAgentRuntime(options.dataDir);

    console.log(JSON.stringify(result, null, 2));
  });

program
  .command("agent:health")
  .description("Show a concise health summary for the resident agent")
  .alias("status")
  .option("--data-dir <path>", "Override application data directory")
  .action((options: { dataDir?: string }) => {
    const report = getAgentHealthReport(options.dataDir);

    console.log(JSON.stringify(report, null, 2));
  });

program
  .command("agent:run-once")
  .description("Run one manual snapshot refresh cycle without starting the resident agent")
  .option("--data-dir <path>", "Override application data directory")
  .option("--windows <windows>", "Comma-separated snapshot windows", parseReportWindowList, ["day", "week"])
  .action((options: { dataDir?: string; windows: ReportWindow[] }) => {
    const result = runAgentOnce(options.dataDir, {
      windows: options.windows,
    });

    console.log(JSON.stringify(result, null, 2));
  });

program
  .command("agent:snapshot:latest")
  .description("Show the latest stored snapshots for the control plane")
  .option("--data-dir <path>", "Override application data directory")
  .option("--windows <windows>", "Comma-separated snapshot windows", parseReportWindowList, ["day", "week"])
  .action((options: { dataDir?: string; windows: ReportWindow[] }) => {
    const snapshots = listLatestAgentSnapshots(options.dataDir, options.windows);

    console.log(JSON.stringify(snapshots, null, 2));
  });

program
  .command("agent:collectors")
  .description("Show collector states managed by the resident agent")
  .option("--data-dir <path>", "Override application data directory")
  .action((options: { dataDir?: string }) => {
    const status = getAgentStatusSnapshot(options.dataDir);

    console.log(JSON.stringify(status.state?.collectors ?? [], null, 2));
  });

program
  .command("agent:autostart:status")
  .description("Show OS autostart status for the resident agent")
  .option("--data-dir <path>", "Override application data directory")
  .option("--plist-path <path>", "Override the macOS LaunchAgent plist path")
  .option("--startup-script-path <path>", "Override the Windows startup script path")
  .action((options: { dataDir?: string; plistPath?: string; startupScriptPath?: string }) => {
    const status = getAgentAutostartStatus({
      dataDir: options.dataDir,
      plistPath: options.plistPath,
      startupScriptPath: options.startupScriptPath,
    });

    console.log(JSON.stringify(status, null, 2));
  });

program
  .command("agent:autostart:install")
  .description("Install OS autostart for the resident agent")
  .option("--data-dir <path>", "Override application data directory")
  .option("--plist-path <path>", "Override the macOS LaunchAgent plist path")
  .option("--startup-script-path <path>", "Override the Windows startup script path")
  .option("--no-load", "Write the LaunchAgent file without loading it")
  .action((options: { dataDir?: string; plistPath?: string; startupScriptPath?: string; load: boolean }) => {
    const status = installAgentAutostart({
      dataDir: options.dataDir,
      plistPath: options.plistPath,
      startupScriptPath: options.startupScriptPath,
      load: options.load,
    });

    console.log(JSON.stringify(status, null, 2));
  });

program
  .command("agent:autostart:uninstall")
  .description("Remove OS autostart for the resident agent")
  .option("--data-dir <path>", "Override application data directory")
  .option("--plist-path <path>", "Override the macOS LaunchAgent plist path")
  .option("--startup-script-path <path>", "Override the Windows startup script path")
  .option("--no-unload", "Remove the LaunchAgent file without unloading it first")
  .action((options: { dataDir?: string; plistPath?: string; startupScriptPath?: string; unload: boolean }) => {
    const status = uninstallAgentAutostart({
      dataDir: options.dataDir,
      plistPath: options.plistPath,
      startupScriptPath: options.startupScriptPath,
      unload: options.unload,
    });

    console.log(JSON.stringify(status, null, 2));
  });

program
  .command("setup")
  .description("Run the guided setup flow")
  .argument("[data-dir]", "Application data directory")
  .option("--data-dir <path>", "Override application data directory")
  .option("--interactive", "Force the interactive setup wizard")
  .option("--non-interactive", "Disable prompts and use the non-interactive flow")
  .action(async (
    positionalDataDir: string | undefined,
    options: { dataDir?: string; interactive?: boolean; nonInteractive?: boolean },
  ) => {
    const prompts = createPromptSessionForCommand(options);
    const dataDir = resolvePreferredDataDir(positionalDataDir, options.dataDir);

    try {
      console.log(
        JSON.stringify(
          await runSetup(dataDir, {
            prompts,
          }),
          null,
          2,
        ),
      );
    } finally {
      prompts?.close();
    }
  });

program
  .command("init")
  .description("Initialize local application storage")
  .argument("[data-dir]", "Application data directory")
  .option("--data-dir <path>", "Override application data directory")
  .option("--interactive", "Force the interactive setup wizard")
  .option("--non-interactive", "Disable prompts and use the non-interactive flow")
  .action(async (
    positionalDataDir: string | undefined,
    options: { dataDir?: string; interactive?: boolean; nonInteractive?: boolean },
  ) => {
    const prompts = createPromptSessionForCommand(options);
    const dataDir = resolvePreferredDataDir(positionalDataDir, options.dataDir);

    try {
      if (prompts) {
        await runInteractiveInit(dataDir, {
          prompts,
        });
        return;
      }

      console.log(
        JSON.stringify(
          await runInit(dataDir, {
            prompts,
          }),
          null,
          2,
        ),
      );
    } finally {
      prompts?.close();
    }
  });

program
  .command("collect:mock")
  .description("Insert deterministic mock workflow events for local testing")
  .option("--data-dir <path>", "Override application data directory")
  .action((options: { dataDir?: string }) => {
    const mockEvents = generateMockRawEvents();

    withDatabase(options.dataDir, (database) => {
      for (const event of mockEvents) {
        database.insertRawEvent(event);
      }
    });

    console.log(
      JSON.stringify(
        {
          status: "mock_events_inserted",
          rawEventCount: mockEvents.length,
          workflowsSeeded: 5,
        },
        null,
        2,
      ),
    );
  });

program
  .command("collect:macos:once")
  .description("Capture the current macOS frontmost application once and store it locally")
  .option("--data-dir <path>", "Override application data directory")
  .option("--json", "Print machine-readable JSON")
  .option("--prompt-accessibility", "Ask macOS to show the Accessibility permission prompt first")
  .action((options: { dataDir?: string; json?: boolean; promptAccessibility?: boolean }) => {
    const collectorRunner = resolveMacOSCollectorRunner();
    const event = collectorRunner.captureOnce({
      promptAccessibility: options.promptAccessibility,
    });
    const dataDir = resolveCommandDataDir(options.dataDir);
    const paths = resolveAppPaths(dataDir);

    withDatabase(dataDir, (database) => {
      database.insertRawEvent(event);
    });

    const payload = {
      status: "macos_event_inserted",
      databasePath: paths.databasePath,
      event,
    };

    if (options.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    console.log(JSON.stringify(payload, null, 2));
  });

program
  .command("import:events")
  .description("Import raw events from a JSON or NDJSON file")
  .argument("<file-path>", "Path to the import file")
  .option("--data-dir <path>", "Override application data directory")
  .action((filePath: string, options: { dataDir?: string }) => {
    const importedEvents = importEventsFromFile(filePath);

    withDatabase(options.dataDir, (database) => {
      for (const event of importedEvents) {
        database.insertRawEvent(event);
      }
    });

    console.log(
      JSON.stringify(
        {
          status: "events_imported",
          filePath,
          importedEventCount: importedEvents.length,
        },
        null,
        2,
      ),
    );
  });

program
  .command("analyze")
  .description("Normalize events, build sessions, and detect workflows")
  .option("--data-dir <path>", "Override application data directory")
  .action((options: { dataDir?: string }) => {
    const { analysisResult, rawEventCount } = withDatabase(options.dataDir, (database) => {
      const rawEvents = database.getRawEventsChronological();
      const result = analyzeRawEvents(rawEvents, {
        ...resolveConfiguredAnalyzeOptions(options.dataDir),
        feedbackByWorkflowSignature: database.listWorkflowFeedbackSummary(),
      });

      database.replaceAnalysisArtifacts(result);

      return {
        analysisResult: result,
        rawEventCount: rawEvents.length,
      };
    });

    console.log(
      JSON.stringify(
        {
          status: "analysis_completed",
          rawEvents: rawEventCount,
          normalizedEvents: analysisResult.normalizedEvents.length,
          sessions: analysisResult.sessions.length,
          workflowClusters: analysisResult.workflowClusters.length,
        },
        null,
        2,
      ),
    );
  });

program
  .command("debug:raw:list")
  .description("List recent raw events for debug tracing")
  .option("--data-dir <path>", "Override application data directory")
  .option("--limit <count>", "Maximum number of raw events to print", "25")
  .option("--json", "Print machine-readable JSON")
  .action((options: { dataDir?: string; limit: string; json?: boolean }) => {
    renderRawEventList({
      dataDir: options.dataDir,
      limit: Number.parseInt(options.limit, 10),
      json: options.json,
    });
  });

program
  .command("debug:quality:report")
  .description("Summarize dataset quality signals and interpretation risks")
  .option("--data-dir <path>", "Override application data directory")
  .action((options: { dataDir?: string }) => {
    const report = withDatabase(options.dataDir, (database) => buildDatasetQualityReport(database));

    console.log(JSON.stringify(report, null, 2));
  });

program
  .command("debug:normalized:list")
  .description("List recent normalized events and semantic actions")
  .option("--data-dir <path>", "Override application data directory")
  .option("--limit <count>", "Maximum number of normalized events to print", "25")
  .option("--json", "Print machine-readable JSON")
  .action((options: { dataDir?: string; limit: string; json?: boolean }) => {
    renderNormalizedEventList({
      dataDir: options.dataDir,
      limit: Number.parseInt(options.limit, 10),
      json: options.json,
    });
  });

program
  .command("debug:trace:raw")
  .description("Trace one raw event through normalized, session, and workflow stages with membership context")
  .argument("<raw-event-id>", "Raw event id")
  .option("--data-dir <path>", "Override application data directory")
  .action((rawEventId: string, options: { dataDir?: string }) => {
    const trace = withDatabase(options.dataDir, (database) => buildRawEventTrace(database, rawEventId));

    if (!trace) {
      throw new Error(`Raw event not found: ${rawEventId}`);
    }

    console.log(JSON.stringify(trace, null, 2));
  });

program
  .command("debug:trace:session")
  .description("Trace one analyzed session back to raw events, boundaries, and workflow membership context")
  .argument("<session-id>", "Session id")
  .option("--data-dir <path>", "Override application data directory")
  .action((sessionId: string, options: { dataDir?: string }) => {
    const trace = withDatabase(options.dataDir, (database) => buildSessionTrace(database, sessionId));

    if (!trace) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    console.log(JSON.stringify(trace, null, 2));
  });

program
  .command("debug:trace:workflow")
  .description("Trace one workflow cluster to its member sessions, boundaries, and similarity context")
  .alias("trace")
  .argument("<workflow-id>", "Workflow cluster id")
  .option("--data-dir <path>", "Override application data directory")
  .action((workflowId: string, options: { dataDir?: string }) => {
    const trace = withDatabase(options.dataDir, (database) =>
      buildWorkflowClusterTrace(database, workflowId),
    );

    if (!trace) {
      throw new Error(`Workflow cluster not found: ${workflowId}`);
    }

    console.log(JSON.stringify(trace, null, 2));
  });

program
  .command("domain-pack:test")
  .description("Test domain-pack matching against an imported fixture file")
  .argument("<file-path>", "Path to a JSON or NDJSON fixture file")
  .option("--limit <count>", "Maximum number of normalized events to print", "20")
  .option("--json", "Print machine-readable JSON")
  .action((filePath: string, options: { limit: string; json?: boolean }) => {
    const rawEvents = rawEventInputsToRawEvents(importEventsFromFile(filePath));

    renderDomainPackInspection(inspectDomainPackCoverage(rawEvents), {
      limit: Number.parseInt(options.limit, 10),
      json: options.json,
    });
  });

program
  .command("domain-pack:report")
  .description("Show route-family match coverage for stored browser events")
  .option("--data-dir <path>", "Override application data directory")
  .option("--limit <count>", "Maximum number of normalized events to print", "20")
  .option("--json", "Print machine-readable JSON")
  .action((options: { dataDir?: string; limit: string; json?: boolean }) => {
    const rawEvents = withDatabase(options.dataDir, (database) => database.getRawEventsChronological());

    renderDomainPackInspection(inspectDomainPackCoverage(rawEvents), {
      limit: Number.parseInt(options.limit, 10),
      json: options.json,
    });
  });

program
  .command("action:coverage")
  .description("Show semantic action coverage, unknown_action rates, and review queue data")
  .alias("coverage")
  .option("--data-dir <path>", "Override application data directory")
  .option("--limit <count>", "Maximum number of rows to print per table", "10")
  .option("--json", "Print machine-readable JSON")
  .action((options: { dataDir?: string; limit: string; json?: boolean }) => {
    const rawEvents = withDatabase(options.dataDir, (database) => database.getRawEventsChronological());

    renderActionCoverage(inspectActionCoverage(rawEvents), {
      limit: Number.parseInt(options.limit, 10),
      json: options.json,
    });
  });

program
  .command("action:suggest")
  .description("Build an offline review prompt for unknown_action patterns")
  .option("--data-dir <path>", "Override application data directory")
  .option("--limit <count>", "Maximum number of review queue items to include", "10")
  .option("--json", "Print machine-readable JSON")
  .action((options: { dataDir?: string; limit: string; json?: boolean }) => {
    const rawEvents = withDatabase(options.dataDir, (database) => database.getRawEventsChronological());

    renderActionSuggestion(inspectActionCoverage(rawEvents), {
      limit: Number.parseInt(options.limit, 10),
      json: options.json,
    });
  });

program
  .command("collector:list")
  .description("List available collectors and assets")
  .option("--json", "Print machine-readable JSON")
  .action((options: { json?: boolean }) => {
    const collectors = getAvailableCollectors();

    if (options.json) {
      console.log(JSON.stringify(collectors, null, 2));
      return;
    }

    console.table(
      collectors.map((collector) => ({
        id: collector.id,
        name: collector.name,
        platform: collector.platform,
        runtime: collector.runtime,
        eventTypes: collector.supportedEventTypes.join(", "),
        scriptPath: collector.scriptPath ?? "",
      })),
    );
  });

program
  .command("collector:windows:info")
  .description("Print usage details for the Windows active-window collector")
  .option("--json", "Print machine-readable JSON")
  .action((options: { json?: boolean }) => {
    const info = getWindowsActiveWindowCollectorInfo();
    const payload = {
      ...info,
      examples: {
        writeNdjson: `pwsh -File "${info.scriptPath}" -OutputPath ".\\\\events.ndjson"`,
        postToIngest: `pwsh -File "${info.scriptPath}" -IngestUrl "http://127.0.0.1:4318/events"`,
        importFixture: `npm run dev -- import:events "${info.sampleFixturePath}" --data-dir ./tmp/windows-data`,
      },
    };

    if (options.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    console.log(JSON.stringify(payload, null, 2));
  });

program
  .command("collector:macos:info")
  .description("Print usage details for the macOS active-window collector")
  .option("--json", "Print machine-readable JSON")
  .action((options: { json?: boolean }) => {
    const info = getMacOSActiveWindowCollectorInfo();
    const payload = {
      ...info,
      permissions: {
        accessibilityRequiredForWindowTitles: true,
        appSwitchFallbackWithoutAccessibility: true,
        systemSettingsPath: "System Settings > Privacy & Security > Accessibility",
      },
      examples: {
        checkPermissions: `swift "${info.scriptPath}" --check-permissions --json`,
        captureOnceToStdout: `swift "${info.scriptPath}" --once --stdout`,
        writeNdjson: `swift "${info.scriptPath}" --output-path "./macos-events.ndjson"`,
        postToIngest: `swift "${info.scriptPath}" --ingest-url "http://127.0.0.1:4318/events"`,
        compileBinary: `swiftc "${info.scriptPath}" -o "./tmp/macos-active-window-collector"`,
        importFixture: `npm run dev -- import:events "${info.sampleFixturePath}" --data-dir ./tmp/macos-data`,
      },
    };

    if (options.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    console.log(JSON.stringify(payload, null, 2));
  });

program
  .command("collector:macos:check")
  .description("Check macOS collector permission status")
  .option("--json", "Print machine-readable JSON")
  .option("--prompt-accessibility", "Ask macOS to show the Accessibility permission prompt")
  .action((options: { json?: boolean; promptAccessibility?: boolean }) => {
    const collectorRunner = resolveMacOSCollectorRunner();
    const payload = collectorRunner.getPermissionStatus({
      promptAccessibility: options.promptAccessibility,
    });

    if (options.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    console.log(JSON.stringify(payload, null, 2));
  });

program
  .command("collector:gws:calendar:info")
  .description("Print usage details and diagnostics for the optional gws Calendar collector")
  .option("--calendar-id <id>", "Calendar id to monitor", DEFAULT_GWS_CALENDAR_ID)
  .option("--json", "Print machine-readable JSON")
  .action((options: { calendarId: string; json?: boolean }) => {
    const info = getGWSCalendarCollectorInfo();
    const standaloneCommand = info.scriptPath?.endsWith(".ts")
      ? `node --import tsx "${info.scriptPath}" --ingest-url "http://127.0.0.1:4318/events" --calendar-id "${options.calendarId}"`
      : `node "${info.scriptPath}" --ingest-url "http://127.0.0.1:4318/events" --calendar-id "${options.calendarId}"`;
    const payload = {
      ...info,
      diagnostics: getGWSCalendarCollectorStatus({
        calendarId: options.calendarId,
      }),
      examples: {
        checkPrerequisites: `npm run dev -- doctor --gws-calendar-id "${options.calendarId}"`,
        runInAgent: `npm run dev -- agent:run --gws-calendar --gws-calendar-id "${options.calendarId}"`,
        runStandalone: standaloneCommand,
      },
    };

    if (options.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    console.log(JSON.stringify(payload, null, 2));
  });

program
  .command("collector:gws:drive:info")
  .description("Print usage details and diagnostics for the optional gws Drive collector")
  .option("--json", "Print machine-readable JSON")
  .action((options: { json?: boolean }) => {
    const info = getGWSDriveCollectorInfo();
    const standaloneCommand = info.scriptPath?.endsWith(".ts")
      ? `node --import tsx "${info.scriptPath}" --ingest-url "http://127.0.0.1:4318/events"`
      : `node "${info.scriptPath}" --ingest-url "http://127.0.0.1:4318/events"`;
    const payload = {
      ...info,
      diagnostics: getGWSDriveCollectorStatus(),
      examples: {
        checkPrerequisites: "npm run dev -- doctor",
        runInAgent: "npm run dev -- agent:run --gws-drive",
        runStandalone: standaloneCommand,
      },
    };

    if (options.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    console.log(JSON.stringify(payload, null, 2));
  });

program
  .command("collector:gws:sheets:info")
  .description("Print usage details and diagnostics for the optional gws Sheets collector")
  .option("--json", "Print machine-readable JSON")
  .action((options: { json?: boolean }) => {
    const info = getGWSSheetsCollectorInfo();
    const standaloneCommand = info.scriptPath?.endsWith(".ts")
      ? `node --import tsx "${info.scriptPath}" --ingest-url "http://127.0.0.1:4318/events"`
      : `node "${info.scriptPath}" --ingest-url "http://127.0.0.1:4318/events"`;
    const payload = {
      ...info,
      diagnostics: getGWSSheetsCollectorStatus(),
      examples: {
        checkPrerequisites: "npm run dev -- doctor",
        runInAgent: "npm run dev -- agent:run --gws-sheets",
        runStandalone: standaloneCommand,
      },
    };

    if (options.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    console.log(JSON.stringify(payload, null, 2));
  });

program
  .command("collector:git:info")
  .description("Print usage details and diagnostics for the optional Git context collector")
  .requiredOption("--repo-path <path>", "Local Git repository path to inspect")
  .option("--json", "Print machine-readable JSON")
  .action((options: { repoPath: string; json?: boolean }) => {
    const info = getGitContextCollectorInfo();
    const standaloneCommand = info.scriptPath?.endsWith(".ts")
      ? `node --import tsx "${info.scriptPath}" --ingest-url "http://127.0.0.1:4318/events" --repo-path "${options.repoPath}"`
      : `node "${info.scriptPath}" --ingest-url "http://127.0.0.1:4318/events" --repo-path "${options.repoPath}"`;
    const payload = {
      ...info,
      diagnostics: getGitContextCollectorStatus({
        repoPath: options.repoPath,
      }),
      examples: {
        checkPrerequisites: `npm run dev -- doctor --git-repo "${options.repoPath}"`,
        runInAgent: `npm run dev -- agent:run --git-repo "${options.repoPath}"`,
        runStandalone: standaloneCommand,
      },
    };

    if (options.json) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    console.log(JSON.stringify(payload, null, 2));
  });

program
  .command("cluster:benchmark")
  .description("Compare hybrid clustering v2 against the legacy sequence-only baseline")
  .option(
    "--similarity-threshold <value>",
    "Similarity threshold",
    String(DEFAULT_CLUSTER_SIMILARITY_THRESHOLD),
  )
  .option("--sequence-weight <value>", "Hybrid sequence similarity weight", String(DEFAULT_CLUSTER_SIMILARITY_WEIGHTS.sequence))
  .option("--action-set-weight <value>", "Hybrid action-set similarity weight", String(DEFAULT_CLUSTER_SIMILARITY_WEIGHTS.actionSet))
  .option("--context-weight <value>", "Hybrid domain/application context weight", String(DEFAULT_CLUSTER_SIMILARITY_WEIGHTS.context))
  .option("--time-weight <value>", "Hybrid time-of-day similarity weight", String(DEFAULT_CLUSTER_SIMILARITY_WEIGHTS.timeOfDay))
  .option(
    "--composite-weight <value>",
    "Confidence weight for composite similarity",
    String(DEFAULT_CLUSTER_CONFIDENCE_WEIGHTS.compositeSimilarity),
  )
  .option(
    "--concentration-weight <value>",
    "Confidence weight for top-variant concentration",
    String(DEFAULT_CLUSTER_CONFIDENCE_WEIGHTS.topVariantConcentration),
  )
  .option(
    "--repetition-weight <value>",
    "Confidence weight for repetition",
    String(DEFAULT_CLUSTER_CONFIDENCE_WEIGHTS.repetition),
  )
  .option("--json", "Print machine-readable JSON")
  .action(
    (options: {
      similarityThreshold: string;
      sequenceWeight: string;
      actionSetWeight: string;
      contextWeight: string;
      timeWeight: string;
      compositeWeight: string;
      concentrationWeight: string;
      repetitionWeight: string;
      json?: boolean;
    }) => {
      const result = runClusterBenchmark({
        similarityThreshold: parseNumberOption(options.similarityThreshold, "similarity threshold"),
        similarityWeights: {
          sequence: parseNumberOption(options.sequenceWeight, "sequence weight"),
          actionSet: parseNumberOption(options.actionSetWeight, "action-set weight"),
          context: parseNumberOption(options.contextWeight, "context weight"),
          timeOfDay: parseNumberOption(options.timeWeight, "time weight"),
        },
        confidenceWeights: {
          compositeSimilarity: parseNumberOption(options.compositeWeight, "composite weight"),
          topVariantConcentration: parseNumberOption(
            options.concentrationWeight,
            "concentration weight",
          ),
          repetition: parseNumberOption(options.repetitionWeight, "repetition weight"),
        },
      });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(JSON.stringify(result, null, 2));
    },
  );

const reportCommand = program
  .command("report")
  .description("Show detected workflows")
  .option("--data-dir <path>", "Override application data directory")
  .option("--json", "Print machine-readable JSON")
  .option("--window <window>", "Report window (all, day, week)", parseReportWindow, "all")
  .option("--date <date>", "Local report date in YYYY-MM-DD format")
  .option("--include-excluded", "Include excluded workflows")
  .option("--include-hidden", "Include hidden workflows")
  .action(
    (options: {
      dataDir?: string;
      json?: boolean;
      window: ReportWindow;
      date?: string;
      includeExcluded?: boolean;
      includeHidden?: boolean;
    }) => {
      renderReport(options.json, options.dataDir, {
        window: options.window,
        date: options.date,
        includeExcluded: options.includeExcluded,
        includeHidden: options.includeHidden,
      });
    },
  );

reportCommand.addCommand(
  new Command("compare")
    .description("Compare the selected day or week report against the previous matching window")
    .option("--data-dir <path>", "Override application data directory")
    .option("--json", "Print machine-readable JSON")
    .option("--window <window>", "Comparison window (day, week)", parseReportWindow, "week")
    .option("--date <date>", "Local report date in YYYY-MM-DD format")
    .option("--include-excluded", "Include excluded workflows")
    .option("--include-hidden", "Include hidden workflows")
    .action(
      (options: {
        dataDir?: string;
        json?: boolean;
        window: ReportWindow;
        date?: string;
        includeExcluded?: boolean;
        includeHidden?: boolean;
      }, command: Command) => {
        const resolvedOptions = mergeActionOptions(options, command);
        renderReportComparison(resolvedOptions.json, resolvedOptions.dataDir, {
          window: resolvedOptions.window,
          date: resolvedOptions.date,
          includeExcluded: resolvedOptions.includeExcluded,
          includeHidden: resolvedOptions.includeHidden,
        });
      },
    ),
);

reportCommand.addCommand(
  new Command("generate")
    .description("Generate and store a report snapshot")
    .option("--data-dir <path>", "Override application data directory")
    .option("--window <window>", "Report window (all, day, week)", parseReportWindow, "day")
    .option("--date <date>", "Local report date in YYYY-MM-DD format")
    .option("--json", "Print machine-readable JSON")
    .option("--include-excluded", "Include excluded workflows")
    .option("--include-hidden", "Include hidden workflows")
    .action(
      (options: {
        dataDir?: string;
        window: ReportWindow;
        date?: string;
        json?: boolean;
        includeExcluded?: boolean;
        includeHidden?: boolean;
      }, command: Command) => {
        const resolvedOptions = mergeActionOptions(options, command);
        const snapshot = withDatabase(resolvedOptions.dataDir, (database) =>
          generateReportSnapshot(database, {
            window: resolvedOptions.window,
            date: resolvedOptions.date,
            includeExcluded: resolvedOptions.includeExcluded,
            includeHidden: resolvedOptions.includeHidden,
          }),
        );

        if (resolvedOptions.json) {
          console.log(JSON.stringify(snapshot, null, 2));
          return;
        }

        renderSnapshotSummary(snapshot);
        renderReportTable(snapshot.workflows);

        if (snapshot.emergingWorkflows.length > 0) {
          console.log("Emerging workflows");
          console.table(
            snapshot.emergingWorkflows.map((entry) => ({
              workflow: entry.workflowName,
              frequency: entry.frequency,
              averageDuration: formatDuration(entry.averageDurationSeconds),
              totalDuration: formatDuration(entry.totalDurationSeconds),
              confidence: entry.confidence,
            })),
          );
        }
      },
    ),
);

const reportSnapshotCommand = new Command("snapshot")
  .description("Inspect stored report snapshots");

reportSnapshotCommand.addCommand(
  new Command("list")
    .description("List stored report snapshots")
    .option("--data-dir <path>", "Override application data directory")
    .option("--window <window>", "Filter by report window", parseReportWindow)
    .option("--limit <count>", "Maximum rows to return", "20")
    .option("--json", "Print machine-readable JSON")
    .action(
      (options: {
        dataDir?: string;
        window?: ReportWindow;
        limit: string;
        json?: boolean;
      }, command: Command) => {
        const resolvedOptions = mergeActionOptions(options, command);
        const snapshots = withDatabase(resolvedOptions.dataDir, (database) =>
          database.listReportSnapshots({
            window: resolvedOptions.window,
            limit: Number.parseInt(resolvedOptions.limit, 10),
          }),
        );

        if (resolvedOptions.json) {
          console.log(JSON.stringify(snapshots, null, 2));
          return;
        }

        renderSnapshotListTable(snapshots);
      },
    ),
);

reportSnapshotCommand.addCommand(
  new Command("show")
    .description("Show one stored report snapshot")
    .option("--data-dir <path>", "Override application data directory")
    .option("--window <window>", "Report window", parseReportWindow, "day")
    .option("--date <date>", "Local report date in YYYY-MM-DD format")
    .option("--latest", "Show the latest snapshot for the selected window")
    .option("--json", "Print machine-readable JSON")
    .action(
      (options: {
        dataDir?: string;
        window: ReportWindow;
        date?: string;
        latest?: boolean;
        json?: boolean;
      }, command: Command) => {
        const resolvedOptions = mergeActionOptions(options, command);
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
        const snapshot = withDatabase(resolvedOptions.dataDir, (database) => {
          if (resolvedOptions.latest) {
            return database.getLatestReportSnapshot(resolvedOptions.window, timezone);
          }

          if (!resolvedOptions.date) {
            throw new Error("--date is required unless --latest is provided");
          }

          return database.getReportSnapshotByWindowAndDate(
            resolvedOptions.window,
            resolvedOptions.date,
            timezone,
          );
        });

        if (!snapshot) {
          throw new Error("Report snapshot not found");
        }

        if (resolvedOptions.json) {
          console.log(JSON.stringify(snapshot, null, 2));
          return;
        }

        renderSnapshotSummary(snapshot);
        renderReportTable(snapshot.workflows);

        if (snapshot.emergingWorkflows.length > 0) {
          console.log("Emerging workflows");
          console.table(
            snapshot.emergingWorkflows.map((entry) => ({
              workflow: entry.workflowName,
              frequency: entry.frequency,
              averageDuration: formatDuration(entry.averageDurationSeconds),
              totalDuration: formatDuration(entry.totalDurationSeconds),
              confidence: entry.confidence,
            })),
          );
        }
      },
    ),
);

reportCommand.addCommand(reportSnapshotCommand);

program
  .command("report:compare")
  .description("Compare the selected day or week report against the previous matching window")
  .alias("compare")
  .option("--data-dir <path>", "Override application data directory")
  .option("--json", "Print machine-readable JSON")
  .option("--window <window>", "Comparison window (day, week)", parseReportWindow, "week")
  .option("--date <date>", "Local report date in YYYY-MM-DD format")
  .option("--include-excluded", "Include excluded workflows")
  .option("--include-hidden", "Include hidden workflows")
  .action(
    (options: {
      dataDir?: string;
      json?: boolean;
      window: ReportWindow;
      date?: string;
      includeExcluded?: boolean;
      includeHidden?: boolean;
    }) => {
      renderReportComparison(options.json, options.dataDir, {
        window: options.window,
        date: options.date,
        includeExcluded: options.includeExcluded,
        includeHidden: options.includeHidden,
      });
    },
  );

program
  .command("report:generate")
  .description("Generate and store a report snapshot")
  .option("--data-dir <path>", "Override application data directory")
  .option("--window <window>", "Report window (all, day, week)", parseReportWindow, "day")
  .option("--date <date>", "Local report date in YYYY-MM-DD format")
  .option("--json", "Print machine-readable JSON")
  .option("--include-excluded", "Include excluded workflows")
  .option("--include-hidden", "Include hidden workflows")
  .action(
    (options: {
      dataDir?: string;
      window: ReportWindow;
      date?: string;
      json?: boolean;
      includeExcluded?: boolean;
      includeHidden?: boolean;
    }) => {
      const snapshot = withDatabase(options.dataDir, (database) =>
        generateReportSnapshot(database, {
          window: options.window,
          date: options.date,
          includeExcluded: options.includeExcluded,
          includeHidden: options.includeHidden,
        }),
      );

      if (options.json) {
        console.log(JSON.stringify(snapshot, null, 2));
        return;
      }

      renderSnapshotSummary(snapshot);
      renderReportTable(snapshot.workflows);

      if (snapshot.emergingWorkflows.length > 0) {
        console.log("Emerging workflows");
        console.table(
          snapshot.emergingWorkflows.map((entry) => ({
            workflow: entry.workflowName,
            frequency: entry.frequency,
            averageDuration: formatDuration(entry.averageDurationSeconds),
            totalDuration: formatDuration(entry.totalDurationSeconds),
            confidence: entry.confidence,
          })),
        );
      }
    },
  );

program
  .command("report:snapshot:list")
  .description("List stored report snapshots")
  .option("--data-dir <path>", "Override application data directory")
  .option("--window <window>", "Filter by report window", parseReportWindow)
  .option("--limit <count>", "Maximum rows to return", "20")
  .option("--json", "Print machine-readable JSON")
  .action(
    (options: {
      dataDir?: string;
      window?: ReportWindow;
      limit: string;
      json?: boolean;
    }) => {
      const snapshots = withDatabase(options.dataDir, (database) =>
        database.listReportSnapshots({
          window: options.window,
          limit: Number.parseInt(options.limit, 10),
        }),
      );

      if (options.json) {
        console.log(JSON.stringify(snapshots, null, 2));
        return;
      }

      renderSnapshotListTable(snapshots);
    },
  );

program
  .command("report:snapshot:show")
  .description("Show one stored report snapshot")
  .option("--data-dir <path>", "Override application data directory")
  .option("--window <window>", "Report window", parseReportWindow, "day")
  .option("--date <date>", "Local report date in YYYY-MM-DD format")
  .option("--latest", "Show the latest snapshot for the selected window")
  .option("--json", "Print machine-readable JSON")
  .action(
    (options: {
      dataDir?: string;
      window: ReportWindow;
      date?: string;
      latest?: boolean;
      json?: boolean;
    }) => {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
      const snapshot = withDatabase(options.dataDir, (database) => {
        if (options.latest) {
          return database.getLatestReportSnapshot(options.window, timezone);
        }

        if (!options.date) {
          throw new Error("--date is required unless --latest is provided");
        }

        return database.getReportSnapshotByWindowAndDate(options.window, options.date, timezone);
      });

      if (!snapshot) {
        throw new Error("Report snapshot not found");
      }

      if (options.json) {
        console.log(JSON.stringify(snapshot, null, 2));
        return;
      }

      renderSnapshotSummary(snapshot);
      renderReportTable(snapshot.workflows);

      if (snapshot.emergingWorkflows.length > 0) {
        console.log("Emerging workflows");
        console.table(
          snapshot.emergingWorkflows.map((entry) => ({
            workflow: entry.workflowName,
            frequency: entry.frequency,
            averageDuration: formatDuration(entry.averageDurationSeconds),
            totalDuration: formatDuration(entry.totalDurationSeconds),
            confidence: entry.confidence,
          })),
        );
      }
    },
  );

program
  .command("report:scheduler")
  .description("Run a local scheduler that refreshes report snapshots")
  .helpGroup("Deprecated Commands:")
  .option("--data-dir <path>", "Override application data directory")
  .option("--windows <windows>", "Comma-separated report windows", parseReportWindowList, ["day", "week"])
  .option("--interval-seconds <seconds>", "Polling interval in seconds", "300")
  .option("--once", "Run one scheduler cycle and exit")
  .option("--json", "Print machine-readable JSON")
  .action(runLegacyReportSchedulerCommand);

const workflowCommand = program
  .command("workflow")
  .description("Inspect or update workflow clusters");

workflowCommand.addCommand(
  new Command("list")
    .description("List workflow clusters including feedback state")
    .option("--data-dir <path>", "Override application data directory")
    .option("--json", "Print machine-readable JSON")
    .action((options: { dataDir?: string; json?: boolean }) => {
      renderWorkflowList(options.json, options.dataDir);
    }),
);

workflowCommand.addCommand(
  new Command("show")
    .description("Show one workflow cluster in detail")
    .argument("<workflow-id>", "Workflow cluster id")
    .option("--data-dir <path>", "Override application data directory")
    .option("--json", "Print machine-readable JSON")
    .action((workflowId: string, options: { dataDir?: string; json?: boolean }) => {
      renderWorkflowDetail(workflowId, options.dataDir, options.json);
    }),
);

workflowCommand.addCommand(
  new Command("label")
    .description("Store rich workflow feedback for naming, business purpose, and automation review")
    .argument("<workflow-id>", "Workflow cluster id")
    .option("--data-dir <path>", "Override application data directory")
    .option("--name <name>", "Workflow display name")
    .option("--purpose <purpose>", "Business purpose for this workflow")
    .option("--repetitive <true|false>", "Mark whether the workflow is repetitive", parseBooleanOption)
    .option(
      "--automation-candidate <true|false>",
      "Mark whether the workflow is an automation candidate",
      parseBooleanOption,
    )
    .option("--difficulty <difficulty>", "Automation difficulty (low, medium, high)")
    .option(
      "--approve-candidate <true|false>",
      "Mark whether the automation candidate is approved",
      parseBooleanOption,
    )
    .action(
      (
        workflowId: string,
        options: {
          dataDir?: string;
          name?: string;
          purpose?: string;
          repetitive?: boolean;
          automationCandidate?: boolean;
          difficulty?: "low" | "medium" | "high";
          approveCandidate?: boolean;
        },
      ) => {
        const result = withDatabase(options.dataDir, (database) =>
          saveWorkflowReview(database, {
            workflowId,
            name: options.name,
            purpose: options.purpose,
            repetitive: options.repetitive,
            automationCandidate: options.automationCandidate,
            difficulty: options.difficulty,
            approvedAutomationCandidate: options.approveCandidate,
          }),
        );

        console.log(
          JSON.stringify(
            {
              status: "workflow_labeled",
              workflowId,
              name: options.name ?? null,
              purpose: options.purpose ?? null,
              repetitive: options.repetitive ?? null,
              automationCandidate: options.automationCandidate ?? null,
              difficulty: options.difficulty ?? null,
              approvedAutomationCandidate: options.approveCandidate ?? null,
              ...summarizeWorkflowFeedbackResult(result),
            },
            null,
            2,
          ),
        );
      },
    ),
);

workflowCommand.addCommand(
  new Command("merge")
    .description("Merge one workflow cluster into another on future analyses")
    .argument("<workflow-id>", "Workflow cluster id to merge")
    .argument("<target-workflow-id>", "Workflow cluster id to merge into")
    .option("--data-dir <path>", "Override application data directory")
    .action((workflowId: string, targetWorkflowId: string, options: { dataDir?: string }) => {
      const result = withDatabase(options.dataDir, (database) =>
        saveWorkflowReview(database, {
          workflowId,
          mergeIntoWorkflowId: targetWorkflowId,
        }),
      );

      console.log(
        JSON.stringify(
          {
            status: "workflow_merge_saved",
            workflowId,
            targetWorkflowId,
            ...summarizeWorkflowFeedbackResult(result),
          },
          null,
          2,
        ),
      );
    }),
);

workflowCommand.addCommand(
  new Command("split")
    .description("Split a workflow cluster on future analyses after a selected action")
    .argument("<workflow-id>", "Workflow cluster id")
    .requiredOption("--after-action <action-name>", "Action name after which the workflow should split")
    .option("--data-dir <path>", "Override application data directory")
    .action(
      (
        workflowId: string,
        options: { dataDir?: string; afterAction: string },
      ) => {
        const result = withDatabase(options.dataDir, (database) =>
          saveWorkflowReview(database, {
            workflowId,
            splitAfterActionName: options.afterAction,
          }),
        );

        console.log(
          JSON.stringify(
            {
              status: "workflow_split_saved",
              workflowId,
              splitAfterActionName: options.afterAction,
              ...summarizeWorkflowFeedbackResult(result),
            },
            null,
            2,
          ),
        );
      },
    ),
);

workflowCommand.addCommand(
  new Command("exclude")
    .description("Exclude a workflow cluster from report output")
    .argument("<workflow-id>", "Workflow cluster id")
    .option("--data-dir <path>", "Override application data directory")
    .action((workflowId: string, options: { dataDir?: string }) => {
      const result = withDatabase(options.dataDir, (database) =>
        saveWorkflowReview(database, {
          workflowId,
          excluded: true,
        }),
      );

      console.log(
        JSON.stringify(
          {
            status: "workflow_excluded",
            workflowId,
            ...summarizeWorkflowFeedbackResult(result),
          },
          null,
          2,
        ),
      );
    }),
);

workflowCommand.addCommand(
  new Command("include")
    .description("Include a previously excluded workflow cluster")
    .argument("<workflow-id>", "Workflow cluster id")
    .option("--data-dir <path>", "Override application data directory")
    .action((workflowId: string, options: { dataDir?: string }) => {
      const result = withDatabase(options.dataDir, (database) =>
        saveWorkflowReview(database, {
          workflowId,
          excluded: false,
        }),
      );

      console.log(
        JSON.stringify(
          {
            status: "workflow_included",
            workflowId,
            ...summarizeWorkflowFeedbackResult(result),
          },
          null,
          2,
        ),
      );
    }),
);

workflowCommand.addCommand(
  new Command("hide")
    .description("Hide an incorrect workflow cluster")
    .argument("<workflow-id>", "Workflow cluster id")
    .option("--data-dir <path>", "Override application data directory")
    .action((workflowId: string, options: { dataDir?: string }) => {
      const result = withDatabase(options.dataDir, (database) =>
        saveWorkflowReview(database, {
          workflowId,
          hidden: true,
        }),
      );

      console.log(
        JSON.stringify(
          {
            status: "workflow_hidden",
            workflowId,
            ...summarizeWorkflowFeedbackResult(result),
          },
          null,
          2,
        ),
      );
    }),
);

workflowCommand.addCommand(
  new Command("unhide")
    .description("Unhide a hidden workflow cluster")
    .argument("<workflow-id>", "Workflow cluster id")
    .option("--data-dir <path>", "Override application data directory")
    .action((workflowId: string, options: { dataDir?: string }) => {
      const result = withDatabase(options.dataDir, (database) =>
        saveWorkflowReview(database, {
          workflowId,
          hidden: false,
        }),
      );

      console.log(
        JSON.stringify(
          {
            status: "workflow_visible",
            workflowId,
            ...summarizeWorkflowFeedbackResult(result),
          },
          null,
          2,
        ),
      );
    }),
);

const sessionCommand = program
  .command("session")
  .description("Inspect analyzed sessions");

sessionCommand.addCommand(
  new Command("list")
    .description("List analyzed sessions")
    .option("--data-dir <path>", "Override application data directory")
    .option("--json", "Print machine-readable JSON")
    .action((options: { dataDir?: string; json?: boolean }) => {
      renderSessionList(options.json, options.dataDir);
    }),
);

sessionCommand.addCommand(
  new Command("show")
    .description("Show one analyzed session and its ordered steps")
    .argument("<session-id>", "Session id")
    .option("--data-dir <path>", "Override application data directory")
    .option("--json", "Print machine-readable JSON")
    .action((sessionId: string, options: { dataDir?: string; json?: boolean }) => {
      renderSessionDetail(sessionId, options.dataDir, options.json);
    }),
);

sessionCommand.addCommand(
  new Command("delete")
    .description("Delete a session by removing its source raw events and rerunning analysis")
    .argument("<session-id>", "Session id")
    .option("--data-dir <path>", "Override application data directory")
    .action((sessionId: string, options: { dataDir?: string }) => {
      const summary = withDatabase(options.dataDir, (database) => {
        const deletedRawEventCount = database.deleteSessionSourceEvents(sessionId);
        const remainingRawEvents = database.getRawEventsChronological();
        const analysisResult = analyzeRawEvents(remainingRawEvents, {
          ...resolveConfiguredAnalyzeOptions(options.dataDir),
          feedbackByWorkflowSignature: database.listWorkflowFeedbackSummary(),
        });

        database.replaceAnalysisArtifacts(analysisResult);

        return {
          deletedRawEventCount,
          remainingRawEventCount: remainingRawEvents.length,
          remainingSessionCount: analysisResult.sessions.length,
          remainingWorkflowClusterCount: analysisResult.workflowClusters.length,
        };
      });

      console.log(
        JSON.stringify(
          {
            status: "session_deleted",
            sessionId,
            ...summary,
          },
          null,
          2,
        ),
      );
    }),
);

program
  .command("workflow:list")
  .description("List workflow clusters including feedback state")
  .option("--data-dir <path>", "Override application data directory")
  .option("--json", "Print machine-readable JSON")
  .action((options: { dataDir?: string; json?: boolean }) => {
    renderWorkflowList(options.json, options.dataDir);
  });

program
  .command("workflow:show")
  .description("Show one workflow cluster in detail")
  .argument("<workflow-id>", "Workflow cluster id")
  .option("--data-dir <path>", "Override application data directory")
  .option("--json", "Print machine-readable JSON")
  .action((workflowId: string, options: { dataDir?: string; json?: boolean }) => {
    renderWorkflowDetail(workflowId, options.dataDir, options.json);
  });

program
  .command("workflow:rename")
  .description("Rename a workflow cluster")
  .helpGroup("Deprecated Commands:")
  .argument("<workflow-id>", "Workflow cluster id")
  .argument("<name>", "New workflow name")
  .option("--data-dir <path>", "Override application data directory")
  .action((workflowId: string, name: string, options: { dataDir?: string }) => {
    printDeprecationWarning("workflow:rename", {
      replacement: `workflow:label ${workflowId} --name "${name}"`,
    });

    const result = withDatabase(options.dataDir, (database) =>
      saveWorkflowReview(database, {
        workflowId,
        name,
      }),
    );

    console.log(
      JSON.stringify(
        {
          status: "workflow_renamed",
          workflowId,
          name,
          ...summarizeWorkflowFeedbackResult(result),
        },
        null,
        2,
      ),
    );
  });

program
  .command("workflow:label")
  .description("Store rich workflow feedback for naming, business purpose, and automation review")
  .argument("<workflow-id>", "Workflow cluster id")
  .option("--data-dir <path>", "Override application data directory")
  .option("--name <name>", "Workflow display name")
  .option("--purpose <purpose>", "Business purpose for this workflow")
  .option("--repetitive <true|false>", "Mark whether the workflow is repetitive", parseBooleanOption)
  .option(
    "--automation-candidate <true|false>",
    "Mark whether the workflow is an automation candidate",
    parseBooleanOption,
  )
  .option("--difficulty <difficulty>", "Automation difficulty (low, medium, high)")
  .option(
    "--approve-candidate <true|false>",
    "Mark whether the automation candidate is approved",
    parseBooleanOption,
  )
  .action(
    (
      workflowId: string,
      options: {
        dataDir?: string;
        name?: string;
        purpose?: string;
        repetitive?: boolean;
        automationCandidate?: boolean;
        difficulty?: "low" | "medium" | "high";
        approveCandidate?: boolean;
      },
    ) => {
      const result = withDatabase(options.dataDir, (database) =>
        saveWorkflowReview(database, {
          workflowId,
          name: options.name,
          purpose: options.purpose,
          repetitive: options.repetitive,
          automationCandidate: options.automationCandidate,
          difficulty: options.difficulty,
          approvedAutomationCandidate: options.approveCandidate,
        }),
      );

      console.log(
        JSON.stringify(
          {
            status: "workflow_labeled",
            workflowId,
            name: options.name ?? null,
            purpose: options.purpose ?? null,
            repetitive: options.repetitive ?? null,
            automationCandidate: options.automationCandidate ?? null,
            difficulty: options.difficulty ?? null,
            approvedAutomationCandidate: options.approveCandidate ?? null,
            ...summarizeWorkflowFeedbackResult(result),
          },
          null,
          2,
        ),
      );
    },
  );

program
  .command("workflow:merge")
  .description("Merge one workflow cluster into another on future analyses")
  .argument("<workflow-id>", "Workflow cluster id to merge")
  .argument("<target-workflow-id>", "Workflow cluster id to merge into")
  .option("--data-dir <path>", "Override application data directory")
  .action((workflowId: string, targetWorkflowId: string, options: { dataDir?: string }) => {
    const result = withDatabase(options.dataDir, (database) =>
      saveWorkflowReview(database, {
        workflowId,
        mergeIntoWorkflowId: targetWorkflowId,
      }),
    );

    console.log(
      JSON.stringify(
        {
          status: "workflow_merge_saved",
          workflowId,
          targetWorkflowId,
          ...summarizeWorkflowFeedbackResult(result),
        },
        null,
        2,
      ),
    );
  });

program
  .command("workflow:split")
  .description("Split a workflow cluster on future analyses after a selected action")
  .argument("<workflow-id>", "Workflow cluster id")
  .requiredOption("--after-action <action-name>", "Action name after which the workflow should split")
  .option("--data-dir <path>", "Override application data directory")
  .action(
    (
      workflowId: string,
      options: { dataDir?: string; afterAction: string },
    ) => {
      const result = withDatabase(options.dataDir, (database) =>
        saveWorkflowReview(database, {
          workflowId,
          splitAfterActionName: options.afterAction,
        }),
      );

      console.log(
        JSON.stringify(
          {
            status: "workflow_split_saved",
            workflowId,
            splitAfterActionName: options.afterAction,
            ...summarizeWorkflowFeedbackResult(result),
          },
          null,
          2,
        ),
      );
    },
  );

program
  .command("workflow:exclude")
  .description("Exclude a workflow cluster from report output")
  .argument("<workflow-id>", "Workflow cluster id")
  .option("--data-dir <path>", "Override application data directory")
  .action((workflowId: string, options: { dataDir?: string }) => {
    const result = withDatabase(options.dataDir, (database) =>
      saveWorkflowReview(database, {
        workflowId,
        excluded: true,
      }),
    );

    console.log(
      JSON.stringify(
        {
          status: "workflow_excluded",
          workflowId,
          ...summarizeWorkflowFeedbackResult(result),
        },
        null,
        2,
      ),
    );
  });

program
  .command("workflow:include")
  .description("Include a previously excluded workflow cluster")
  .argument("<workflow-id>", "Workflow cluster id")
  .option("--data-dir <path>", "Override application data directory")
  .action((workflowId: string, options: { dataDir?: string }) => {
    const result = withDatabase(options.dataDir, (database) =>
      saveWorkflowReview(database, {
        workflowId,
        excluded: false,
      }),
    );

    console.log(
      JSON.stringify(
        {
          status: "workflow_included",
          workflowId,
          ...summarizeWorkflowFeedbackResult(result),
        },
        null,
        2,
      ),
    );
  });

program
  .command("workflow:hide")
  .description("Hide an incorrect workflow cluster")
  .argument("<workflow-id>", "Workflow cluster id")
  .option("--data-dir <path>", "Override application data directory")
  .action((workflowId: string, options: { dataDir?: string }) => {
    const result = withDatabase(options.dataDir, (database) =>
      saveWorkflowReview(database, {
        workflowId,
        hidden: true,
      }),
    );

    console.log(
      JSON.stringify(
        {
          status: "workflow_hidden",
          workflowId,
          ...summarizeWorkflowFeedbackResult(result),
        },
        null,
        2,
      ),
    );
  });

program
  .command("workflow:unhide")
  .description("Unhide a hidden workflow cluster")
  .argument("<workflow-id>", "Workflow cluster id")
  .option("--data-dir <path>", "Override application data directory")
  .action((workflowId: string, options: { dataDir?: string }) => {
    const result = withDatabase(options.dataDir, (database) =>
      saveWorkflowReview(database, {
        workflowId,
        hidden: false,
      }),
    );

    console.log(
      JSON.stringify(
        {
          status: "workflow_visible",
          workflowId,
          ...summarizeWorkflowFeedbackResult(result),
        },
        null,
        2,
      ),
    );
  });

program
  .command("session:list")
  .description("List analyzed sessions")
  .option("--data-dir <path>", "Override application data directory")
  .option("--json", "Print machine-readable JSON")
  .action((options: { dataDir?: string; json?: boolean }) => {
    renderSessionList(options.json, options.dataDir);
  });

program
  .command("session:show")
  .description("Show one analyzed session and its ordered steps")
  .argument("<session-id>", "Session id")
  .option("--data-dir <path>", "Override application data directory")
  .option("--json", "Print machine-readable JSON")
  .action((sessionId: string, options: { dataDir?: string; json?: boolean }) => {
    renderSessionDetail(sessionId, options.dataDir, options.json);
  });

program
  .command("session:delete")
  .description("Delete a session by removing its source raw events and rerunning analysis")
  .argument("<session-id>", "Session id")
  .option("--data-dir <path>", "Override application data directory")
  .action((sessionId: string, options: { dataDir?: string }) => {
    const summary = withDatabase(options.dataDir, (database) => {
      const deletedRawEventCount = database.deleteSessionSourceEvents(sessionId);
      const remainingRawEvents = database.getRawEventsChronological();
      const analysisResult = analyzeRawEvents(remainingRawEvents, {
        ...resolveConfiguredAnalyzeOptions(options.dataDir),
        feedbackByWorkflowSignature: database.listWorkflowFeedbackSummary(),
      });

      database.replaceAnalysisArtifacts(analysisResult);

      return {
        deletedRawEventCount,
        remainingRawEventCount: remainingRawEvents.length,
        remainingSessionCount: analysisResult.sessions.length,
        remainingWorkflowClusterCount: analysisResult.workflowClusters.length,
      };
    });

    console.log(
      JSON.stringify(
        {
          status: "session_deleted",
          sessionId,
          ...summary,
        },
        null,
        2,
      ),
    );
  });

program
  .command("llm:payloads")
  .description("Print summarized workflow payloads that are safe to send to an LLM")
  .option("--data-dir <path>", "Override application data directory")
  .option("--include-excluded", "Include excluded workflows")
  .option("--include-hidden", "Include hidden workflows")
  .option("--include-short-form", "Include short-form workflow clusters")
  .action(
    (options: {
      dataDir?: string;
      includeExcluded?: boolean;
      includeHidden?: boolean;
      includeShortForm?: boolean;
    }) => {
      renderWorkflowSummaryPayloads(options.dataDir, {
        includeExcluded: options.includeExcluded,
        includeHidden: options.includeHidden,
        includeShortForm: options.includeShortForm,
      });
    },
  );

program
  .command("llm:analyze")
  .description("Analyze summarized workflow payloads with an LLM provider")
  .option("--data-dir <path>", "Override application data directory")
  .option("--provider <provider>", "LLM provider")
  .option("--auth <method>", "Authentication method for the provider")
  .option("--model <model>", "Model name for the provider")
  .option("--base-url <url>", "Override provider base URL")
  .option("--project-id <id>", "Override Google Cloud project id for Gemini OAuth")
  .option("--include-excluded", "Include excluded workflows")
  .option("--include-hidden", "Include hidden workflows")
  .option("--include-short-form", "Include short-form workflow clusters")
  .option("--apply-names", "Persist LLM workflow_name results as rename feedback")
  .option("--json", "Print machine-readable JSON")
  .action(
    async (options: {
      dataDir?: string;
      provider?: string;
      auth?: string;
      model?: string;
      baseUrl?: string;
      projectId?: string;
      includeExcluded?: boolean;
      includeHidden?: boolean;
      includeShortForm?: boolean;
      applyNames?: boolean;
      json?: boolean;
    }) => {
      const payloadRecords = withDatabase(options.dataDir, (database) =>
        database.listWorkflowSummaryPayloadRecords({
          includeExcluded: options.includeExcluded,
          includeHidden: options.includeHidden,
          includeShortForm: options.includeShortForm,
        }),
      );
      const { analyses } = await analyzeWorkflowPayloadRecords({
        dataDir: options.dataDir,
        payloadRecords,
        provider: options.provider,
        auth: options.auth,
        model: options.model,
        baseUrl: options.baseUrl,
        projectId: options.projectId,
      });

      persistWorkflowLLMAnalysisResults(options.dataDir, analyses, {
        applyNames: options.applyNames,
      });

      if (options.json) {
        console.log(JSON.stringify(analyses, null, 2));
        return;
      }

      console.table(
        analyses.map((analysis) => ({
          workflowClusterId: analysis.workflowClusterId,
          workflowName: analysis.workflowName,
          suitability: analysis.automationSuitability,
          recommendedApproach: analysis.recommendedApproach,
        })),
      );
    },
  );

program
  .command("llm:providers")
  .description("List supported LLM providers and authentication methods")
  .option("--json", "Print machine-readable JSON")
  .action((options: { json?: boolean }) => {
    const providers = LLM_PROVIDERS.map((provider) => {
      const descriptor = getLLMProviderDescriptor(provider);

      return {
        provider,
        label: descriptor.label,
        defaultModel: descriptor.defaultModel,
        supportedAuthMethods: descriptor.supportedAuthMethods,
        apiKeyEnvVars: descriptor.apiKeyEnvVars,
      };
    });

    if (options.json) {
      console.log(JSON.stringify(providers, null, 2));
      return;
    }

    console.table(
      providers.map((provider) => ({
        provider: provider.provider,
        label: provider.label,
        defaultModel: provider.defaultModel,
        auth: provider.supportedAuthMethods.join(", "),
        envVars: provider.apiKeyEnvVars.join(", "),
      })),
    );
  });

program
  .command("llm:config:show")
  .description("Show the saved default LLM analysis configuration")
  .option("--data-dir <path>", "Override application data directory")
  .option("--json", "Print machine-readable JSON")
  .action((options: { dataDir?: string; json?: boolean }) => {
    const credentialStatus = buildProviderCredentialStatus(options.dataDir);

    if (options.json) {
      console.log(JSON.stringify(credentialStatus, null, 2));
      return;
    }

    console.log(JSON.stringify(credentialStatus.configuration, null, 2));
    console.table(
      credentialStatus.providers.map((provider) => ({
        provider: provider.provider,
        label: provider.label,
        defaultModel: provider.defaultModel,
        supportedAuthMethods: provider.supportedAuthMethods.join(", "),
        hasApiKey: provider.hasApiKey,
        hasOAuthCredentials: provider.hasOAuthCredentials,
        selected: provider.selected,
      })),
    );
  });

program
  .command("llm:config:set")
  .description("Update the saved default LLM analysis configuration")
  .option("--data-dir <path>", "Override application data directory")
  .option("--provider <provider>", "Default LLM provider")
  .option("--auth <method>", "Default authentication method")
  .option("--model <model>", "Default model name")
  .option("--base-url <url>", "Default provider base URL")
  .option("--clear-base-url", "Clear a previously saved base URL")
  .option("--project-id <id>", "Default Google Cloud project id for Gemini OAuth")
  .option("--clear-project-id", "Clear a previously saved Google Cloud project id")
  .action(
    (options: {
      dataDir?: string;
      provider?: string;
      auth?: string;
      model?: string;
      baseUrl?: string;
      clearBaseUrl?: boolean;
      projectId?: string;
      clearProjectId?: boolean;
    }) => {
      if (
        !options.provider &&
        !options.auth &&
        options.model === undefined &&
        options.baseUrl === undefined &&
        !options.clearBaseUrl &&
        options.projectId === undefined &&
        !options.clearProjectId
      ) {
        throw new Error("At least one config option is required");
      }

      const configuration = withDatabase(options.dataDir, (database) =>
        updateLLMConfiguration(database, {
          provider: options.provider,
          authMethod: options.auth,
          model: options.model,
          baseUrl: options.clearBaseUrl ? null : options.baseUrl,
          googleProjectId: options.clearProjectId ? null : options.projectId,
        }),
      );

      console.log(
        JSON.stringify(
          {
            status: "llm_config_updated",
            configuration,
          },
          null,
          2,
        ),
      );
    },
  );

program
  .command("credential:status")
  .description("Show secure credential backend status")
  .option("--data-dir <path>", "Override application data directory")
  .action((options: { dataDir?: string }) => {
    console.log(JSON.stringify(buildProviderCredentialStatus(options.dataDir), null, 2));
  });

program
  .command("credential:set")
  .description("Store a provider API key in secure OS credential storage")
  .argument("<provider>", "Provider name")
  .argument("[api-key]", "Provider API key. If omitted, provider env vars are used.")
  .action((providerName: string, apiKey: string | undefined) => {
    const credentialStore = resolveCredentialStore();
    const provider = normalizeLLMProvider(providerName);

    if (!supportsLLMAuthMethod(provider, "api-key")) {
      throw new Error(`${provider} does not support API key storage`);
    }

    const descriptor = getLLMProviderDescriptor(provider);
    const resolvedApiKey =
      apiKey ??
      descriptor.apiKeyEnvVars
        .map((envVar) => process.env[envVar]?.trim())
        .find((value): value is string => Boolean(value));

    if (!resolvedApiKey) {
      throw new Error(`API key is required. Expected one of: ${descriptor.apiKeyEnvVars.join(", ")}`);
    }

    setLLMApiKey(credentialStore, provider, resolvedApiKey);

    console.log(
      JSON.stringify(
        {
          status: "api_key_stored",
          provider,
          backend: credentialStore.backend,
        },
        null,
        2,
      ),
    );
  });

program
  .command("credential:delete")
  .description("Delete a stored provider API key from secure OS credential storage")
  .argument("<provider>", "Provider name")
  .action((providerName: string) => {
    const credentialStore = resolveCredentialStore();
    const provider = normalizeLLMProvider(providerName);

    if (!supportsLLMAuthMethod(provider, "api-key")) {
      throw new Error(`${provider} does not support API key storage`);
    }

    deleteLLMApiKey(credentialStore, provider);

    console.log(
      JSON.stringify(
        {
          status: "api_key_deleted",
          provider,
          backend: credentialStore.backend,
        },
        null,
        2,
      ),
    );
  });

program
  .command("credential:set-openai")
  .description("Store the OpenAI API key in secure OS credential storage")
  .helpGroup("Deprecated Commands:")
  .argument("[api-key]", "OpenAI API key. If omitted, OPENAI_API_KEY is used.")
  .action((apiKey: string | undefined) => {
    printDeprecationWarning("credential:set-openai", {
      replacement: "credential:set openai",
    });

    const credentialStore = resolveCredentialStore();
    const resolvedApiKey = apiKey ?? requireEnv("OPENAI_API_KEY");

    setLLMApiKey(credentialStore, "openai", resolvedApiKey);

    console.log(
      JSON.stringify(
        {
          status: "openai_key_stored",
          backend: credentialStore.backend,
        },
        null,
        2,
      ),
    );
  });

program
  .command("credential:delete-openai")
  .description("Delete the stored OpenAI API key from secure OS credential storage")
  .helpGroup("Deprecated Commands:")
  .action(() => {
    printDeprecationWarning("credential:delete-openai", {
      replacement: "credential:delete openai",
    });

    const credentialStore = resolveCredentialStore();
    deleteLLMApiKey(credentialStore, "openai");

    console.log(
      JSON.stringify(
        {
          status: "openai_key_deleted",
          backend: credentialStore.backend,
        },
        null,
        2,
      ),
    );
  });

const authCommand = program
  .command("auth")
  .description("Run provider authentication flows");

authCommand.addCommand(
  new Command("login")
    .description("Run a provider OAuth login flow when supported")
    .argument("<provider>", "Provider name")
    .option("--data-dir <path>", "Override application data directory")
    .option("--interactive", "Force prompts for missing values")
    .option("--non-interactive", "Disable prompts and require explicit arguments")
    .option("--client-id <id>", "OAuth client id")
    .option("--client-secret <secret>", "OAuth client secret for providers that require it")
    .option("--project-id <id>", "Google Cloud project id for Gemini")
    .option("--issuer-url <url>", "OAuth issuer base URL for OpenAI Codex")
    .option("--port <port>", "Local callback port", "0")
    .action(async (providerName: string, options: AuthLoginCommandOptions, command: Command) => {
      await runAuthLoginCommand(providerName, mergeActionOptions(options, command));
    }),
);

authCommand.addCommand(
  new Command("logout")
    .description("Delete stored OAuth credentials for a provider")
    .argument("<provider>", "Provider name")
    .option("--data-dir <path>", "Override application data directory")
    .action((providerName: string, options: { dataDir?: string }) => {
      runAuthLogoutCommand(providerName, options);
    }),
);

program
  .command("auth:login")
  .description("Run a provider OAuth login flow when supported")
  .argument("<provider>", "Provider name")
  .option("--data-dir <path>", "Override application data directory")
  .option("--interactive", "Force prompts for missing values")
  .option("--non-interactive", "Disable prompts and require explicit arguments")
  .option("--client-id <id>", "OAuth client id")
  .option("--client-secret <secret>", "OAuth client secret for providers that require it")
  .option("--project-id <id>", "Google Cloud project id for Gemini")
  .option("--issuer-url <url>", "OAuth issuer base URL for OpenAI Codex")
  .option("--port <port>", "Local callback port", "0")
  .action(
    async (providerName: string, options: AuthLoginCommandOptions) => {
      await runAuthLoginCommand(providerName, options);
    },
  );

program
  .command("auth:logout")
  .description("Delete stored OAuth credentials for a provider")
  .argument("<provider>", "Provider name")
  .option("--data-dir <path>", "Override application data directory")
  .action((providerName: string, options: { dataDir?: string }) => {
    runAuthLogoutCommand(providerName, options);
  });

program
  .command("llm:results")
  .description("List stored LLM workflow analysis results")
  .option("--data-dir <path>", "Override application data directory")
  .option("--json", "Print machine-readable JSON")
  .action((options: { dataDir?: string; json?: boolean }) => {
    const results = withDatabase(options.dataDir, (database) => database.listWorkflowLLMAnalyses());

    if (options.json) {
      console.log(JSON.stringify(results, null, 2));
      return;
    }

    console.table(
      results.map((result) => ({
        workflowClusterId: result.workflowClusterId,
        provider: result.provider,
        model: result.model,
        workflowName: result.workflowName,
        automationSuitability: result.automationSuitability,
        recommendedApproach: result.recommendedApproach,
      })),
    );
  });

program
  .command("viewer:open")
  .description("Open the local workflow viewer in the default browser")
  .alias("viewer")
  .option("--data-dir <path>", "Override application data directory")
  .option("--host <host>", "Fallback host when no active agent state exists")
  .option("--port <port>", "Fallback port when no active agent state exists")
  .action((options: { dataDir?: string; host?: string; port?: string }) => {
    const { dataDir, config } = loadCommandConfig(options.dataDir);
    const viewerUrl = resolveViewerUrl(dataDir, {
      host:
        options.host ??
        resolveEnvOverride("WID_SERVER_HOST") ??
        config.server.host ??
        DEFAULT_WID_SERVER_HOST,
      port: Number.parseInt(
        options.port ??
          resolveEnvOverride("WID_SERVER_PORT") ??
          String(config.server.port ?? DEFAULT_WID_SERVER_PORT),
        10,
      ),
    });
    const opened = openSystemBrowser(viewerUrl);

    console.log(
      JSON.stringify(
        {
          status: opened ? "viewer_open_requested" : "viewer_open_failed",
          viewerUrl,
          opened,
        },
        null,
        2,
      ),
    );
  });

program
  .command("server:run")
  .description("Run a local HTTP server for collectors and the browser viewer")
  .option("--data-dir <path>", "Override application data directory")
  .option("--host <host>", "Host to bind")
  .option("--port <port>", "Port to bind")
  .option("--ingest-auth-token <token>", "Override and persist the shared ingest auth token")
  .option("--verbose", "Enable verbose ingest request logging")
  .option("--open", "Open the local viewer in the default browser after startup")
  .action(
    (options: {
      dataDir?: string;
      host?: string;
      port?: string;
      ingestAuthToken?: string;
      verbose?: boolean;
      open?: boolean;
    }) =>
    runServerCommand(options, "server:run"),
  );

program
  .command("serve")
  .description("Run a local HTTP server for collectors and the browser viewer")
  .helpGroup("Deprecated Commands:")
  .option("--data-dir <path>", "Override application data directory")
  .option("--host <host>", "Host to bind")
  .option("--port <port>", "Port to bind")
  .option("--ingest-auth-token <token>", "Override and persist the shared ingest auth token")
  .option("--verbose", "Enable verbose ingest request logging")
  .option("--open", "Open the local viewer in the default browser after startup")
  .action(
    (options: {
      dataDir?: string;
      host?: string;
      port?: string;
      ingestAuthToken?: string;
      verbose?: boolean;
      open?: boolean;
    }) => runServerCommand(options, "serve"),
  );

program
  .command("demo")
  .description("Reset local data, seed mock workflows, run analysis, and print a report")
  .option("--data-dir <path>", "Override application data directory")
  .option("--json", "Print machine-readable JSON")
  .action((options: { dataDir?: string; json?: boolean }) => {
    const mockEvents = generateMockRawEvents();

    const summary = withDatabase(options.dataDir, (database) => {
      database.clearAllData();

      for (const event of mockEvents) {
        database.insertRawEvent(event);
      }

      const rawEvents = database.getRawEventsChronological();
      const analysisResult = analyzeRawEvents(rawEvents, {
        ...resolveConfiguredAnalyzeOptions(options.dataDir),
        feedbackByWorkflowSignature: database.listWorkflowFeedbackSummary(),
      });

      database.replaceAnalysisArtifacts(analysisResult);

      return {
        rawEvents: rawEvents.length,
        normalizedEvents: analysisResult.normalizedEvents.length,
        sessions: analysisResult.sessions.length,
        workflowClusters: analysisResult.workflowClusters.length,
      };
    });

    console.log(JSON.stringify({ status: "demo_completed", ...summary }, null, 2));
    renderReport(options.json, options.dataDir);
  });

program
  .command("reset")
  .description("Delete all locally stored events and analysis results")
  .option("--data-dir <path>", "Override application data directory")
  .action((options: { dataDir?: string }) => {
    withDatabase(options.dataDir, (database) => {
      database.clearAllData();
    });

    console.log(JSON.stringify({ status: "reset_completed" }, null, 2));
  });

await program.parseAsync(normalizeCliArgv(process.argv));
