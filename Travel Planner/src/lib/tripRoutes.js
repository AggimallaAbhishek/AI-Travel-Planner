import { apiFetch } from "./api";

const tripRouteCache = new Map();
const ROUTE_CACHE_TTL_MS = 5 * 60 * 1000;
const FAILED_ROUTE_CACHE_TTL_MS = 15 * 1000;

function readCachedRoutes(tripId) {
  return tripRouteCache.get(String(tripId));
}

function writeCachedRoutes(tripId, value) {
  tripRouteCache.set(String(tripId), {
    createdAt: Date.now(),
    value,
  });
}

function resolveRouteCacheTtlMs(value = {}) {
  return Array.isArray(value?.days) && value.days.length > 0
    ? ROUTE_CACHE_TTL_MS
    : FAILED_ROUTE_CACHE_TTL_MS;
}

export function clearTripRoutesCache(tripId) {
  tripRouteCache.delete(String(tripId));
}

export async function fetchTripRoutes(tripId, options = {}) {
  const normalizedTripId = String(tripId ?? "").trim();

  if (!normalizedTripId) {
    throw new Error("Trip id is required to load optimized routes.");
  }

  if (!options.force) {
    const cachedEntry = readCachedRoutes(normalizedTripId);
    const cacheAgeMs = Date.now() - (cachedEntry?.createdAt ?? 0);
    const cacheTtlMs = resolveRouteCacheTtlMs(cachedEntry?.value);

    if (cachedEntry && cacheAgeMs < cacheTtlMs) {
      console.info("[trip-routes] Returning cached trip routes", {
        tripId: normalizedTripId,
        cacheAgeMs,
        cacheTtlMs,
      });
      return cachedEntry.value;
    }

    if (cachedEntry) {
      tripRouteCache.delete(normalizedTripId);
    }
  }

  console.info("[trip-routes] Fetching optimized routes", {
    tripId: normalizedTripId,
  });

  const response = await apiFetch(`/api/trips/${normalizedTripId}/routes`, {
    signal: options.signal,
  });
  const routes = response.routes ?? response;

  writeCachedRoutes(normalizedTripId, routes);
  return routes;
}
