import { Command } from "commander";

const program = new Command();

program
  .name("Godpherhack")
  .description("CLI Agent for CTF solving")
  .version("0.1.0")
  .option("-d, --challenge-dir <dir>", "Challenge working directory", process.cwd())
  .action(async (opts) => {
    const { startApp } = await import("./ui/App.js");
    await startApp({ challengeDir: opts.challengeDir });
  });

program
  .command("hub")
  .description("Start the Hub API server")
  .option("-p, --port <port>", "Port to listen on", "3000")
  .action(async (opts) => {
    const { startHub } = await import("./hub/index.js");
    await startHub({ port: Number(opts.port) });
  });

program.parse();
