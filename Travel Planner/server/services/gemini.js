import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  buildFallbackGeneratedTrip,
  buildTripPrompt,
  normalizeTripObjective,
  normalizeUserSelection,
  normalizeGeneratedTrip,
  parseAiTripPayload,
} from "../../shared/trips.js";
import {
  applyDeterministicTripRepairs,
  buildRepairDiff,
  evaluateTripConstraints,
} from "./constraints.js";
import { buildTripFusionIndex, findLowConfidenceActivities } from "./dataFusion.js";
import { getRecommendationsForDestination } from "./recommendations.js";
import { listDestinationPois } from "./worldPoiIndex.js";

let model;
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_RETRIES = 1;
const DEFAULT_FUSION_TIMEOUT_MS = 5_000;
const DEFAULT_MIN_FUSION_CONFIDENCE = 0.55;

export function resolveGeminiApiKey() {
  return process.env.GOOGLE_GEMINI_API_KEY ?? process.env.GEMINI_API_KEY ?? "";
}

export function resolveGeminiModelName() {
  return process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL;
}

function resolveGeminiTimeoutMs() {
  const timeoutMs = Number.parseInt(process.env.GEMINI_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(timeoutMs) && timeoutMs >= 5_000
    ? timeoutMs
    : DEFAULT_TIMEOUT_MS;
}

function resolveGeminiMaxRetries() {
  const retries = Number.parseInt(process.env.GEMINI_MAX_RETRIES ?? "", 10);
  return Number.isFinite(retries) && retries >= 0 && retries <= 3
    ? retries
    : DEFAULT_MAX_RETRIES;
}

function resolveFusionTimeoutMs() {
  const timeoutMs = Number.parseInt(process.env.FUSION_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(timeoutMs) && timeoutMs >= 1_500
    ? timeoutMs
    : DEFAULT_FUSION_TIMEOUT_MS;
}

function resolveMinFusionConfidence() {
  const confidence = Number.parseFloat(
    process.env.MIN_FUSION_CONFIDENCE ?? ""
  );
  return Number.isFinite(confidence) && confidence >= 0 && confidence <= 1
    ? confidence
    : DEFAULT_MIN_FUSION_CONFIDENCE;
}

function getGeminiModel() {
  if (!model) {
    const apiKey = resolveGeminiApiKey();

    if (!apiKey) {
      throw new Error("Missing GOOGLE_GEMINI_API_KEY for the server.");
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const selectedModel = resolveGeminiModelName();

    console.info("[gemini] Initializing model", { model: selectedModel });
    model = genAI.getGenerativeModel({
      model: selectedModel,
    });
  }

  return model;
}

function withTimeout(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Gemini request timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    promise
      .then(resolve)
      .catch(reject)
      .finally(() => clearTimeout(timeout));
  });
}

function normalizeText(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed || fallback;
}

function normalizeStringArray(values = [], maxItems = 32) {
  if (!Array.isArray(values)) {
    return [];
  }

  const items = [];
  const seen = new Set();

  for (const value of values) {
    const text = normalizeText(String(value ?? ""));
    if (!text) {
      continue;
    }

    const key = text.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    items.push(text);
    seen.add(key);

    if (items.length >= maxItems) {
      break;
    }
  }

  return items;
}

function buildCriticPrompt({
  userSelection,
  plannerOutput,
  deterministicReport,
  lowConfidenceActivities,
}) {
  return `You are the Critic in a planner-critic-repair travel system.

Analyze the proposed plan strictly against hard constraints and return JSON only.

User constraints:
${JSON.stringify(userSelection, null, 2)}

Planner proposal:
${JSON.stringify(plannerOutput, null, 2)}

Deterministic validator report:
${JSON.stringify(deterministicReport, null, 2)}

Low-confidence activities from fusion index:
${JSON.stringify(lowConfidenceActivities, null, 2)}

Return JSON only with this exact schema:
{
  "hard_violations": ["string"],
  "soft_violations": ["string"],
  "repair_instructions": ["string"],
  "verdict": "pass|repair"
}

Rules:
- hard_violations must list only objective constraint failures.
- soft_violations can include quality/style issues.
- repair_instructions must be concrete, minimal, and actionable.
- Keep each list concise (max 10 items).`;
}

function buildRepairPrompt({
  userSelection,
  plannerOutput,
  criticReport,
}) {
  return `You are the Repair model in a planner-critic-repair travel system.

Rewrite only the minimum required portions of the plan to satisfy hard constraints and reduce soft violations.
Keep destination and overall trip style consistent.
Return strict JSON only (no markdown).

User constraints:
${JSON.stringify(userSelection, null, 2)}

Existing plan:
${JSON.stringify(plannerOutput, null, 2)}

Critic report:
${JSON.stringify(criticReport, null, 2)}

JSON schema:
{
  "destination": "string",
  "days": [
    {
      "day": 1,
      "title": "string",
      "activities": ["string"],
      "estimated_cost": "string",
      "tips": "string"
    }
  ],
  "total_estimated_cost": "string",
  "travel_tips": ["string"]
}

Rules:
- Preserve unchanged days where possible.
- Ensure day count equals requested duration.
- Keep 3-5 activities per day.
- Respect objective and constraint fields.`;
}

function normalizeCriticReport(raw = {}) {
  const hardViolations = normalizeStringArray(
    raw?.hard_violations ?? raw?.hardViolations ?? []
  );
  const softViolations = normalizeStringArray(
    raw?.soft_violations ?? raw?.softViolations ?? []
  );
  const repairInstructions = normalizeStringArray(
    raw?.repair_instructions ?? raw?.repairInstructions ?? []
  );
  const verdict = normalizeText(raw?.verdict, "repair").toLowerCase();

  return {
    hardViolations,
    softViolations,
    repairInstructions,
    verdict: verdict === "pass" ? "pass" : "repair",
  };
}

function mergeUniqueMessages(...messageGroups) {
  const merged = [];
  const seen = new Set();

  for (const group of messageGroups) {
    for (const message of normalizeStringArray(group ?? [], 64)) {
      const key = message.toLowerCase();
      if (seen.has(key)) {
        continue;
      }

      merged.push(message);
      seen.add(key);
    }
  }

  return merged;
}

async function requestGeminiJson({
  prompt,
  timeoutMs,
  temperature = 0.5,
  maxOutputTokens = 3072,
}) {
  const result = await withTimeout(
    getGeminiModel().generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature,
        topP: 0.9,
        topK: 32,
        maxOutputTokens,
        responseMimeType: "application/json",
      },
    }),
    timeoutMs
  );

  return parseAiTripPayload(result.response.text());
}

