import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildGoogleMapsDirectionsUrl,
  buildGoogleMapsSearchUrl,
  normalizeGeoCoordinates,
} from "../../shared/maps.js";
import {
  normalizeAlternativesCount,
  normalizeTripConstraints,
  normalizeTripObjective,
} from "../../shared/trips.js";
import { createMemoryCacheStore } from "./cacheStore.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const GOOGLE_PLACES_TEXT_SEARCH_URL =
  "https://places.googleapis.com/v1/places:searchText";
const GOOGLE_ROUTES_MATRIX_URL =
  "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix";
const GOOGLE_ROUTES_COMPUTE_URL =
  "https://routes.googleapis.com/directions/v2:computeRoutes";
const GOOGLE_PLACES_ROUTE_FIELD_MASK = [
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.googleMapsUri",
  "places.viewport",
].join(",");
const GOOGLE_ROUTE_MATRIX_FIELD_MASK = [
  "originIndex",
  "destinationIndex",
  "distanceMeters",
  "duration",
  "condition",
  "status",
].join(",");
const GOOGLE_COMPUTE_ROUTE_FIELD_MASK = [
  "routes.distanceMeters",
  "routes.duration",
  "routes.polyline.encodedPolyline",
].join(",");
const DEFAULT_ROUTE_CACHE_TTL_MS = 15 * 60 * 1000;
const DEFAULT_ROUTE_REQUEST_TIMEOUT_MS = 12_000;
const DEFAULT_MAX_ROUTE_STOPS_PER_DAY = 8;
const DEFAULT_FALLBACK_DRIVE_SPEED_METERS_PER_SECOND = 10;
const DEFAULT_LOCAL_VIEWPORT_PADDING_RATIO = 0.22;
const DEFAULT_LOCAL_VIEWPORT_MIN_SPAN = 0.018;
const DEFAULT_LOCAL_CLUSTER_RADIUS_METERS = 8_000;
const MAX_LOCAL_CLUSTER_RADIUS_METERS = 22_000;
const ROUTE_CACHE_SCHEMA_VERSION = "v2-city-fallback-routes";
const OBJECTIVE_PROFILES = [
  "fastest",
  "cheapest",
  "best_experience",
];
const STOP_SOURCE_PRIORITY = Object.freeze({
  itinerary: 4,
  ai_plan: 3,
  inferred: 2,
  unknown: 1,
});
const PLACE_QUERY_LEADING_PATTERNS = Object.freeze([
  /^explore\s+/i,
  /^visit\s+/i,
  /^discover\s+/i,
  /^experience\s+/i,
  /^check[\s-]*in(?:\s+at)?\s+/i,
  /^walk(?:\s+through|\s+around|\s+along)?\s+/i,
  /^stroll(?:\s+through|\s+around|\s+along)?\s+/i,
  /^temple\s+stop\s+at\s+/i,
  /^stop\s+at\s+/i,
  /^sunset\s+dinner\s+in\s+/i,
  /^dinner\s+in\s+/i,
  /^lunch\s+in\s+/i,
  /^breakfast\s+in\s+/i,
  /^brunch\s+in\s+/i,
  /^coffee\s+tasting(?:\s+session)?(?:\s+in)?\s+/i,
  /^relax(?:ing)?\s+at\s+/i,
  /^surf(?:ing)?\s+at\s+/i,
  /^shop(?:ping)?\s+at\s+/i,
  /^head\s+to\s+/i,
  /^time\s+in\s+/i,
]);
const GENERIC_PLACE_QUERY_PATTERNS = Object.freeze([
  /^arrival$/i,
  /^departure$/i,
  /^departure prep$/i,
  /^check[\s-]*in$/i,
  /^the villa$/i,
  /^villa$/i,
  /^hotel$/i,
  /^resort$/i,
  /^cultural immersion$/i,
  /^natural beauty$/i,
  /^cultural(?: and)? natural wonders$/i,
  /^coastal charm$/i,
  /^beach fun$/i,
  /^island adventure$/i,
  /^water park thrills$/i,
  /^farewell dinner$/i,
  /^coffee tasting(?: session)?$/i,
  /^sunset dinner$/i,
  /^breakfast$/i,
  /^brunch$/i,
  /^lunch$/i,
  /^dinner$/i,
  /^walk$/i,
  /^stroll$/i,
  /^sunset$/i,
  /^sunrise$/i,
  /^temple$/i,
  /^shopping$/i,
  /^nightlife$/i,
  /^(?:cultural|natural|iconic|historic|trendy|coastal|futuristic)$/i,
]);

function normalizeText(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed || fallback;
}

function normalizeInteger(value, fallback = null) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function parseCoordinate(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizePositiveNumber(value, fallback) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function splitCandidateFragments(value = "") {
  const normalized = normalizeText(value);

  if (!normalized) {
    return [];
  }

  return normalized
    .split(/\s*(?:\/|&|,| and | or )\s*/i)
    .map((fragment) => normalizeText(fragment))
    .filter(Boolean);
}

function cleanPlaceCandidate(value = "") {
  let candidate = normalizeText(value).replace(
    /^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g,
    ""
  );

  for (const pattern of PLACE_QUERY_LEADING_PATTERNS) {
    candidate = candidate.replace(pattern, "");
  }

  candidate = candidate.replace(/^(?:the|central|downtown|local)\s+/i, "");
  candidate = candidate.replace(/\s+(?:and|or)$/i, "");
  candidate = candidate.replace(
    /\s+(?:fun|beauty|wonders?|wonder|grandeur|elegance|adventure|thrills?|immersion|prep|nightlife)$/i,
    ""
  );

  return normalizeText(candidate).replace(
    /^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g,
    ""
  );
}

function isLikelyPlaceCandidate(value = "") {
  const candidate = normalizeText(value);

  if (!candidate) {
    return false;
  }

  if (GENERIC_PLACE_QUERY_PATTERNS.some((pattern) => pattern.test(candidate))) {
    return false;
  }

  if (/^(?:day|stop|session|experience|tour)$/i.test(candidate)) {
    return false;
  }

  const words = candidate.split(/\s+/).filter(Boolean);

  if (words.length === 1) {
    return candidate.length >= 4;
  }

  return true;
}

function pushUniquePlaceCandidate(candidates = [], seen = new Set(), value = "") {
  const candidate = cleanPlaceCandidate(value);
  const key = candidate.toLowerCase();

  if (!isLikelyPlaceCandidate(candidate) || seen.has(key)) {
    return;
  }

  seen.add(key);
  candidates.push(candidate);
}

function extractPlaceCandidatesFromText(value = "") {
  const text = normalizeText(value);

  if (!text) {
    return [];
  }

  const rawCandidates = [];
  const locationPhrasePattern =
    /\b(?:in|at|near|around|through|towards?|to|from|inside|by|along)\s+([^.;:()]+)/gi;
  const capitalizedPhrasePattern =
    /\b[A-Z][A-Za-z'/-]*(?:\s+(?:[A-Z][A-Za-z'/-]*|of|the|and|\/)){0,5}/g;
  let match;

  while ((match = locationPhrasePattern.exec(text)) !== null) {
    rawCandidates.push(match[1]);
  }

  rawCandidates.push(...(text.match(capitalizedPhrasePattern) ?? []));

  if (rawCandidates.length === 0) {
    rawCandidates.push(text);
  }

  const seen = new Set();
  const candidates = [];

  for (const rawCandidate of rawCandidates) {
    const fragments = splitCandidateFragments(rawCandidate);

    if (fragments.length === 0) {
      pushUniquePlaceCandidate(candidates, seen, rawCandidate);
      continue;
    }

    for (const fragment of fragments) {
      pushUniquePlaceCandidate(candidates, seen, fragment);
    }
  }

  return candidates;
}

function buildFallbackSearchQueries({
  day,
  aiPlanDay,
  destination,
}) {
  const queries = [];
  const seen = new Set();
  const scopedDestination = normalizeText(destination);

  function pushQuery(value = "") {
    const query = normalizeText(value);
    const key = query.toLowerCase();

    if (!query || seen.has(key)) {
      return;
    }

    seen.add(key);
    queries.push(query);
  }

  pushQuery([normalizeText(day?.title), destination].filter(Boolean).join(" in "));
  pushQuery([normalizeText(aiPlanDay?.title), destination].filter(Boolean).join(" in "));

  const candidateTexts = [
    day?.title,
    aiPlanDay?.title,
    ...(Array.isArray(aiPlanDay?.activities) ? aiPlanDay.activities : []),
  ];

  for (const text of candidateTexts) {
    for (const candidate of extractPlaceCandidatesFromText(text)) {
      pushQuery(
        scopedDestination
          ? `top sights in ${candidate}, ${scopedDestination}`
          : candidate
      );
    }
  }

  return queries;
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, value));
}

function normalizeLabelKey(value = "") {
  return normalizeText(value).toLowerCase();
}

function splitAddressParts(value = "") {
  return normalizeText(value)
    .split(",")
    .map((part) => normalizeText(part))
    .filter(Boolean);
}

function getDestinationPrimaryLabel(destination = "") {
  return normalizeText(splitAddressParts(destination)[0], normalizeText(destination));
}

function isStreetLikeAddressPart(value = "") {
  const text = normalizeText(value);

  if (!text) {
    return false;
  }

  return (
    /\d/.test(text) ||
    /\b(?:street|st|road|rd|avenue|ave|lane|ln|boulevard|blvd|drive|dr|jalan|jl|jln|gang|gg)\b/i.test(
      text
    )
  );
}

function formatLocalityLabel(value = "") {
  const normalized = normalizeText(value);

  if (!normalized) {
    return "";
  }

  return normalizeText(
    normalized
      .replace(
        /\b(?:city|regency|prefecture|province|district|county|ward|municipality|region)\b/gi,
        ""
      )
      .replace(/\s{2,}/g, " ")
  );
}

function extractLocalityLabel(address = "", destination = "") {
  const parts = splitAddressParts(address);
  const destinationPrimary = getDestinationPrimaryLabel(destination);
  const destinationCountry = normalizeText(splitAddressParts(destination).at(-1));
  const destinationPrimaryKey = normalizeLabelKey(destinationPrimary);
  const destinationCountryKey = normalizeLabelKey(destinationCountry);

  const moreSpecificLocality = parts.find((part) => {
    const key = normalizeLabelKey(part);

    return (
      key &&
      key !== destinationPrimaryKey &&
      key !== destinationCountryKey &&
      !isStreetLikeAddressPart(part)
    );
  });

  if (moreSpecificLocality) {
    return formatLocalityLabel(moreSpecificLocality);
  }

  const destinationMatch = parts.find(
    (part) =>
      normalizeLabelKey(part) === destinationPrimaryKey &&
      !isStreetLikeAddressPart(part)
  );

  if (destinationMatch) {
    return formatLocalityLabel(destinationMatch);
  }

  const genericLocality = parts.find(
    (part) =>
      normalizeLabelKey(part) !== destinationCountryKey &&
      !isStreetLikeAddressPart(part)
  );

  return formatLocalityLabel(genericLocality || destinationPrimary || destination);
}

