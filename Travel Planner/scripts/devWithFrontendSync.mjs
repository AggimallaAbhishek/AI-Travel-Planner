import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptFilePath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(scriptFilePath), "..");
const nodeExecutable = process.execPath;
const viteCliPath = path.join(projectRoot, "node_modules", "vite", "bin", "vite.js");

function logDebug(message, context = undefined) {
  if (context) {
    console.info("[dev-sync]", message, context);
    return;
  }

  console.info("[dev-sync]", message);
}

if (!existsSync(viteCliPath)) {
  throw new Error(
    `Unable to find Vite CLI at ${viteCliPath}. Run npm install before starting the dev server.`
  );
}

const syncProcess = spawn(
  nodeExecutable,
  ["./scripts/frontendBackupSync.mjs", "--watch", "--skip-initial-log"],
  {
    cwd: projectRoot,
    stdio: "inherit",
  }
);

const viteProcess = spawn(nodeExecutable, [viteCliPath], {
  cwd: projectRoot,
  stdio: "inherit",
});

logDebug("Started Vite and frontend backup watcher.");

function stopChildren(signalName) {
  logDebug("Stopping child processes", { signal: signalName });

  if (!syncProcess.killed) {
    syncProcess.kill("SIGTERM");
  }

  if (!viteProcess.killed) {
    viteProcess.kill("SIGTERM");
  }
}

process.on("SIGINT", () => {
  stopChildren("SIGINT");
  process.exit(0);
});

process.on("SIGTERM", () => {
  stopChildren("SIGTERM");
  process.exit(0);
});

viteProcess.on("exit", (code) => {
  logDebug("Vite process exited", { code });
  if (!syncProcess.killed) {
    syncProcess.kill("SIGTERM");
  }
  process.exit(code ?? 0);
});

syncProcess.on("exit", (code) => {
  logDebug("Frontend backup watcher exited", { code });
  if (code && code !== 0 && !viteProcess.killed) {
    viteProcess.kill("SIGTERM");
    process.exit(code);
  }
});