async function loadFusionRecommendationsWithTimeout({
  destination,
  userSelection,
}) {
  const fusionTimeoutMs = resolveFusionTimeoutMs();

  try {
    const recommendations = await withTimeout(
      getRecommendationsForDestination({
        destination,
        userSelection,
      }),
      fusionTimeoutMs
    );
    return recommendations;
  } catch (error) {
    console.warn("[gemini] Fusion recommendation lookup failed", {
      destination,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function generateTripPlan(userSelection) {
  const startedAt = Date.now();
  const normalizedSelection = normalizeUserSelection(userSelection);
  const prompt = buildTripPrompt(normalizedSelection);
  const timeoutMs = resolveGeminiTimeoutMs();
  const maxAttempts = resolveGeminiMaxRetries() + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const latencyBreakdownMs = {
      planner: 0,
      critic: 0,
      repair: 0,
      fusion: 0,
      optimize: 0,
      persist: 0,
      total: 0,
    };

    try {
      console.info("[gemini] Trip generation attempt started", {
        attempt,
        maxAttempts,
        timeoutMs,
        objective: normalizeTripObjective(normalizedSelection.objective),
      });

      const plannerStartedAt = Date.now();
      const plannerRaw = await requestGeminiJson({
        prompt,
        timeoutMs,
        temperature: 0.6,
      });
      latencyBreakdownMs.planner = Date.now() - plannerStartedAt;
      const plannerNormalized = normalizeGeneratedTrip(plannerRaw, {
        userSelection: normalizedSelection,
      });
      const deterministicRepaired = applyDeterministicTripRepairs({
        generatedTrip: plannerNormalized,
        userSelection: normalizedSelection,
      });

      const fusionStartedAt = Date.now();
      const fusionDestination =
        deterministicRepaired?.aiPlan?.destination ??
        normalizedSelection.location.label;
      const fusionRecommendations = await loadFusionRecommendationsWithTimeout({
        destination: fusionDestination,
        userSelection: normalizedSelection,
      });
      const worldPoiItems = await listDestinationPois({
        destination: fusionDestination,
        limit: 24,
      }).catch((error) => {
        console.warn("[gemini] World POI index lookup failed", {
          destination: fusionDestination,
          message: error instanceof Error ? error.message : String(error),
        });
        return [];
      });
      latencyBreakdownMs.fusion = Date.now() - fusionStartedAt;
      const fusionIndex = buildTripFusionIndex({
        trip: deterministicRepaired,
        recommendations: fusionRecommendations ?? {},
        worldPoiItems,
      });
      const lowConfidenceActivities = findLowConfidenceActivities({
        trip: deterministicRepaired,
        fusionIndex,
        minConfidence: resolveMinFusionConfidence(),
      });
      const deterministicReport = evaluateTripConstraints({
        generatedTrip: deterministicRepaired,
        userSelection: normalizedSelection,
        fusionIndex,
        minFusionConfidence: resolveMinFusionConfidence(),
      });

      const criticStartedAt = Date.now();
      const criticRaw = await requestGeminiJson({
        prompt: buildCriticPrompt({
          userSelection: normalizedSelection,
          plannerOutput: deterministicRepaired.aiPlan,
          deterministicReport,
          lowConfidenceActivities,
        }),
        timeoutMs: Math.max(6_000, Math.floor(timeoutMs * 0.75)),
        temperature: 0.2,
        maxOutputTokens: 2048,
      });
      latencyBreakdownMs.critic = Date.now() - criticStartedAt;
      const criticReport = normalizeCriticReport(criticRaw);

      const shouldRepair =
        deterministicReport.hardViolations.length > 0 ||
        criticReport.hardViolations.length > 0 ||
        criticReport.verdict === "repair";

      let finalPlan = deterministicRepaired;
      let repairDiff = {
        changed: false,
        removedActivities: [],
        addedActivities: [],
        unchangedActivityCount: 0,
      };

      if (shouldRepair) {
        const repairStartedAt = Date.now();
        const repairedRaw = await requestGeminiJson({
          prompt: buildRepairPrompt({
            userSelection: normalizedSelection,
            plannerOutput: deterministicRepaired.aiPlan,
            criticReport,
          }),
          timeoutMs: Math.max(7_000, Math.floor(timeoutMs * 0.85)),
          temperature: 0.35,
        });
        latencyBreakdownMs.repair = Date.now() - repairStartedAt;

        const repairedNormalized = normalizeGeneratedTrip(repairedRaw, {
          userSelection: normalizedSelection,
        });
        finalPlan = applyDeterministicTripRepairs({
          generatedTrip: repairedNormalized,
          userSelection: normalizedSelection,
        });
        repairDiff = buildRepairDiff({
          beforeTrip: deterministicRepaired,
          afterTrip: finalPlan,
        });
      }

      const finalConstraintReport = evaluateTripConstraints({
        generatedTrip: finalPlan,
        userSelection: normalizedSelection,
        fusionIndex,
        minFusionConfidence: resolveMinFusionConfidence(),
      });
      const mergedHardViolations = mergeUniqueMessages(
        finalConstraintReport.hardViolations,
        criticReport.hardViolations
      );
      const mergedSoftViolations = mergeUniqueMessages(
        finalConstraintReport.softViolations,
        criticReport.softViolations,
        lowConfidenceActivities.map(
          (activity) =>
            `${activity.name} (day ${activity.dayNumber ?? "?"}) has low fusion confidence`
        )
      );
      const durationMs = Date.now() - startedAt;
      latencyBreakdownMs.total = durationMs;
      const sourceProvenance = {
        primaryProvider: fusionRecommendations?.provider ?? "itinerary",
        sources: [
          {
            provider: "gemini",
            sourceType: "llm",
            fetchedAt: new Date().toISOString(),
          },
          ...(fusionRecommendations
            ? [
                {
                  provider: fusionRecommendations.provider,
                  sourceType: "destination-data",
                  fetchedAt: fusionRecommendations.fetchedAt,
                },
              ]
            : []),
        ],
        cache: {
          status: fusionRecommendations?.sourceProvenance?.cache?.status ?? "miss",
        },
      };

      console.info("[gemini] Trip plan generated", {
        attempt,
        durationMs,
        dayCount: finalPlan.aiPlan?.days?.length ?? 0,
        hardViolations: mergedHardViolations.length,
        repaired: shouldRepair,
      });

      return {
        ...finalPlan,
        llmArtifacts: {
          planner_output: plannerRaw,
          critic_report: criticReport,
          repair_diff: repairDiff,
          low_confidence_activities: lowConfidenceActivities,
        },
        optimizationMeta: {
          objective: normalizeTripObjective(normalizedSelection.objective),
          alternativesCount: normalizedSelection.alternativesCount,
          method: "planner-critic-repair-v1",
          generatedAt: new Date().toISOString(),
          constraints: normalizedSelection.constraints,
        },
        constraintReport: {
          valid: mergedHardViolations.length === 0,
          hardViolations: mergedHardViolations,
          softViolations: mergedSoftViolations,
          stats: finalConstraintReport.stats,
        },
        sourceProvenance,
        latencyBreakdownMs,
      };
    } catch (error) {
      const retryable = attempt < maxAttempts;
      console.error("[gemini] Trip generation attempt failed", {
        attempt,
        maxAttempts,
        retryable,
        errorMessage: error instanceof Error ? error.message : String(error),
      });

      if (!retryable) {
        break;
      }
    }
  }

  console.warn("[gemini] Returning fallback trip plan after model failure");
  const fallback = buildFallbackGeneratedTrip(normalizedSelection);
  const durationMs = Date.now() - startedAt;

  return {
    ...fallback,
    llmArtifacts: {
      planner_output: null,
      critic_report: null,
      repair_diff: null,
      low_confidence_activities: [],
    },
    optimizationMeta: {
      objective: normalizeTripObjective(normalizedSelection.objective),
      alternativesCount: normalizedSelection.alternativesCount,
      method: "fallback",
      generatedAt: new Date().toISOString(),
      constraints: normalizedSelection.constraints,
    },
    constraintReport: {
      valid: false,
      hardViolations: ["Returned fallback itinerary because all model attempts failed."],
      softViolations: [],
      stats: {},
    },
    sourceProvenance: {
      primaryProvider: "fallback",
      sources: [
        {
          provider: "fallback",
          sourceType: "generated",
          fetchedAt: new Date().toISOString(),
        },
      ],
      cache: {
        status: "miss",
      },
    },
    latencyBreakdownMs: {
      planner: durationMs,
      critic: 0,
      repair: 0,
      fusion: 0,
      optimize: 0,
      persist: 0,
      total: durationMs,
    },
  };
}
