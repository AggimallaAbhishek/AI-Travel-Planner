import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createBoundedTtlCache } from "../lib/boundedTtlCache.js";
import { verifyMultimodalRoutes } from "./gemini.js";
import { runPythonTransportOptimization } from "./pythonOptimizer.js";

function normalizeText(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized || fallback;
}

function normalizeLookupKey(value) {
  return normalizeText(String(value ?? ""))
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }

  return fallback;
}

function parseModes(values = []) {
  if (!Array.isArray(values)) {
    return [];
  }

  return [
    ...new Set(
      values
        .map((value) => normalizeText(String(value ?? "")).toLowerCase())
        .filter((value) => ["flight", "train", "road"].includes(value))
    ),
  ];
}

function resolveTransportOptionsCacheTtlMs() {
  return parsePositiveInteger(
    process.env.INDIA_TRANSPORT_OPTIONS_CACHE_TTL_MS,
    DEFAULT_TRANSPORT_OPTIONS_CACHE_TTL_MS
  );
}

function resolveTransportMaxTransfers(value) {
  return parsePositiveInteger(
    value ?? process.env.INDIA_TRANSPORT_MAX_TRANSFERS,
    DEFAULT_TRANSPORT_MAX_TRANSFERS
  );
}

function resolveTransportTopK(value) {
  return parsePositiveInteger(
    value ?? process.env.INDIA_TRANSPORT_TOP_K,
    DEFAULT_TRANSPORT_TOP_K
  );
}

function getTransportCacheKey({
  origin,
  destinationId,
  preferredModes = [],
  maxTransfers,
  topK,
}) {
  return [
    normalizeLookupKey(origin),
    normalizeText(destinationId),
    preferredModes.join(","),
    String(maxTransfers),
    String(topK),
  ].join("::");
}

const currentFilePath = fileURLToPath(import.meta.url);
const currentDirPath = path.dirname(currentFilePath);
const indiaDataDirPath = path.resolve(currentDirPath, "../data/india");
const indiaDatasetPaths = {
  destinations: path.join(indiaDataDirPath, "india_destinations.json"),
  attractions: path.join(indiaDataDirPath, "india_attractions.json"),
  transportCities: path.join(indiaDataDirPath, "india_transport_cities.json"),
  transportRoutes: path.join(indiaDataDirPath, "india_transport_routes.json"),
  destinationHubs: path.join(indiaDataDirPath, "india_destination_hubs.json"),
};

let cachedSnapshot = null;
const DEFAULT_TRANSPORT_OPTIONS_CACHE_TTL_MS = 5 * 60 * 1_000;
const DEFAULT_TRANSPORT_OPTIONS_CACHE_MAX_ENTRIES = 200;
const DEFAULT_TRANSPORT_MAX_TRANSFERS = 4;
const DEFAULT_TRANSPORT_TOP_K = 4;
const TRANSPORT_OPTIONS_CACHE = createBoundedTtlCache({
  defaultTtlMs: DEFAULT_TRANSPORT_OPTIONS_CACHE_TTL_MS,
  maxEntries: DEFAULT_TRANSPORT_OPTIONS_CACHE_MAX_ENTRIES,
});

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function scoreMatch(candidate = {}, normalizedQuery = "") {
  const name = normalizeLookupKey(candidate.destination_name);
  const state = normalizeLookupKey(candidate.state_ut_name);
  const label = normalizeLookupKey(
    `${candidate.destination_name} ${candidate.state_ut_name} india`
  );
  const tags = Array.isArray(candidate.tags)
    ? candidate.tags.map((tag) => normalizeLookupKey(tag)).join(" ")
    : "";

  let score = 0;

  if (!normalizedQuery) {
    return score;
  }

  if (name === normalizedQuery) {
    score += 350;
  } else if (name.startsWith(normalizedQuery)) {
    score += 240;
  } else if (name.includes(normalizedQuery)) {
    score += 160;
  }

  if (label.startsWith(normalizedQuery)) {
    score += 120;
  } else if (label.includes(normalizedQuery)) {
    score += 85;
  }

  if (state.startsWith(normalizedQuery)) {
    score += 75;
  } else if (state.includes(normalizedQuery)) {
    score += 45;
  }

  if (tags.includes(normalizedQuery)) {
    score += 35;
  }

  return score;
}

function buildLookupValues(destination = {}) {
  return [
    destination.destination_id,
    destination.destination_name,
    destination.destination_slug,
    `${destination.destination_name}, ${destination.state_ut_name}`,
    `${destination.destination_name}, ${destination.state_ut_name}, India`,
  ]
    .map((value) => normalizeLookupKey(String(value ?? "")))
    .filter(Boolean);
}

