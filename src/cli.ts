import { Command } from "commander";

const program = new Command();

program
  .name("godpherhack")
  .description("CLI-first team platform for CTF/educational environments")
  .version("0.1.0")
  .action(async () => {
    const { startApp } = await import("./ui/App.js");
    await startApp();
  });

program.parse();