function resolveDominantLocalityLabel(stops = [], destination = "") {
  const counts = new Map();

  for (const stop of Array.isArray(stops) ? stops : []) {
    const localityLabel = extractLocalityLabel(stop?.location, destination);
    const key = normalizeLabelKey(localityLabel);

    if (!key) {
      continue;
    }

    counts.set(key, {
      label: localityLabel,
      count: (counts.get(key)?.count ?? 0) + 1,
    });
  }

  return (
    Array.from(counts.values()).sort((left, right) => right.count - left.count)[0]
      ?.label ?? formatLocalityLabel(getDestinationPrimaryLabel(destination) || destination)
  );
}

function buildTimedFetchOptions(options = {}, timeoutMs) {
  return {
    ...options,
    ...(typeof AbortSignal !== "undefined" &&
    typeof AbortSignal.timeout === "function"
      ? { signal: AbortSignal.timeout(timeoutMs) }
      : {}),
  };
}

function resolvePlacesApiKey() {
  return normalizeText(
    process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY
  );
}

function resolveRoutesApiKey() {
  return normalizeText(
    process.env.GOOGLE_MAPS_API_KEY ?? process.env.GOOGLE_PLACES_API_KEY
  );
}

function resolveMaxStopsPerDay() {
  return normalizeInteger(
    process.env.ROUTE_OPTIMIZER_MAX_STOPS_PER_DAY,
    DEFAULT_MAX_ROUTE_STOPS_PER_DAY
  );
}

function hasCoordinates(value) {
  const coordinates = normalizeGeoCoordinates(value);

  return (
    coordinates.latitude !== null &&
    coordinates.longitude !== null
  );
}

function createLatLngWaypoint(stop = {}) {
  const coordinates = normalizeGeoCoordinates(stop.geoCoordinates);
  return {
    waypoint: {
      location: {
        latLng: {
          latitude: coordinates.latitude,
          longitude: coordinates.longitude,
        },
      },
    },
  };
}

function calculateGreatCircleDistanceMeters(left = {}, right = {}) {
  const leftCoordinates = normalizeGeoCoordinates(left);
  const rightCoordinates = normalizeGeoCoordinates(right);

  if (!hasCoordinates(leftCoordinates) || !hasCoordinates(rightCoordinates)) {
    return Number.POSITIVE_INFINITY;
  }

  const earthRadiusMeters = 6_371_000;
  const toRadians = (value) => (value * Math.PI) / 180;
  const deltaLatitude = toRadians(
    rightCoordinates.latitude - leftCoordinates.latitude
  );
  const deltaLongitude = toRadians(
    rightCoordinates.longitude - leftCoordinates.longitude
  );
  const originLatitude = toRadians(leftCoordinates.latitude);
  const destinationLatitude = toRadians(rightCoordinates.latitude);
  const haversine =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(originLatitude) *
      Math.cos(destinationLatitude) *
      Math.sin(deltaLongitude / 2) ** 2;

  return (
    2 * earthRadiusMeters * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
  );
}

function buildStopClusterMetrics(stops = []) {
  const points = (Array.isArray(stops) ? stops : [])
    .map((stop) => normalizeGeoCoordinates(stop?.geoCoordinates))
    .filter((coordinates) => hasCoordinates(coordinates));

  if (points.length === 0) {
    return null;
  }

  const center = {
    latitude:
      points.reduce((total, point) => total + point.latitude, 0) / points.length,
    longitude:
      points.reduce((total, point) => total + point.longitude, 0) / points.length,
  };
  const radiusMeters = points.reduce(
    (maximum, point) =>
      Math.max(maximum, calculateGreatCircleDistanceMeters(point, center)),
    0
  );

  return {
    center,
    radiusMeters,
    points,
  };
}

function clampViewportToBounds(viewport = null, bounds = null) {
  if (!viewport) {
    return null;
  }

  if (!bounds) {
    return viewport;
  }

  const north = clampNumber(viewport.north, bounds.south, bounds.north);
  const south = clampNumber(viewport.south, bounds.south, bounds.north);
  const east = clampNumber(viewport.east, bounds.west, bounds.east);
  const west = clampNumber(viewport.west, bounds.west, bounds.east);

  if (north < south || east < west) {
    return viewport;
  }

  return {
    north,
    south,
    east,
    west,
  };
}

function buildDayClusterViewport(stops = [], fallbackBounds = null) {
  const cluster = buildStopClusterMetrics(stops);

  if (!cluster) {
    return fallbackBounds ? { ...fallbackBounds } : null;
  }

  const latitudes = cluster.points.map((point) => point.latitude);
  const longitudes = cluster.points.map((point) => point.longitude);
  const north = Math.max(...latitudes);
  const south = Math.min(...latitudes);
  const east = Math.max(...longitudes);
  const west = Math.min(...longitudes);
  const latitudeSpan = north - south;
  const longitudeSpan = east - west;
  const latitudePadding = Math.max(
    latitudeSpan * DEFAULT_LOCAL_VIEWPORT_PADDING_RATIO,
    DEFAULT_LOCAL_VIEWPORT_MIN_SPAN / 2
  );
  const longitudePadding = Math.max(
    longitudeSpan * DEFAULT_LOCAL_VIEWPORT_PADDING_RATIO,
    DEFAULT_LOCAL_VIEWPORT_MIN_SPAN / 2
  );

  return clampViewportToBounds(
    {
      north: north + latitudePadding,
      south: south - latitudePadding,
      east: east + longitudePadding,
      west: west - longitudePadding,
    },
    fallbackBounds
  );
}

function buildMapCenter(viewport = null) {
  if (!viewport) {
    return null;
  }

  return {
    latitude: Number(((viewport.north + viewport.south) / 2).toFixed(6)),
    longitude: Number(((viewport.east + viewport.west) / 2).toFixed(6)),
  };
}

function buildDayMapContext({
  stops = [],
  destination = "",
  fallbackBounds = null,
}) {
  const usableStops = Array.isArray(stops) ? stops : [];
  const hasClusterStops = usableStops.some((stop) => hasCoordinates(stop?.geoCoordinates));
  const mapViewport = buildDayClusterViewport(usableStops, fallbackBounds);

  return {
    localityLabel: resolveDominantLocalityLabel(usableStops, destination),
    mapViewport,
    mapCenter: buildMapCenter(mapViewport),
    viewportSource:
      hasClusterStops && mapViewport ? "day_cluster" : fallbackBounds ? "destination_fallback" : "unavailable",
  };
}

function filterLocalizedFallbackStops({
  fallbackStops = [],
  resolvedStops = [],
  cityBounds = null,
  destination = "",
  maxStops = 8,
}) {
  const boundedStops = (Array.isArray(fallbackStops) ? fallbackStops : []).filter((stop) =>
    isWithinBounds(stop?.geoCoordinates, cityBounds)
  );
  const candidateStops =
    boundedStops.length > 0 ? boundedStops : Array.isArray(fallbackStops) ? fallbackStops : [];
  const cluster = buildStopClusterMetrics(resolvedStops);
  const dominantLocalityKey = normalizeLabelKey(
    resolveDominantLocalityLabel(resolvedStops, destination)
  );

  const localizedStops = candidateStops.filter((stop) => {
    const localityKey = normalizeLabelKey(
      extractLocalityLabel(stop?.location, destination)
    );

    if (dominantLocalityKey && localityKey === dominantLocalityKey) {
      return true;
    }

    if (!cluster) {
      return true;
    }

    const distanceMeters = calculateGreatCircleDistanceMeters(
      stop?.geoCoordinates,
      cluster.center
    );
    const allowedRadiusMeters = Math.min(
      MAX_LOCAL_CLUSTER_RADIUS_METERS,
      Math.max(
        DEFAULT_LOCAL_CLUSTER_RADIUS_METERS,
        cluster.radiusMeters * 2.3 + 2_200
      )
    );

    return distanceMeters <= allowedRadiusMeters;
  });

  return (localizedStops.length > 0 ? localizedStops : candidateStops).slice(0, maxStops);
}

function normalizeStopSource(value = "") {
  const normalized = normalizeLabelKey(value);

  return STOP_SOURCE_PRIORITY[normalized] ? normalized : "unknown";
}

function countInferredStops(stops = []) {
  return (Array.isArray(stops) ? stops : []).filter(
    (stop) => normalizeStopSource(stop?.source) === "inferred"
  ).length;
}

function parseDurationSeconds(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  const duration = normalizeText(typeof value === "string" ? value : "");
  const match = duration.match(/^([0-9.]+)s$/);
  if (!match) {
    return null;
  }

  const parsed = Number.parseFloat(match[1]);
  return Number.isFinite(parsed) ? parsed : null;
}

function roundFinite(value) {
  return Number.isFinite(value) ? Math.round(value) : null;
}

function normalizeBounds(viewport = {}) {
  const north = parseCoordinate(viewport?.northEast?.latitude);
  const east = parseCoordinate(viewport?.northEast?.longitude);
  const south = parseCoordinate(viewport?.southWest?.latitude);
  const west = parseCoordinate(viewport?.southWest?.longitude);

  if (
    north === null ||
    east === null ||
    south === null ||
    west === null ||
    north < south
  ) {
    return null;
  }

  return { north, south, east, west };
}

function isWithinBounds(coordinates = {}, bounds = null) {
  if (!bounds) return true;
  const point = normalizeGeoCoordinates(coordinates);
  if (point.latitude === null || point.longitude === null) {
    return false;
  }
  return (
    point.latitude <= bounds.north &&
    point.latitude >= bounds.south &&
    point.longitude <= bounds.east &&
    point.longitude >= bounds.west
  );
}

