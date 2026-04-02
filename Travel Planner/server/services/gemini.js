import { GoogleGenerativeAI } from "@google/generative-ai";
import { parseAiTripPayload } from "../../shared/trips.js";
import { incrementPlanningMetric } from "../lib/planningMetrics.js";

let model;
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const DEFAULT_TIMEOUT_MS = 20_000;
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
  const payload = {
    trip_request: {
      destination: planningRequest.destination,
      days: planningRequest.days,
      budget_amount: planningRequest.budgetAmount,
      travel_style: planningRequest.travelStyle,
      pace: planningRequest.pace,
      food_preferences: planningRequest.foodPreferences,
    },
    planned_days: (groundedPlan.days ?? []).map((day) => buildPromptDay(day)),
  };

  return `You are a travel itinerary narrator.

You must ONLY use the provided JSON data.
Do NOT invent, rename, infer, or substitute hotels, restaurants, attractions, routes, prices, durations, or neighborhoods.
If any field is missing, return "Data not available".
Do NOT add places that are not present in the input.
Do NOT change the stop order.
Return valid JSON only.

INPUT:
${JSON.stringify(payload, null, 2)}

TASK:
For each day, write:
- "title": concise grounded title
- "summary": 2-3 sentences using only provided facts
- "tips": 2-4 practical tips using only provided facts

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
