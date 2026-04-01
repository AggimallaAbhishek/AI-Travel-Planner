import fs from "node:fs";
import { fileURLToPath } from "node:url";
import {
  normalizeGeoCoordinates,
  resolveGoogleMapsUrl,
} from "../../shared/maps.js";
import { buildDestinationLookupKeys } from "../../shared/worldPoi.js";

const TRANSPORT_DATASET_PATH = fileURLToPath(
  new URL("../../data/transport/transport.json", import.meta.url)
);
const MAX_FALLBACK_MATCH_DISTANCE_METERS = 80_000;

let cachedTransportDataset = null;

function normalizeText(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed || fallback;
}

function normalizeBounds(bounds = null) {
  if (!bounds || typeof bounds !== "object") {
    return null;
  }

  const north = Number(bounds.north);
  const south = Number(bounds.south);
  const east = Number(bounds.east);
  const west = Number(bounds.west);

  if (![north, south, east, west].every((value) => Number.isFinite(value))) {
    return null;
  }

  return { north, south, east, west };
}

function getBoundsCenter(bounds = null) {
  if (!bounds) {
    return null;
  }

  return normalizeGeoCoordinates({
    latitude: (bounds.north + bounds.south) / 2,
    longitude: (bounds.east + bounds.west) / 2,
  });
}

function averageCoordinates(points = []) {
  const validPoints = points
    .map((point) => normalizeGeoCoordinates(point))
    .filter(
      (point) =>
        point.latitude !== null && point.longitude !== null
    );

  if (validPoints.length === 0) {
    return null;
  }

  const aggregate = validPoints.reduce(
    (current, point) => ({
      latitude: current.latitude + point.latitude,
      longitude: current.longitude + point.longitude,
    }),
    { latitude: 0, longitude: 0 }
  );

  return {
    latitude: aggregate.latitude / validPoints.length,
    longitude: aggregate.longitude / validPoints.length,
  };
}

function calculateGreatCircleDistanceMeters(start, end) {
  const origin = normalizeGeoCoordinates(start);
  const destination = normalizeGeoCoordinates(end);

  if (
    origin.latitude === null ||
    origin.longitude === null ||
    destination.latitude === null ||
    destination.longitude === null
  ) {
    return null;
  }

  const earthRadiusMeters = 6_371_000;
  const toRadians = (value) => (value * Math.PI) / 180;
  const deltaLatitude = toRadians(destination.latitude - origin.latitude);
  const deltaLongitude = toRadians(destination.longitude - origin.longitude);
  const originLatitude = toRadians(origin.latitude);
  const destinationLatitude = toRadians(destination.latitude);

  const haversine =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.cos(originLatitude) *
      Math.cos(destinationLatitude) *
      Math.sin(deltaLongitude / 2) ** 2;
  const arc = 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));

  return earthRadiusMeters * arc;
}

function formatDistance(distanceMeters) {
  if (!Number.isFinite(distanceMeters)) {
    return "";
  }

  if (distanceMeters < 1_000) {
    return `${Math.round(distanceMeters / 100) * 100} m`;
  }

  return `${(distanceMeters / 1_000).toFixed(distanceMeters < 10_000 ? 1 : 0)} km`;
}

function normalizeTransportRecord(record = {}, defaultType = "") {
  const name = normalizeText(record?.name);
  const coordinates = normalizeGeoCoordinates(
    record?.coordinates ?? record?.geoCoordinates
  );

  if (
    !name ||
    coordinates.latitude === null ||
    coordinates.longitude === null
  ) {
    return null;
  }

  const locality = normalizeText(record?.locality);
  const countryName = normalizeText(record?.countryName);
  const address = normalizeText(record?.address, [locality, countryName].filter(Boolean).join(", "));
  const transportType = normalizeText(record?.transportType, defaultType);
  const iata = normalizeText(record?.iata);
  const icao = normalizeText(record?.icao);

  return {
    id: normalizeText(record?.id, `${transportType || "transport"}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`),
    name,
    locality,
    address,
    countryCode: normalizeText(record?.countryCode),
    countryName,
    coordinates,
    mapsUrl: resolveGoogleMapsUrl({
      mapsUrl: record?.mapsUrl,
      name,
      location: address,
      coordinates,
    }),
    transportType,
    provider: normalizeText(record?.provider),
    network: normalizeText(record?.network),
    operator: normalizeText(record?.operator),
    code: iata || icao || "",
  };
}