function ensureIndiaDatasetExists() {
  const missingPaths = Object.values(indiaDatasetPaths).filter(
    (filePath) => !fs.existsSync(filePath)
  );
  if (missingPaths.length > 0) {
    const error = new Error(
      "India data files are missing. Run `python3 ./scripts/buildIndiaTravelData.py` to generate them."
    );
    error.code = "india-data/missing-dataset";
    error.missingPaths = missingPaths;
    throw error;
  }
}

export function clearIndiaDataCache() {
  cachedSnapshot = null;
  TRANSPORT_OPTIONS_CACHE.clear();
}

export function loadIndiaDataSnapshot() {
  if (cachedSnapshot) {
    return cachedSnapshot;
  }

  ensureIndiaDatasetExists();

  const destinations = readJsonFile(indiaDatasetPaths.destinations);
  const attractions = readJsonFile(indiaDatasetPaths.attractions);
  const transportCities = readJsonFile(indiaDatasetPaths.transportCities);
  const transportRoutes = readJsonFile(indiaDatasetPaths.transportRoutes);
  const destinationHubs = readJsonFile(indiaDatasetPaths.destinationHubs);

  const destinationById = new Map();
  const destinationsByLookupKey = new Map();
  const attractionsByDestinationId = new Map();
  const transportCityById = new Map();
  const transportCityByLookupKey = new Map();
  const routesBySourceCityId = new Map();
  const hubsByDestinationId = new Map();

  for (const destination of destinations) {
    destinationById.set(destination.destination_id, destination);
    for (const lookupValue of buildLookupValues(destination)) {
      if (!destinationsByLookupKey.has(lookupValue)) {
        destinationsByLookupKey.set(lookupValue, destination);
      }
    }
  }

  for (const attraction of attractions) {
    const destinationId = attraction.destination_id;
    const existing = attractionsByDestinationId.get(destinationId) ?? [];
    existing.push(attraction);
    attractionsByDestinationId.set(destinationId, existing);
  }

  for (const transportCity of transportCities) {
    transportCityById.set(transportCity.city_id, transportCity);

    const lookupValues = [
      transportCity.canonical_name,
      ...(Array.isArray(transportCity.aliases) ? transportCity.aliases : []),
    ];

    for (const lookupValue of lookupValues) {
      const key = normalizeLookupKey(lookupValue);
      if (!key || transportCityByLookupKey.has(key)) {
        continue;
      }
      transportCityByLookupKey.set(key, transportCity);
    }
  }

  for (const route of transportRoutes) {
    const sourceCityId = route.source_city_id;
    const existing = routesBySourceCityId.get(sourceCityId) ?? [];
    existing.push(route);
    routesBySourceCityId.set(sourceCityId, existing);
  }

  for (const hub of destinationHubs) {
    const destinationId = hub.destination_id;
    const existing = hubsByDestinationId.get(destinationId) ?? [];
    existing.push(hub);
    hubsByDestinationId.set(destinationId, existing);
  }

  for (const [destinationId, hubs] of hubsByDestinationId.entries()) {
    hubs.sort((left, right) => left.hub_rank - right.hub_rank);
    hubsByDestinationId.set(destinationId, hubs);
  }

  cachedSnapshot = {
    destinations,
    attractions,
    transportCities,
    transportRoutes,
    destinationHubs,
    destinationById,
    destinationsByLookupKey,
    attractionsByDestinationId,
    transportCityById,
    transportCityByLookupKey,
    routesBySourceCityId,
    hubsByDestinationId,
  };

  return cachedSnapshot;
}

export function searchIndiaDestinations(query = "", options = {}) {
  const snapshot = loadIndiaDataSnapshot();
  const normalizedQuery = normalizeLookupKey(query);
  const limit = parsePositiveInteger(options.limit, 10);

  const ranked = snapshot.destinations
    .map((destination) => ({
      destination,
      score: normalizedQuery ? scoreMatch(destination, normalizedQuery) : 0,
      hubCount: (snapshot.hubsByDestinationId.get(destination.destination_id) ?? [])
        .length,
      attractionCount: (
        snapshot.attractionsByDestinationId.get(destination.destination_id) ?? []
      ).length,
    }))
    .filter((entry) => (normalizedQuery ? entry.score > 0 : true))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }

      if (right.hubCount !== left.hubCount) {
        return right.hubCount - left.hubCount;
      }

      if (right.attractionCount !== left.attractionCount) {
        return right.attractionCount - left.attractionCount;
      }

      return left.destination.destination_name.localeCompare(
        right.destination.destination_name
      );
    })
    .slice(0, limit)
    .map((entry) => ({
      destinationId: entry.destination.destination_id,
      destinationName: entry.destination.destination_name,
      stateUtName: entry.destination.state_ut_name,
      label: `${entry.destination.destination_name}, ${entry.destination.state_ut_name}, India`,
      primaryText: entry.destination.destination_name,
      secondaryText: `${entry.destination.state_ut_name}, India`,
      imageUrl: entry.destination.image_url,
      source: "india_dataset",
      transportCoverage:
        entry.hubCount > 0 ? "available" : "none",
    }));

  console.info("[india-data] Destination search completed", {
    query: String(query ?? ""),
    count: ranked.length,
  });

  return ranked;
}

