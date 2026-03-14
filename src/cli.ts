import { Command } from "commander";

import { getAgentHealthReport, listLatestAgentSnapshots, runAgentOnce } from "./agent/control.js";
import { getAgentStatusSnapshot } from "./agent/state.js";
import { startAgentRuntime, stopAgentRuntime } from "./agent/runtime.js";
import { resolveAppPaths } from "./app-paths.js";
import { getAvailableCollectors } from "./collectors/index.js";
import { getMacOSActiveWindowCollectorInfo, resolveMacOSCollectorRunner } from "./collectors/macos.js";
import { getWindowsActiveWindowCollectorInfo } from "./collectors/windows.js";
import { resolveCredentialStore } from "./credentials/store.js";
import { generateMockRawEvents } from "./collectors/mock.js";
import { importEventsFromFile } from "./importers/events.js";
import { createOpenAIWorkflowAnalyzer } from "./llm/openai.js";
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
      averageDuration: formatDuration(entry.averageDurationSeconds),
      totalDuration: formatDuration(entry.totalDurationSeconds),
      automationSuitability: entry.automationSuitability,
      recommendation: entry.recommendedApproach,
    })),
  );
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
    renderReportTable(report.workflows);
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
  const useLegacyAllTimeOutput = (options.window ?? "all") === "all" && options.date === undefined;

  if (useLegacyAllTimeOutput) {
    if (json) {
      console.log(JSON.stringify(report.workflows, null, 2));
      return;
    }

    renderReportTable(report.workflows);
    return;
  }

  renderWindowedWorkflowReport(report, json);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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

function resolveOpenAIApiKey(): string {
  const credentialStore = resolveCredentialStore();
  const storedKey = credentialStore.getOpenAIKey();

  if (storedKey) {
    return storedKey;
  }

  return requireEnv("OPENAI_API_KEY");
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
      const result = analyzeRawEvents(rawEvents);

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
      const analysisResult = analyzeRawEvents(remainingRawEvents);

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
  .option("--provider <provider>", "LLM provider", "openai")
  .option("--model <model>", "Model name for the provider")
  .option("--base-url <url>", "Override provider base URL")
  .option("--include-excluded", "Include excluded workflows")
  .option("--include-hidden", "Include hidden workflows")
  .option("--apply-names", "Persist LLM workflow_name results as rename feedback")
  .option("--json", "Print machine-readable JSON")
  .action(
    async (options: {
      dataDir?: string;
      provider: string;
      model?: string;
      baseUrl?: string;
      includeExcluded?: boolean;
      includeHidden?: boolean;
      applyNames?: boolean;
      json?: boolean;
    }) => {
      if (options.provider !== "openai") {
        throw new Error(`Unsupported provider: ${options.provider}`);
      }

      const payloadRecords = withDatabase(options.dataDir, (database) =>
        database.listWorkflowSummaryPayloadRecords({
          includeExcluded: options.includeExcluded,
          includeHidden: options.includeHidden,
        }),
      );
      const analyzer = createOpenAIWorkflowAnalyzer({
        apiKey: resolveOpenAIApiKey(),
        model: options.model,
        baseUrl: options.baseUrl,
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
  .command("credential:status")
  .description("Show secure credential backend status")
  .action(() => {
    const credentialStore = resolveCredentialStore();

    console.log(
      JSON.stringify(
        {
          backend: credentialStore.backend,
          supported: credentialStore.isSupported(),
          hasOpenAIKey: credentialStore.hasOpenAIKey(),
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

    credentialStore.setOpenAIKey(resolvedApiKey);

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
    credentialStore.deleteOpenAIKey();

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
      const analysisResult = analyzeRawEvents(rawEvents);

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
