import { apiFetch } from "./api";
import { normalizeDestinationRecommendations } from "../../shared/recommendations.js";

const recommendationCache = new Map();
const FRONTEND_RECOMMENDATION_CACHE_TTL_MS = 5 * 60 * 1000;
const FRONTEND_MOCK_RECOMMENDATION_CACHE_TTL_MS = 15 * 1000;
const TRIP_RECOMMENDATION_REQUEST_TIMEOUT_MS = 20_000;

function resolveFrontendRecommendationCacheTtlMs(recommendations = {}) {
  const warningText = String(recommendations.warning ?? "").toLowerCase();

  if (
    recommendations.provider === "mock" ||
    warningText.includes("curated sample")
  ) {
    return FRONTEND_MOCK_RECOMMENDATION_CACHE_TTL_MS;
  }

  return FRONTEND_RECOMMENDATION_CACHE_TTL_MS;
}

function readCachedRecommendations(tripId) {
  return recommendationCache.get(String(tripId));
}

function writeCachedRecommendations(tripId, recommendations) {
  recommendationCache.set(String(tripId), {
    value: recommendations,
    createdAt: Date.now(),
  });
}

export function clearTripRecommendationsCache(tripId) {
  recommendationCache.delete(String(tripId));
}

export async function fetchTripRecommendations(tripId, options = {}) {
  const normalizedTripId = String(tripId ?? "").trim();

  if (!normalizedTripId) {
    throw new Error("Trip id is required to load recommendations.");
  }

  if (!options.force) {
    const cachedEntry = readCachedRecommendations(normalizedTripId);
    const cacheAgeMs = Date.now() - (cachedEntry?.createdAt ?? 0);
    const cacheTtlMs = resolveFrontendRecommendationCacheTtlMs(
      cachedEntry?.value
    );

    if (cachedEntry && cacheAgeMs < cacheTtlMs) {
      console.info("[trip-recommendations] Returning cached recommendations", {
        tripId: normalizedTripId,
        provider: cachedEntry.value?.provider,
        cacheAgeMs,
        cacheTtlMs,
      });
      return cachedEntry.value;
    }

    if (cachedEntry) {
      console.info("[trip-recommendations] Cached recommendations expired", {
        tripId: normalizedTripId,
        cacheAgeMs,
        cacheTtlMs,
      });
      recommendationCache.delete(normalizedTripId);
    }
  }

  console.info("[trip-recommendations] Fetching recommendations", {
    tripId: normalizedTripId,
  });

  const response = await apiFetch(`/api/trips/${normalizedTripId}/recommendations`, {
    signal: options.signal,
    timeoutMs: options.timeoutMs ?? TRIP_RECOMMENDATION_REQUEST_TIMEOUT_MS,
  });
  const recommendations = normalizeDestinationRecommendations(
    response.recommendations ?? response
  );

  writeCachedRecommendations(normalizedTripId, recommendations);
  return recommendations;
}
