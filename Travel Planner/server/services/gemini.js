import { GoogleGenerativeAI } from "@google/generative-ai";
import {
  buildFallbackGeneratedTrip,
  buildTripPrompt,
  normalizeGeneratedTrip,
  parseAiTripPayload,
} from "../../shared/trips.js";

let model;
const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_MAX_RETRIES = 1;

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

async function requestGeminiTripPlan(prompt, timeoutMs) {
  return withTimeout(
    getGeminiModel().generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.6,
        topP: 0.9,
        topK: 32,
        maxOutputTokens: 3072,
        responseMimeType: "application/json",
      },
    }),
    timeoutMs
  );
}

export async function generateTripPlan(userSelection) {
  const startedAt = Date.now();
  const prompt = buildTripPrompt(userSelection);
  const timeoutMs = resolveGeminiTimeoutMs();
  const maxAttempts = resolveGeminiMaxRetries() + 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      console.info("[gemini] Trip generation attempt started", {
        attempt,
        maxAttempts,
        timeoutMs,
      });

      const result = await requestGeminiTripPlan(prompt, timeoutMs);
      const responseText = result.response.text();
      const parsed = parseAiTripPayload(responseText);
      const normalized = normalizeGeneratedTrip(parsed, { userSelection });
      const durationMs = Date.now() - startedAt;

      console.info("[gemini] Trip plan generated", {
        attempt,
        durationMs,
        dayCount: normalized.aiPlan?.days?.length ?? 0,
      });

      return normalized;
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
  return buildFallbackGeneratedTrip(userSelection);
}
