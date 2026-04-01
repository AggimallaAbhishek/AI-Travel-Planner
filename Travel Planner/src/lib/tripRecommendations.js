import { apiFetch } from "./api";
import { normalizeDestinationRecommendations } from "../../shared/recommendations.js";

const RECOMMENDATION_CACHE = new Map();
const LIVE_CACHE_TTL_MS = 5 * 60 * 1_000;
const MOCK_CACHE_TTL_MS = 30 * 1_000;

function resolveCacheTtlMs(recommendations = {}) {
  return recommendations.provider === "mock" ? MOCK_CACHE_TTL_MS : LIVE_CACHE_TTL_MS;
}

function buildCacheKey(tripId, destination = "") {
  const destinationKey = String(destination ?? "").trim().toLowerCase();
  return `${tripId}::${destinationKey}`;
}

function readCachedRecommendations(cacheKey) {
  const cached = RECOMMENDATION_CACHE.get(cacheKey);
  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    RECOMMENDATION_CACHE.delete(cacheKey);
    return null;
  }

  return cached.value;
}

function writeCachedRecommendations(cacheKey, recommendations) {
  RECOMMENDATION_CACHE.set(cacheKey, {
    value: recommendations,
    expiresAt: Date.now() + resolveCacheTtlMs(recommendations),
  });
}

export function clearTripRecommendationsCache(tripId) {
  const normalizedTripId = String(tripId ?? "").trim();
  const prefix = `${normalizedTripId}::`;

  for (const key of RECOMMENDATION_CACHE.keys()) {
    if (key.startsWith(prefix)) {
      RECOMMENDATION_CACHE.delete(key);
    }
  }
}

export async function fetchTripRecommendations(tripId, options = {}) {
  const normalizedTripId = String(tripId ?? "").trim();
  if (!normalizedTripId) {
    throw new Error("Trip id is required to load destination recommendations.");
  }

  const destinationHint = String(options.destination ?? "").trim();
  const initialCacheKey = buildCacheKey(normalizedTripId, destinationHint);

  if (!options.force) {
    const cached = readCachedRecommendations(initialCacheKey);
    if (cached) {
      console.info("[trip-recommendations] Returning cached recommendations", {
        tripId: normalizedTripId,
        destination: destinationHint || cached.destination,
        provider: cached.provider,
      });
      return cached;
    }
  }

  const query = new URLSearchParams();
  if (options.force) {
    query.set("force", "true");
  }

  const response = await apiFetch(
    `/api/trips/${normalizedTripId}/recommendations${
      query.size > 0 ? `?${query.toString()}` : ""
    }`,
    {
      signal: options.signal,
    }
  );
  const recommendations = normalizeDestinationRecommendations(
    response.recommendations ?? response
  );

  const resolvedCacheKey = buildCacheKey(
    normalizedTripId,
    recommendations.destination || destinationHint
  );
  writeCachedRecommendations(resolvedCacheKey, recommendations);

  return recommendations;
}
