import { execSync } from "node:child_process";
import { analyzeTripPdfUiSnapshot, summarizeBrowserErrors } from "../src/lib/trip-pdf/verification.js";

const DEFAULT_URL = "http://127.0.0.1:4174/trips/demo";
const browserCommandPrefix = process.env.AGENT_BROWSER_BIN ?? "npx --yes agent-browser";
const tripUrl = process.env.TRIP_VERIFY_URL ?? DEFAULT_URL;

function runBrowserCommand(args, { allowFailure = false } = {}) {
  const command = `${browserCommandPrefix} ${args}`;
  console.info("[trip-pdf:verify] Running browser command", { command });

  try {
    return execSync(command, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 1024 * 1024 * 5,
    });
  } catch (error) {
    const stdout = error?.stdout?.toString?.() ?? "";
    const stderr = error?.stderr?.toString?.() ?? "";
    const output = `${stdout}\n${stderr}`.trim();

    if (allowFailure) {
      return output;
    }

    console.error("[trip-pdf:verify] Browser command failed", {
      command,
      output,
    });
    throw error;
  }
}

function closeAllBrowserSessions() {
  runBrowserCommand("close --all", { allowFailure: true });
}

async function main() {
  const startedAt = new Date().toISOString();
  console.info("[trip-pdf:verify] Starting UI verification", {
    startedAt,
    tripUrl,
  });

  try {
    runBrowserCommand(`open ${tripUrl}`);
    runBrowserCommand("wait --load networkidle");

    const initialSnapshot = runBrowserCommand("snapshot -i");
    const initialState = analyzeTripPdfUiSnapshot(initialSnapshot);

    if (initialState.hasAuthGate) {
      console.error(
        "[trip-pdf:verify] Verification blocked by auth gate. Sign in first, then rerun with TRIP_VERIFY_URL set to a valid /trips/:tripId URL."
      );
      process.exitCode = 2;
      return;
    }

    if (!initialState.hasRequiredButtons) {
      throw new Error(
        "Trip header actions are missing. Expected both Download PDF and Print buttons."
      );
    }

    runBrowserCommand('find role button click --name "Download PDF"');
    runBrowserCommand("wait 1500");

    const afterDownloadSnapshot = runBrowserCommand("snapshot -i");
    const afterDownloadState = analyzeTripPdfUiSnapshot(afterDownloadSnapshot);
    if (!afterDownloadState.hasRequiredButtons) {
      throw new Error("Download action changed the UI unexpectedly.");
    }

    runBrowserCommand('find role button click --name "Print"');
    runBrowserCommand("wait 1000");
    runBrowserCommand("screenshot /tmp/trip-pdf-ui-verify.png", { allowFailure: true });

    const browserErrors = summarizeBrowserErrors(runBrowserCommand("errors", { allowFailure: true }));

    if (browserErrors.hasErrorEntries) {
      throw new Error(`Browser reported error logs: ${browserErrors.normalized}`);
    }

    console.info("[trip-pdf:verify] Verification completed successfully", {
      tripUrl,
      screenshot: "/tmp/trip-pdf-ui-verify.png",
    });
  } finally {
    closeAllBrowserSessions();
  }
}

main().catch((error) => {
  console.error("[trip-pdf:verify] Verification failed", {
    message: error instanceof Error ? error.message : String(error),
  });
  process.exitCode = 1;
});