async function fetchFallbackStopsForDay({
  day,
  aiPlanDay,
  destination,
  apiKey,
  fetchImpl,
  timeoutMs,
  maxStops,
}) {
  const queries = buildFallbackSearchQueries({
    day,
    aiPlanDay,
    destination,
  });

  if (!apiKey || queries.length === 0) {
    return [];
  }
  const seen = new Set();
  const fallbackStops = [];
  const minimumUsefulStopCount = Math.min(maxStops, 4);

  for (const query of queries) {
    const response = await fetchImpl(
      GOOGLE_PLACES_TEXT_SEARCH_URL,
      buildTimedFetchOptions(
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask": GOOGLE_PLACES_ROUTE_FIELD_MASK,
          },
          body: JSON.stringify({
            textQuery: query,
            languageCode: "en",
            maxResultCount: Math.max(3, Math.min(maxStops, 8)),
            rankPreference: "RELEVANCE",
          }),
        },
        timeoutMs
      )
    );

    if (!response.ok) {
      const message = await parseErrorResponse(response);
      console.warn("[routes] Fallback Places lookup failed", {
        query,
        message,
      });
      continue;
    }

    const payload = await response.json();
    const places = Array.isArray(payload?.places) ? payload.places : [];

    for (const place of places) {
      const name = normalizeText(place?.displayName?.text);
      const key = name.toLowerCase();

      if (!name || seen.has(key)) {
        continue;
      }

      seen.add(key);
      const geoCoordinates = normalizeGeoCoordinates(place?.location);
      fallbackStops.push({
        id: `${day?.dayNumber ?? 0}-fallback-${fallbackStops.length}`,
        dayNumber: day?.dayNumber,
        stopIndex: fallbackStops.length,
        name,
        source: "inferred",
        location: normalizeText(place?.formattedAddress, destination),
        description: "",
        category: "point_of_interest",
        geoCoordinates,
        mapsUrl: normalizeText(
          place?.googleMapsUri,
          buildGoogleMapsSearchUrl({
            name,
            destination,
            coordinates: geoCoordinates,
          })
        ),
      });

      if (fallbackStops.length >= maxStops) {
        return fallbackStops;
      }
    }

    if (fallbackStops.length >= minimumUsefulStopCount) {
      break;
    }
  }

  return fallbackStops.slice(0, maxStops);
}

function findAiPlanDayByNumber(trip = {}, dayNumber) {
  const aiPlanDays = Array.isArray(trip?.aiPlan?.days) ? trip.aiPlan.days : [];
  return (
    aiPlanDays.find(
      (day) => normalizeInteger(day?.day ?? day?.dayNumber, null) === dayNumber
    ) ?? null
  );
}

function mergeStopsWithPreference(primaryStops = [], secondaryStops = [], maxStops = 8) {
  const mergedStops = [];
  const indexByKey = new Map();

  function mergeDuplicateStops(existingStop = {}, incomingStop = {}) {
    const existingCoordinates = normalizeGeoCoordinates(existingStop?.geoCoordinates);
    const incomingCoordinates = normalizeGeoCoordinates(incomingStop?.geoCoordinates);
    const existingHasCoordinates = hasCoordinates(existingCoordinates);
    const incomingHasCoordinates = hasCoordinates(incomingCoordinates);
    const existingSource = normalizeStopSource(existingStop?.source);
    const incomingSource = normalizeStopSource(incomingStop?.source);
    const preferredSource =
      !existingHasCoordinates && incomingHasCoordinates
        ? incomingSource
        : STOP_SOURCE_PRIORITY[incomingSource] > STOP_SOURCE_PRIORITY[existingSource]
          ? incomingSource
          : existingSource;

    return {
      ...existingStop,
      name: normalizeText(existingStop?.name, normalizeText(incomingStop?.name)),
      location: normalizeText(
        existingStop?.location,
        normalizeText(incomingStop?.location)
      ),
      description: normalizeText(
        existingStop?.description,
        normalizeText(incomingStop?.description)
      ),
      category: normalizeText(
        existingStop?.category,
        normalizeText(incomingStop?.category)
      ),
      geoCoordinates:
        existingHasCoordinates || !incomingHasCoordinates
          ? existingCoordinates
          : incomingCoordinates,
      mapsUrl:
        !existingHasCoordinates && incomingHasCoordinates
          ? normalizeText(incomingStop?.mapsUrl, normalizeText(existingStop?.mapsUrl))
          : normalizeText(existingStop?.mapsUrl, normalizeText(incomingStop?.mapsUrl)),
      source: preferredSource,
    };
  }

  for (const stop of [...primaryStops, ...secondaryStops]) {
    const name = normalizeText(stop?.name);
    if (!name) {
      continue;
    }
    const key = name.toLowerCase();
    const existingIndex = indexByKey.get(key);

    if (existingIndex !== undefined) {
      mergedStops[existingIndex] = mergeDuplicateStops(mergedStops[existingIndex], stop);
      continue;
    }

    if (mergedStops.length >= maxStops) {
      continue;
    }

    mergedStops.push({
      ...stop,
      name,
    });
    indexByKey.set(key, mergedStops.length - 1);
  }

  return mergedStops;
}

function createAiPlanDayStops(aiPlanDay = {}, destination = "", maxStopsPerDay = 8) {
  const activities = Array.isArray(aiPlanDay?.activities) ? aiPlanDay.activities : [];
  const details = normalizeText(aiPlanDay?.tips, "Planned activity from the itinerary.");
  const dayNumber = normalizeInteger(aiPlanDay?.day ?? aiPlanDay?.dayNumber, 0);
  const uniqueStops = [];
  const seen = new Set();

  function pushStop(name, description) {
    const normalizedName = normalizeText(name);
    const key = normalizedName.toLowerCase();

    if (!normalizedName || seen.has(key) || uniqueStops.length >= maxStopsPerDay) {
      return;
    }

    seen.add(key);
    uniqueStops.push({
      id: `${dayNumber}-activity-${uniqueStops.length}`,
      dayNumber,
      stopIndex: uniqueStops.length,
      name: normalizedName,
      source: "ai_plan",
      location: destination,
      description: normalizeText(description, details),
      category: "activity",
      geoCoordinates: normalizeGeoCoordinates(null),
      mapsUrl: buildGoogleMapsSearchUrl({
        name: normalizedName,
        destination,
      }),
    });
  }

  for (const activity of activities) {
    const normalizedActivity = normalizeText(activity);
    const extractedPlaces = extractPlaceCandidatesFromText(activity);

    for (const candidate of extractedPlaces) {
      pushStop(candidate, normalizedActivity || details);
    }

    if (extractedPlaces.length === 0 && isLikelyPlaceCandidate(normalizedActivity)) {
      pushStop(normalizedActivity, details);
    }

    if (uniqueStops.length >= maxStopsPerDay) {
      return uniqueStops;
    }
  }

  if (uniqueStops.length < 2) {
    for (const candidate of extractPlaceCandidatesFromText(aiPlanDay?.title)) {
      pushStop(candidate, normalizeText(aiPlanDay?.title, details));
    }
  }

  return uniqueStops;
}

function buildRouteCacheKey({
  trip,
  optimizeFor,
  objective,
  constraints,
  alternativesCount,
  dayNumber,
}) {
  const itineraryDays = Array.isArray(trip?.itinerary?.days)
    ? trip.itinerary.days
    : [];
  const daySnapshot = itineraryDays
    .filter((day) => dayNumber === null || day.dayNumber === dayNumber)
    .map((day) => ({
      dayNumber: day.dayNumber,
      title: normalizeText(day.title),
      aiPlanTitle: normalizeText(findAiPlanDayByNumber(trip, day.dayNumber)?.title),
      activities: Array.isArray(
        findAiPlanDayByNumber(trip, day.dayNumber)?.activities
      )
        ? findAiPlanDayByNumber(trip, day.dayNumber).activities.map((activity) =>
            normalizeText(activity)
          )
        : [],
      places: Array.isArray(day.places)
        ? day.places.map((place) => ({
            name: normalizeText(place.placeName),
            coordinates: normalizeGeoCoordinates(place.geoCoordinates),
          }))
        : [],
    }));

  return JSON.stringify({
    version: ROUTE_CACHE_SCHEMA_VERSION,
    tripId: normalizeText(trip?.id),
    destination: normalizeText(trip?.userSelection?.location?.label),
    optimizeFor,
    objective,
    constraints: normalizeTripConstraints(constraints),
    alternativesCount: normalizeAlternativesCount(alternativesCount),
    dayNumber,
    daySnapshot,
  });
}

function createWeightMatrix(routeMatrix = [], weightKey = "durationSeconds") {
  return routeMatrix.map((row, rowIndex) =>
    row.map((cell, columnIndex) => {
      if (rowIndex === columnIndex) {
        return 0;
      }

      const value = cell?.[weightKey];
      return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
    })
  );
}

function resolveBudgetIntensity(userSelection = {}) {
  const budget = normalizeText(userSelection?.budget).toLowerCase();

  if (/luxury|premium/.test(budget)) {
    return 1.8;
  }

  if (/cheap|economy|budget/.test(budget)) {
    return 0.65;
  }

  return 1;
}

function estimateStopExperienceScore(stop = {}, stopIndex = 0) {
  const category = normalizeText(stop?.category).toLowerCase();
  const description = normalizeText(stop?.description);
  let score = 0.5;

  if (category) {
    score += 0.2;
  }

  if (/museum|heritage|cultural|historic|landmark/.test(category)) {
    score += 0.35;
  } else if (/food|dining|restaurant/.test(category)) {
    score += 0.22;
  } else if (/nature|beach|mountain|park/.test(category)) {
    score += 0.28;
  } else if (/shopping/.test(category)) {
    score += 0.12;
  }

  if (description.length > 80) {
    score += 0.1;
  }

  if (stopIndex === 0) {
    score -= 0.05;
  }

  return Math.max(0.1, Math.min(1.5, score));
}

