import { Command } from "commander";

import { resolveAppPaths } from "./app-paths.js";
import { generateMockRawEvents } from "./collectors/mock.js";
import { analyzeRawEvents } from "./pipeline/analyze.js";
import { buildReportEntries, formatDuration } from "./reporting/report.js";
import { AppDatabase } from "./storage/database.js";

const program = new Command();

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
    };

    console.log(JSON.stringify(result, null, 2));
  });

program
  .command("init")
  .description("Initialize local application storage")
  .option("--data-dir <path>", "Override application data directory")
  .action((options: { dataDir?: string }) => {
    const paths = resolveAppPaths(options.dataDir);
    const database = new AppDatabase(paths);
    database.initialize();
    database.close();

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
    const database = new AppDatabase(resolveAppPaths(options.dataDir));
    database.initialize();

    const mockEvents = generateMockRawEvents();

    for (const event of mockEvents) {
      database.insertRawEvent(event);
    }

    database.close();

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
  .command("analyze")
  .description("Normalize events, build sessions, and detect workflows")
  .option("--data-dir <path>", "Override application data directory")
  .action((options: { dataDir?: string }) => {
    const database = new AppDatabase(resolveAppPaths(options.dataDir));
    database.initialize();

    const rawEvents = database.getRawEventsChronological();
    const analysisResult = analyzeRawEvents(rawEvents);

    database.replaceAnalysisArtifacts(analysisResult);
    database.close();

    console.log(
      JSON.stringify(
        {
          status: "analysis_completed",
          rawEvents: rawEvents.length,
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
  .command("report")
  .description("Show detected workflows")
  .option("--data-dir <path>", "Override application data directory")
  .option("--json", "Print machine-readable JSON")
  .action((options: { dataDir?: string; json?: boolean }) => {
    const database = new AppDatabase(resolveAppPaths(options.dataDir));
    database.initialize();
    const reportEntries = buildReportEntries(database.listWorkflowClusters());
    database.close();

    if (options.json) {
      console.log(JSON.stringify(reportEntries, null, 2));
      return;
    }

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
  });

program
  .command("reset")
  .description("Delete all locally stored events and analysis results")
  .option("--data-dir <path>", "Override application data directory")
  .action((options: { dataDir?: string }) => {
    const database = new AppDatabase(resolveAppPaths(options.dataDir));
    database.initialize();
    database.clearAllData();
    database.close();

    console.log(JSON.stringify({ status: "reset_completed" }, null, 2));
  });

await program.parseAsync(process.argv);
