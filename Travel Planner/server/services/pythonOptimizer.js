import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_TIMEOUT_MS = 10_000;

function normalizeText(value) {
  return String(value ?? "").trim();
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }

  return fallback;
}

function resolvePythonBin() {
  return normalizeText(process.env.PYTHON_BIN) || "python3";
}

function resolveRouteOptimizerPath() {
  const configuredPath = normalizeText(process.env.PYTHON_ROUTE_OPTIMIZER_PATH);
  if (configuredPath) {
    return configuredPath;
  }

  const currentFilePath = fileURLToPath(import.meta.url);
  const currentDirPath = path.dirname(currentFilePath);
  return path.resolve(currentDirPath, "../../../route_optimizer.py");
}

function parseJsonSafely(value) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch (_error) {
    return null;
  }
}

function computePathWeight(matrix = [], order = []) {
  let totalWeight = 0;
  for (let i = 0; i < order.length - 1; i += 1) {
    const fromIndex = order[i];
    const toIndex = order[i + 1];
    const weight = Number.parseFloat(matrix[fromIndex]?.[toIndex]);
    if (!Number.isFinite(weight)) {
      return Number.POSITIVE_INFINITY;
    }

    totalWeight += weight;
  }

  return totalWeight;
}

function buildFallbackOptimization(payload = {}) {
  const matrix = Array.isArray(payload.matrix) ? payload.matrix : [];
  const nodeCount = matrix.length;
  const originIndex = Number.isInteger(payload.originIndex) ? payload.originIndex : 0;
  const unvisited = new Set(Array.from({ length: nodeCount }, (_unused, index) => index));
  unvisited.delete(originIndex);

  const visitOrder = [originIndex];
  let current = originIndex;

  while (unvisited.size > 0) {
    let nextNode = null;
    let nextWeight = Number.POSITIVE_INFINITY;

    for (const candidate of unvisited) {
      const candidateWeight = Number.parseFloat(matrix[current]?.[candidate]);
      if (Number.isFinite(candidateWeight) && candidateWeight < nextWeight) {
        nextNode = candidate;
        nextWeight = candidateWeight;
      }
    }

    if (!Number.isInteger(nextNode)) {
      break;
    }

    visitOrder.push(nextNode);
    unvisited.delete(nextNode);
    current = nextNode;
  }

  return {
    algorithm: "node-fallback-nearest-neighbor",
    visitOrder,
    totalWeight: computePathWeight(matrix, visitOrder),
    shortestPathsFromOrigin: [],
    previous: [],
    mst: {
      totalWeight: 0,
      edges: [],
    },
    clusters: [],
    clusterAssignments: {},
    dayPlans: [],
    engine: "node-fallback",
  };
}

function normalizeOptimizerResult(result = {}) {
  const visitOrder = Array.isArray(result.visitOrder)
    ? result.visitOrder.filter((value) => Number.isInteger(value))
    : [];

  return {
    algorithm: normalizeText(result.algorithm) || "python-nearest-neighbor-2opt",
    visitOrder,
    totalWeight: Number.parseFloat(result.totalWeight) || 0,
    shortestPathsFromOrigin: Array.isArray(result.shortestPathsFromOrigin)
      ? result.shortestPathsFromOrigin
      : [],
    previous: Array.isArray(result.previous) ? result.previous : [],
    mst: result.mst && typeof result.mst === "object" ? result.mst : { totalWeight: 0, edges: [] },
    clusters: Array.isArray(result.clusters) ? result.clusters : [],
    clusterAssignments:
      result.clusterAssignments && typeof result.clusterAssignments === "object"
        ? result.clusterAssignments
        : {},
    dayPlans: Array.isArray(result.dayPlans) ? result.dayPlans : [],
  };
}

export async function runPythonRouteOptimization(payload = {}, options = {}) {
  const timeoutMs = parsePositiveInteger(
    options.timeoutMs ?? process.env.PYTHON_OPTIMIZER_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS
  );
  const optimizerPath = resolveRouteOptimizerPath();
  const pythonBin = resolvePythonBin();

  return new Promise((resolve) => {
    const child = spawn(pythonBin, [optimizerPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      child.kill("SIGKILL");
      console.warn("[optimizer] Python optimizer timed out; falling back to JS optimizer", {
        timeoutMs,
        traceId: options.traceId ?? null,
      });
      resolve({
        ...buildFallbackOptimization(payload),
        warning: `Python optimizer timed out after ${timeoutMs}ms.`,
      });
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      console.warn("[optimizer] Python optimizer could not start; falling back", {
        message: error instanceof Error ? error.message : String(error),
        traceId: options.traceId ?? null,
      });
      resolve({
        ...buildFallbackOptimization(payload),
        warning: "Python optimizer process failed to start.",
      });
    });

    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);

      if (code !== 0) {
        console.warn("[optimizer] Python optimizer exited with non-zero code; falling back", {
          code,
          stderr: stderr.slice(0, 500),
          traceId: options.traceId ?? null,
        });
        resolve({
          ...buildFallbackOptimization(payload),
          warning: "Python optimizer failed to complete.",
        });
        return;
      }

      const parsed = parseJsonSafely(stdout);
      if (!parsed || typeof parsed !== "object") {
        console.warn("[optimizer] Python optimizer returned invalid JSON; falling back", {
          traceId: options.traceId ?? null,
        });
        resolve({
          ...buildFallbackOptimization(payload),
          warning: "Python optimizer returned invalid output.",
        });
        return;
      }

      if (parsed.error) {
        console.warn("[optimizer] Python optimizer returned error payload; falling back", {
          message: parsed.error,
          traceId: options.traceId ?? null,
        });
        resolve({
          ...buildFallbackOptimization(payload),
          warning: String(parsed.error),
        });
        return;
      }

      resolve(normalizeOptimizerResult(parsed));
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

