import { apiFetch } from "./api";
import { normalizeDestinationRecommendations } from "../../shared/recommendations.js";

const recommendationCache = new Map();

function readCachedRecommendations(tripId) {
  return recommendationCache.get(String(tripId));
}

function writeCachedRecommendations(tripId, recommendations) {
  recommendationCache.set(String(tripId), recommendations);
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
    const cached = readCachedRecommendations(normalizedTripId);
    if (cached) {
      console.info("[trip-recommendations] Returning cached recommendations", {
        tripId: normalizedTripId,
        provider: cached.provider,
      });
      return cached;
    }
  }

  console.info("[trip-recommendations] Fetching recommendations", {
    tripId: normalizedTripId,
  });

  const response = await apiFetch(`/api/trips/${normalizedTripId}/recommendations`, {
    signal: options.signal,
  });
  const recommendations = normalizeDestinationRecommendations(
    response.recommendations ?? response
  );

  writeCachedRecommendations(normalizedTripId, recommendations);
  return recommendations;
}
