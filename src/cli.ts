import { Command } from "commander";

const program = new Command();

program
  .name("what-ive-done")
  .description("Local workflow pattern analyzer CLI")
  .version("0.1.0");

program
  .command("doctor")
  .description("Validate local runtime prerequisites")
  .action(() => {
    const result = {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    };

    console.log(JSON.stringify(result, null, 2));
  });

await program.parseAsync(process.argv);