function normalizeDestinationEntry(entry = {}) {
  const destination = entry?.destination ?? {};
  const destinationKey = normalizeText(destination?.destinationKey);

  if (!destinationKey) {
    return null;
  }

  return {
    destination: {
      destinationKey,
      destinationLabel: normalizeText(destination?.destinationLabel),
      locality: normalizeText(destination?.locality),
      adminArea: normalizeText(destination?.adminArea),
      countryCode: normalizeText(destination?.countryCode),
      countryName: normalizeText(destination?.countryName),
      cityBounds: normalizeBounds(destination?.cityBounds),
      center: normalizeGeoCoordinates(destination?.center),
    },
    airports: (Array.isArray(entry?.airports) ? entry.airports : [])
      .map((record) => normalizeTransportRecord(record, "airport"))
      .filter(Boolean),
    railStations: (Array.isArray(entry?.railStations) ? entry.railStations : [])
      .map((record) => normalizeTransportRecord(record, "rail_station"))
      .filter(Boolean),
    metroStations: (Array.isArray(entry?.metroStations) ? entry.metroStations : [])
      .map((record) => normalizeTransportRecord(record, "metro_station"))
      .filter(Boolean),
    busTerminals: (Array.isArray(entry?.busTerminals) ? entry.busTerminals : [])
      .map((record) => normalizeTransportRecord(record, "bus_terminal"))
      .filter(Boolean),
    flightRouteCount: Array.isArray(entry?.flightRoutes) ? entry.flightRoutes.length : 0,
  };
}

function loadRawTransportDataset() {
  const raw = fs.readFileSync(TRANSPORT_DATASET_PATH, "utf8");
  return JSON.parse(raw);
}

export function loadTransportDataset() {
  if (cachedTransportDataset) {
    return cachedTransportDataset;
  }

  const rawDataset = loadRawTransportDataset();
  const destinations = Object.values(rawDataset?.destinations ?? {})
    .map((entry) => normalizeDestinationEntry(entry))
    .filter(Boolean);
  const destinationsByKey = new Map(
    destinations.map((entry) => [entry.destination.destinationKey, entry])
  );

  cachedTransportDataset = {
    sourceVersion: normalizeText(
      rawDataset?.datasetVersion,
      normalizeText(rawDataset?.generatedAt, "transport-dataset")
    ),
    generatedAt: normalizeText(rawDataset?.generatedAt),
    schemaVersion: Number.parseInt(rawDataset?.schemaVersion, 10) || null,
    destinations,
    destinationsByKey,
  };

  return cachedTransportDataset;
}

function resolveTransportDestinationEntry({ destination = "", cityBounds = null } = {}) {
  const dataset = loadTransportDataset();
  const lookupKeys = buildDestinationLookupKeys(destination);

  for (const lookupKey of lookupKeys) {
    const exactMatch = dataset.destinationsByKey.get(lookupKey);
    if (exactMatch) {
      return exactMatch;
    }
  }

  const normalizedDestination = normalizeText(destination).toLowerCase();
  if (normalizedDestination) {
    const labelMatch = dataset.destinations.find((entry) => {
      return (
        normalizeText(entry.destination.destinationLabel).toLowerCase() ===
          normalizedDestination ||
        normalizeText(entry.destination.locality).toLowerCase() ===
          normalizedDestination
      );
    });

    if (labelMatch) {
      return labelMatch;
    }
  }

  const boundsCenter = getBoundsCenter(normalizeBounds(cityBounds));
  if (!boundsCenter) {
    return null;
  }

  return dataset.destinations
    .map((entry) => {
      const candidateCenter = normalizeGeoCoordinates(
        entry.destination.center ?? getBoundsCenter(entry.destination.cityBounds)
      );
      const distanceMeters = calculateGreatCircleDistanceMeters(
        boundsCenter,
        candidateCenter
      );

      return {
        entry,
        distanceMeters,
      };
    })
    .filter(({ distanceMeters }) => Number.isFinite(distanceMeters))
    .sort((left, right) => left.distanceMeters - right.distanceMeters)
    .find(
      ({ distanceMeters }) =>
        distanceMeters <= MAX_FALLBACK_MATCH_DISTANCE_METERS
    )?.entry ?? null;
}

