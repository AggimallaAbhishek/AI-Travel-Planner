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
  const normalizedTripId = String(tripId ?? "").trim();
  const prefix = `${normalizedTripId}::`;

  for (const key of tripRouteCache.keys()) {
    if (key === normalizedTripId || key.startsWith(prefix)) {
      tripRouteCache.delete(key);
    }
  }
}

function normalizeConstraints(constraints = {}) {
  const source = constraints && typeof constraints === "object" ? constraints : {};

  return {
    dailyTimeLimitHours: source.dailyTimeLimitHours,
    budgetCap: source.budgetCap,
    mobilityPref: source.mobilityPref,
    mealPrefs: Array.isArray(source.mealPrefs) ? source.mealPrefs : [],
  };
}

function buildRouteQuery(options = {}) {
  const params = new URLSearchParams();

  if (options.objective) {
    params.set("objective", String(options.objective));
  }

  if (options.optimizeFor) {
    params.set("optimizeFor", String(options.optimizeFor));
  }

  if (options.day !== undefined && options.day !== null && options.day !== "") {
    params.set("day", String(options.day));
  }

  if (
    options.alternativesCount !== undefined &&
    options.alternativesCount !== null &&
    options.alternativesCount !== ""
  ) {
    params.set("alternatives_count", String(options.alternativesCount));
  }

  const constraints = normalizeConstraints(options.constraints);

  if (constraints.dailyTimeLimitHours) {
    params.set("daily_time_limit", String(constraints.dailyTimeLimitHours));
  }
  if (constraints.budgetCap) {
    params.set("budget_cap", String(constraints.budgetCap));
  }
  if (constraints.mobilityPref) {
    params.set("mobility_pref", constraints.mobilityPref);
  }
  if (constraints.mealPrefs.length > 0) {
    params.set("meal_prefs", constraints.mealPrefs.join(","));
  }

  return params.toString();
}

function buildRouteCacheKey(tripId, options = {}) {
  return `${tripId}::${buildRouteQuery(options)}`;
}

export async function fetchTripRoutes(tripId, options = {}) {
  const normalizedTripId = String(tripId ?? "").trim();

  if (!normalizedTripId) {
    throw new Error("Trip id is required to load optimized routes.");
  }

  const cacheKey = buildRouteCacheKey(normalizedTripId, options);

  if (!options.force) {
    const cachedEntry = readCachedRoutes(cacheKey);
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
      tripRouteCache.delete(cacheKey);
    }
  }

  console.info("[trip-routes] Fetching optimized routes", {
    tripId: normalizedTripId,
    objective: options.objective ?? "",
    alternativesCount: options.alternativesCount ?? "",
  });
  const query = buildRouteQuery(options);
  const response = await apiFetch(
    `/api/trips/${normalizedTripId}/routes${query ? `?${query}` : ""}`,
    {
      signal: options.signal,
    }
  );
  const routes = response.routes ?? response;

  writeCachedRoutes(cacheKey, routes);
  return routes;
}

export async function fetchTripRouteAlternatives(tripId, options = {}) {
  const normalizedTripId = String(tripId ?? "").trim();

  if (!normalizedTripId) {
    throw new Error("Trip id is required to load route alternatives.");
  }

  const query = buildRouteQuery(options);
  const response = await apiFetch(
    `/api/trips/${normalizedTripId}/alternatives${query ? `?${query}` : ""}`,
    {
      signal: options.signal,
    }
  );

  return response.alternatives ?? response;
}

export async function replanTrip(tripId, disruptions, options = {}) {
  const normalizedTripId = String(tripId ?? "").trim();

  if (!normalizedTripId) {
    throw new Error("Trip id is required to replan a trip.");
  }

  const response = await apiFetch(`/api/trips/${normalizedTripId}/replan`, {
    method: "POST",
    body: {
      disruptions,
    },
    signal: options.signal,
  });

  clearTripRoutesCache(normalizedTripId);
  return response;
}
