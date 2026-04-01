import {
  buildGoogleMapsSearchUrl,
  normalizeGeoCoordinates,
} from "./maps.js";
import {
  buildDestinationLookupKeys,
  createDestinationKey,
  inferDestinationParts,
  normalizeCountryCode,
  normalizePoiKey,
} from "./worldPoi.js";

export const TRANSPORT_DATASET_SCHEMA_VERSION = 1;
export const TRANSPORT_NODE_LAYER_KEYS = Object.freeze([
  "airports",
  "railStations",
  "metroStations",
  "busTerminals",
]);
export const TRANSPORT_LAYER_KEYS = Object.freeze([
  ...TRANSPORT_NODE_LAYER_KEYS,
  "flightRoutes",
]);

function normalizeText(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed || fallback;
}

function normalizeNumber(value, fallback = null) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeBounds(bounds = null) {
  if (!bounds || typeof bounds !== "object") {
    return null;
  }

  const north = normalizeNumber(bounds.north);
  const south = normalizeNumber(bounds.south);
  const east = normalizeNumber(bounds.east);
  const west = normalizeNumber(bounds.west);

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

export function createEmptyTransportLayers() {
  return {
    airports: [],
    flightRoutes: [],
    railStations: [],
    metroStations: [],
    busTerminals: [],
  };
}

export function createTransportDestinationRecord(input = {}) {
  const destination =
    input?.destination && typeof input.destination === "object"
      ? { ...input.destination }
      : inferDestinationParts(normalizeText(input?.destinationLabel));
  const destinationKey = normalizeText(
    input?.destinationKey,
    createDestinationKey({
      locality: destination.locality,
      countryCode: destination.countryCode,
      countryName: destination.countryName,
    })
  );
  const destinationLabel = normalizeText(
    input?.destinationLabel,
    [destination.locality, destination.countryName].filter(Boolean).join(", ")
  );

  return {
    destination: {
      destinationKey,
      destinationLabel,
      locality: normalizeText(destination.locality),
      adminArea: normalizeText(destination.adminArea),
      countryCode: normalizeCountryCode(destination.countryCode),
      countryName: normalizeText(destination.countryName),
      cityBounds: normalizeBounds(destination.cityBounds),
      center: normalizeGeoCoordinates(destination.center),
    },
    ...createEmptyTransportLayers(),
  };
}

export function cloneTransportDestinationRecord(record = {}) {
  const normalized = createTransportDestinationRecord(record);

  for (const layerKey of TRANSPORT_LAYER_KEYS) {
    normalized[layerKey] = Array.isArray(record?.[layerKey])
      ? record[layerKey].map((item) => ({ ...item }))
      : [];
  }

  return normalized;
}

export function buildTransportLookupKeys(input = {}) {
  const source = typeof input === "string" ? inferDestinationParts(input) : { ...input };
  const destinationKey = normalizeText(
    source.destinationKey,
    createDestinationKey({
      locality: source.locality,
      countryCode: source.countryCode,
      countryName: source.countryName,
    })
  );
  const destinationLabel = normalizeText(
    source.destinationLabel,
    [source.locality, source.countryName].filter(Boolean).join(", ")
  );
  const locality = normalizeText(source.locality);
  const countryName = normalizeText(source.countryName);
  const countryCode = normalizeCountryCode(source.countryCode);

  const keys = new Set(
    [
      destinationKey,
      normalizePoiKey(destinationLabel),
      normalizePoiKey(locality),
      normalizePoiKey(countryName),
      normalizePoiKey(countryCode),
      ...buildDestinationLookupKeys({
        locality,
        countryName,
        countryCode,
      }),
    ].filter(Boolean)
  );

  return [...keys];
}

export function createTransportMapsUrl({
  name = "",
  locality = "",
  countryName = "",
  coordinates = null,
} = {}) {
  return buildGoogleMapsSearchUrl({
    name,
    location: [locality, countryName].filter(Boolean).join(", "),
    coordinates,
  });
}