export function resolveIndiaDestination(query = "") {
  const snapshot = loadIndiaDataSnapshot();
  const normalizedQuery = normalizeLookupKey(query);

  if (!normalizedQuery) {
    return null;
  }

  return snapshot.destinationsByLookupKey.get(normalizedQuery) ?? null;
}

export function getIndiaDestinationDetail(destinationId = "") {
  const snapshot = loadIndiaDataSnapshot();
  const destination = snapshot.destinationById.get(String(destinationId ?? "").trim());

  if (!destination) {
    return null;
  }

  const attractions = snapshot.attractionsByDestinationId.get(destination.destination_id) ?? [];
  const hubs = (snapshot.hubsByDestinationId.get(destination.destination_id) ?? []).map((hub) => ({
    ...hub,
    city: snapshot.transportCityById.get(hub.city_id) ?? null,
  }));

  return {
    destination,
    attractions,
    hubs,
    transportCoverage: hubs.length > 0 ? "available" : "none",
  };
}

function resolveTransportCity(query = "", snapshot = loadIndiaDataSnapshot()) {
  const normalizedQuery = normalizeLookupKey(query);
  if (!normalizedQuery) {
    return null;
  }

  return snapshot.transportCityByLookupKey.get(normalizedQuery) ?? null;
}

function resolveOriginCity(query = "", snapshot = loadIndiaDataSnapshot()) {
  const directCity = resolveTransportCity(query, snapshot);
  if (directCity) {
    return {
      city: directCity,
      matchedBy: "transport_city",
    };
  }

  const destination = resolveIndiaDestination(query);
  if (!destination) {
    return null;
  }

  const hubs = snapshot.hubsByDestinationId.get(destination.destination_id) ?? [];
  const firstHub = hubs[0];
  if (!firstHub) {
    return null;
  }

  return {
    city: snapshot.transportCityById.get(firstHub.city_id) ?? null,
    matchedBy: "destination_hub",
    destination,
    lastMile: firstHub,
  };
}

function buildLegacyDirectOptions({
  snapshot,
  resolvedOrigin,
  destinationHubs = [],
}) {
  const hubByCityId = new Map(destinationHubs.map((hub) => [hub.city_id, hub]));
  const candidateRoutes =
    snapshot.routesBySourceCityId.get(resolvedOrigin.city.city_id) ?? [];

  return candidateRoutes
    .filter((route) => hubByCityId.has(route.destination_city_id))
    .map((route) => {
      const sourceCity = snapshot.transportCityById.get(route.source_city_id) ?? null;
      const destinationCity =
        snapshot.transportCityById.get(route.destination_city_id) ?? null;
      const hub = hubByCityId.get(route.destination_city_id) ?? null;

      return {
        option_id:
          route.route_id ||
          `${route.source_city_id}-${route.destination_city_id}-${route.mode}`,
        mode: route.mode,
        submode: route.submode,
        source_city: sourceCity?.canonical_name ?? "",
        destination_city: destinationCity?.canonical_name ?? "",
        duration_minutes: route.duration_minutes,
        distance_km: route.distance_km,
        availability_status: route.availability_status,
        cost_general: route.cost_general,
        cost_sleeper: route.cost_sleeper,
        cost_ac3: route.cost_ac3,
        cost_ac2: route.cost_ac2,
        cost_ac1: route.cost_ac1,
        cost_is_estimated: route.cost_is_estimated,
        source_quality: route.source_quality,
        source_dataset: route.source_dataset,
        transfer_count: 0,
        segment_count: 1,
        mode_mix: [route.mode],
        source_datasets: [route.source_dataset].filter(Boolean),
        segments: [
          {
            segment_index: 1,
            route_id: route.route_id,
            source_city_id: route.source_city_id,
            source_city_name: sourceCity?.canonical_name ?? "",
            destination_city_id: route.destination_city_id,
            destination_city_name: destinationCity?.canonical_name ?? "",
            mode: route.mode,
            submode: route.submode,
            duration_minutes: route.duration_minutes,
            distance_km: route.distance_km,
            availability_status: route.availability_status,
            cost_general: route.cost_general,
            cost_sleeper: route.cost_sleeper,
            cost_ac3: route.cost_ac3,
            cost_ac2: route.cost_ac2,
            cost_ac1: route.cost_ac1,
            cost_is_estimated: route.cost_is_estimated,
            source_dataset: route.source_dataset,
            source_quality: route.source_quality,
          },
        ],
        last_mile: hub
          ? {
              destination_id: hub.destination_id,
              city_id: hub.city_id,
              hub_rank: hub.hub_rank,
              access_distance_km: hub.access_distance_km,
              access_duration_minutes: hub.access_duration_minutes,
              matching_method: hub.matching_method,
            }
          : null,
      };
    })
    .sort((left, right) => {
      if (left.duration_minutes !== right.duration_minutes) {
        return left.duration_minutes - right.duration_minutes;
      }

      return left.mode.localeCompare(right.mode);
    });
}

