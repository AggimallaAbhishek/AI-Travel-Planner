function normalizeText(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized || fallback;
}

function normalizeCoordinate(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sanitizeGooglePlaceId(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }

  if (/^mock[-_:]/i.test(normalized)) {
    return "";
  }

  if (normalized.includes(":") && !/^ChI/i.test(normalized)) {
    return "";
  }

  if (!/^[A-Za-z0-9_-]+$/.test(normalized)) {
    return "";
  }

  return normalized;
}

export function isRemoteHttpUrl(value) {
  if (typeof value !== "string") {
    return false;
  }

  return /^https?:\/\//i.test(value.trim());
}

export function hasCoordinates(coordinates = {}) {
  const latitude = normalizeCoordinate(coordinates?.latitude ?? coordinates?.lat);
  const longitude = normalizeCoordinate(
    coordinates?.longitude ?? coordinates?.lng
  );

  return Number.isFinite(latitude) && Number.isFinite(longitude);
}

export function buildGoogleMapsQueryUrl(query = "") {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) {
    return "https://www.google.com/maps";
  }

  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    normalizedQuery
  )}`;
}

export function buildGoogleMapsCoordinateUrl(coordinates = {}) {
  const latitude = normalizeCoordinate(coordinates?.latitude ?? coordinates?.lat);
  const longitude = normalizeCoordinate(
    coordinates?.longitude ?? coordinates?.lng
  );

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return "https://www.google.com/maps";
  }

  return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
}

export function resolveGoogleMapsUrl({
  mapsUrl = "",
  placeId = "",
  externalPlaceId = "",
  coordinates = {},
  name = "",
  address = "",
  destination = "",
} = {}) {
  const resolvedPlaceId = sanitizeGooglePlaceId(placeId || externalPlaceId);
  const hasLatLng = hasCoordinates(coordinates);
  const queryLabel = [name, address, destination]
    .map((value) => normalizeText(String(value ?? "")))
    .filter(Boolean)
    .join(", ");

  if (resolvedPlaceId) {
    const query = hasLatLng
      ? `${coordinates.latitude},${coordinates.longitude}`
      : queryLabel || normalizeText(name, "Travel destination");
    const endpoint = new URL("https://www.google.com/maps/search/");
    endpoint.searchParams.set("api", "1");
    endpoint.searchParams.set("query", query);
    endpoint.searchParams.set("query_place_id", resolvedPlaceId);
    return endpoint.toString();
  }

  if (hasLatLng) {
    return buildGoogleMapsCoordinateUrl(coordinates);
  }

  if (isRemoteHttpUrl(mapsUrl)) {
    return String(mapsUrl).trim();
  }

  return buildGoogleMapsQueryUrl(queryLabel || normalizeText(name));
}

