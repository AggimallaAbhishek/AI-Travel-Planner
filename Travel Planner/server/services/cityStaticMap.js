import { createMemoryCacheStore } from "./cacheStore.js";

const OVERPASS_API_URL = "https://overpass-api.de/api/interpreter";
const DEFAULT_OVERPASS_TIMEOUT_MS = 10_000;
const DEFAULT_BASEMAP_TTL_MS = 12 * 60 * 60 * 1000;
const DEFAULT_BASEMAP_STALE_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_FEATURE_LIMITS = Object.freeze({
  roads: 140,
  water: 32,
  parks: 36,
});

const basemapCache = createMemoryCacheStore({
  defaultTtlMs: DEFAULT_BASEMAP_TTL_MS,
  defaultStaleTtlMs: DEFAULT_BASEMAP_STALE_TTL_MS,
});

function normalizeText(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed || fallback;
}

function parseCoordinate(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeBounds(bounds = {}) {
  if (!bounds || typeof bounds !== "object") {
    return null;
  }

  const north = parseCoordinate(bounds.north);
  const south = parseCoordinate(bounds.south);
  const east = parseCoordinate(bounds.east);
  const west = parseCoordinate(bounds.west);

  if (
    north === null ||
    south === null ||
    east === null ||
    west === null ||
    north < south ||
    east < west
  ) {
    return null;
  }

  return { north, south, east, west };
}

function roundBounds(bounds = null, digits = 4) {
  if (!bounds) {
    return null;
  }

  const factor = 10 ** digits;
  return {
    north: Math.round(bounds.north * factor) / factor,
    south: Math.round(bounds.south * factor) / factor,
    east: Math.round(bounds.east * factor) / factor,
    west: Math.round(bounds.west * factor) / factor,
  };
}

function buildBasemapCacheKey(destination = "", bounds = null) {
  const roundedBounds = roundBounds(bounds);

  return JSON.stringify({
    destination: normalizeText(destination).toLowerCase(),
    bounds: roundedBounds,
  });
}

export function buildOverpassBasemapQuery(bounds = {}) {
  const normalizedBounds = normalizeBounds(bounds);
  if (!normalizedBounds) {
    return "";
  }

  const bbox = `${normalizedBounds.south},${normalizedBounds.west},${normalizedBounds.north},${normalizedBounds.east}`;

  return [
    "[out:json][timeout:25];",
    "(",
    `  way["highway"~"motorway|trunk|primary|secondary|tertiary|residential|living_street"](${bbox});`,
    `  way["natural"="water"](${bbox});`,
    `  way["waterway"~"river|canal|stream|drain"](${bbox});`,
    `  way["landuse"="reservoir"](${bbox});`,
    `  way["leisure"="park"](${bbox});`,
    `  way["landuse"="grass"](${bbox});`,
    `  way["natural"="wood"](${bbox});`,
    ");",
    "out tags geom qt;",
  ].join("\n");
}

function buildTimedFetchOptions(options = {}, timeoutMs = DEFAULT_OVERPASS_TIMEOUT_MS) {
  return {
    ...options,
    ...(typeof AbortSignal !== "undefined" &&
    typeof AbortSignal.timeout === "function"
      ? { signal: AbortSignal.timeout(timeoutMs) }
      : {}),
  };
}

function classifyOverpassElement(tags = {}) {
  const highway = normalizeText(tags.highway);
  const natural = normalizeText(tags.natural);
  const waterway = normalizeText(tags.waterway);
  const leisure = normalizeText(tags.leisure);
  const landuse = normalizeText(tags.landuse);

  if (highway) {
    return {
      category: "roads",
      kind: highway,
    };
  }

  if (
    natural === "water" ||
    waterway ||
    landuse === "reservoir"
  ) {
    return {
      category: "water",
      kind: natural || waterway || landuse || "water",
    };
  }

  if (leisure === "park" || landuse === "grass" || natural === "wood") {
    return {
      category: "parks",
      kind: leisure || landuse || natural || "park",
    };
  }

  return null;
}

function simplifyGeometry(geometry = [], maxPoints = 64) {
  if (!Array.isArray(geometry) || geometry.length < 2) {
    return [];
  }

  if (geometry.length <= maxPoints) {
    return geometry
      .map((point) => ({
        latitude: parseCoordinate(point?.lat),
        longitude: parseCoordinate(point?.lon),
      }))
      .filter(
        (point) => point.latitude !== null && point.longitude !== null
      );
  }

  const step = Math.max(1, Math.ceil(geometry.length / maxPoints));
  const simplified = [];

  for (let index = 0; index < geometry.length; index += step) {
    const point = geometry[index];
    const latitude = parseCoordinate(point?.lat);
    const longitude = parseCoordinate(point?.lon);

    if (latitude === null || longitude === null) {
      continue;
    }

    simplified.push({ latitude, longitude });
  }

  const lastPoint = geometry.at(-1);
  const lastLatitude = parseCoordinate(lastPoint?.lat);
  const lastLongitude = parseCoordinate(lastPoint?.lon);
  const tail = {
    latitude: lastLatitude,
    longitude: lastLongitude,
  };
  const lastSimplifiedPoint = simplified.at(-1);

  if (
    tail.latitude !== null &&
    tail.longitude !== null &&
    (!lastSimplifiedPoint ||
      lastSimplifiedPoint.latitude !== tail.latitude ||
      lastSimplifiedPoint.longitude !== tail.longitude)
  ) {
    simplified.push(tail);
  }

  return simplified;
}

function isClosedGeometry(coordinates = []) {
  if (coordinates.length < 3) {
    return false;
  }

  const firstPoint = coordinates[0];
  const lastPoint = coordinates.at(-1);

  return (
    Math.abs(firstPoint.latitude - lastPoint.latitude) < 0.000001 &&
    Math.abs(firstPoint.longitude - lastPoint.longitude) < 0.000001
  );
}

function normalizeOverpassFeature(element = {}) {
  const classified = classifyOverpassElement(element?.tags);
  if (!classified) {
    return null;
  }

  const coordinates = simplifyGeometry(
    element?.geometry,
    classified.category === "roads" ? 72 : 90
  );
  if (coordinates.length < 2) {
    return null;
  }

  return {
    id: `${normalizeText(element?.type, "way")}-${element?.id ?? "feature"}`,
    category: classified.category,
    kind: classified.kind,
    coordinates,
    closed:
      classified.category !== "roads" && (isClosedGeometry(coordinates) || coordinates.length >= 3),
  };
}

function limitFeatures(features = [], limit = 24) {
  if (!Array.isArray(features) || features.length <= limit) {
    return Array.isArray(features) ? features : [];
  }

  return features
    .slice()
    .sort((left, right) => right.coordinates.length - left.coordinates.length)
    .slice(0, limit);
}

function createEmptyBasemap(destination = "", cityBounds = null, reason = "") {
  return {
    source: "openstreetmap-overpass",
    destination: normalizeText(destination),
    cityBounds: normalizeBounds(cityBounds),
    generatedAt: new Date().toISOString(),
    roads: [],
    water: [],
    parks: [],
    reason: normalizeText(reason),
  };
}

export async function getStaticCityBasemap({
  destination = "",
  cityBounds,
  fetchImpl = fetch,
  cacheStore = basemapCache,
  endpoint = OVERPASS_API_URL,
  timeoutMs = DEFAULT_OVERPASS_TIMEOUT_MS,
  featureLimits = DEFAULT_FEATURE_LIMITS,
} = {}) {
  const normalizedBounds = normalizeBounds(cityBounds);
  if (!normalizedBounds) {
    return createEmptyBasemap(destination, null, "missing_city_bounds");
  }

  const cacheKey = buildBasemapCacheKey(destination, normalizedBounds);
  const cachedBasemap = await cacheStore.get(cacheKey, { allowStale: true });
  if (cachedBasemap?.value) {
    console.info("[city-basemap] Reusing cached city basemap", {
      destination,
      isStale: cachedBasemap.isStale,
    });
    return cachedBasemap.value;
  }

  const query = buildOverpassBasemapQuery(normalizedBounds);
  if (!query) {
    return createEmptyBasemap(destination, normalizedBounds, "missing_query");
  }

  try {
    console.info("[city-basemap] Fetching static city basemap", {
      destination,
      endpoint,
    });

    const response = await fetchImpl(
      endpoint,
      buildTimedFetchOptions(
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "text/plain;charset=UTF-8",
          },
          body: query,
        },
        timeoutMs
      )
    );

    if (!response.ok) {
      const reason = normalizeText(await response.text(), `HTTP ${response.status}`);
      console.warn("[city-basemap] Failed to fetch city basemap", {
        destination,
        status: response.status,
        reason,
      });
      return createEmptyBasemap(destination, normalizedBounds, reason);
    }

    const payload = await response.json();
    const elements = Array.isArray(payload?.elements) ? payload.elements : [];
    const allFeatures = elements
      .map((element) => normalizeOverpassFeature(element))
      .filter(Boolean);
    const basemap = {
      source: "openstreetmap-overpass",
      destination: normalizeText(destination),
      cityBounds: normalizedBounds,
      generatedAt: new Date().toISOString(),
      roads: limitFeatures(
        allFeatures.filter((feature) => feature.category === "roads"),
        featureLimits.roads
      ),
      water: limitFeatures(
        allFeatures.filter((feature) => feature.category === "water"),
        featureLimits.water
      ),
      parks: limitFeatures(
        allFeatures.filter((feature) => feature.category === "parks"),
        featureLimits.parks
      ),
      reason: "",
    };

    await cacheStore.set(cacheKey, basemap, {
      ttlMs: DEFAULT_BASEMAP_TTL_MS,
      staleTtlMs: DEFAULT_BASEMAP_STALE_TTL_MS,
    });

    console.info("[city-basemap] Static city basemap ready", {
      destination,
      roads: basemap.roads.length,
      water: basemap.water.length,
      parks: basemap.parks.length,
    });

    return basemap;
  } catch (error) {
    console.warn("[city-basemap] Basemap fetch failed, using empty shell", {
      destination,
      message: error instanceof Error ? error.message : String(error),
    });
    return createEmptyBasemap(
      destination,
      normalizedBounds,
      error instanceof Error ? error.message : String(error)
    );
  }
}
