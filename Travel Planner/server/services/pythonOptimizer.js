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

function buildFallbackTransportOptimization(payload = {}) {
  return {
    algorithm: "node-fallback-multimodal",
    objective: normalizeText(payload.objective, "fastest_feasible"),
    origin_city_id: normalizeText(payload.originCityId),
    destination_city_ids: Array.isArray(payload.destinationCityIds)
      ? payload.destinationCityIds
          .map((value) => normalizeText(value))
          .filter(Boolean)
      : [],
    preferred_modes: Array.isArray(payload.preferredModes)
      ? payload.preferredModes
          .map((value) => normalizeText(value).toLowerCase())
          .filter(Boolean)
      : [],
    max_transfers: Number.isInteger(payload.maxTransfers)
      ? Math.max(0, payload.maxTransfers)
      : 4,
    top_k: Number.isInteger(payload.topK) ? Math.max(1, payload.topK) : 4,
    transportOptions: [],
    verification: {
      status: "unverified",
      provider: "none",
      confidence: 0,
      notes: ["Python multimodal optimizer was unavailable."],
    },
    notes: [
      "Python multimodal optimizer could not complete. Returning an empty transport option set.",
    ],
    graphMetrics: {
      city_count: 0,
      route_count: 0,
      hub_count: 0,
    },
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

function normalizeTransportSegment(segment = {}) {
  return {
    segment_index: Number.parseInt(segment.segment_index, 10) || 0,
    route_id: normalizeText(segment.route_id),
    source_city_id: normalizeText(segment.source_city_id),
    source_city_name: normalizeText(segment.source_city_name),
    destination_city_id: normalizeText(segment.destination_city_id),
    destination_city_name: normalizeText(segment.destination_city_name),
    mode: normalizeText(segment.mode).toLowerCase(),
    submode: normalizeText(segment.submode),
    duration_minutes: Number.parseInt(segment.duration_minutes, 10) || 0,
    distance_km:
      Number.parseFloat(segment.distance_km) > 0
        ? Number(Number.parseFloat(segment.distance_km).toFixed(2))
        : null,
    availability_status: normalizeText(segment.availability_status, "unknown"),
    cost_general:
      Number.isFinite(Number.parseFloat(segment.cost_general))
        ? Number(Number.parseFloat(segment.cost_general).toFixed(2))
        : null,
    cost_sleeper:
      Number.isFinite(Number.parseFloat(segment.cost_sleeper))
        ? Number(Number.parseFloat(segment.cost_sleeper).toFixed(2))
        : null,
    cost_ac3:
      Number.isFinite(Number.parseFloat(segment.cost_ac3))
        ? Number(Number.parseFloat(segment.cost_ac3).toFixed(2))
        : null,
    cost_ac2:
      Number.isFinite(Number.parseFloat(segment.cost_ac2))
        ? Number(Number.parseFloat(segment.cost_ac2).toFixed(2))
        : null,
    cost_ac1:
      Number.isFinite(Number.parseFloat(segment.cost_ac1))
        ? Number(Number.parseFloat(segment.cost_ac1).toFixed(2))
        : null,
    cost_is_estimated:
      String(segment.cost_is_estimated ?? "")
        .trim()
        .toLowerCase() === "true" || segment.cost_is_estimated === true,
    source_dataset: normalizeText(segment.source_dataset),
    source_quality: normalizeText(segment.source_quality, "medium"),
  };
}

function normalizeTransportOption(option = {}) {
  return {
    option_id: normalizeText(option.option_id),
    destination_city_id: normalizeText(option.destination_city_id),
    destination_city_name: normalizeText(option.destination_city_name),
    total_duration_minutes: Number.parseInt(option.total_duration_minutes, 10) || 0,
    total_distance_km:
      Number.isFinite(Number.parseFloat(option.total_distance_km))
        ? Number(Number.parseFloat(option.total_distance_km).toFixed(2))
        : null,
    transfer_count: Number.parseInt(option.transfer_count, 10) || 0,
    segment_count: Number.parseInt(option.segment_count, 10) || 0,
    mode_mix: Array.isArray(option.mode_mix)
      ? option.mode_mix
          .map((value) => normalizeText(value).toLowerCase())
          .filter(Boolean)
      : [],
    availability_status: normalizeText(option.availability_status, "unknown"),
    cost_general:
      Number.isFinite(Number.parseFloat(option.cost_general))
        ? Number(Number.parseFloat(option.cost_general).toFixed(2))
        : null,
    cost_sleeper:
      Number.isFinite(Number.parseFloat(option.cost_sleeper))
        ? Number(Number.parseFloat(option.cost_sleeper).toFixed(2))
        : null,
    cost_ac3:
      Number.isFinite(Number.parseFloat(option.cost_ac3))
        ? Number(Number.parseFloat(option.cost_ac3).toFixed(2))
        : null,
    cost_ac2:
      Number.isFinite(Number.parseFloat(option.cost_ac2))
        ? Number(Number.parseFloat(option.cost_ac2).toFixed(2))
        : null,
    cost_ac1:
      Number.isFinite(Number.parseFloat(option.cost_ac1))
        ? Number(Number.parseFloat(option.cost_ac1).toFixed(2))
        : null,
    cost_is_estimated:
      String(option.cost_is_estimated ?? "")
        .trim()
        .toLowerCase() === "true" || option.cost_is_estimated === true,
    source_quality: normalizeText(option.source_quality, "medium"),
    source_datasets: Array.isArray(option.source_datasets)
      ? option.source_datasets.map((value) => normalizeText(value)).filter(Boolean)
      : [],
    segments: Array.isArray(option.segments)
      ? option.segments.map((segment) => normalizeTransportSegment(segment))
      : [],
    last_mile:
      option.last_mile && typeof option.last_mile === "object"
        ? {
            destination_id: normalizeText(option.last_mile.destination_id),
            city_id: normalizeText(option.last_mile.city_id),
            hub_rank: Number.parseInt(option.last_mile.hub_rank, 10) || 0,
            access_distance_km:
              Number.isFinite(Number.parseFloat(option.last_mile.access_distance_km))
                ? Number(Number.parseFloat(option.last_mile.access_distance_km).toFixed(2))
                : null,
            access_duration_minutes:
              Number.parseInt(option.last_mile.access_duration_minutes, 10) || null,
            matching_method: normalizeText(option.last_mile.matching_method),
          }
        : null,
  };
}

function normalizeTransportOptimizerResult(result = {}) {
  return {
    algorithm: normalizeText(result.algorithm, "python-multimodal-dijkstra-v2"),
    objective: normalizeText(result.objective, "fastest_feasible"),
    origin_city_id: normalizeText(result.origin_city_id),
    origin_city_name: normalizeText(result.origin_city_name),
    destination_city_ids: Array.isArray(result.destination_city_ids)
      ? result.destination_city_ids.map((value) => normalizeText(value)).filter(Boolean)
      : [],
    top_k: Number.parseInt(result.top_k, 10) || 4,
    max_transfers: Number.parseInt(result.max_transfers, 10) || 4,
    preferred_modes: Array.isArray(result.preferred_modes)
      ? result.preferred_modes.map((value) => normalizeText(value).toLowerCase()).filter(Boolean)
      : [],
    transportOptions: Array.isArray(result.transportOptions)
      ? result.transportOptions.map((option) => normalizeTransportOption(option))
      : [],
    verification:
      result.verification && typeof result.verification === "object"
        ? {
            status: normalizeText(result.verification.status, "not_requested"),
            provider: normalizeText(result.verification.provider, "none"),
            confidence:
              Number.isFinite(Number.parseFloat(result.verification.confidence))
                ? Number(Number.parseFloat(result.verification.confidence).toFixed(2))
                : 0,
            notes: Array.isArray(result.verification.notes)
              ? result.verification.notes
                  .map((note) => normalizeText(note))
                  .filter(Boolean)
              : [],
          }
        : {
            status: "not_requested",
            provider: "none",
            confidence: 0,
            notes: [],
          },
    notes: Array.isArray(result.notes)
      ? result.notes.map((note) => normalizeText(note)).filter(Boolean)
      : [],
    graphMetrics:
      result.graphMetrics && typeof result.graphMetrics === "object"
        ? {
            city_count: Number.parseInt(result.graphMetrics.city_count, 10) || 0,
            route_count: Number.parseInt(result.graphMetrics.route_count, 10) || 0,
            hub_count: Number.parseInt(result.graphMetrics.hub_count, 10) || 0,
          }
        : {
            city_count: 0,
            route_count: 0,
            hub_count: 0,
          },
  };
}

async function runPythonOptimizer(
  payload = {},
  {
    timeoutMs: timeoutMsInput,
    traceId,
    label,
    fallbackBuilder,
    resultNormalizer,
  } = {}
) {
  const timeoutMs = parsePositiveInteger(
    timeoutMsInput ?? process.env.PYTHON_OPTIMIZER_TIMEOUT_MS,
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
        label,
        traceId: traceId ?? null,
      });
      resolve({
        ...fallbackBuilder(payload),
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
        label,
        traceId: traceId ?? null,
      });
      resolve({
        ...fallbackBuilder(payload),
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
          label,
          traceId: traceId ?? null,
        });
        resolve({
          ...fallbackBuilder(payload),
          warning: "Python optimizer failed to complete.",
        });
        return;
      }

      const parsed = parseJsonSafely(stdout);
      if (!parsed || typeof parsed !== "object") {
        console.warn("[optimizer] Python optimizer returned invalid JSON; falling back", {
          label,
          traceId: traceId ?? null,
        });
        resolve({
          ...fallbackBuilder(payload),
          warning: "Python optimizer returned invalid output.",
        });
        return;
      }

      if (parsed.error) {
        console.warn("[optimizer] Python optimizer returned error payload; falling back", {
          message: parsed.error,
          label,
          traceId: traceId ?? null,
        });
        resolve({
          ...fallbackBuilder(payload),
          warning: String(parsed.error),
        });
        return;
      }

      resolve(resultNormalizer(parsed));
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

export async function runPythonRouteOptimization(payload = {}, options = {}) {
  return runPythonOptimizer(payload, {
    timeoutMs: options.timeoutMs,
    traceId: options.traceId,
    label: "matrix",
    fallbackBuilder: buildFallbackOptimization,
    resultNormalizer: normalizeOptimizerResult,
  });
}

export async function runPythonTransportOptimization(payload = {}, options = {}) {
  return runPythonOptimizer(payload, {
    timeoutMs: options.timeoutMs,
    traceId: options.traceId,
    label: "multimodal",
    fallbackBuilder: buildFallbackTransportOptimization,
    resultNormalizer: normalizeTransportOptimizerResult,
  });
}