function buildObjectiveWeightMatrix({
  routeMatrix = [],
  stops = [],
  objective = "fastest",
  constraints = {},
  userSelection = {},
}) {
  const budgetIntensity = resolveBudgetIntensity(userSelection);
  const dailyTimeLimitHours = normalizeInteger(
    constraints?.dailyTimeLimitHours,
    10
  );
  const dailyTimePenaltyFactor = dailyTimeLimitHours <= 8 ? 1.18 : 1;
  const stopScores = stops.map(estimateStopExperienceScore);

  return routeMatrix.map((row, rowIndex) =>
    row.map((cell, columnIndex) => {
      if (rowIndex === columnIndex) {
        return 0;
      }

      const durationSeconds = Number.isFinite(cell?.durationSeconds)
        ? cell.durationSeconds
        : Number.POSITIVE_INFINITY;
      const distanceMeters = Number.isFinite(cell?.distanceMeters)
        ? cell.distanceMeters
        : Number.POSITIVE_INFINITY;
      if (!Number.isFinite(durationSeconds) || !Number.isFinite(distanceMeters)) {
        return Number.POSITIVE_INFINITY;
      }

      const baseTravelCost = (distanceMeters / 1_000) * (4.5 * budgetIntensity);
      const baseDurationWeight = durationSeconds * dailyTimePenaltyFactor;
      const experienceBonus =
        ((stopScores[rowIndex] ?? 0.5) + (stopScores[columnIndex] ?? 0.5)) / 2;

      if (objective === "cheapest") {
        return baseTravelCost * 45 + baseDurationWeight * 0.18;
      }

      if (objective === "best_experience") {
        const scenicPenalty = baseDurationWeight * 0.55 + baseTravelCost * 16;
        return Math.max(1, scenicPenalty - experienceBonus * 40);
      }

      return baseDurationWeight;
    })
  );
}

function scoreAlternativeForObjective({
  objective,
  durationSeconds,
  estimatedCost,
  experienceScore,
  range,
}) {
  const durationRatio =
    range.duration.max > range.duration.min
      ? (durationSeconds - range.duration.min) /
        (range.duration.max - range.duration.min)
      : 0;
  const costRatio =
    range.cost.max > range.cost.min
      ? (estimatedCost - range.cost.min) / (range.cost.max - range.cost.min)
      : 0;
  const experienceRatio =
    range.experience.max > range.experience.min
      ? (experienceScore - range.experience.min) /
        (range.experience.max - range.experience.min)
      : 0;

  if (objective === "cheapest") {
    return (1 - costRatio) * 0.65 + (1 - durationRatio) * 0.35;
  }

  if (objective === "best_experience") {
    return experienceRatio * 0.6 + (1 - durationRatio) * 0.25 + (1 - costRatio) * 0.15;
  }

  return (1 - durationRatio) * 0.7 + (1 - costRatio) * 0.2 + experienceRatio * 0.1;
}

export function runDijkstraOnWeightMatrix(weightMatrix = [], startIndex = 0) {
  const distances = Array.from(
    { length: weightMatrix.length },
    () => Number.POSITIVE_INFINITY
  );
  const previous = Array.from({ length: weightMatrix.length }, () => null);
  const queue = [{ distance: 0, index: startIndex }];
  distances[startIndex] = 0;

  while (queue.length > 0) {
    queue.sort((left, right) => left.distance - right.distance);
    const current = queue.shift();

    if (!current || current.distance > distances[current.index]) {
      continue;
    }

    for (let neighborIndex = 0; neighborIndex < weightMatrix.length; neighborIndex += 1) {
      if (neighborIndex === current.index) {
        continue;
      }

      const edgeWeight = weightMatrix[current.index]?.[neighborIndex];
      if (!Number.isFinite(edgeWeight)) {
        continue;
      }

      const nextDistance = current.distance + edgeWeight;
      if (nextDistance >= distances[neighborIndex]) {
        continue;
      }

      distances[neighborIndex] = nextDistance;
      previous[neighborIndex] = current.index;
      queue.push({
        distance: nextDistance,
        index: neighborIndex,
      });
    }
  }

  return {
    distances: distances.map((value) =>
      Number.isFinite(value) ? value : null
    ),
    previous,
  };
}

export function runPrimOnWeightMatrix(weightMatrix = []) {
  if (weightMatrix.length === 0) {
    return {
      totalWeight: 0,
      edges: [],
    };
  }

  const visited = new Set([0]);
  const edges = [];
  let totalWeight = 0;

  while (visited.size < weightMatrix.length) {
    let bestEdge = null;

    for (const fromIndex of visited) {
      for (let toIndex = 0; toIndex < weightMatrix.length; toIndex += 1) {
        if (visited.has(toIndex) || fromIndex === toIndex) {
          continue;
        }

        const weight = weightMatrix[fromIndex]?.[toIndex];
        if (!Number.isFinite(weight)) {
          continue;
        }

        if (!bestEdge || weight < bestEdge.weight) {
          bestEdge = {
            fromIndex,
            toIndex,
            weight,
          };
        }
      }
    }

    if (!bestEdge) {
      break;
    }

    visited.add(bestEdge.toIndex);
    totalWeight += bestEdge.weight;
    edges.push(bestEdge);
  }

  return {
    totalWeight,
    edges,
  };
}

function calculatePathWeight(weightMatrix = [], visitOrder = []) {
  let totalWeight = 0;

  for (let index = 0; index < visitOrder.length - 1; index += 1) {
    const fromIndex = visitOrder[index];
    const toIndex = visitOrder[index + 1];
    const weight = weightMatrix[fromIndex]?.[toIndex];

    if (!Number.isFinite(weight)) {
      return Number.POSITIVE_INFINITY;
    }

    totalWeight += weight;
  }

  return totalWeight;
}

function buildNearestNeighborOrder({
  weightMatrix = [],
  startIndex = 0,
  endIndex = null,
}) {
  const nodeCount = weightMatrix.length;
  if (nodeCount === 0) {
    return [];
  }

  const unvisited = new Set(
    Array.from({ length: nodeCount }, (_, index) => index)
  );
  unvisited.delete(startIndex);

  const hasFixedEnd = Number.isInteger(endIndex) && endIndex !== startIndex;
  if (hasFixedEnd) {
    unvisited.delete(endIndex);
  }

  const order = [startIndex];
  let currentIndex = startIndex;

  while (unvisited.size > 0) {
    let bestIndex = null;
    let bestWeight = Number.POSITIVE_INFINITY;

    for (const candidateIndex of unvisited) {
      const weight = weightMatrix[currentIndex]?.[candidateIndex];
      if (!Number.isFinite(weight) || weight >= bestWeight) {
        continue;
      }

      bestWeight = weight;
      bestIndex = candidateIndex;
    }

    if (bestIndex === null) {
      break;
    }

    order.push(bestIndex);
    unvisited.delete(bestIndex);
    currentIndex = bestIndex;
  }

  if (hasFixedEnd) {
    order.push(endIndex);
  }

  return order;
}

function improveOrderWithTwoOpt(weightMatrix = [], visitOrder = [], options = {}) {
  if (visitOrder.length < 4) {
    return visitOrder;
  }

  const fixedStart = options.fixedStart !== false;
  const fixedEnd = options.fixedEnd !== false;
  let bestOrder = [...visitOrder];
  let bestWeight = calculatePathWeight(weightMatrix, bestOrder);
  let improved = true;

  while (improved) {
    improved = false;

    for (let leftIndex = fixedStart ? 1 : 0; leftIndex < bestOrder.length - 2; leftIndex += 1) {
      const rightBoundary = fixedEnd ? bestOrder.length - 2 : bestOrder.length - 1;

      for (let rightIndex = leftIndex + 1; rightIndex <= rightBoundary; rightIndex += 1) {
        const candidateOrder = [
          ...bestOrder.slice(0, leftIndex),
          ...bestOrder.slice(leftIndex, rightIndex + 1).reverse(),
          ...bestOrder.slice(rightIndex + 1),
        ];
        const candidateWeight = calculatePathWeight(weightMatrix, candidateOrder);

        if (candidateWeight + 1e-9 >= bestWeight) {
          continue;
        }

        bestOrder = candidateOrder;
        bestWeight = candidateWeight;
        improved = true;
      }
    }
  }

  return bestOrder;
}

function normalizeVisitOrder(visitOrder = [], nodeCount, startIndex, endIndex) {
  if (!Array.isArray(visitOrder) || visitOrder.length === 0) {
    return null;
  }

  const normalizedOrder = visitOrder
    .map((value) => normalizeInteger(value, null))
    .filter((value) => Number.isInteger(value));
  const uniqueValues = new Set(normalizedOrder);

  if (uniqueValues.size !== nodeCount) {
    return null;
  }

  if (
    normalizedOrder.some((value) => value < 0 || value >= nodeCount) ||
    normalizedOrder[0] !== startIndex
  ) {
    return null;
  }

  if (Number.isInteger(endIndex) && endIndex !== startIndex) {
    if (normalizedOrder[normalizedOrder.length - 1] !== endIndex) {
      return null;
    }
  }

  return normalizedOrder;
}

function reconstructShortestPath(previous = [], originIndex, destinationIndex) {
  if (!Number.isInteger(originIndex) || !Number.isInteger(destinationIndex)) {
    return [];
  }

  const path = [];
  let currentIndex = destinationIndex;
  const visited = new Set();

  while (Number.isInteger(currentIndex) && !visited.has(currentIndex)) {
    path.unshift(currentIndex);
    if (currentIndex === originIndex) {
      return path;
    }
    visited.add(currentIndex);
    currentIndex = previous[currentIndex];
  }

  return path[0] === originIndex ? path : [];
}

function runDijkstraFastestOptimizer({
  routeMatrix,
  originIndex,
  destinationIndex,
}) {
  const weightMatrix = createWeightMatrix(routeMatrix, "durationSeconds");
  const shortestPathsFromOrigin = runDijkstraOnWeightMatrix(weightMatrix, originIndex);
  const mst = runPrimOnWeightMatrix(weightMatrix);
  const visitOrder = [originIndex];
  const unvisited = new Set(
    Array.from({ length: weightMatrix.length }, (_, index) => index)
  );

  unvisited.delete(originIndex);

  if (Number.isInteger(destinationIndex) && destinationIndex !== originIndex) {
    unvisited.delete(destinationIndex);
  }

  let currentIndex = originIndex;

  while (unvisited.size > 0) {
    const nextPaths = runDijkstraOnWeightMatrix(weightMatrix, currentIndex);
    let nextIndex = null;
    let nextDistance = Number.POSITIVE_INFINITY;

    for (const candidateIndex of unvisited) {
      const candidateDistance = nextPaths.distances[candidateIndex];

      if (!Number.isFinite(candidateDistance) || candidateDistance >= nextDistance) {
        continue;
      }

      nextDistance = candidateDistance;
      nextIndex = candidateIndex;
    }

    if (!Number.isInteger(nextIndex)) {
      break;
    }

    const pathIndices = reconstructShortestPath(
      nextPaths.previous,
      currentIndex,
      nextIndex
    );
    const nextNodes =
      pathIndices.length > 1
        ? pathIndices.slice(1).filter((index) => unvisited.has(index))
        : [nextIndex];

    for (const nodeIndex of nextNodes) {
      visitOrder.push(nodeIndex);
      unvisited.delete(nodeIndex);
      currentIndex = nodeIndex;
    }
  }

  for (const remainingIndex of unvisited) {
    visitOrder.push(remainingIndex);
  }

  if (Number.isInteger(destinationIndex) && destinationIndex !== originIndex) {
    visitOrder.push(destinationIndex);
  }

  return {
    algorithm: "dijkstra-fastest",
    visitOrder: normalizeVisitOrder(
      visitOrder,
      weightMatrix.length,
      originIndex,
      destinationIndex
    ) ?? visitOrder,
    totalWeight: calculatePathWeight(weightMatrix, visitOrder),
    shortestPathsFromOrigin: shortestPathsFromOrigin.distances,
    previous: shortestPathsFromOrigin.previous,
    mst,
  };
}

