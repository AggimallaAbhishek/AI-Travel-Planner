import { apiFetch } from "./api";

const tripMapCache = new Map();
const TRIP_MAP_CACHE_TTL_MS = 2 * 60 * 1000;

function normalizeText(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed || fallback;
}

function buildTripMapQuery(options = {}) {
  const params = new URLSearchParams();

  if (options.day !== undefined && options.day !== null && options.day !== "") {
    params.set("day", String(options.day));
  }

  return params.toString();
}

function buildTripMapCacheKey(tripId, options = {}) {
  const normalizedTripId = normalizeText(String(tripId ?? ""));
  const query = buildTripMapQuery(options);
  return `${normalizedTripId}::${query}`;
}

export function clearTripMapCache(tripId) {
  const normalizedTripId = normalizeText(String(tripId ?? ""));
  const prefix = `${normalizedTripId}::`;

  for (const key of tripMapCache.keys()) {
    if (key === normalizedTripId || key.startsWith(prefix)) {
      tripMapCache.delete(key);
    }
  }
}

export async function fetchTripMap(tripId, options = {}) {
  const normalizedTripId = normalizeText(String(tripId ?? ""));

  if (!normalizedTripId) {
    throw new Error("Trip id is required to load the trip map.");
  }

  const cacheKey = buildTripMapCacheKey(normalizedTripId, options);
  const cachedEntry = tripMapCache.get(cacheKey);

  if (!options.force && cachedEntry) {
    const cacheAgeMs = Date.now() - cachedEntry.createdAt;

    if (cacheAgeMs < TRIP_MAP_CACHE_TTL_MS) {
      console.info("[trip-map] Returning cached unified trip map", {
        tripId: normalizedTripId,
        cacheAgeMs,
      });
      return cachedEntry.value;
    }

    tripMapCache.delete(cacheKey);
  }

  const query = buildTripMapQuery(options);
  console.info("[trip-map] Fetching unified trip map", {
    tripId: normalizedTripId,
    day: options.day ?? "",
  });
  const response = await apiFetch(
    `/api/trips/${normalizedTripId}/map${query ? `?${query}` : ""}`,
    {
      signal: options.signal,
    }
  );
  const tripMap = response?.tripMap ?? response;

  tripMapCache.set(cacheKey, {
    createdAt: Date.now(),
    value: tripMap,
  });

  return tripMap;
}
