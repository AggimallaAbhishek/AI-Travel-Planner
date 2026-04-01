import { createMemoryCacheStore } from "./cacheStore.js";
import { getPrebuiltCityMapArtifact } from "./cityMapDataset.js";

const OVERPASS_API_URL = "https://overpass-api.de/api/interpreter";
const DEFAULT_OVERPASS_TIMEOUT_MS = 10_000;
const DEFAULT_BASEMAP_TTL_MS = 12 * 60 * 60 * 1000;
const DEFAULT_BASEMAP_STALE_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_FEATURE_LIMITS = Object.freeze({
  roads: 140,
  water: 32,
  parks: 36,
});
const TARGET_ADMIN_LEVELS = [4, 6, 7, 8, 9];

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

function escapeOverpassRegex(value = "") {
  return normalizeText(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildBoundaryNameCandidates(destination = "") {
  const normalizedDestination = normalizeText(destination);
  const primaryLabel = normalizeText(normalizedDestination.split(",")[0]);
  const candidates = [primaryLabel, normalizedDestination]
    .map((value) => normalizeText(value))
    .filter(Boolean);

  return [...new Set(candidates)];
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

export function buildOverpassBoundaryQuery(destination = "", bounds = {}) {
  const normalizedBounds = normalizeBounds(bounds);
  const nameCandidates = buildBoundaryNameCandidates(destination);

  if (!normalizedBounds || nameCandidates.length === 0) {
    return "";
  }

  const bbox = `${normalizedBounds.south},${normalizedBounds.west},${normalizedBounds.north},${normalizedBounds.east}`;
  const namePattern = nameCandidates.map(escapeOverpassRegex).join("|");

  return [
    "[out:json][timeout:25];",
    "(",
    `  relation["boundary"="administrative"]["name"~"^(${namePattern})$",i](${bbox});`,
    `  relation["boundary"="administrative"]["name:en"~"^(${namePattern})$",i](${bbox});`,
    `  way["boundary"="administrative"]["name"~"^(${namePattern})$",i](${bbox});`,
    `  way["boundary"="administrative"]["name:en"~"^(${namePattern})$",i](${bbox});`,
    ");",
    "out tags geom;",
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

function closeRing(coordinates = []) {
  if (coordinates.length === 0) {
    return [];
  }

  const firstPoint = coordinates[0];
  const lastPoint = coordinates.at(-1);

  if (
    firstPoint.latitude === lastPoint.latitude &&
    firstPoint.longitude === lastPoint.longitude
  ) {
    return coordinates;
  }

  return [...coordinates, firstPoint];
}

function normalizeBoundaryRing(geometry = [], maxPoints = 220) {
  const simplified = simplifyGeometry(geometry, maxPoints);
  if (simplified.length < 3) {
    return [];
  }

  return closeRing(simplified);
}

function calculateRingArea(coordinates = []) {
  if (!Array.isArray(coordinates) || coordinates.length < 4) {
    return 0;
  }

  let doubledArea = 0;
  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const current = coordinates[index];
    const next = coordinates[index + 1];
    doubledArea +=
      current.longitude * next.latitude - next.longitude * current.latitude;
  }

  return Math.abs(doubledArea / 2);
}

export function buildFallbackOutlineFromBounds(bounds = {}) {
  const normalizedBounds = normalizeBounds(bounds);
  if (!normalizedBounds) {
    return null;
  }

  const latitudeSpan = normalizedBounds.north - normalizedBounds.south;
  const longitudeSpan = normalizedBounds.east - normalizedBounds.west;
  const lat = (ratio) => normalizedBounds.south + latitudeSpan * ratio;
  const lng = (ratio) => normalizedBounds.west + longitudeSpan * ratio;
  const polygon = closeRing([
    { latitude: lat(0.90), longitude: lng(0.18) },
    { latitude: lat(0.97), longitude: lng(0.45) },
    { latitude: lat(0.92), longitude: lng(0.82) },
    { latitude: lat(0.72), longitude: lng(0.95) },
    { latitude: lat(0.42), longitude: lng(0.92) },
    { latitude: lat(0.12), longitude: lng(0.72) },
    { latitude: lat(0.04), longitude: lng(0.38) },
    { latitude: lat(0.12), longitude: lng(0.12) },
    { latitude: lat(0.44), longitude: lng(0.05) },
    { latitude: lat(0.74), longitude: lng(0.08) },
  ]);

  return {
    source: "fallback_bounds",
    name: "",
    polygons: [polygon],
  };
}

function normalizeBoundaryFeature(element = {}) {
  const tags = element?.tags ?? {};
  const outerMemberPolygons = Array.isArray(element?.members)
    ? element.members
        .filter(
          (member) =>
            normalizeText(member?.role).toLowerCase() === "outer" &&
            Array.isArray(member?.geometry)
        )
        .map((member) => normalizeBoundaryRing(member.geometry))
        .filter((polygon) => polygon.length >= 4)
    : [];
  const polygons =
    outerMemberPolygons.length > 0
      ? outerMemberPolygons
      : (() => {
          const ring = normalizeBoundaryRing(element?.geometry);
          return ring.length >= 4 ? [ring] : [];
        })();

  if (polygons.length === 0) {
    return null;
  }

  const adminLevel = parseCoordinate(tags.admin_level);
  const name = normalizeText(tags["name:en"] ?? tags.name);
  const totalArea = polygons.reduce(
    (largestArea, polygon) => Math.max(largestArea, calculateRingArea(polygon)),
    0
  );

  return {
    id: `${normalizeText(element?.type, "relation")}-${element?.id ?? "outline"}`,
    type: normalizeText(element?.type, "relation"),
    name,
    adminLevel,
    polygons,
    totalArea,
  };
}

function scoreBoundaryFeature(feature = {}, destination = "") {
  const candidates = buildBoundaryNameCandidates(destination).map((value) =>
    value.toLowerCase()
  );
  const name = normalizeText(feature?.name).toLowerCase();
  const primaryCandidate = candidates[0] ?? "";
  const adminLevel = Number.isFinite(feature?.adminLevel)
    ? feature.adminLevel
    : null;
  let score = 0;

  if (name && candidates.includes(name)) {
    score += 1_000;
  } else if (primaryCandidate && name.includes(primaryCandidate)) {
    score += 650;
  }

  if (feature?.type === "relation") {
    score += 220;
  }

  if (adminLevel !== null) {
    const preferredIndex = TARGET_ADMIN_LEVELS.findIndex(
      (level) => level === adminLevel
    );
    score += preferredIndex >= 0 ? 180 - preferredIndex * 20 : 40;
  }

  score += Math.min(180, Math.round((feature?.totalArea ?? 0) * 10_000));

  return score;
}

function selectBestBoundaryFeature(elements = [], destination = "") {
  const boundaryFeatures = elements
    .map((element) => normalizeBoundaryFeature(element))
    .filter(Boolean);

  if (boundaryFeatures.length === 0) {
    return null;
  }

  boundaryFeatures.sort((left, right) => {
    const scoreDelta =
      scoreBoundaryFeature(right, destination) -
      scoreBoundaryFeature(left, destination);

    if (scoreDelta !== 0) {
      return scoreDelta;
    }

    return (right.totalArea ?? 0) - (left.totalArea ?? 0);
  });

  return boundaryFeatures[0];
}

async function fetchOverpassPayload({
  endpoint,
  query,
  fetchImpl,
  timeoutMs,
}) {
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
    throw new Error(normalizeText(await response.text(), `HTTP ${response.status}`));
  }

  return response.json();
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
  const normalizedBounds = normalizeBounds(cityBounds);

  return {
    source: "fallback_bounds",
    mapSource: "fallback_bounds",
    destination: normalizeText(destination),
    cityBounds: normalizedBounds,
    generatedAt: new Date().toISOString(),
    outline: buildFallbackOutlineFromBounds(normalizedBounds),
    roads: [],
    water: [],
    parks: [],
    reason: normalizeText(reason),
  };
}

export async function fetchRemoteCityBasemap({
  destination = "",
  cityBounds,
  fetchImpl = fetch,
  endpoint = OVERPASS_API_URL,
  timeoutMs = DEFAULT_OVERPASS_TIMEOUT_MS,
  featureLimits = DEFAULT_FEATURE_LIMITS,
} = {}) {
  const normalizedBounds = normalizeBounds(cityBounds);
  if (!normalizedBounds) {
    return createEmptyBasemap(destination, null, "missing_city_bounds");
  }

  const query = buildOverpassBasemapQuery(normalizedBounds);
  const boundaryQuery = buildOverpassBoundaryQuery(destination, normalizedBounds);
  if (!query) {
    return createEmptyBasemap(destination, normalizedBounds, "missing_query");
  }

  try {
    console.info("[city-basemap] Fetching static city basemap", {
      destination,
      endpoint,
    });

    const [featurePayload, boundaryPayload] = await Promise.all([
      fetchOverpassPayload({
        endpoint,
        query,
        fetchImpl,
        timeoutMs,
      }),
      boundaryQuery
        ? fetchOverpassPayload({
            endpoint,
            query: boundaryQuery,
            fetchImpl,
            timeoutMs,
          }).catch((error) => {
            console.warn("[city-basemap] Failed to fetch administrative outline", {
              destination,
              message: error instanceof Error ? error.message : String(error),
            });
            return { elements: [] };
          })
        : Promise.resolve({ elements: [] }),
    ]);
    const elements = Array.isArray(featurePayload?.elements)
      ? featurePayload.elements
      : [];
    const boundaryElements = Array.isArray(boundaryPayload?.elements)
      ? boundaryPayload.elements
      : [];
    const allFeatures = elements
      .map((element) => normalizeOverpassFeature(element))
      .filter(Boolean);
    const matchedBoundary = selectBestBoundaryFeature(boundaryElements, destination);
    const basemap = {
      source: "openstreetmap-overpass",
      mapSource: "remote_overpass",
      destination: normalizeText(destination),
      cityBounds: normalizedBounds,
      generatedAt: new Date().toISOString(),
      outline:
        matchedBoundary !== null
          ? {
              source: "administrative_boundary",
              name: matchedBoundary.name,
              polygons: matchedBoundary.polygons,
            }
          : buildFallbackOutlineFromBounds(normalizedBounds),
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

    console.info("[city-basemap] Static city basemap ready", {
      destination,
      outlineSource: basemap.outline?.source ?? "missing",
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

function normalizePrebuiltBasemap(basemap = null, destination = "", fallbackBounds = null) {
  if (!basemap || typeof basemap !== "object") {
    return null;
  }

  const normalizedDestination = normalizeText(
    basemap.destination,
    normalizeText(destination)
  );
  const normalizedBounds =
    normalizeBounds(basemap.cityBounds) ?? normalizeBounds(fallbackBounds);

  if (!normalizedDestination || !normalizedBounds) {
    return null;
  }

  return {
    ...basemap,
    source: "prebuilt_city_map",
    mapSource: "prebuilt_city_map",
    destination: normalizedDestination,
    cityBounds: normalizedBounds,
    generatedAt: normalizeText(basemap.generatedAt, new Date().toISOString()),
    outline: basemap.outline ?? buildFallbackOutlineFromBounds(normalizedBounds),
    roads: Array.isArray(basemap.roads) ? basemap.roads : [],
    water: Array.isArray(basemap.water) ? basemap.water : [],
    parks: Array.isArray(basemap.parks) ? basemap.parks : [],
    reason: normalizeText(basemap.reason),
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
  dataDir,
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

  const prebuiltBasemap = normalizePrebuiltBasemap(
    await getPrebuiltCityMapArtifact({ destination, dataDir }),
    destination,
    normalizedBounds
  );
  if (prebuiltBasemap) {
    await cacheStore.set(cacheKey, prebuiltBasemap, {
      ttlMs: DEFAULT_BASEMAP_TTL_MS,
      staleTtlMs: DEFAULT_BASEMAP_STALE_TTL_MS,
    });

    console.info("[city-basemap] Using prebuilt city basemap", {
      destination,
      roads: prebuiltBasemap.roads.length,
      water: prebuiltBasemap.water.length,
      parks: prebuiltBasemap.parks.length,
      outlineSource: prebuiltBasemap.outline?.source ?? "missing",
    });

    return prebuiltBasemap;
  }

  console.warn("[city-basemap] No prebuilt city basemap found, using fallback shell", {
    destination,
  });

  const fallbackBasemap = createEmptyBasemap(
    destination,
    normalizedBounds,
    "unsupported_destination"
  );
  await cacheStore.set(cacheKey, fallbackBasemap, {
    ttlMs: DEFAULT_BASEMAP_TTL_MS,
    staleTtlMs: DEFAULT_BASEMAP_STALE_TTL_MS,
  });

  return fallbackBasemap;
}
