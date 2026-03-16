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
  isGoogleOAuthAccessTokenExpired,
  refreshGoogleOAuthCredentials,
  runGoogleOAuthInteractiveLogin,
} from "./auth/google-oauth.js";
import { getAvailableCollectors } from "./collectors/index.js";
import { getMacOSActiveWindowCollectorInfo, resolveMacOSCollectorRunner } from "./collectors/macos.js";
import { getWindowsActiveWindowCollectorInfo } from "./collectors/windows.js";
import {
  deleteGeminiOAuthCredentials,
  deleteLLMApiKey,
  getGeminiOAuthCredentials,
  getLLMApiKey,
  hasGeminiOAuthCredentials,
  hasLLMApiKey,
  setGeminiOAuthCredentials,
  setLLMApiKey,
} from "./credentials/llm.js";
import { resolveCredentialStore } from "./credentials/store.js";
import { generateMockRawEvents } from "./collectors/mock.js";
import { importEventsFromFile } from "./importers/events.js";
import {
  getDefaultLLMAuthMethod,
  getLLMProviderDescriptor,
  LLM_PROVIDERS,
  normalizeLLMAuthMethod,
  normalizeLLMProvider,
  supportsLLMAuthMethod,
  type LLMAuthMethod,
  type LLMProvider,
} from "./llm/catalog.js";
import {
  getStoredLLMConfiguration,
  updateLLMConfiguration,
  type LLMConfiguration,
} from "./llm/config.js";
import { createWorkflowAnalyzer } from "./llm/factory.js";
import { analyzeRawEvents } from "./pipeline/analyze.js";
import { buildWorkflowReport, formatDuration } from "./reporting/report.js";
import {
  buildWorkflowReportFromDatabase,
  generateReportSnapshot,
  runReportSchedulerCycle,
} from "./reporting/service.js";
import { parseReportWindow, parseReportWindowList, resolveReportTimeWindow } from "./reporting/windows.js";
import { startIngestServer } from "./server/ingest-server.js";
import { AppDatabase } from "./storage/database.js";
import type {
  ReportEntry,
  ReportSnapshot,
  ReportSnapshotSummary,
  ReportWindow,
  WorkflowLLMAnalysis,
  WorkflowReport,
} from "./domain/types.js";

const program = new Command();

function withDatabase<T>(dataDir: string | undefined, fn: (database: AppDatabase) => T): T {
  const database = new AppDatabase(resolveAppPaths(dataDir));
  database.initialize();

  try {
    return fn(database);
  } finally {
    database.close();
  }
}