function flattenOptimizerOptionToApi(option = {}, fallbackOriginCityName = "") {
  const modeMix = Array.isArray(option.mode_mix) ? option.mode_mix : [];
  const mode = modeMix.length === 1 ? modeMix[0] : "multimodal";

  return {
    option_id: option.option_id,
    mode,
    submode: modeMix.length > 0 ? modeMix.join("+") : "unknown",
    source_city: fallbackOriginCityName,
    destination_city: option.destination_city_name,
    duration_minutes: option.total_duration_minutes ?? option.duration_minutes,
    distance_km: option.total_distance_km ?? option.distance_km ?? null,
    availability_status: option.availability_status ?? "unknown",
    cost_general: option.cost_general ?? null,
    cost_sleeper: option.cost_sleeper ?? null,
    cost_ac3: option.cost_ac3 ?? null,
    cost_ac2: option.cost_ac2 ?? null,
    cost_ac1: option.cost_ac1 ?? null,
    cost_is_estimated: Boolean(option.cost_is_estimated),
    source_quality: option.source_quality ?? "medium",
    source_dataset: Array.isArray(option.source_datasets)
      ? option.source_datasets.join(",")
      : option.source_dataset ?? "",
    transfer_count: option.transfer_count ?? 0,
    segment_count: option.segment_count ?? 0,
    mode_mix: modeMix,
    source_datasets: Array.isArray(option.source_datasets)
      ? option.source_datasets
      : [],
    segments: Array.isArray(option.segments) ? option.segments : [],
    last_mile: option.last_mile ?? null,
  };
}

