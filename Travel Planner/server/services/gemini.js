import { GoogleGenerativeAI } from "@google/generative-ai";
import { parseAiTripPayload } from "../../shared/trips.js";
import { incrementPlanningMetric } from "../lib/planningMetrics.js";

let model;
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_ROUTE_VERIFICATION_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_RETRIES = 1;

function normalizeText(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized || fallback;
}

function normalizeTips(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => normalizeText(String(item ?? "")))
    .filter(Boolean)
    .slice(0, 4);
}

function parseBoolean(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }

  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return fallback;
  }

  return normalized === "1" || normalized === "true" || normalized === "yes";
}

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

function resolveGeminiRouteVerificationEnabled() {
  return parseBoolean(process.env.TRANSPORT_GEMINI_VERIFICATION_ENABLED, true);
}

function resolveGeminiRouteVerificationTimeoutMs() {
  const timeoutMs = Number.parseInt(
    process.env.GEMINI_ROUTE_VERIFICATION_TIMEOUT_MS ?? "",
    10
  );
  return Number.isFinite(timeoutMs) && timeoutMs >= 2_000
    ? timeoutMs
    : DEFAULT_ROUTE_VERIFICATION_TIMEOUT_MS;
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

function buildTemplateNarrativeDays(groundedPlan = {}) {
  const destination = normalizeText(groundedPlan.destination, "your destination");

  return (groundedPlan.days ?? []).map((day, index) => ({
    day: Number.parseInt(day?.day, 10) || index + 1,
    title:
      normalizeText(day?.title) ||
      `Day ${Number.parseInt(day?.day, 10) || index + 1} in ${destination}`,
    summary:
      normalizeText(day?.summary) ||
      (Array.isArray(day?.places) && day.places.length > 0
        ? `This day uses verified stops and a practical route through ${destination}.`
        : "Data not available"),
    tips:
      normalizeTips(day?.tips).length > 0
        ? normalizeTips(day?.tips)
        : [
            "Follow the verified stop order to reduce unnecessary transit time.",
            "Use the saved map links and booking details before heading out.",
          ],
  }));
}

function normalizeNarrativePayload(payload = {}, groundedPlan = {}) {
  const fallbackDays = buildTemplateNarrativeDays(groundedPlan);
  const rawDays = Array.isArray(payload?.days) ? payload.days : [];

  return {
    days: fallbackDays.map((fallbackDay, index) => {
      const matchingDay =
        rawDays.find(
          (candidate) =>
            Number.parseInt(candidate?.day, 10) === fallbackDay.day
        ) ?? rawDays[index] ?? {};

      return {
        day: fallbackDay.day,
        title: normalizeText(matchingDay?.title, fallbackDay.title),
        summary: normalizeText(matchingDay?.summary, fallbackDay.summary),
        tips:
          normalizeTips(matchingDay?.tips).length > 0
            ? normalizeTips(matchingDay?.tips)
            : fallbackDay.tips,
      };
    }),
  };
}

function isNarrativePayloadValid(narrative = {}, groundedPlan = {}) {
  if (!Array.isArray(narrative?.days)) {
    return false;
  }

  if (narrative.days.length !== (groundedPlan.days ?? []).length) {
    return false;
  }

  return narrative.days.every((day, index) => {
    const groundedDay = groundedPlan.days?.[index];
    if (!groundedDay) {
      return false;
    }

    return (
      Number.parseInt(day.day, 10) === Number.parseInt(groundedDay.day, 10) &&
      Boolean(normalizeText(day.title)) &&
      Boolean(normalizeText(day.summary)) &&
      Array.isArray(day.tips) &&
      day.tips.length > 0
    );
  });
}

function buildPromptDay(day = {}) {
  return {
    day: day.day,
    places: (day.places ?? []).map((place) => ({
      id: place.id,
      name: place.name,
      category: place.category,
      description: place.description || "Data not available",
      travel_time_from_previous_minutes:
        place.travelTimeFromPreviousMinutes ?? 0,
    })),
    restaurants: (day.restaurants ?? []).map((restaurant) => ({
      id: restaurant.id,
      name: restaurant.name,
      food_tags:
        Array.isArray(restaurant.foodTags) && restaurant.foodTags.length > 0
          ? restaurant.foodTags
          : ["Data not available"],
    })),
    hotels: (day.hotels ?? []).map((hotel) => ({
      id: hotel.id,
      name: hotel.name,
      distance_to_cluster_m:
        hotel.distanceToClusterMeters ?? "Data not available",
    })),
    route: Array.isArray(day.route) ? day.route : [],
    estimated_time_minutes: day.estimatedTimeMinutes ?? 0,
    estimated_cost_amount: day.estimatedCostAmount ?? 0,
  };
}

export function buildGroundedNarrativePrompt({
  planningRequest,
  groundedPlan,
}) {
  const stay = planningRequest.selection?.accommodation || planningRequest.accommodation;
  const logistics = planningRequest.selection?.logistics || planningRequest.logistics;
  const hasStay = Boolean(stay);
  const hasLogistics = Boolean(logistics);

  const payload = {
    trip_request: {
      destination: planningRequest.destination,
      days: planningRequest.days,
      budget_amount: planningRequest.budgetAmount,
      travel_style: planningRequest.travelStyle,
      pace: planningRequest.pace,
      food_preferences: planningRequest.foodPreferences,
      accommodation: hasStay ? stay : "Not specified",
      arrival_and_departure: hasLogistics ? logistics : "Not specified",
    },
    planned_days: (groundedPlan.days ?? []).map((day) => buildPromptDay(day)),
  };

  const extraConstraints = [];
  if (hasStay) {
    extraConstraints.push(`- Incorporate the travel accommodation (${stay}) into the daily summaries (e.g. starting the day or returning to the hotel).`);
    extraConstraints.push(`- Suggest 1 or 2 walkable distance places near the accommodation (${stay}) in your tips.`);
  }
  if (hasLogistics) {
    extraConstraints.push(`- For Day 1, strictly incorporate Arrival Logistics: ${logistics}.`);
    extraConstraints.push(`- For the final Day, strictly incorporate Departure Logistics: ${logistics}.`);
  }

  return `You are a travel itinerary narrator.

You must ONLY use the provided JSON data for the main itinerary.
Do NOT invent, rename, infer, or substitute hotels, restaurants, attractions, routes, prices, durations, or neighborhoods in the 'summary'.
If any field is missing, return "Data not available".
Do NOT change the stop order.
Exception: You may suggest new walkable places strictly in the 'tips' section if an accommodation is provided.
Return valid JSON only.

INPUT:
${JSON.stringify(payload, null, 2)}


TASK:
For each day, write:
- "title": concise grounded title
- "summary": 2-3 sentences using only provided facts. 
- "tips": 2-4 practical tips using only provided facts
${extraConstraints.join("\n")}

OUTPUT:
{
  "days": [
    {
      "day": 1,
      "title": "",
      "summary": "",
      "tips": []
    }
  ]
}`;
}

async function requestGeminiNarrative(prompt, timeoutMs) {
  return withTimeout(
    getGeminiModel().generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.15,
        topP: 0.1,
        topK: 1,
        maxOutputTokens: 1536,
        responseMimeType: "application/json",
      },
    }),
    timeoutMs
  );
}

