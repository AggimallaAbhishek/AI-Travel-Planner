import {
  normalizeGeoCoordinates,
  resolveGoogleMapsUrl,
} from "./maps.js";

export const UNIFIED_MAP_NODE_CATEGORIES = Object.freeze([
  "tourist_spot",
  "hotel",
  "restaurant",
  "airport",
  "rail_station",
  "metro_station",
  "bus_terminal",
]);

const CATEGORY_ALIASES = Object.freeze({
  landmark: "tourist_spot",
  museum: "tourist_spot",
  temple: "tourist_spot",
  park: "tourist_spot",
  beach: "tourist_spot",
  viewpoint: "tourist_spot",
  heritage_site: "tourist_spot",
  cultural_district: "tourist_spot",
  market: "tourist_spot",
  waterfront: "tourist_spot",
  garden: "tourist_spot",
  plaza: "tourist_spot",
  neighborhood: "tourist_spot",
  monument: "tourist_spot",
  art_district: "tourist_spot",
  palace: "tourist_spot",
  fort: "tourist_spot",
  bridge: "tourist_spot",
  point_of_interest: "tourist_spot",
  activity: "tourist_spot",
  hotel: "hotel",
  lodging: "hotel",
  accommodation: "hotel",
  restaurant: "restaurant",
  dining: "restaurant",
  airport: "airport",
  rail_station: "rail_station",
  railway_station: "rail_station",
  train_station: "rail_station",
  station: "rail_station",
  metro_station: "metro_station",
  subway_station: "metro_station",
  metro: "metro_station",
  bus_terminal: "bus_terminal",
  bus_station: "bus_terminal",
  bus_interchange: "bus_terminal",
});

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

function normalizeStringArray(values = [], maxItems = 12) {
  if (!Array.isArray(values)) {
    return [];
  }

  const unique = [];
  const seen = new Set();

  for (const value of values) {
    const label = normalizeText(String(value ?? ""));
    const key = label.toLowerCase();

    if (!label || seen.has(key)) {
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

export function normalizeUnifiedMapNodeCategory(value, fallback = "tourist_spot") {
  const normalized = normalizeText(String(value ?? "")).toLowerCase();
  const resolved = CATEGORY_ALIASES[normalized] ?? normalized;

  return UNIFIED_MAP_NODE_CATEGORIES.includes(resolved) ? resolved : fallback;
}

export function resolveUnifiedMapFilterCategory(category = "") {
  const normalized = normalizeUnifiedMapNodeCategory(category);

  if (normalized === "rail_station" || normalized === "metro_station") {
    return "rail_metro";
  }

  if (normalized === "tourist_spot") {
    return "tourist_spots";
  }

  if (normalized === "hotel") {
    return "hotels";
  }

  if (normalized === "restaurant") {
    return "restaurants";
  }

  if (normalized === "airport") {
    return "airports";
  }

  if (normalized === "bus_terminal") {
    return "bus_terminals";
  }

  return normalized;
}

export function formatUnifiedMapDistanceLabel(distanceMeters) {
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) {
    return "";
  }

  if (distanceMeters < 950) {
    return `${Math.max(50, Math.round(distanceMeters / 50) * 50)} m`;
  }

  return `${(distanceMeters / 1000).toFixed(1)} km`;
}

export function normalizeUnifiedMapNode(node = {}, options = {}) {
  const coordinates = normalizeGeoCoordinates(
    node.coordinates ?? node.geoCoordinates ?? node.locationCoordinates
  );
  const category = normalizeUnifiedMapNodeCategory(
    options.category ?? node.category ?? node.type
  );
  const name = normalizeText(
    node.name ?? node.placeName ?? node.title,
    "Mapped stop"
  );
  const address = normalizeText(
    node.address ?? node.location ?? node.formattedAddress
  );

  return {
    id: normalizeText(node.id, `${category}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`),
    name,
    category,
    subcategory: normalizeText(
      options.subcategory ?? node.subcategory ?? node.typeLabel ?? node.rawCategory
    ),
    coordinates,
    address,
    dayNumbers: normalizeStringArray(
      (Array.isArray(node.dayNumbers) ? node.dayNumbers : [node.dayNumber]).map((value) =>
        String(value ?? "")
      ),
      16
    ).map((value) => Number.parseInt(value, 10)).filter(Number.isFinite),
    source: normalizeText(node.source ?? node.provider, options.source ?? "unknown"),
    confidence: Number(
      Math.max(0, Math.min(1, normalizeNumber(node.confidence, options.confidence ?? 0.75))).toFixed(3)
    ),
    mapsUrl: resolveGoogleMapsUrl({
      mapsUrl: node.mapsUrl ?? node.googleMapsUri,
      name,
      location: address,
      coordinates,
    }),
    provider: normalizeText(node.provider, options.provider),
    visitOrder: Number.isFinite(node.visitOrder) ? node.visitOrder : null,
  };
}

export function normalizeUnifiedMapSegment(segment = {}, options = {}) {
  const distanceMeters = normalizeNumber(segment.distanceMeters, 0);
  const durationSeconds = normalizeNumber(segment.durationSeconds, 0);

  return {
    fromStopId: normalizeText(segment.fromStopId ?? segment.fromId),
    toStopId: normalizeText(segment.toStopId ?? segment.toId),
    distanceMeters,
    durationSeconds,
    label: normalizeText(
      segment.label,
      formatUnifiedMapDistanceLabel(distanceMeters)
    ),
    polyline: Array.isArray(segment.polyline) ? segment.polyline : [],
    provider: normalizeText(segment.provider, options.provider ?? "estimated-haversine"),
  };
}