function runLocalRouteOptimizerOnWeightMatrix({
  weightMatrix,
  algorithm = "js-nearest-neighbor-2opt",
  originIndex,
  destinationIndex,
}) {
  const initialOrder = buildNearestNeighborOrder({
    weightMatrix,
    startIndex: originIndex,
    endIndex: destinationIndex,
  });
  const visitOrder = improveOrderWithTwoOpt(weightMatrix, initialOrder, {
    fixedStart: true,
    fixedEnd: Number.isInteger(destinationIndex) && destinationIndex !== originIndex,
  });
  const shortestPaths = runDijkstraOnWeightMatrix(weightMatrix, originIndex);
  const mst = runPrimOnWeightMatrix(weightMatrix);

  return {
    algorithm,
    visitOrder,
    totalWeight: calculatePathWeight(weightMatrix, visitOrder),
    shortestPathsFromOrigin: shortestPaths.distances,
    previous: shortestPaths.previous,
    mst,
  };
}

function runLocalRouteOptimizer({
  routeMatrix,
  optimizeFor,
  originIndex,
  destinationIndex,
}) {
  const weightKey =
    optimizeFor === "distance" ? "distanceMeters" : "durationSeconds";
  const weightMatrix = createWeightMatrix(routeMatrix, weightKey);

  return runLocalRouteOptimizerOnWeightMatrix({
    weightMatrix,
    algorithm: "js-nearest-neighbor-2opt",
    originIndex,
    destinationIndex,
  });
}

async function runPythonRouteOptimizer({
  routeMatrix,
  optimizeFor,
  originIndex,
  destinationIndex,
}) {
  if (process.env.PYTHON_ROUTE_OPTIMIZER_ENABLED !== "true") {
    return null;
  }

  const pythonExecutable = normalizeText(
    process.env.PYTHON_EXECUTABLE,
    "python3"
  );
  const scriptPath = path.resolve(__dirname, "..", "..", "..", "route_optimizer.py");
  const weightKey =
    optimizeFor === "distance" ? "distanceMeters" : "durationSeconds";
  const payload = {
    matrix: routeMatrix.map((row) =>
      row.map((cell) =>
        Number.isFinite(cell?.[weightKey]) ? cell[weightKey] : null
      )
    ),
    originIndex,
    destinationIndex,
  };

  return new Promise((resolve, reject) => {
    const child = spawn(pythonExecutable, [scriptPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            normalizeText(stderr, `Python optimizer exited with code ${code}.`)
          )
        );
        return;
      }

      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(error);
      }
    });

    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  });
}

async function parseErrorResponse(response) {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const payload = await response.json();
    return (
      payload?.error?.message ??
      payload?.message ??
      `HTTP ${response.status}`
    );
  }

  const text = await response.text();
  return normalizeText(text, `HTTP ${response.status}`);
}

function createFallbackRouteMatrix(stops = []) {
  const fallbackSpeedMetersPerSecond = normalizePositiveNumber(
    process.env.ROUTE_OPTIMIZER_FALLBACK_SPEED_MPS,
    DEFAULT_FALLBACK_DRIVE_SPEED_METERS_PER_SECOND
  );

  return stops.map((origin, originIndex) =>
    stops.map((destination, destinationIndex) => {
      if (originIndex === destinationIndex) {
        return {
          distanceMeters: 0,
          durationSeconds: 0,
        };
      }

      const distanceMeters = calculateGreatCircleDistanceMeters(
        origin.geoCoordinates,
        destination.geoCoordinates
      );

      return {
        distanceMeters,
        durationSeconds: Number.isFinite(distanceMeters)
          ? distanceMeters / fallbackSpeedMetersPerSecond
          : Number.POSITIVE_INFINITY,
      };
    })
  );
}

async function geocodeStopWithPlaces({
  stop,
  destination,
  apiKey,
  fetchImpl,
  timeoutMs,
  geocodeCache,
  cityBounds = null,
}) {
  const query = normalizeText([stop.name, destination].filter(Boolean).join(", "));
  if (!query || !apiKey) {
    return null;
  }

  const cacheKey = query.toLowerCase();
  if (geocodeCache.has(cacheKey)) {
    return geocodeCache.get(cacheKey);
  }

  const geocodePromise = (async () => {
    console.info("[routes] Geocoding itinerary stop", {
      stopName: stop.name,
      destination,
    });

    const response = await fetchImpl(
      GOOGLE_PLACES_TEXT_SEARCH_URL,
      buildTimedFetchOptions(
        {
          method: "POST",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask": GOOGLE_PLACES_ROUTE_FIELD_MASK,
          },
          body: JSON.stringify({
            textQuery: query,
            languageCode: "en",
            maxResultCount: 5,
            rankPreference: "RELEVANCE",
          }),
        },
        timeoutMs
      )
    );

    if (!response.ok) {
      const message = await parseErrorResponse(response);
      throw new Error(
        `Place lookup failed with status ${response.status}: ${message}`
      );
    }

    const payload = await response.json();
    const places = Array.isArray(payload?.places) ? payload.places : [];
    const place =
      places.find((candidate) =>
        isWithinBounds(candidate?.location, cityBounds)
      ) ?? places[0] ?? null;

    if (!place?.location) {
      return null;
    }

    return {
      geoCoordinates: normalizeGeoCoordinates(place.location),
      location: normalizeText(place.formattedAddress, destination),
      mapsUrl: normalizeText(
        place.googleMapsUri,
        buildGoogleMapsSearchUrl({
          name: stop.name,
          destination,
          coordinates: place.location,
        })
      ),
    };
  })().catch((error) => {
    console.warn("[routes] Failed to geocode itinerary stop", {
      stopName: stop.name,
      destination,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  });

  geocodeCache.set(cacheKey, geocodePromise);
  return geocodePromise;
}

async function geocodeCityBounds({
  destination,
  apiKey,
  fetchImpl,
  timeoutMs,
}) {
  const query = normalizeText(destination);
  if (!apiKey || !query) {
    return null;
  }

  const response = await fetchImpl(
    GOOGLE_PLACES_TEXT_SEARCH_URL,
    buildTimedFetchOptions(
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": GOOGLE_PLACES_ROUTE_FIELD_MASK,
        },
        body: JSON.stringify({
          textQuery: query,
          languageCode: "en",
          maxResultCount: 1,
          rankPreference: "RELEVANCE",
        }),
      },
      timeoutMs
    )
  );

  if (!response.ok) {
    const message = await parseErrorResponse(response);
    console.warn("[routes] City bounds lookup failed", { destination, message });
    return null;
  }

  const payload = await response.json();
  const place = Array.isArray(payload?.places) ? payload.places[0] : null;
  const bounds = normalizeBounds(place?.viewport);
  if (!bounds) {
    return null;
  }

  return bounds;
}

async function fetchGoogleRouteMatrix({
  stops,
  apiKey,
  fetchImpl,
  timeoutMs,
}) {
  const routeMatrix = createFallbackRouteMatrix(stops);

  if (!apiKey) {
    return {
      routeMatrix,
      provider: "estimated-haversine",
      usedEstimatedFallback: true,
    };
  }

  const response = await fetchImpl(
    GOOGLE_ROUTES_MATRIX_URL,
    buildTimedFetchOptions(
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": GOOGLE_ROUTE_MATRIX_FIELD_MASK,
        },
        body: JSON.stringify({
          origins: stops.map(createLatLngWaypoint),
          destinations: stops.map(createLatLngWaypoint),
          travelMode: "DRIVE",
          routingPreference: "TRAFFIC_AWARE",
          languageCode: "en-US",
          units: "METRIC",
        }),
      },
      timeoutMs
    )
  );

  if (!response.ok) {
    const message = await parseErrorResponse(response);
    console.warn("[routes] Route matrix request failed, using estimated fallback", {
      message,
    });
    return {
      routeMatrix,
      provider: "estimated-haversine",
      usedEstimatedFallback: true,
    };
  }

  const payload = await response.json();
  const elements = Array.isArray(payload) ? payload : [];
  let missingElementCount = 0;

  for (const element of elements) {
    const originIndex = normalizeInteger(element?.originIndex, null);
    const destinationIndex = normalizeInteger(element?.destinationIndex, null);

    if (
      !Number.isInteger(originIndex) ||
      !Number.isInteger(destinationIndex) ||
      originIndex < 0 ||
      destinationIndex < 0 ||
      originIndex >= stops.length ||
      destinationIndex >= stops.length
    ) {
      continue;
    }

    if (originIndex === destinationIndex) {
      routeMatrix[originIndex][destinationIndex] = {
        distanceMeters: 0,
        durationSeconds: 0,
      };
      continue;
    }

    const routeExists =
      !element?.condition || element.condition === "ROUTE_EXISTS";
    const durationSeconds = parseDurationSeconds(element?.duration);
    const distanceMeters = Number.isFinite(element?.distanceMeters)
      ? element.distanceMeters
      : null;

    if (!routeExists || durationSeconds === null || !Number.isFinite(distanceMeters)) {
      missingElementCount += 1;
      continue;
    }

    routeMatrix[originIndex][destinationIndex] = {
      distanceMeters,
      durationSeconds,
    };
  }

  if (missingElementCount > 0) {
    console.info("[routes] Route matrix filled missing elements with estimated fallback", {
      missingElementCount,
      stopCount: stops.length,
    });
  }

  return {
    routeMatrix,
    provider: "google-routes-matrix",
    usedEstimatedFallback: missingElementCount > 0,
  };
}

