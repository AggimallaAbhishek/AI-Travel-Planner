import {
  buildFallbackGeneratedTrip,
  normalizeGeneratedTrip,
  normalizeUserSelection,
} from "../../shared/trips.js";
import {
  applyDeterministicTripRepairs,
  buildRepairDiff,
  evaluateTripConstraints,
} from "./constraints.js";
import { buildTripFusionIndex } from "./dataFusion.js";
import { generateTripPlan } from "./gemini.js";

const DEFAULT_FUSION_CONFIDENCE = 0.55;

function parseBooleanEnv(value) {
  if (value === undefined || value === null) {
    return false;
  }

  const normalized = String(value).trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

function resolveMinFusionConfidence() {
  const parsed = Number.parseFloat(process.env.MIN_FUSION_CONFIDENCE ?? "");

  if (Number.isFinite(parsed) && parsed > 0 && parsed < 1) {
    return parsed;
  }

  return DEFAULT_FUSION_CONFIDENCE;
}

export function isPlannerCriticRepairEnabled() {
  return parseBooleanEnv(process.env.FEATURE_PLANNER_CRITIC_REPAIR);
}

function buildSourceProvenanceFromFusion(fusionIndex) {
  if (!fusionIndex) {
    return {
      primaryProvider: "llm",
      sources: [],
      cache: {},
    };
  }

  return {
    primaryProvider: "fusion-index",
    sources: Array.isArray(fusionIndex.items)
      ? fusionIndex.items.slice(0, 12)
      : [],
    cache: {
      stats: fusionIndex.stats ?? {},
      generatedAt: fusionIndex.generatedAt ?? new Date().toISOString(),
    },
  };
}

function safeNormalizeTrip(trip, userSelection) {
  try {
    return normalizeGeneratedTrip(trip, { userSelection });
  } catch (error) {
    console.warn("[orchestration] Failed to normalize planner output; using fallback", {
      message: error instanceof Error ? error.message : String(error),
    });
    return buildFallbackGeneratedTrip(userSelection);
  }
}

export async function orchestrateTripGeneration({
  userSelection,
  planner = generateTripPlan,
  fusionIndexBuilder = buildTripFusionIndex,
  constraintEvaluator = evaluateTripConstraints,
  repairer = applyDeterministicTripRepairs,
  repairDiffBuilder = buildRepairDiff,
  minFusionConfidence = resolveMinFusionConfidence(),
} = {}) {
  const normalizedSelection = normalizeUserSelection(userSelection);
  const latencyBreakdownMs = {
    plan: 0,
    fusion: 0,
    critic: 0,
    repair: 0,
    optimize: 0,
    persist: 0,
  };

  let plannerOutput;
  const planStart = Date.now();
  try {
    plannerOutput = await planner(normalizedSelection);
  } catch (error) {
    console.error("[orchestration] Planner stage failed, returning fallback", {
      message: error instanceof Error ? error.message : String(error),
    });
    plannerOutput = buildFallbackGeneratedTrip(normalizedSelection);
  }
  latencyBreakdownMs.plan = Date.now() - planStart;

  const normalizedPlannerOutput = safeNormalizeTrip(
    plannerOutput,
    normalizedSelection
  );

  let fusionIndex = null;
  const fusionStart = Date.now();
  try {
    fusionIndex = fusionIndexBuilder
      ? fusionIndexBuilder({
          trip: {
            userSelection: normalizedSelection,
            ...normalizedPlannerOutput,
          },
          recommendations: {},
          transportSignals: [],
        })
      : null;
  } catch (error) {
    console.warn("[orchestration] Fusion index build failed", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
  latencyBreakdownMs.fusion = Date.now() - fusionStart;

  const sourceProvenance = buildSourceProvenanceFromFusion(fusionIndex);

  const runCritic = (trip) =>
    constraintEvaluator({
      generatedTrip: trip,
      userSelection: normalizedSelection,
      fusionIndex,
      minFusionConfidence,
    });

  let constraintReport;
  const criticStart = Date.now();
  constraintReport = runCritic(normalizedPlannerOutput);
  latencyBreakdownMs.critic = Date.now() - criticStart;

  let finalTrip = normalizedPlannerOutput;
  let repairDiff = { changed: false, removedActivities: [], addedActivities: [], unchangedActivityCount: 0 };

  if (!constraintReport.valid) {
    const repairStart = Date.now();
    const repairedTrip = repairer({
      generatedTrip: normalizedPlannerOutput,
      userSelection: normalizedSelection,
    });
    latencyBreakdownMs.repair = Date.now() - repairStart;
    repairDiff = repairDiffBuilder({ beforeTrip: normalizedPlannerOutput, afterTrip: repairedTrip });
    finalTrip = repairedTrip;

    const criticAfterRepairStart = Date.now();
    constraintReport = runCritic(repairedTrip);
    latencyBreakdownMs.critic += Date.now() - criticAfterRepairStart;
  }

  const llmArtifacts = {
    plannerOutput: normalizedPlannerOutput,
    criticReport: constraintReport,
    repairDiff,
  };

  console.info("[orchestration] Completed planner-critic-repair run", {
    valid: constraintReport.valid,
    hardViolations: constraintReport.hardViolations?.length ?? 0,
    softViolations: constraintReport.softViolations?.length ?? 0,
    fusionItems: fusionIndex?.items?.length ?? 0,
    latencyMs: latencyBreakdownMs,
  });

  return {
    generatedTrip: finalTrip,
    constraintReport,
    llmArtifacts,
    sourceProvenance,
    latencyBreakdownMs,
  };
}