export async function generateGroundedNarrative({
  planningRequest,
  groundedPlan,
  traceId = "",
}) {
  const fallback = {
    days: buildTemplateNarrativeDays(groundedPlan),
    source: "template",
    discardedReason: "",
  };

  if (!resolveGeminiApiKey()) {
    console.warn("[gemini] Narrative generation skipped; missing API key", {
      traceId: traceId || null,
    });
    incrementPlanningMetric("narrative_template_used", {
      reason: "missing_api_key",
    });
    return {
      ...fallback,
      discardedReason: "missing_api_key",
    };
  }

  const timeoutMs = resolveGeminiTimeoutMs();
  const maxAttempts = resolveGeminiMaxRetries() + 1;
  const prompt = buildGroundedNarrativePrompt({
    planningRequest,
    groundedPlan,
  });

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      console.info("[gemini] Grounded narrative attempt started", {
        attempt,
        maxAttempts,
        traceId: traceId || null,
      });
      const result = await requestGeminiNarrative(prompt, timeoutMs);
      const parsed = parseAiTripPayload(result.response.text());
      const narrative = normalizeNarrativePayload(parsed, groundedPlan);

      if (!isNarrativePayloadValid(narrative, groundedPlan)) {
        throw new Error("Grounded narrative payload did not satisfy validation.");
      }

      console.info("[gemini] Grounded narrative accepted", {
        attempt,
        dayCount: narrative.days.length,
        traceId: traceId || null,
      });
      incrementPlanningMetric("narrative_accepted", {
        source: "gemini",
      });

      return {
        ...narrative,
        source: "gemini",
        discardedReason: "",
      };
    } catch (error) {
      const retryable = attempt < maxAttempts;
      console.warn("[gemini] Grounded narrative rejected", {
        attempt,
        retryable,
        message: error instanceof Error ? error.message : String(error),
        traceId: traceId || null,
      });
      incrementPlanningMetric("narrative_rejected", {
        retryable: retryable ? "yes" : "no",
      });

      if (!retryable) {
        incrementPlanningMetric("narrative_template_used", {
          reason: "invalid_or_failed_response",
        });
        return {
          ...fallback,
          discardedReason: "invalid_or_failed_response",
        };
      }
    }
  }

  return {
    ...fallback,
    discardedReason: "unexpected_fallback",
  };
}