async function fetchGoogleRoutePreview({
  orderedStops,
  apiKey,
  fetchImpl,
  timeoutMs,
}) {
  if (!apiKey || orderedStops.length < 2) {
    return null;
  }

  const response = await fetchImpl(
    GOOGLE_ROUTES_COMPUTE_URL,
    buildTimedFetchOptions(
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": GOOGLE_COMPUTE_ROUTE_FIELD_MASK,
        },
        body: JSON.stringify({
          origin: createLatLngWaypoint(orderedStops[0]).waypoint,
          destination: createLatLngWaypoint(
            orderedStops[orderedStops.length - 1]
          ).waypoint,
          intermediates: orderedStops
            .slice(1, -1)
            .map((stop) => createLatLngWaypoint(stop).waypoint),
          travelMode: "DRIVE",
          routingPreference: "TRAFFIC_AWARE",
          polylineQuality: "HIGH_QUALITY",
          polylineEncoding: "ENCODED_POLYLINE",
          languageCode: "en-US",
          units: "METRIC",
        }),
      },
      timeoutMs
    )
  );

  if (!response.ok) {
    const message = await parseErrorResponse(response);
    console.warn("[routes] Route preview request failed", {
      message,
    });
    return null;
  }

  const payload = await response.json();
  const route = Array.isArray(payload?.routes) ? payload.routes[0] : null;

  if (!route) {
    return null;
  }

  return {
    polyline: normalizeText(route?.polyline?.encodedPolyline),
    distanceMeters: Number.isFinite(route?.distanceMeters)
      ? route.distanceMeters
      : null,
    durationSeconds: parseDurationSeconds(route?.duration),
  };
}

function createRawDayStops({
  day = {},
  aiPlanDay = null,
  destination = "",
  maxStopsPerDay,
}) {
  const dayPlaces = Array.isArray(day.places) ? day.places : [];
  const uniqueStops = [];
  const seen = new Set();

  for (const place of dayPlaces) {
    const name = normalizeText(place?.placeName ?? place?.name);
    if (!name) {
      continue;
    }

    const key = name.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    uniqueStops.push({
      id: `${day.dayNumber}-${uniqueStops.length}`,
      dayNumber: day.dayNumber,
      stopIndex: uniqueStops.length,
      name,
      source: "itinerary",
      location: normalizeText(place?.location ?? destination, destination),
      description: normalizeText(place?.placeDetails ?? place?.description),
      category: normalizeText(place?.category),
      geoCoordinates: normalizeGeoCoordinates(place?.geoCoordinates),
      mapsUrl: buildGoogleMapsSearchUrl({
        name,
        destination,
        coordinates: place?.geoCoordinates,
      }),
    });
    seen.add(key);

    if (uniqueStops.length >= maxStopsPerDay) {
      break;
    }
  }

  return mergeStopsWithPreference(
    createAiPlanDayStops(aiPlanDay, destination, maxStopsPerDay),
    uniqueStops,
    maxStopsPerDay
  );
}

function buildMarkersFromOrderedStops(orderedStops = []) {
  return orderedStops
    .map((stop, index) => {
      const coordinates = normalizeGeoCoordinates(stop?.geoCoordinates);
      if (coordinates.latitude === null || coordinates.longitude === null) {
        return null;
      }

      return {
        id: stop.id ?? `${index + 1}-${stop.name ?? "stop"}`,
        name: normalizeText(stop.name, `Stop ${index + 1}`),
        location: normalizeText(stop.location),
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
        visitOrder: index + 1,
        mapsUrl: normalizeText(stop.mapsUrl),
        source: normalizeStopSource(stop?.source),
      };
    })
    .filter(Boolean);
}

function formatRouteWarning({
  provider,
  usedEstimatedFallback,
  unresolvedStops,
  truncatedStops,
  usedFallbackPlaces = false,
}) {
  const warnings = [];

  if (provider === "estimated-haversine" || usedEstimatedFallback) {
    warnings.push(
      "Live Google route data was unavailable for part of this plan, so straight-line estimates were used for the route graph."
    );
  }

  if (unresolvedStops.length > 0) {
    warnings.push(
      `Some itinerary stops could not be geocoded and were excluded: ${unresolvedStops
        .map((stop) => stop.name)
        .join(", ")}.`
    );
  }

  if (truncatedStops) {
    warnings.push(
      "Only the first group of itinerary stops was optimized for this day to keep route computation within API limits."
    );
  }

  if (usedFallbackPlaces) {
    warnings.push(
      "Some day stops were inferred from Google Places because the itinerary text could not be geocoded directly."
    );
  }

  return warnings.join(" ");
}

function formatMstWithStopNames(mst = {}, stops = []) {
  return {
    totalWeight: roundFinite(mst.totalWeight),
    edges: Array.isArray(mst.edges)
      ? mst.edges.map((edge) => ({
          fromIndex: edge.fromIndex,
          fromName: stops[edge.fromIndex]?.name ?? "",
          toIndex: edge.toIndex,
          toName: stops[edge.toIndex]?.name ?? "",
          weight: roundFinite(edge.weight),
        }))
      : [],
  };
}

function buildRouteGraphPayload({
  optimizerResult = {},
  weightMetric = "duration_seconds",
}) {
  return {
    algorithm: normalizeText(optimizerResult?.algorithm),
    weightMetric,
    totalWeight: roundFinite(optimizerResult?.totalWeight),
    shortestPaths: Array.isArray(optimizerResult?.shortestPathsFromOrigin)
      ? optimizerResult.shortestPathsFromOrigin.map(roundFinite)
      : [],
    previous: Array.isArray(optimizerResult?.previous)
      ? optimizerResult.previous.map((value) =>
          Number.isInteger(value) ? value : null
        )
      : [],
  };
}

function buildSegmentDetails({
  orderedStopsWithGraphIndex = [],
  routeMatrix = [],
  shortestPaths = [],
}) {
  const details = [];
  let cumulativeDistanceMeters = 0;
  let cumulativeDurationSeconds = 0;

  for (let index = 0; index < orderedStopsWithGraphIndex.length - 1; index += 1) {
    const originStop = orderedStopsWithGraphIndex[index];
    const destinationStop = orderedStopsWithGraphIndex[index + 1];
    const segment = routeMatrix[originStop.graphIndex]?.[destinationStop.graphIndex];
    const distanceMeters = roundFinite(segment?.distanceMeters) ?? 0;
    const durationSeconds = roundFinite(segment?.durationSeconds) ?? 0;

    cumulativeDistanceMeters += distanceMeters;
    cumulativeDurationSeconds += durationSeconds;

    details.push({
      segmentNumber: index + 1,
      fromId: originStop.id,
      fromName: originStop.name,
      toId: destinationStop.id,
      toName: destinationStop.name,
      distanceMeters,
      durationSeconds,
      cumulativeDistanceMeters,
      cumulativeDurationSeconds,
      shortestPathFromStartSeconds: roundFinite(
        shortestPaths?.[destinationStop.graphIndex]
      ),
    });
  }

  return details;
}

function estimateRouteCost({
  totalDistanceMeters,
  totalDurationSeconds,
  userSelection = {},
}) {
  const budgetIntensity = resolveBudgetIntensity(userSelection);
  const distanceCost = (totalDistanceMeters / 1_000) * 4.25 * budgetIntensity;
  const timeCost = (totalDurationSeconds / 60) * 0.42;
  return roundFinite(distanceCost + timeCost);
}

function estimateRouteExperience({
  orderedStops = [],
  totalDurationSeconds,
}) {
  const baseScore = orderedStops.reduce(
    (total, stop, index) => total + estimateStopExperienceScore(stop, index),
    0
  );
  const durationPenalty = (Number.isFinite(totalDurationSeconds) ? totalDurationSeconds : 0) / 4_800;
  const score = Math.max(1, baseScore * 10 - durationPenalty * 3.5);
  return Number(score.toFixed(1));
}

function computeRange(values = []) {
  const finiteValues = values.filter(Number.isFinite);
  if (finiteValues.length === 0) {
    return {
      min: 0,
      max: 0,
    };
  }

  return {
    min: Math.min(...finiteValues),
    max: Math.max(...finiteValues),
  };
}

function formatObjectiveLabel(objective) {
  if (objective === "best_experience") {
    return "Best Experience";
  }

  if (objective === "cheapest") {
    return "Cheapest";
  }

  return "Fastest";
}

function buildTradeoffDelta(selected, baselineFastest) {
  if (!baselineFastest) {
    return {
      minutesVsFastest: 0,
      costVsFastest: 0,
      experienceVsFastest: 0,
    };
  }

  return {
    minutesVsFastest: roundFinite(
      (selected.totalDurationSeconds - baselineFastest.totalDurationSeconds) / 60
    ),
    costVsFastest: roundFinite(
      selected.estimatedCost - baselineFastest.estimatedCost
    ),
    experienceVsFastest: Number(
      (selected.experienceScore - baselineFastest.experienceScore).toFixed(1)
    ),
  };
}

function formatDurationLabelForExplanation(durationSeconds) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return "unavailable";
  }

  const minutes = Math.round(durationSeconds / 60);
  if (minutes < 60) {
    return `${minutes} min`;
  }

  const hours = Math.floor(minutes / 60);
  const remainderMinutes = minutes % 60;
  if (remainderMinutes === 0) {
    return `${hours} hr`;
  }

  return `${hours} hr ${remainderMinutes} min`;
}

function matrixResultProviderFromDays(days = []) {
  const providers = new Set(
    (Array.isArray(days) ? days : [])
      .map((day) => normalizeText(day?.routeProvider))
      .filter(Boolean)
  );

  if (providers.size === 0) {
    return "not-applicable";
  }

  if (providers.size === 1) {
    return [...providers][0];
  }

  return "mixed";
}

function createMapBackedRouteCacheStore({
  cache = new Map(),
  now = () => Date.now(),
  ttlMs = DEFAULT_ROUTE_CACHE_TTL_MS,
} = {}) {
  return {
    mode: "map",
    async get(key, options = {}) {
      const entry = cache.get(String(key));
      if (!entry) {
        return null;
      }

      const current = now();
      if (current <= entry.freshUntil) {
        return {
          value: entry.value,
          isStale: false,
        };
      }

      if (options.allowStale && current <= entry.staleUntil) {
        return {
          value: entry.value,
          isStale: true,
        };
      }

      cache.delete(String(key));
      return null;
    },
    async set(key, value, options = {}) {
      const freshTtlMs = normalizeInteger(options.ttlMs, ttlMs);
      const staleTtlMs = normalizeInteger(
        options.staleTtlMs,
        Math.min(ttlMs, 5 * 60 * 1000)
      );
      const createdAt = now();

      cache.set(String(key), {
        value,
        freshUntil: createdAt + freshTtlMs,
        staleUntil: createdAt + freshTtlMs + staleTtlMs,
      });
    },
    stats() {
      return {
        size: cache.size,
      };
    },
  };
}

