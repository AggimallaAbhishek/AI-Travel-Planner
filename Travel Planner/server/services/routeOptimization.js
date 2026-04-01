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
const ROUTE_CACHE_SCHEMA_VERSION = "v1-day-routes";
const OBJECTIVE_PROFILES = [
  "fastest",
  "cheapest",
  "best_experience",
];

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

function normalizePositiveNumber(value, fallback) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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

function buildRouteCacheKey({ trip, optimizeFor, dayNumber }) {
  const itineraryDays = Array.isArray(trip?.itinerary?.days)
    ? trip.itinerary.days
    : [];
  const daySnapshot = itineraryDays
    .filter((day) => dayNumber === null || day.dayNumber === dayNumber)
    .map((day) => ({
      dayNumber: day.dayNumber,
      title: normalizeText(day.title),
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

function runLocalRouteOptimizer({
  routeMatrix,
  optimizeFor,
  originIndex,
  destinationIndex,
}) {
  const weightKey =
    optimizeFor === "distance" ? "distanceMeters" : "durationSeconds";
  const weightMatrix = createWeightMatrix(routeMatrix, weightKey);
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
    algorithm: "js-nearest-neighbor-2opt",
    visitOrder,
    totalWeight: calculatePathWeight(weightMatrix, visitOrder),
    shortestPathsFromOrigin: shortestPaths.distances,
    previous: shortestPaths.previous,
    mst,
  };
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
            maxResultCount: 1,
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
    const place = Array.isArray(payload?.places) ? payload.places[0] : null;

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

function createRawDayStops(day = {}, destination = "", maxStopsPerDay) {
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

  return uniqueStops;
}

function formatRouteWarning({
  provider,
  usedEstimatedFallback,
  unresolvedStops,
  truncatedStops,
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

export function createTripRouteService({
  now = () => Date.now(),
  cache = new Map(),
  cacheTtlMs = DEFAULT_ROUTE_CACHE_TTL_MS,
  timeoutMs = DEFAULT_ROUTE_REQUEST_TIMEOUT_MS,
  fetchImpl = fetch,
  resolvePlacesKey = resolvePlacesApiKey,
  resolveRoutesKey = resolveRoutesApiKey,
  maxStopsPerDay = resolveMaxStopsPerDay(),
  pythonRouteOptimizer = runPythonRouteOptimizer,
} = {}) {
  async function getRoutesForTrip({
    trip,
    optimizeFor = "duration",
    dayNumber = null,
  }) {
    const normalizedOptimizeFor =
      optimizeFor === "distance" ? "distance" : "duration";
    const normalizedDayNumber = normalizeInteger(dayNumber, null);
    const cacheKey = buildRouteCacheKey({
      trip,
      optimizeFor: normalizedOptimizeFor,
      dayNumber: normalizedDayNumber,
    });
    const cached = cache.get(cacheKey);

    if (cached && now() - cached.createdAt < cacheTtlMs) {
      console.info("[routes] Returning cached optimized routes", {
        tripId: trip?.id ?? null,
        optimizeFor: normalizedOptimizeFor,
        dayNumber: normalizedDayNumber,
      });
      return cached.value;
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

    for (const day of scopedDays) {
      const rawDayStops = createRawDayStops(day, destination, maxStopsPerDay);
      const truncatedStops =
        Array.isArray(day?.places) && day.places.length > rawDayStops.length;

      if (rawDayStops.length < 2) {
        routeDays.push({
          dayNumber: day.dayNumber,
          title: normalizeText(day.title, `Day ${day.dayNumber}`),
          status: "needs-more-stops",
          algorithm: "not-applicable",
          routeProvider: "not-applicable",
          inputStopCount: rawDayStops.length,
          resolvedStopCount: rawDayStops.length,
          orderedStops: rawDayStops,
          segments: [],
          totalDistanceMeters: 0,
          totalDurationSeconds: 0,
          shortestPathsFromStart: [],
          mst: { totalWeight: 0, edges: [] },
          directionsUrl: rawDayStops.length === 1
            ? buildGoogleMapsSearchUrl({
                name: rawDayStops[0].name,
                destination,
                coordinates: rawDayStops[0].geoCoordinates,
              })
            : "",
          polyline: "",
          warning: formatRouteWarning({
            provider: "not-applicable",
            usedEstimatedFallback: false,
            unresolvedStops: [],
            truncatedStops,
          }),
          unresolvedStops: [],
        });
        continue;
      }

      const resolvedStops = [];
      const unresolvedStops = [];

      for (const stop of rawDayStops) {
        if (hasCoordinates(stop.geoCoordinates)) {
          resolvedStops.push(stop);
          continue;
        }

        const geocodedStop = await geocodeStopWithPlaces({
          stop,
          destination,
          apiKey: placesApiKey,
          fetchImpl,
          timeoutMs,
          geocodeCache,
        });

        if (!geocodedStop?.geoCoordinates || !hasCoordinates(geocodedStop.geoCoordinates)) {
          unresolvedStops.push(stop);
          continue;
        }

        resolvedStops.push({
          ...stop,
          geoCoordinates: geocodedStop.geoCoordinates,
          location: geocodedStop.location,
          mapsUrl: geocodedStop.mapsUrl,
        });
      }

      if (resolvedStops.length < 2) {
        routeDays.push({
          dayNumber: day.dayNumber,
          title: normalizeText(day.title, `Day ${day.dayNumber}`),
          status: "insufficient-geocoded-stops",
          algorithm: "not-applicable",
          routeProvider: "not-applicable",
          inputStopCount: rawDayStops.length,
          resolvedStopCount: resolvedStops.length,
          orderedStops: resolvedStops,
          segments: [],
          totalDistanceMeters: 0,
          totalDurationSeconds: 0,
          shortestPathsFromStart: [],
          mst: { totalWeight: 0, edges: [] },
          directionsUrl: "",
          polyline: "",
          warning: formatRouteWarning({
            provider: "not-applicable",
            usedEstimatedFallback: false,
            unresolvedStops,
            truncatedStops,
          }),
          unresolvedStops,
        });
        continue;
      }

      const matrixResult = await fetchGoogleRouteMatrix({
        stops: resolvedStops,
        apiKey: routesApiKey,
        fetchImpl,
        timeoutMs,
      });
      const optimizerInput = {
        routeMatrix: matrixResult.routeMatrix,
        optimizeFor: normalizedOptimizeFor,
        originIndex: 0,
        destinationIndex: null,
      };

      let optimizerResult = null;

      try {
        optimizerResult = await pythonRouteOptimizer(optimizerInput);
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

      const orderedStops = optimizerResult.visitOrder.map((graphIndex) => ({
        ...resolvedStops[graphIndex],
        graphIndex,
      }));
      const routePreview = await fetchGoogleRoutePreview({
        orderedStops,
        apiKey: routesApiKey,
        fetchImpl,
        timeoutMs,
      });
      const segments = [];

      for (let index = 0; index < orderedStops.length - 1; index += 1) {
        const originStop = orderedStops[index];
        const destinationStop = orderedStops[index + 1];
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

      const totalDistanceMeters = routePreview?.distanceMeters ?? segments.reduce(
        (total, segment) => total + (segment.distanceMeters ?? 0),
        0
      );
      const totalDurationSeconds = routePreview?.durationSeconds ?? segments.reduce(
        (total, segment) => total + (segment.durationSeconds ?? 0),
        0
      );

      routeDays.push({
        dayNumber: day.dayNumber,
        title: normalizeText(day.title, `Day ${day.dayNumber}`),
        status: "ready",
        algorithm: normalizeText(
          optimizerResult.algorithm,
          "js-nearest-neighbor-2opt"
        ),
        routeProvider: matrixResult.provider,
        inputStopCount: rawDayStops.length,
        resolvedStopCount: resolvedStops.length,
        orderedStops: orderedStops.map((stop) => ({
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
        shortestPathsFromStart: Array.isArray(
          optimizerResult.shortestPathsFromOrigin
        )
          ? optimizerResult.shortestPathsFromOrigin.map(roundFinite)
          : [],
        mst: formatMstWithStopNames(optimizerResult.mst, resolvedStops),
        directionsUrl: buildGoogleMapsDirectionsUrl({
          origin: orderedStops[0],
          destination: orderedStops[orderedStops.length - 1],
          waypoints: orderedStops.slice(1, -1),
          travelMode: "driving",
        }),
        polyline: normalizeText(routePreview?.polyline),
        warning: formatRouteWarning({
          provider: matrixResult.provider,
          usedEstimatedFallback: matrixResult.usedEstimatedFallback,
          unresolvedStops,
          truncatedStops,
        }),
        unresolvedStops: unresolvedStops.map((stop) => ({
          id: stop.id,
          name: stop.name,
        })),
      });
    }

    const result = {
      tripId: normalizeText(trip?.id),
      destination,
      optimizeFor: normalizedOptimizeFor,
      dayCount: routeDays.length,
      days: routeDays,
      generatedAt: new Date().toISOString(),
    };

    cache.set(cacheKey, {
      createdAt: now(),
      value: result,
    });

    console.info("[routes] Trip route optimization complete", {
      tripId: trip?.id ?? null,
      dayCount: routeDays.length,
      optimizeFor: normalizedOptimizeFor,
    });

    return result;
  }

  return {
    getRoutesForTrip,
    cache,
  };
}

const tripRouteService = createTripRouteService();

export const getRoutesForTrip = tripRouteService.getRoutesForTrip;
