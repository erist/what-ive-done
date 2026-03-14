import { Command } from "commander";

import { resolveAppPaths } from "./app-paths.js";
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
    const database = new AppDatabase(resolveAppPaths(options.dataDir));
    database.initialize();
    database.close();

    console.log(
      JSON.stringify(
        {
          status: "initialized",
          databasePath: resolveAppPaths(options.dataDir).databasePath,
        },
        null,
        2,
      ),
    );
  });

await program.parseAsync(process.argv);