export function createTripRouteService({
  now = () => Date.now(),
  cache = new Map(),
  cacheStore = null,
  cacheTtlMs = DEFAULT_ROUTE_CACHE_TTL_MS,
  timeoutMs = DEFAULT_ROUTE_REQUEST_TIMEOUT_MS,
  fetchImpl = fetch,
  resolvePlacesKey = resolvePlacesApiKey,
  resolveRoutesKey = resolveRoutesApiKey,
  maxStopsPerDay = resolveMaxStopsPerDay(),
  pythonRouteOptimizer = runPythonRouteOptimizer,
} = {}) {
  const localCacheStore =
    cacheStore ??
    (cache instanceof Map
      ? createMapBackedRouteCacheStore({
          cache,
          now,
          ttlMs: cacheTtlMs,
        })
      : createMemoryCacheStore({
          now,
          defaultTtlMs: cacheTtlMs,
          defaultStaleTtlMs: Math.min(cacheTtlMs, 5 * 60 * 1000),
        }));

  async function getRoutesForTrip({
    trip,
    optimizeFor = "duration",
    objective = "",
    constraints = {},
    alternativesCount = null,
    dayNumber = null,
  }) {
    const derivedObjective =
      objective ||
      trip?.userSelection?.objective ||
      (optimizeFor === "distance" ? "cheapest" : "fastest");
    const normalizedObjective = normalizeTripObjective(derivedObjective);
    const normalizedConstraints = normalizeTripConstraints(
      constraints ?? trip?.userSelection?.constraints
    );
    const normalizedAlternativesCount = normalizeAlternativesCount(
      alternativesCount ?? trip?.userSelection?.alternativesCount
    );
    const normalizedOptimizeFor =
      optimizeFor === "distance"
        ? "distance"
        : normalizedObjective === "cheapest"
          ? "distance"
          : "duration";
    const normalizedDayNumber = normalizeInteger(dayNumber, null);
    const cacheKey = buildRouteCacheKey({
      trip,
      optimizeFor: normalizedOptimizeFor,
      objective: normalizedObjective,
      constraints: normalizedConstraints,
      alternativesCount: normalizedAlternativesCount,
      dayNumber: normalizedDayNumber,
    });
    const cached = await localCacheStore.get(cacheKey, {
      allowStale: true,
    });

    if (cached) {
      console.info("[routes] Returning cached optimized routes", {
        tripId: trip?.id ?? null,
        optimizeFor: normalizedOptimizeFor,
        objective: normalizedObjective,
        dayNumber: normalizedDayNumber,
        stale: cached.isStale,
      });

      const staleWarning = cached.isStale
        ? "Route cache is stale while a fresh computation is pending."
        : "";

      return {
        ...cached.value,
        sourceProvenance: {
          ...(cached.value?.sourceProvenance ?? {}),
          cache: {
            status: cached.isStale ? "stale" : "fresh",
          },
        },
        warning: normalizeText([cached.value?.warning, staleWarning].join(" ")),
      };
    }

    const destination = normalizeText(trip?.userSelection?.location?.label);
    const itineraryDays = Array.isArray(trip?.itinerary?.days)
      ? trip.itinerary.days
      : [];
    const scopedDays = itineraryDays.filter(
      (day) => normalizedDayNumber === null || day.dayNumber === normalizedDayNumber
    );
    const placesApiKey = resolvePlacesKey();
    const routesApiKey = resolveRoutesKey();
    const geocodeCache = new Map();
    const routeDays = [];
    const cityBounds = await geocodeCityBounds({
      destination,
      apiKey: placesApiKey || routesApiKey,
      fetchImpl,
      timeoutMs,
    });

    for (const day of scopedDays) {
      const aiPlanDay = findAiPlanDayByNumber(trip, day.dayNumber);
      let dayStops = createRawDayStops({
        day,
        aiPlanDay,
        destination,
        maxStopsPerDay,
      });
      const itineraryStopCount = Array.isArray(day?.places) ? day.places.length : 0;
      const aiActivityCount = Array.isArray(aiPlanDay?.activities)
        ? aiPlanDay.activities.filter((activity) => normalizeText(activity)).length
        : 0;
      let truncatedStops = Math.max(itineraryStopCount, aiActivityCount) > dayStops.length;
      let usedFallbackPlaces = false;

      if (dayStops.length < 2) {
        const fallbackStops = await fetchFallbackStopsForDay({
          day,
          aiPlanDay,
          destination,
          apiKey: placesApiKey,
          fetchImpl,
          timeoutMs,
          maxStops: maxStopsPerDay,
        });

        if (fallbackStops.length >= 2) {
          dayStops = fallbackStops;
          truncatedStops = false;
          usedFallbackPlaces = true;
          console.info("[routes] Applied fallback Places stops for day", {
            dayNumber: day.dayNumber,
            destination,
            count: dayStops.length,
          });
        }
      }

      if (dayStops.length < 2) {
        routeDays.push({
          dayNumber: day.dayNumber,
          title: normalizeText(day.title, `Day ${day.dayNumber}`),
          status: "needs-more-stops",
          objective: normalizedObjective,
          objectiveLabel: formatObjectiveLabel(normalizedObjective),
          algorithm: "not-applicable",
          routeProvider: "not-applicable",
          inputStopCount: dayStops.length,
          resolvedStopCount: dayStops.length,
          orderedStops: dayStops,
          markers: buildMarkersFromOrderedStops(dayStops),
          segments: [],
          alternatives: [],
          totalDistanceMeters: 0,
          totalDurationSeconds: 0,
          estimatedCost: 0,
          experienceScore: 0,
          paretoScore: 0,
          explanation: {
            whySelected:
              "At least two recognizable stops are required before multi-objective optimization can run.",
            tradeoffDelta: {
              minutesVsFastest: 0,
              costVsFastest: 0,
              experienceVsFastest: 0,
            },
          },
          shortestPathsFromStart: [],
          mst: { totalWeight: 0, edges: [] },
          directionsUrl: dayStops.length === 1
            ? buildGoogleMapsSearchUrl({
                name: dayStops[0].name,
                destination,
                coordinates: dayStops[0].geoCoordinates,
              })
            : "",
          polyline: "",
          warning: formatRouteWarning({
            provider: "not-applicable",
            usedEstimatedFallback: false,
            unresolvedStops: [],
            truncatedStops,
            usedFallbackPlaces,
          }),
          unresolvedStops: [],
          cityBounds,
        });
        continue;
      }

      let resolvedStops = [];
      let unresolvedStops = [];
      const geocodeResults = await Promise.all(
        dayStops.map(async (stop) => {
          if (hasCoordinates(stop.geoCoordinates)) {
            return {
              stop,
              geocodedStop: {
                geoCoordinates: normalizeGeoCoordinates(stop.geoCoordinates),
                location: stop.location,
                mapsUrl: stop.mapsUrl,
              },
            };
          }

          const geocodedStop = await geocodeStopWithPlaces({
            stop,
            destination,
            apiKey: placesApiKey,
            fetchImpl,
            timeoutMs,
            geocodeCache,
            cityBounds,
          });

          return {
            stop,
            geocodedStop,
          };
        })
      );

      for (const result of geocodeResults) {
        const coordinates = normalizeGeoCoordinates(result?.geocodedStop?.geoCoordinates);

        if (!hasCoordinates(coordinates) || !isWithinBounds(coordinates, cityBounds)) {
          unresolvedStops.push(result.stop);
          continue;
        }

        resolvedStops.push({
          ...result.stop,
          geoCoordinates: coordinates,
          location: normalizeText(result?.geocodedStop?.location, result.stop.location),
          mapsUrl: normalizeText(result?.geocodedStop?.mapsUrl, result.stop.mapsUrl),
        });
      }

      if (resolvedStops.length < 2) {
        const fallbackStops = (await fetchFallbackStopsForDay({
          day,
          aiPlanDay,
          destination,
          apiKey: placesApiKey,
          fetchImpl,
          timeoutMs,
          maxStops: maxStopsPerDay,
        })).filter((stop) => isWithinBounds(stop.geoCoordinates, cityBounds));

        const mergedResolvedStops = mergeStopsWithPreference(
          resolvedStops,
          fallbackStops,
          maxStopsPerDay
        );

        if (mergedResolvedStops.length >= 2) {
          resolvedStops = mergedResolvedStops;
          usedFallbackPlaces = true;
          console.info("[routes] Filled missing geocoded stops with fallback Places results", {
            dayNumber: day.dayNumber,
            destination,
            resolvedStopCount: resolvedStops.length,
          });
        }
      }

      if (resolvedStops.length < 2) {
        routeDays.push({
          dayNumber: day.dayNumber,
          title: normalizeText(day.title, `Day ${day.dayNumber}`),
          status: "insufficient-geocoded-stops",
          objective: normalizedObjective,
          objectiveLabel: formatObjectiveLabel(normalizedObjective),
          algorithm: "not-applicable",
          routeProvider: "not-applicable",
          inputStopCount: dayStops.length,
          resolvedStopCount: resolvedStops.length,
          orderedStops: resolvedStops,
          markers: buildMarkersFromOrderedStops(resolvedStops),
          segments: [],
          alternatives: [],
          totalDistanceMeters: 0,
          totalDurationSeconds: 0,
          estimatedCost: 0,
          experienceScore: 0,
          paretoScore: 0,
          explanation: {
            whySelected:
              "At least two geocoded stops are required before route optimization can run.",
            tradeoffDelta: {
              minutesVsFastest: 0,
              costVsFastest: 0,
              experienceVsFastest: 0,
            },
          },
          shortestPathsFromStart: [],
          mst: { totalWeight: 0, edges: [] },
          directionsUrl: "",
          polyline: "",
          warning: formatRouteWarning({
            provider: "not-applicable",
            usedEstimatedFallback: false,
            unresolvedStops,
            truncatedStops,
            usedFallbackPlaces,
          }),
          unresolvedStops,
          cityBounds,
        });
        continue;
      }

      const matrixResult = await fetchGoogleRouteMatrix({
        stops: resolvedStops,
        apiKey: routesApiKey,
        fetchImpl,
        timeoutMs,
      });
      const profileAlternatives = [];

      for (const profile of OBJECTIVE_PROFILES) {
        let optimizerResult = null;

        if (profile === "fastest") {
          const optimizerInput = {
            routeMatrix: matrixResult.routeMatrix,
            optimizeFor: "duration",
            originIndex: 0,
            destinationIndex: null,
          };

          try {
            optimizerResult =
              typeof pythonRouteOptimizer === "function"
                ? await pythonRouteOptimizer(optimizerInput)
                : null;
          } catch (error) {
            console.warn("[routes] Python route optimizer failed, using JS fallback", {
              message: error instanceof Error ? error.message : String(error),
            });
          }

          if (!optimizerResult) {
            optimizerResult = runLocalRouteOptimizer(optimizerInput);
          } else {
            const normalizedVisitOrder = normalizeVisitOrder(
              optimizerResult.visitOrder,
              resolvedStops.length,
              0,
              null
            );

            optimizerResult = normalizedVisitOrder
              ? {
                  ...optimizerResult,
                  visitOrder: normalizedVisitOrder,
                }
              : runLocalRouteOptimizer(optimizerInput);
          }
        } else {
          const objectiveWeightMatrix = buildObjectiveWeightMatrix({
            routeMatrix: matrixResult.routeMatrix,
            stops: resolvedStops,
            objective: profile,
            constraints: normalizedConstraints,
            userSelection: trip?.userSelection,
          });

          optimizerResult = runLocalRouteOptimizerOnWeightMatrix({
            weightMatrix: objectiveWeightMatrix,
            originIndex: 0,
            destinationIndex: null,
            algorithm:
              profile === "cheapest"
                ? "js-cheapest-weighted-2opt"
                : "js-experience-orienteering-2opt",
          });
        }

        const orderedStopsWithGraphIndex = optimizerResult.visitOrder.map((graphIndex) => ({
          ...resolvedStops[graphIndex],
          graphIndex,
        }));
        const segments = [];

        for (let index = 0; index < orderedStopsWithGraphIndex.length - 1; index += 1) {
          const originStop = orderedStopsWithGraphIndex[index];
          const destinationStop = orderedStopsWithGraphIndex[index + 1];
          const segment = matrixResult.routeMatrix[originStop.graphIndex]?.[
            destinationStop.graphIndex
          ];

          segments.push({
            fromName: originStop.name,
            toName: destinationStop.name,
            distanceMeters: roundFinite(segment?.distanceMeters),
            durationSeconds: roundFinite(segment?.durationSeconds),
          });
        }

        const totalDistanceMeters = segments.reduce(
          (total, segment) => total + (segment.distanceMeters ?? 0),
          0
        );
        const totalDurationSeconds = segments.reduce(
          (total, segment) => total + (segment.durationSeconds ?? 0),
          0
        );
        const estimatedCost = estimateRouteCost({
          totalDistanceMeters,
          totalDurationSeconds,
          userSelection: trip?.userSelection,
        });
        const experienceScore = estimateRouteExperience({
          orderedStops: orderedStopsWithGraphIndex,
          totalDurationSeconds,
        });

        profileAlternatives.push({
          objective: profile,
          objectiveLabel: formatObjectiveLabel(profile),
          optimizerResult,
          orderedStopsWithGraphIndex,
          orderedStops: orderedStopsWithGraphIndex.map((stop) => ({
            id: stop.id,
            name: stop.name,
            location: stop.location,
            description: stop.description,
            category: stop.category,
            geoCoordinates: stop.geoCoordinates,
            mapsUrl: stop.mapsUrl,
          })),
          segments,
          totalDistanceMeters: roundFinite(totalDistanceMeters),
          totalDurationSeconds: roundFinite(totalDurationSeconds),
          estimatedCost: estimatedCost ?? 0,
          experienceScore,
        });
      }

      const range = {
        duration: computeRange(
          profileAlternatives.map((alternative) => alternative.totalDurationSeconds)
        ),
        cost: computeRange(
          profileAlternatives.map((alternative) => alternative.estimatedCost)
        ),
        experience: computeRange(
          profileAlternatives.map((alternative) => alternative.experienceScore)
        ),
      };
      const scoredAlternatives = profileAlternatives
        .map((alternative) => ({
          ...alternative,
          score: scoreAlternativeForObjective({
            objective: normalizedObjective,
            durationSeconds: alternative.totalDurationSeconds,
            estimatedCost: alternative.estimatedCost,
            experienceScore: alternative.experienceScore,
            range,
          }),
        }))
        .sort((left, right) => right.score - left.score);
      const selectedAlternative =
        scoredAlternatives.find(
          (alternative) => alternative.objective === normalizedObjective
        ) ?? scoredAlternatives[0];
      const baselineFastest = scoredAlternatives.find(
        (alternative) => alternative.objective === "fastest"
      );
      const routePreview = await fetchGoogleRoutePreview({
        orderedStops: selectedAlternative.orderedStopsWithGraphIndex,
        apiKey: routesApiKey,
        fetchImpl,
        timeoutMs,
      });
      const selectedTotalDistanceMeters =
        routePreview?.distanceMeters ?? selectedAlternative.totalDistanceMeters;
      const selectedTotalDurationSeconds =
        routePreview?.durationSeconds ?? selectedAlternative.totalDurationSeconds;
      const selectedTradeoffDelta = buildTradeoffDelta(
        selectedAlternative,
        baselineFastest
      );
      const selectedExplanation = `Selected ${
        selectedAlternative.objectiveLabel
      } route balancing travel time ${formatDurationLabelForExplanation(
        selectedTotalDurationSeconds
      )}, estimated cost ${selectedAlternative.estimatedCost}, and experience score ${
        selectedAlternative.experienceScore
      }.`;

      routeDays.push({
        dayNumber: day.dayNumber,
        title: normalizeText(day.title, `Day ${day.dayNumber}`),
        status: "ready",
        objective: normalizedObjective,
        objectiveLabel: formatObjectiveLabel(normalizedObjective),
        algorithm: normalizeText(
          selectedAlternative.optimizerResult.algorithm,
          "js-nearest-neighbor-2opt"
        ),
        routeProvider: matrixResult.provider,
        inputStopCount: dayStops.length,
        resolvedStopCount: resolvedStops.length,
        orderedStops: selectedAlternative.orderedStops,
        markers: buildMarkersFromOrderedStops(selectedAlternative.orderedStops),
        segments: selectedAlternative.segments,
        alternatives: scoredAlternatives
          .slice(0, normalizedAlternativesCount)
          .map((alternative, index) => ({
            rank: index + 1,
            objective: alternative.objective,
            objectiveLabel: alternative.objectiveLabel,
            algorithm: normalizeText(alternative.optimizerResult.algorithm),
            paretoScore: Number(alternative.score.toFixed(3)),
            totalDistanceMeters: alternative.totalDistanceMeters,
            totalDurationSeconds: alternative.totalDurationSeconds,
            estimatedCost: alternative.estimatedCost,
            experienceScore: alternative.experienceScore,
            stopNames: alternative.orderedStops.map((stop) => stop.name),
            tradeoffDelta: buildTradeoffDelta(alternative, baselineFastest),
          })),
        totalDistanceMeters: roundFinite(selectedTotalDistanceMeters),
        totalDurationSeconds: roundFinite(selectedTotalDurationSeconds),
        estimatedCost: selectedAlternative.estimatedCost,
        experienceScore: selectedAlternative.experienceScore,
        paretoScore: Number(selectedAlternative.score.toFixed(3)),
        explanation: {
          whySelected: selectedExplanation,
          tradeoffDelta: selectedTradeoffDelta,
        },
        shortestPathsFromStart: Array.isArray(
          selectedAlternative.optimizerResult.shortestPathsFromOrigin
        )
          ? selectedAlternative.optimizerResult.shortestPathsFromOrigin.map(roundFinite)
          : [],
        mst: formatMstWithStopNames(
          selectedAlternative.optimizerResult.mst,
          resolvedStops
        ),
        directionsUrl: buildGoogleMapsDirectionsUrl({
          origin: selectedAlternative.orderedStopsWithGraphIndex[0],
          destination:
            selectedAlternative.orderedStopsWithGraphIndex[
              selectedAlternative.orderedStopsWithGraphIndex.length - 1
            ],
          waypoints: selectedAlternative.orderedStopsWithGraphIndex.slice(1, -1),
          travelMode: "driving",
        }),
        polyline: normalizeText(routePreview?.polyline),
        warning: formatRouteWarning({
          provider: matrixResult.provider,
          usedEstimatedFallback: matrixResult.usedEstimatedFallback,
          unresolvedStops,
          truncatedStops,
          usedFallbackPlaces,
        }),
        unresolvedStops: unresolvedStops.map((stop) => ({
          id: stop.id,
          name: stop.name,
        })),
        cityBounds,
      });
    }

    const selectedDay =
      routeDays.find((dayRoute) => dayRoute.status === "ready") ?? routeDays[0] ?? null;

    const result = {
      tripId: normalizeText(trip?.id),
      destination,
      optimizeFor: normalizedOptimizeFor,
      objective: normalizedObjective,
      constraints: normalizedConstraints,
      alternativesCount: normalizedAlternativesCount,
      optimizationMeta: {
        objective: normalizedObjective,
        alternativesCount: normalizedAlternativesCount,
        method: "pareto-multi-objective-routing",
        generatedAt: new Date().toISOString(),
        constraints: normalizedConstraints,
      },
      sourceProvenance: {
        primaryProvider: "google-routes",
        sources: [
          {
            provider: matrixResultProviderFromDays(routeDays),
            sourceType: "routing-api",
            fetchedAt: new Date().toISOString(),
          },
        ],
        cache: {
          status: "miss",
        },
      },
      dayCount: routeDays.length,
      days: routeDays,
      selectedDayDefault: selectedDay?.dayNumber ?? null,
      generatedAt: new Date().toISOString(),
      cityBounds,
      mapPolyline: normalizeText(selectedDay?.polyline),
    };

    await localCacheStore.set(cacheKey, result, {
      ttlMs: cacheTtlMs,
      staleTtlMs: Math.min(cacheTtlMs, 5 * 60 * 1000),
    });

    console.info("[routes] Trip route optimization complete", {
      tripId: trip?.id ?? null,
      dayCount: routeDays.length,
      optimizeFor: normalizedOptimizeFor,
      objective: normalizedObjective,
    });

    return result;
  }

  return {
    getRoutesForTrip,
    cache: localCacheStore,
  };
}

const tripRouteService = createTripRouteService();

export const getRoutesForTrip = tripRouteService.getRoutesForTrip;
