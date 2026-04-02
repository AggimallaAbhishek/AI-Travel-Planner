import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

export function getIndiaTransportOptions({ origin = "", destination = "" } = {}) {
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
  const hubByCityId = new Map(
    destinationHubs.map((hub) => [hub.city_id, hub])
  );
  const candidateRoutes =
    snapshot.routesBySourceCityId.get(resolvedOrigin.city.city_id) ?? [];
  const options = candidateRoutes
    .filter((route) => hubByCityId.has(route.destination_city_id))
    .map((route) => {
      const sourceCity = snapshot.transportCityById.get(route.source_city_id) ?? null;
      const destinationCity =
        snapshot.transportCityById.get(route.destination_city_id) ?? null;
      const hub = hubByCityId.get(route.destination_city_id) ?? null;

      return {
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
        last_mile: hub
          ? {
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

  console.info("[india-data] Transport options resolved", {
    origin: normalizeText(origin),
    destination: normalizeText(destination),
    optionCount: options.length,
  });

  return {
    origin: {
      query: normalizeText(origin),
      matchedBy: resolvedOrigin.matchedBy,
      city: resolvedOrigin.city,
    },
    destination: getIndiaDestinationDetail(resolvedDestination.destination_id),
    options,
    message:
      options.length > 0
        ? ""
        : "No direct transport options were found for the selected origin and destination.",
  };
}
