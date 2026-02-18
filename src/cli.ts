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

program.parse();
