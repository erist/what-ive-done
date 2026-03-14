import { Command } from "commander";

import { resolveAppPaths } from "./app-paths.js";
import { generateMockRawEvents } from "./collectors/mock.js";
import { analyzeRawEvents } from "./pipeline/analyze.js";
import { buildReportEntries, formatDuration } from "./reporting/report.js";
import { AppDatabase } from "./storage/database.js";

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

function renderReport(json = false, dataDir?: string): void {
  const reportEntries = withDatabase(dataDir, (database) =>
    buildReportEntries(database.listWorkflowClusters()),
  );

  if (json) {
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
    };

    console.log(JSON.stringify(result, null, 2));
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
  .command("report")
  .description("Show detected workflows")
  .option("--data-dir <path>", "Override application data directory")
  .option("--json", "Print machine-readable JSON")
  .action((options: { dataDir?: string; json?: boolean }) => {
    renderReport(options.json, options.dataDir);
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