function renderReportTable(reportEntries: ReportEntry[]): void {
  console.table(
    reportEntries.map((entry) => ({
      workflow: entry.workflowName,
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
        totalSessions: snapshot.totalSessions,
        totalTrackedDuration: formatDuration(snapshot.totalTrackedDurationSeconds),
        generatedAt: snapshot.generatedAt,
      },
      null,
      2,
    ),
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

function renderWorkflowSummaryPayloads(
  dataDir: string | undefined,
  options: { includeExcluded?: boolean | undefined; includeHidden?: boolean | undefined },
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

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required`);
  }

  return value;
}

function getStoredAnalysisConfiguration(dataDir?: string): LLMConfiguration {
  return withDatabase(dataDir, (database) => getStoredLLMConfiguration(database));
}

function resolveApiKeyFromEnv(provider: LLMProvider): string | undefined {
  const descriptor = getLLMProviderDescriptor(provider);

  for (const envVar of descriptor.apiKeyEnvVars) {
    const value = process.env[envVar];

    if (value) {
      return value;
    }
  }

  return undefined;
}

function resolveProviderApiKey(provider: LLMProvider): string {
  const credentialStore = resolveCredentialStore();
  const storedKey = getLLMApiKey(credentialStore, provider);

  if (storedKey) {
    return storedKey;
  }

  const envKey = resolveApiKeyFromEnv(provider);

  if (envKey) {
    return envKey;
  }

  const descriptor = getLLMProviderDescriptor(provider);
  throw new Error(
    `${descriptor.label} API key is required. Use credential:set ${provider} or set ${descriptor.apiKeyEnvVars.join(", ")}`,
  );
}

function resolveLLMAnalysisConfiguration(
  dataDir: string | undefined,
  options: {
    provider?: string | undefined;
    auth?: string | undefined;
    model?: string | undefined;
    baseUrl?: string | undefined;
    projectId?: string | undefined;
  },
): LLMConfiguration {
  const stored = getStoredAnalysisConfiguration(dataDir);
  const provider = options.provider ? normalizeLLMProvider(options.provider) : stored.provider;
  const providerChanged = provider !== stored.provider;
  const authMethod = options.auth
    ? normalizeLLMAuthMethod(options.auth)
    : providerChanged && !supportsLLMAuthMethod(provider, stored.authMethod)
      ? getDefaultLLMAuthMethod(provider)
      : stored.authMethod;

  if (!supportsLLMAuthMethod(provider, authMethod)) {
    throw new Error(`Provider ${provider} does not support auth method ${authMethod}`);
  }

  const configuration: LLMConfiguration = {
    provider,
    authMethod,
  };

  const model = options.model ?? (providerChanged ? undefined : stored.model);
  const baseUrl = options.baseUrl ?? (providerChanged ? undefined : stored.baseUrl);
  const googleProjectId =
    provider === "gemini"
      ? options.projectId ?? (providerChanged ? undefined : stored.googleProjectId)
      : undefined;

  if (model) {
    configuration.model = model;
  }

  if (baseUrl) {
    configuration.baseUrl = baseUrl;
  }

  if (googleProjectId) {
    configuration.googleProjectId = googleProjectId;
  }

  return configuration;
}

async function resolveGeminiOAuthRuntime(
  dataDir: string | undefined,
): Promise<{ accessToken: string; projectId: string }> {
  const credentialStore = resolveCredentialStore();
  const storedCredentials = getGeminiOAuthCredentials(credentialStore);

  if (!storedCredentials) {
    throw new Error("Gemini OAuth credentials not found. Run auth:login gemini first.");
  }

  const credentials = isGoogleOAuthAccessTokenExpired(storedCredentials)
    ? await refreshGoogleOAuthCredentials({
        credentials: storedCredentials,
      })
    : storedCredentials;

  if (credentials !== storedCredentials) {
    setGeminiOAuthCredentials(credentialStore, credentials);
  }

  const configuredProjectId = getStoredAnalysisConfiguration(dataDir).googleProjectId;
  const projectId = configuredProjectId ?? credentials.projectId;

  if (!projectId) {
    throw new Error("Gemini OAuth analysis requires a Google Cloud project id");
  }

  return {
    accessToken: credentials.accessToken,
    projectId,
  };
}

function buildProviderCredentialStatus(dataDir?: string) {
  const credentialStore = resolveCredentialStore();
  const configuration = getStoredAnalysisConfiguration(dataDir);

  return {
    backend: credentialStore.backend,
    supported: credentialStore.isSupported(),
    configuration,
    hasOpenAIKey: hasLLMApiKey(credentialStore, "openai"),
    providers: LLM_PROVIDERS.map((provider) => {
      const descriptor = getLLMProviderDescriptor(provider);
      return {
        provider,
        label: descriptor.label,
        defaultModel: descriptor.defaultModel,
        supportedAuthMethods: descriptor.supportedAuthMethods,
        hasApiKey: hasLLMApiKey(credentialStore, provider),
        envApiKeyAvailable: Boolean(resolveApiKeyFromEnv(provider)),
        hasOAuthCredentials: provider === "gemini" ? hasGeminiOAuthCredentials(credentialStore) : false,
        selected: configuration.provider === provider,
      };
    }),
  };
}

program
  .name("what-ive-done")
  .description("Local workflow pattern analyzer CLI")
  .version("0.1.0");

program
  .command("doctor")
  .description("Validate local runtime prerequisites")
  .action(() => {
    const paths = resolveAppPaths();
    const result = {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      dataDir: paths.dataDir,
      databasePath: paths.databasePath,
      agentLockPath: paths.agentLockPath,
    };

    console.log(JSON.stringify(result, null, 2));
  });

program
  .command("agent:run")
  .description("Run the resident local agent runtime")
  .option("--data-dir <path>", "Override application data directory")
  .option("--heartbeat-interval-ms <ms>", "Heartbeat interval in milliseconds", "30000")
  .option("--ingest-host <host>", "Host to bind the local ingest server", "127.0.0.1")
  .option("--ingest-port <port>", "Port to bind the local ingest server", "4318")
  .option("--collector-poll-interval-ms <ms>", "Collector polling interval in milliseconds", "1000")
  .option("--collector-restart-delay-ms <ms>", "Collector restart delay after failures", "5000")
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
  .action(
    async (options: {
      dataDir?: string;
      heartbeatIntervalMs: string;
      ingestHost: string;
      ingestPort: string;
      collectorPollIntervalMs: string;
      collectorRestartDelayMs: string;
      promptAccessibility: boolean;
      snapshotWindows: ReportWindow[];
      snapshotIntervalSeconds: string;
      collectors: boolean;
      snapshotScheduler: boolean;
    }) => {
    const runtime = await startAgentRuntime({
      dataDir: options.dataDir,
      heartbeatIntervalMs: Number.parseInt(options.heartbeatIntervalMs, 10),
      ingestHost: options.ingestHost,
      ingestPort: Number.parseInt(options.ingestPort, 10),
      collectorPollIntervalMs: Number.parseInt(options.collectorPollIntervalMs, 10),
      collectorRestartDelayMs: Number.parseInt(options.collectorRestartDelayMs, 10),
      promptAccessibility: options.promptAccessibility,
      enableCollectors: options.collectors,
      snapshotWindows: options.snapshotWindows,
      snapshotIntervalMs: Number.parseInt(options.snapshotIntervalSeconds, 10) * 1000,
      enableSnapshotScheduler: options.snapshotScheduler,
    });

    console.log(JSON.stringify(getAgentStatusSnapshot(options.dataDir), null, 2));

    await runtime.waitForStop();
    },
  );

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
  .option("--data-dir <path>", "Override application data directory")
  .action((options: { dataDir?: string }) => {
    const result = stopAgentRuntime(options.dataDir);

    console.log(JSON.stringify(result, null, 2));
  });

program
  .command("agent:health")
  .description("Show a concise health summary for the resident agent")
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
  .option("--plist-path <path>", "Override the LaunchAgent plist path")
  .action((options: { dataDir?: string; plistPath?: string }) => {
    const status = getAgentAutostartStatus({
      dataDir: options.dataDir,
      plistPath: options.plistPath,
    });

    console.log(JSON.stringify(status, null, 2));
  });

program
  .command("agent:autostart:install")
  .description("Install OS autostart for the resident agent")
  .option("--data-dir <path>", "Override application data directory")
  .option("--plist-path <path>", "Override the LaunchAgent plist path")
  .option("--no-load", "Write the LaunchAgent file without loading it")
  .action((options: { dataDir?: string; plistPath?: string; load: boolean }) => {
    const status = installAgentAutostart({
      dataDir: options.dataDir,
      plistPath: options.plistPath,
      load: options.load,
    });

    console.log(JSON.stringify(status, null, 2));
  });

program
  .command("agent:autostart:uninstall")
  .description("Remove OS autostart for the resident agent")
  .option("--data-dir <path>", "Override application data directory")
  .option("--plist-path <path>", "Override the LaunchAgent plist path")
  .option("--no-unload", "Remove the LaunchAgent file without unloading it first")
  .action((options: { dataDir?: string; plistPath?: string; unload: boolean }) => {
    const status = uninstallAgentAutostart({
      dataDir: options.dataDir,
      plistPath: options.plistPath,
      unload: options.unload,
    });

    console.log(JSON.stringify(status, null, 2));
  });

program
  .command("init")
  .description("Initialize local application storage")
  .option("--data-dir <path>", "Override application data directory")
  .action((options: { dataDir?: string }) => {
    const paths = resolveAppPaths(options.dataDir);
    withDatabase(options.dataDir, () => undefined);

    console.log(
      JSON.stringify(
        {
          status: "initialized",
          databasePath: paths.databasePath,
        },
        null,
        2,
      ),
    );
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
    const paths = resolveAppPaths(options.dataDir);

    withDatabase(options.dataDir, (database) => {
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
  .option("--data-dir <path>", "Override application data directory")
  .option("--windows <windows>", "Comma-separated report windows", parseReportWindowList, ["day", "week"])
  .option("--interval-seconds <seconds>", "Polling interval in seconds", "300")
  .option("--once", "Run one scheduler cycle and exit")
  .option("--json", "Print machine-readable JSON")
  .action(
    async (options: {
      dataDir?: string;
      windows: ReportWindow[];
      intervalSeconds: string;
      once?: boolean;
      json?: boolean;
    }) => {
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

        if (options.json) {
          console.log(JSON.stringify(payload, null, 2));
        } else {
          console.log(JSON.stringify(payload, null, 2));
        }

        if (options.once || stopped) {
          break;
        }

        await sleep(intervalMs);
      } while (!stopped);
    },
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
  .argument("<workflow-id>", "Workflow cluster id")
  .argument("<name>", "New workflow name")
  .option("--data-dir <path>", "Override application data directory")
  .action((workflowId: string, name: string, options: { dataDir?: string }) => {
    withDatabase(options.dataDir, (database) => {
      database.saveWorkflowFeedback({
        workflowClusterId: workflowId,
        renameTo: name,
      });
    });

    console.log(JSON.stringify({ status: "workflow_renamed", workflowId, name }, null, 2));
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
      withDatabase(options.dataDir, (database) => {
        database.saveWorkflowFeedback({
          workflowClusterId: workflowId,
          renameTo: options.name,
          businessPurpose: options.purpose,
          repetitive: options.repetitive,
          automationCandidate: options.automationCandidate,
          automationDifficulty: options.difficulty,
          approvedAutomationCandidate: options.approveCandidate,
        });
      });

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
    withDatabase(options.dataDir, (database) => {
      database.saveWorkflowFeedback({
        workflowClusterId: workflowId,
        mergeIntoWorkflowId: targetWorkflowId,
      });
    });

    console.log(
      JSON.stringify(
        { status: "workflow_merge_saved", workflowId, targetWorkflowId },
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
      withDatabase(options.dataDir, (database) => {
        database.saveWorkflowFeedback({
          workflowClusterId: workflowId,
          splitAfterActionName: options.afterAction,
        });
      });

      console.log(
        JSON.stringify(
          {
            status: "workflow_split_saved",
            workflowId,
            splitAfterActionName: options.afterAction,
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
    withDatabase(options.dataDir, (database) => {
      database.saveWorkflowFeedback({
        workflowClusterId: workflowId,
        excluded: true,
      });
    });

    console.log(JSON.stringify({ status: "workflow_excluded", workflowId }, null, 2));
  });

program
  .command("workflow:include")
  .description("Include a previously excluded workflow cluster")
  .argument("<workflow-id>", "Workflow cluster id")
  .option("--data-dir <path>", "Override application data directory")
  .action((workflowId: string, options: { dataDir?: string }) => {
    withDatabase(options.dataDir, (database) => {
      database.saveWorkflowFeedback({
        workflowClusterId: workflowId,
        excluded: false,
      });
    });

    console.log(JSON.stringify({ status: "workflow_included", workflowId }, null, 2));
  });

program
  .command("workflow:hide")
  .description("Hide an incorrect workflow cluster")
  .argument("<workflow-id>", "Workflow cluster id")
  .option("--data-dir <path>", "Override application data directory")
  .action((workflowId: string, options: { dataDir?: string }) => {
    withDatabase(options.dataDir, (database) => {
      database.saveWorkflowFeedback({
        workflowClusterId: workflowId,
        hidden: true,
      });
    });

    console.log(JSON.stringify({ status: "workflow_hidden", workflowId }, null, 2));
  });

program
  .command("workflow:unhide")
  .description("Unhide a hidden workflow cluster")
  .argument("<workflow-id>", "Workflow cluster id")
  .option("--data-dir <path>", "Override application data directory")
  .action((workflowId: string, options: { dataDir?: string }) => {
    withDatabase(options.dataDir, (database) => {
      database.saveWorkflowFeedback({
        workflowClusterId: workflowId,
        hidden: false,
      });
    });

    console.log(JSON.stringify({ status: "workflow_visible", workflowId }, null, 2));
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
  .action(
    (options: { dataDir?: string; includeExcluded?: boolean; includeHidden?: boolean }) => {
      renderWorkflowSummaryPayloads(options.dataDir, {
        includeExcluded: options.includeExcluded,
        includeHidden: options.includeHidden,
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
      applyNames?: boolean;
      json?: boolean;
    }) => {
      const payloadRecords = withDatabase(options.dataDir, (database) =>
        database.listWorkflowSummaryPayloadRecords({
          includeExcluded: options.includeExcluded,
          includeHidden: options.includeHidden,
        }),
      );
      const configuration = resolveLLMAnalysisConfiguration(options.dataDir, options);
      const runtimeAuth =
        configuration.provider === "gemini" && configuration.authMethod === "oauth2"
          ? await resolveGeminiOAuthRuntime(options.dataDir)
          : undefined;
      const analyzer = createWorkflowAnalyzer({
        provider: configuration.provider,
        authMethod: configuration.authMethod,
        apiKey:
          configuration.authMethod === "api-key"
            ? resolveProviderApiKey(configuration.provider)
            : undefined,
        accessToken: runtimeAuth?.accessToken,
        projectId: configuration.googleProjectId ?? runtimeAuth?.projectId,
        model: configuration.model,
        baseUrl: configuration.baseUrl,
      });
      const analyses: WorkflowLLMAnalysis[] = [];

      for (const record of payloadRecords) {
        analyses.push(await analyzer.analyze(record));
      }

      withDatabase(options.dataDir, (database) => {
        database.replaceWorkflowLLMAnalyses(analyses);

        if (options.applyNames) {
          for (const analysis of analyses) {
            database.saveWorkflowFeedback({
              workflowClusterId: analysis.workflowClusterId,
              renameTo: analysis.workflowName,
            });
          }
        }
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
  .argument("<provider>", "Provider name: openai|gemini|claude")
  .argument("[api-key]", "Provider API key. If omitted, provider env vars are used.")
  .action((providerName: string, apiKey: string | undefined) => {
    const credentialStore = resolveCredentialStore();
    const provider = normalizeLLMProvider(providerName);
    const resolvedApiKey = apiKey ?? resolveApiKeyFromEnv(provider);

    if (!resolvedApiKey) {
      const descriptor = getLLMProviderDescriptor(provider);
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
  .argument("<provider>", "Provider name: openai|gemini|claude")
  .action((providerName: string) => {
    const credentialStore = resolveCredentialStore();
    const provider = normalizeLLMProvider(providerName);
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
  .argument("[api-key]", "OpenAI API key. If omitted, OPENAI_API_KEY is used.")
  .action((apiKey: string | undefined) => {
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
  .action(() => {
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

program
  .command("auth:login")
  .description("Run a provider OAuth login flow when supported")
  .argument("<provider>", "Provider name")
  .option("--data-dir <path>", "Override application data directory")
  .option("--client-id <id>", "OAuth client id for Gemini")
  .option("--client-secret <secret>", "OAuth client secret for Gemini")
  .option("--project-id <id>", "Google Cloud project id for Gemini")
  .option("--port <port>", "Local callback port", "0")
  .action(
    async (
      providerName: string,
      options: {
        dataDir?: string;
        clientId?: string;
        clientSecret?: string;
        projectId?: string;
        port: string;
      },
    ) => {
      const provider = normalizeLLMProvider(providerName);

      if (provider !== "gemini") {
        throw new Error(`${provider} does not expose a public OAuth login flow for direct API usage`);
      }

      const credentialStore = resolveCredentialStore();

      if (!credentialStore.isSupported()) {
        throw new Error("Secure credential storage is required for OAuth login on this platform");
      }

      let authorizationUrl = "";
      let redirectUri = "";
      const credentials = await runGoogleOAuthInteractiveLogin({
        clientId: options.clientId ?? requireEnv("GOOGLE_CLIENT_ID"),
        clientSecret: options.clientSecret ?? requireEnv("GOOGLE_CLIENT_SECRET"),
        projectId: options.projectId ?? requireEnv("GOOGLE_CLOUD_PROJECT"),
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
    },
  );

program
  .command("auth:logout")
  .description("Delete stored OAuth credentials for a provider")
  .argument("<provider>", "Provider name")
  .option("--data-dir <path>", "Override application data directory")
  .action((providerName: string, options: { dataDir?: string }) => {
    const provider = normalizeLLMProvider(providerName);

    if (provider !== "gemini") {
      throw new Error(`${provider} does not have stored OAuth credentials in this CLI`);
    }

    const credentialStore = resolveCredentialStore();
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
  .command("serve")
  .description("Run a local HTTP ingest server for browser or desktop collectors")
  .option("--data-dir <path>", "Override application data directory")
  .option("--host <host>", "Host to bind", "127.0.0.1")
  .option("--port <port>", "Port to bind", "4318")
  .action(async (options: { dataDir?: string; host: string; port: string }) => {
    const server = await startIngestServer({
      dataDir: options.dataDir,
      host: options.host,
      port: Number.parseInt(options.port, 10),
    });

    console.log(
      JSON.stringify(
        {
          status: "listening",
          host: server.host,
          port: server.port,
          healthUrl: `http://${server.host}:${server.port}/health`,
          eventsUrl: `http://${server.host}:${server.port}/events`,
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
  });

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

await program.parseAsync(process.argv);