function buildRouteVerificationPrompt({
  originCityName = "",
  destinationLabel = "",
  options = [],
}) {
  const payload = {
    origin: originCityName,
    destination: destinationLabel,
    candidate_options: options.map((option) => ({
      option_id: option.option_id,
      total_duration_minutes: option.total_duration_minutes,
      total_distance_km: option.total_distance_km,
      transfer_count: option.transfer_count,
      mode_mix: option.mode_mix,
      availability_status: option.availability_status,
      source_quality: option.source_quality,
      last_mile: option.last_mile ?? null,
      segments: Array.isArray(option.segments)
        ? option.segments.map((segment) => ({
            route_id: segment.route_id,
            source_city_name: segment.source_city_name,
            destination_city_name: segment.destination_city_name,
            mode: segment.mode,
            submode: segment.submode,
            duration_minutes: segment.duration_minutes,
            distance_km: segment.distance_km,
            availability_status: segment.availability_status,
            source_quality: segment.source_quality,
          }))
        : [],
    })),
  };

  return `You are validating multimodal travel routes.

You MUST ONLY evaluate the provided candidate options.
Never invent routes, cities, segments, or IDs.
Never rename option IDs.
Use fastest feasible logic with transfer practicality.
If data is insufficient, mark status as "partial".

INPUT:
${JSON.stringify(payload, null, 2)}

Return strict JSON:
{
  "status": "verified" | "partial" | "rejected",
  "confidence": 0.0,
  "notes": ["string"],
  "ranked_option_ids": ["option-1", "option-2"]
}`;
}

function normalizeRouteVerificationPayload(parsed, options = []) {
  const validOptionIds = new Set(
    options
      .map((option) => normalizeText(option.option_id))
      .filter(Boolean)
  );
  const rankedOptionIds = Array.isArray(parsed?.ranked_option_ids)
    ? parsed.ranked_option_ids
        .map((value) => normalizeText(value))
        .filter((value) => value && validOptionIds.has(value))
    : [];
  const confidence = Number.parseFloat(parsed?.confidence);
  const status = normalizeText(parsed?.status, "partial").toLowerCase();

  return {
    status: ["verified", "partial", "rejected"].includes(status)
      ? status
      : "partial",
    confidence: Number.isFinite(confidence)
      ? Number(Math.min(1, Math.max(0, confidence)).toFixed(2))
      : 0.45,
    notes: Array.isArray(parsed?.notes)
      ? parsed.notes
          .map((note) => normalizeText(note))
          .filter(Boolean)
          .slice(0, 4)
      : [],
    ranked_option_ids: rankedOptionIds,
  };
}