function getReferencePoint({ markers = [], cityBounds = null, destinationEntry = null } = {}) {
  const markerCenter = averageCoordinates(
    (Array.isArray(markers) ? markers : []).map((marker) => marker?.coordinates)
  );
  if (markerCenter) {
    return markerCenter;
  }

  const destinationCenter = normalizeGeoCoordinates(destinationEntry?.destination?.center);
  if (
    destinationCenter.latitude !== null &&
    destinationCenter.longitude !== null
  ) {
    return destinationCenter;
  }

  return getBoundsCenter(normalizeBounds(cityBounds));
}

function getTransportTypeLabel(transportType = "") {
  const normalizedType = normalizeText(transportType).toLowerCase();

  if (normalizedType === "airport") {
    return "Airport";
  }

  if (normalizedType === "rail_station") {
    return "Rail station";
  }

  if (normalizedType === "metro_station") {
    return "Metro station";
  }

  if (normalizedType === "bus_terminal") {
    return "Bus terminal";
  }

  return "Transport stop";
}

function rankTransportRecords(records = [], referencePoint = null, limit = 0) {
  const ranked = records
    .map((record) => {
      const distanceMeters = calculateGreatCircleDistanceMeters(
        referencePoint,
        record.coordinates
      );

      return {
        ...record,
        distanceMeters,
        distanceLabel: formatDistance(distanceMeters),
        transportTypeLabel: getTransportTypeLabel(record.transportType),
      };
    })
    .filter((record) => Number.isFinite(record.distanceMeters))
    .sort((left, right) => left.distanceMeters - right.distanceMeters);

  if (limit > 0) {
    return ranked.slice(0, limit);
  }

  return ranked;
}

export function buildTransportContextForCityMap({
  destination = "",
  cityBounds = null,
  markers = [],
} = {}) {
  try {
    const destinationEntry = resolveTransportDestinationEntry({
      destination,
      cityBounds,
    });

    if (!destinationEntry) {
      return null;
    }

    const referencePoint = getReferencePoint({
      markers,
      cityBounds,
      destinationEntry,
    });

    const nearestAirports = rankTransportRecords(
      destinationEntry.airports,
      referencePoint,
      3
    );
    const nearestStations = rankTransportRecords(
      [
        ...destinationEntry.railStations,
        ...destinationEntry.metroStations,
        ...destinationEntry.busTerminals,
      ],
      referencePoint,
      4
    );
    const recommendedArrivalHub =
      nearestAirports[0] ?? nearestStations[0] ?? null;

    return {
      sourceVersion: loadTransportDataset().sourceVersion,
      matchedDestinationKey: destinationEntry.destination.destinationKey,
      generatedAt: loadTransportDataset().generatedAt,
      destinationLabel:
        destinationEntry.destination.destinationLabel || normalizeText(destination),
      nearestAirports,
      nearestStations,
      recommendedArrivalHub,
      availableCounts: {
        airports: destinationEntry.airports.length,
        stations:
          destinationEntry.railStations.length +
          destinationEntry.metroStations.length +
          destinationEntry.busTerminals.length,
        flightRoutes: destinationEntry.flightRouteCount,
      },
    };
  } catch (error) {
    console.warn("[transport-context] Failed to build transport context", {
      destination,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export function __resetTransportDatasetCacheForTests() {
  cachedTransportDataset = null;
}
