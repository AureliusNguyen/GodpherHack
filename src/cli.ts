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

const authCmd = program.command("auth").description("Manage authentication with the Hub");

authCmd
  .command("login")
  .description("Sign in to the Hub via GitHub OAuth")
  .option("--hub <url>", "Hub base URL", process.env.HUB_BASE_URL ?? "http://localhost:3000")
  .action(async (opts) => {
    const { loginWithGithub } = await import("./client/auth-client.js");
    try {
      await loginWithGithub(opts.hub);
      console.log(`Logged in to ${opts.hub}`);
    } catch (err) {
      console.error(`Login failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exit(1);
    }
  });

authCmd
  .command("logout")
  .description("Clear stored credentials")
  .action(async () => {
    const { logout } = await import("./client/auth-client.js");
    logout();
    console.log("Logged out.");
  });

program.parse();