export async function getIndiaTransportOptions({
  origin = "",
  destination = "",
  preferredModes = [],
  maxTransfers,
  topK,
  forceRefresh = false,
  traceId = "",
} = {}) {
  const snapshot = loadIndiaDataSnapshot();
  const resolvedDestination = resolveIndiaDestination(destination);

  if (!resolvedDestination) {
    const error = new Error("Destination was not found in the India tourism dataset.");
    error.code = "india-data/destination-not-found";
    throw error;
  }

  const resolvedOrigin = resolveOriginCity(origin, snapshot);
  if (!resolvedOrigin?.city) {
    const error = new Error("Origin was not found in the India transport dataset.");
    error.code = "india-data/origin-not-found";
    throw error;
  }

  const destinationHubs =
    snapshot.hubsByDestinationId.get(resolvedDestination.destination_id) ?? [];
  const resolvedPreferredModes = parseModes(preferredModes);
  const resolvedMaxTransfers = resolveTransportMaxTransfers(maxTransfers);
  const resolvedTopK = resolveTransportTopK(topK);
  const cacheKey = getTransportCacheKey({
    origin,
    destinationId: resolvedDestination.destination_id,
    preferredModes: resolvedPreferredModes,
    maxTransfers: resolvedMaxTransfers,
    topK: resolvedTopK,
  });

  if (!forceRefresh) {
    const cached = TRANSPORT_OPTIONS_CACHE.get(cacheKey);
    if (cached) {
      return {
        ...cached,
        transport_summary: {
          ...(cached.transport_summary ?? {}),
          cacheHit: true,
        },
      };
    }
  }

  const legacyDirectOptions = buildLegacyDirectOptions({
    snapshot,
    resolvedOrigin,
    destinationHubs,
  });

  let optimizerResult = null;
  if (destinationHubs.length > 0) {
    optimizerResult = await runPythonTransportOptimization(
      {
        mode: "multimodal",
        objective: "fastest_feasible",
        originCityId: resolvedOrigin.city.city_id,
        destinationCityIds: destinationHubs.map((hub) => hub.city_id),
        preferredModes: resolvedPreferredModes,
        maxTransfers: resolvedMaxTransfers,
        topK: resolvedTopK,
        routes: snapshot.transportRoutes,
        cities: snapshot.transportCities,
        destinationHubs,
      },
      { traceId }
    );
  }

  let optimizedOptions = Array.isArray(optimizerResult?.transportOptions)
    ? optimizerResult.transportOptions
    : [];
  let fallbackUsed = false;
  if (optimizedOptions.length === 0 && legacyDirectOptions.length > 0) {
    fallbackUsed = true;
    optimizedOptions = legacyDirectOptions;
  }

  if (legacyDirectOptions.length > 0 && optimizedOptions.length > 0) {
    const buildOptionSignature = (option) => {
      const mode =
        normalizeText(option.mode).toLowerCase() ||
        (Array.isArray(option.mode_mix) && option.mode_mix.length === 1
          ? normalizeText(option.mode_mix[0]).toLowerCase()
          : normalizeText(option.submode).toLowerCase());
      const numericDistance = Number.parseFloat(
        option.total_distance_km ?? option.distance_km
      );
      const roundedDistance = Number.isFinite(numericDistance)
        ? Number(numericDistance.toFixed(2))
        : "";
      return [
        mode,
        String(option.total_duration_minutes ?? option.duration_minutes ?? ""),
        String(roundedDistance),
        String(option.transfer_count ?? 0),
      ].join("|");
    };

    const seenSignatures = new Set(
      optimizedOptions.map((option) => buildOptionSignature(option))
    );

    for (const directOption of legacyDirectOptions) {
      const signature = buildOptionSignature(directOption);
      if (seenSignatures.has(signature)) {
        continue;
      }
      seenSignatures.add(signature);
      optimizedOptions.push(directOption);
    }
  }

  optimizedOptions.sort((left, right) => {
    const leftDuration =
      Number.parseFloat(left.total_duration_minutes ?? left.duration_minutes) ||
      Number.MAX_SAFE_INTEGER;
    const rightDuration =
      Number.parseFloat(right.total_duration_minutes ?? right.duration_minutes) ||
      Number.MAX_SAFE_INTEGER;
    if (leftDuration !== rightDuration) {
      return leftDuration - rightDuration;
    }

    const leftTransfers = Number.parseInt(left.transfer_count ?? "0", 10) || 0;
    const rightTransfers = Number.parseInt(right.transfer_count ?? "0", 10) || 0;
    return leftTransfers - rightTransfers;
  });

  const verificationContext = await verifyMultimodalRoutes({
    originCityName: resolvedOrigin.city.canonical_name,
    destinationLabel: `${resolvedDestination.destination_name}, ${resolvedDestination.state_ut_name}, India`,
    options: optimizedOptions,
    traceId,
  });

  const options = verificationContext.options.map((option) =>
    flattenOptimizerOptionToApi(option, resolvedOrigin.city.canonical_name)
  );
  const routeVerification = verificationContext.verification;

  console.info("[india-data] Transport options resolved", {
    origin: normalizeText(origin),
    destination: normalizeText(destination),
    optionCount: options.length,
    preferredModes: resolvedPreferredModes,
    maxTransfers: resolvedMaxTransfers,
    topK: resolvedTopK,
    fallbackUsed,
    traceId: traceId || null,
  });

  const payload = {
    origin: {
      query: normalizeText(origin),
      matchedBy: resolvedOrigin.matchedBy,
      city: resolvedOrigin.city,
    },
    destination: getIndiaDestinationDetail(resolvedDestination.destination_id),
    options,
    route_verification: routeVerification,
    transport_summary: {
      objective: "fastest_feasible",
      algorithm: normalizeText(
        optimizerResult?.algorithm,
        fallbackUsed
          ? "direct-route-fallback"
          : "python-multimodal-dijkstra-v2"
      ),
      preferredModes: resolvedPreferredModes,
      maxTransfers: resolvedMaxTransfers,
      topK: resolvedTopK,
      cacheHit: false,
      fallbackUsed,
      notes: Array.isArray(optimizerResult?.notes) ? optimizerResult.notes : [],
      graphMetrics:
        optimizerResult?.graphMetrics && typeof optimizerResult.graphMetrics === "object"
          ? optimizerResult.graphMetrics
          : {},
    },
    message:
      options.length > 0
        ? ""
        : "No transport route was found for the selected origin and destination.",
  };

  TRANSPORT_OPTIONS_CACHE.set(
    cacheKey,
    payload,
    resolveTransportOptionsCacheTtlMs()
  );

  return payload;
}
