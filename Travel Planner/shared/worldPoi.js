import {
  buildGoogleMapsSearchUrl,
  normalizeGeoCoordinates,
} from "./maps.js";

export const WORLD_POI_CATEGORY_ALLOWLIST = Object.freeze([
  "landmark",
  "museum",
  "temple",
  "park",
  "beach",
  "viewpoint",
  "heritage_site",
  "cultural_district",
  "market",
  "waterfront",
  "garden",
  "plaza",
  "neighborhood",
  "monument",
  "art_district",
  "palace",
  "fort",
  "bridge",
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

export function normalizePoiKey(value, fallback = "") {
  const normalized = normalizeText(value, fallback)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();

  return normalized;
}

export function normalizePoiLabel(value, fallback = "") {
  return normalizeText(value, fallback);
}

export function normalizeCountryCode(value, fallback = "") {
  const normalized = normalizeText(value, fallback).toUpperCase();
  return /^[A-Z]{2,3}$/.test(normalized) ? normalized : fallback;
}

export function dedupeNormalizedStrings(values = [], maxItems = 24) {
  if (!Array.isArray(values)) {
    return [];
  }

  const unique = [];
  const seen = new Set();

  for (const value of values) {
    const label = normalizePoiLabel(value);
    const key = normalizePoiKey(label);

    if (!label || !key || seen.has(key)) {
      continue;
    }

    unique.push(label);
    seen.add(key);

    if (unique.length >= maxItems) {
      break;
    }
  }

  return unique;
}

function normalizeCategory(value) {
  const category = normalizePoiKey(value);
  return WORLD_POI_CATEGORY_ALLOWLIST.includes(category) ? category : "";
}

function normalizeCategories(values = []) {
  const categories = Array.isArray(values) ? values : [values];
  const normalized = [];
  const seen = new Set();

  for (const value of categories) {
    const category = normalizeCategory(value);
    if (!category || seen.has(category)) {
      continue;
    }

    normalized.push(category);
    seen.add(category);
  }

  return normalized;
}

function buildViewport(coordinates = {}, rawViewport = null) {
  if (rawViewport && typeof rawViewport === "object") {
    const north = normalizeNumber(rawViewport?.north ?? rawViewport?.northEast?.latitude);
    const south = normalizeNumber(rawViewport?.south ?? rawViewport?.southWest?.latitude);
    const east = normalizeNumber(rawViewport?.east ?? rawViewport?.northEast?.longitude);
    const west = normalizeNumber(rawViewport?.west ?? rawViewport?.southWest?.longitude);

    if (
      north !== null &&
      south !== null &&
      east !== null &&
      west !== null &&
      north >= south
    ) {
      return { north, south, east, west };
    }
  }

  if (
    coordinates.latitude === null ||
    coordinates.longitude === null
  ) {
    return null;
  }

  const latPadding = 0.015;
  const lngPadding = 0.02;

  return {
    north: Number((coordinates.latitude + latPadding).toFixed(6)),
    south: Number((coordinates.latitude - latPadding).toFixed(6)),
    east: Number((coordinates.longitude + lngPadding).toFixed(6)),
    west: Number((coordinates.longitude - lngPadding).toFixed(6)),
  };
}

export function inferDestinationParts(destination = "") {
  const segments = normalizePoiLabel(destination)
    .split(",")
    .map((segment) => normalizePoiLabel(segment))
    .filter(Boolean);

  if (segments.length === 0) {
    return {
      locality: "",
      adminArea: "",
      countryName: "",
    };
  }

  return {
    locality: segments[0] ?? "",
    adminArea: segments.length > 2 ? segments.slice(1, -1).join(", ") : "",
    countryName: segments.length > 1 ? segments.at(-1) ?? "" : "",
  };
}

export function createDestinationKey({
  locality = "",
  countryCode = "",
  countryName = "",
} = {}) {
  const localityKey = normalizePoiKey(locality);
  const countryKey = normalizePoiKey(countryCode || countryName);
  return [localityKey, countryKey].filter(Boolean).join("__");
}

export function buildDestinationLookupKeys(input = {}) {
  const source =
    typeof input === "string" ? inferDestinationParts(input) : { ...input };
  const locality = normalizePoiLabel(source.locality);
  const adminArea = normalizePoiLabel(source.adminArea);
  const countryName = normalizePoiLabel(source.countryName);
  const countryCode = normalizeCountryCode(source.countryCode);

  const keys = [
    createDestinationKey({ locality, countryCode, countryName }),
    createDestinationKey({ locality, countryName }),
    createDestinationKey({ locality, countryCode }),
    createDestinationKey({ locality: adminArea, countryCode, countryName }),
  ].filter(Boolean);

  return [...new Set(keys)];
}

export function createPoiMapsUrl(poi = {}) {
  return buildGoogleMapsSearchUrl({
    name: poi?.name,
    location: [poi?.locality, poi?.countryName].filter(Boolean).join(", "),
    coordinates: poi?.geoCoordinates,
  });
}

export function normalizeWorldPoiRecord(record = {}) {
  const name = normalizePoiLabel(record.name);
  if (!name) {
    return null;
  }

  const destinationParts = inferDestinationParts(
    normalizePoiLabel(record.destination)
  );
  const locality = normalizePoiLabel(record.locality, destinationParts.locality);
  const adminArea = normalizePoiLabel(record.adminArea, destinationParts.adminArea);
  const countryName = normalizePoiLabel(
    record.countryName,
    destinationParts.countryName
  );
  const countryCode = normalizeCountryCode(record.countryCode);
  const geoCoordinates = normalizeGeoCoordinates(record.geoCoordinates ?? record.coordinates);
  const categories = normalizeCategories(record.categories);
  const altNames = dedupeNormalizedStrings(record.altNames ?? record.aliases);
  const destinationKey = createDestinationKey({
    locality,
    countryCode,
    countryName,
  });
  const normalizedRecord = {
    id: normalizePoiLabel(
      record.id,
      `poi_${destinationKey || "global"}_${normalizePoiKey(name).replace(/\s+/g, "_")}`
    ),
    name,
    altNames,
    countryCode,
    countryName,
    locality,
    adminArea,
    categories,
    geoCoordinates,
    viewport: buildViewport(geoCoordinates, record.viewport),
    popularityScore: Number(
      Math.max(0, Math.min(1, normalizeNumber(record.popularityScore, 0.65))).toFixed(3)
    ),
    sourceIds:
      record.sourceIds && typeof record.sourceIds === "object"
        ? Object.fromEntries(
            Object.entries(record.sourceIds)
              .map(([key, value]) => [normalizePoiKey(key), normalizePoiLabel(value)])
              .filter(([, value]) => Boolean(value))
          )
        : {},
    sourceProvenance: dedupeNormalizedStrings(record.sourceProvenance ?? []),
    destinationKey,
    searchKeys: dedupeNormalizedStrings([name, ...altNames], 32).map((value) =>
      normalizePoiKey(value)
    ),
  };

  return {
    ...normalizedRecord,
    mapsUrl: normalizePoiLabel(record.mapsUrl, createPoiMapsUrl(normalizedRecord)),
  };
}