function reorderOptionsByGeminiRanking(options = [], rankedOptionIds = []) {
  if (!Array.isArray(options) || options.length === 0) {
    return [];
  }

  if (!Array.isArray(rankedOptionIds) || rankedOptionIds.length === 0) {
    return options;
  }

  const orderMap = new Map(
    rankedOptionIds.map((optionId, index) => [normalizeText(optionId), index])
  );

  return [...options].sort((left, right) => {
    const leftRank = orderMap.get(normalizeText(left.option_id));
    const rightRank = orderMap.get(normalizeText(right.option_id));
    const safeLeftRank = Number.isInteger(leftRank) ? leftRank : Number.MAX_SAFE_INTEGER;
    const safeRightRank = Number.isInteger(rightRank) ? rightRank : Number.MAX_SAFE_INTEGER;

    if (safeLeftRank !== safeRightRank) {
      return safeLeftRank - safeRightRank;
    }

    const leftDuration = Number.parseFloat(left.total_duration_minutes) || Number.MAX_SAFE_INTEGER;
    const rightDuration = Number.parseFloat(right.total_duration_minutes) || Number.MAX_SAFE_INTEGER;
    return leftDuration - rightDuration;
  });
}

async function requestGeminiRouteVerification(prompt, timeoutMs) {
  return withTimeout(
    getGeminiModel().generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        topP: 0.1,
        topK: 1,
        maxOutputTokens: 800,
        responseMimeType: "application/json",
      },
    }),
    timeoutMs
  );
}

export async function verifyMultimodalRoutes({
  originCityName = "",
  destinationLabel = "",
  options = [],
  traceId = "",
} = {}) {
  const safeOptions = Array.isArray(options) ? options : [];

  if (safeOptions.length === 0) {
    return {
      verification: {
        status: "not_requested",
        provider: "none",
        confidence: 0,
        notes: ["No candidate route options were available for verification."],
      },
      options: safeOptions,
    };
  }

  if (!resolveGeminiRouteVerificationEnabled()) {
    return {
      verification: {
        status: "not_requested",
        provider: "none",
        confidence: 0,
        notes: ["Gemini route verification is disabled by configuration."],
      },
      options: safeOptions,
    };
  }

  if (!resolveGeminiApiKey()) {
    return {
      verification: {
        status: "not_requested",
        provider: "none",
        confidence: 0,
        notes: ["Gemini verification skipped because API key is missing."],
      },
      options: safeOptions,
    };
  }

  const timeoutMs = resolveGeminiRouteVerificationTimeoutMs();
  const prompt = buildRouteVerificationPrompt({
    originCityName,
    destinationLabel,
    options: safeOptions,
  });

  try {
    console.info("[gemini] Route verification request started", {
      optionCount: safeOptions.length,
      traceId: traceId || null,
    });

    const result = await requestGeminiRouteVerification(prompt, timeoutMs);
    const parsed = parseAiTripPayload(result.response.text());
    const normalized = normalizeRouteVerificationPayload(parsed, safeOptions);
    const reorderedOptions = reorderOptionsByGeminiRanking(
      safeOptions,
      normalized.ranked_option_ids
    );

    console.info("[gemini] Route verification response accepted", {
      status: normalized.status,
      confidence: normalized.confidence,
      traceId: traceId || null,
    });

    return {
      verification: {
        status: normalized.status,
        provider: "gemini",
        confidence: normalized.confidence,
        notes:
          normalized.notes.length > 0
            ? normalized.notes
            : ["Gemini validated the candidate route set without inventing new segments."],
      },
      options: reorderedOptions,
    };
  } catch (error) {
    console.warn("[gemini] Route verification failed, using deterministic ranking", {
      message: error instanceof Error ? error.message : String(error),
      traceId: traceId || null,
    });
    return {
      verification: {
        status: "partial",
        provider: "gemini",
        confidence: 0.35,
        notes: [
          "Gemini verification failed; deterministic route ranking was used instead.",
        ],
      },
      options: safeOptions,
    };
  }
}
