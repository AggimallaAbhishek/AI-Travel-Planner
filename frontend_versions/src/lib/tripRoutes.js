import { apiFetch } from "./api";

const ROUTE_CACHE = new Map();
const ROUTE_CACHE_TTL_MS = 5 * 60 * 1_000;

function normalizeText(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized || fallback;
}

function toFiniteNumber(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toInteger(value, fallback = 0) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function buildCacheKey(tripId, day) {
  return `${normalizeText(tripId)}::${toInteger(day, 1)}`;
}

function readCachedRoute(cacheKey) {
  const cached = ROUTE_CACHE.get(cacheKey);
  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= Date.now()) {
    ROUTE_CACHE.delete(cacheKey);
    return null;
  }

  return cached.value;
}

function writeCachedRoute(cacheKey, value) {
  ROUTE_CACHE.set(cacheKey, {
    value,
    expiresAt: Date.now() + ROUTE_CACHE_TTL_MS,
  });
}

function normalizeStop(stop = {}, index = 0) {
  return {
    order: toInteger(stop.order, index + 1),
    placeId: normalizeText(stop.placeId),
    name: normalizeText(stop.name, "Recommended Stop"),
    address: normalizeText(stop.address),
    category: normalizeText(stop.category, "attraction"),
    rating: toFiniteNumber(stop.rating),
    coordinates: {
      latitude: toFiniteNumber(stop?.coordinates?.latitude),
      longitude: toFiniteNumber(stop?.coordinates?.longitude),
    },
  };
}

function normalizeRoute(route = {}) {
  return {
    day: toInteger(route.day, 1),
    clusterId: toInteger(route.clusterId, 0),
    stopCount: toInteger(route.stopCount, 0),
    visitOrder: Array.isArray(route.visitOrder)
      ? route.visitOrder.filter((value) => Number.isInteger(value))
      : [],
    stops: Array.isArray(route.stops)
      ? route.stops.map((stop, index) => normalizeStop(stop, index))
      : [],
  };
}

function normalizePlanningMeta(meta = {}) {
  return {
    dataProvider: normalizeText(meta.dataProvider),
    algorithmVersion: normalizeText(meta.algorithmVersion),
    cacheHit: Boolean(meta.cacheHit),
    generatedAt: normalizeText(meta.generatedAt),
    freshness: normalizeText(meta.freshness),
  };
}

export function clearTripRouteCache(tripId = "") {
  const normalizedTripId = normalizeText(tripId);
  const prefix = `${normalizedTripId}::`;

  for (const key of ROUTE_CACHE.keys()) {
    if (key.startsWith(prefix)) {
      ROUTE_CACHE.delete(key);
    }
  }
}

export async function fetchTripRoute(tripId, options = {}) {
  const normalizedTripId = normalizeText(tripId);
  if (!normalizedTripId) {
    throw new Error("Trip id is required to load optimized routes.");
  }

  const day = toInteger(options.day, 1);
  if (day < 1 || day > 30) {
    throw new Error("Route day must be between 1 and 30.");
  }

  const cacheKey = buildCacheKey(normalizedTripId, day);
  if (!options.force) {
    const cached = readCachedRoute(cacheKey);
    if (cached) {
      return cached;
    }
  }

  const query = new URLSearchParams();
  query.set("day", String(day));
  if (options.force) {
    query.set("force", "true");
  }

  const response = await apiFetch(
    `/api/trips/${normalizedTripId}/routes?${query.toString()}`,
    {
      signal: options.signal,
    }
  );

  const normalizedRoute = {
    day: toInteger(response.day, day),
    totalDays: toInteger(response.totalDays, day),
    route: normalizeRoute(response.route),
    optimization:
      response.optimization && typeof response.optimization === "object"
        ? response.optimization
        : {},
    planningMeta: normalizePlanningMeta(response.planningMeta),
  };
  writeCachedRoute(cacheKey, normalizedRoute);
  return normalizedRoute;
}

