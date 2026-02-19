import { Command } from "commander";

const program = new Command();

program
  .name("Godpherhack")
  .description("CLI Agent for CTF solving")
  .version("0.1.0")
  .action(async () => {
    const { startApp } = await import("./ui/App.js");
    await startApp();
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
