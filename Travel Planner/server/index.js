import "dotenv/config";
import app from "./app.js";
import { getIndiaDataDiagnostics } from "./services/indiaData.js";
import { getPythonOptimizerReadiness } from "./services/pythonOptimizer.js";

function resolvePort(rawPort) {
  const parsedPort = Number.parseInt(rawPort ?? "", 10);

  if (Number.isInteger(parsedPort) && parsedPort > 0 && parsedPort <= 65535) {
    return parsedPort;
  }

  return 3001;
}

const port = resolvePort(process.env.PORT);

function logStartupDiagnostics() {
  try {
    const indiaDataDiagnostics = getIndiaDataDiagnostics();
    const optimizerReadiness = getPythonOptimizerReadiness();
    console.info("[server] Startup diagnostics", {
      indiaDataStatus: indiaDataDiagnostics.status,
      indiaDataWarnings: indiaDataDiagnostics.parityWarnings?.length ?? 0,
      optimizerStatus: optimizerReadiness.status,
      optimizerPathExists: optimizerReadiness.optimizerPathExists,
    });
  } catch (error) {
    console.warn("[server] Startup diagnostics unavailable", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

app.listen(port, () => {
  logStartupDiagnostics();
  console.info("[server] Travel Planner API listening", {
    port,
    nodeEnv: process.env.NODE_ENV ?? "development",
  });
});
