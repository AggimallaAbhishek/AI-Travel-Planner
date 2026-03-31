function normalizeText(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed || fallback;
}

function normalizeExternalUrl(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return fallback;
  }

  return trimmed;
}

function parseCoordinate(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isGoogleMapsHostname(hostname = "") {
  return (
    /(^|\.)google\.[a-z.]+$/i.test(hostname) ||
    /^maps\.google\.[a-z.]+$/i.test(hostname) ||
    /^maps\.app\.goo\.gl$/i.test(hostname)
  );
}

function normalizeQueryParts(parts = []) {
  const normalized = [];
  const seen = new Set();

  for (const part of parts) {
    const text = normalizeText(part);
    const key = text.toLowerCase();

    if (!text || seen.has(key)) {
      continue;
    }

    normalized.push(text);
    seen.add(key);
  }

  return normalized;
}

export function normalizeGeoCoordinates(value) {
  if (Array.isArray(value)) {
    const longitude = parseCoordinate(value[0]);
    const latitude = parseCoordinate(value[1]);

    return {
      latitude,
      longitude,
    };
  }

  if (!value || typeof value !== "object") {
    return { latitude: null, longitude: null };
  }

  const latitude = parseCoordinate(
    value.latitude ?? value.lat ?? value.latitudeDegrees
  );
  const longitude = parseCoordinate(
    value.longitude ?? value.lng ?? value.longitudeDegrees
  );

  return {
    latitude,
    longitude,
  };
}

export function buildGoogleMapsSearchUrl({
  name = "",
  location = "",
  destination = "",
  coordinates,
} = {}) {
  const normalizedCoordinates = normalizeGeoCoordinates(coordinates);

  if (
    normalizedCoordinates.latitude !== null &&
    normalizedCoordinates.longitude !== null
  ) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      `${normalizedCoordinates.latitude},${normalizedCoordinates.longitude}`
    )}`;
  }

  const query = normalizeQueryParts([name, location, destination]).join(", ");

  if (!query) {
    return "";
  }

  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

export function resolveGoogleMapsUrl({
  mapsUrl = "",
  name = "",
  location = "",
  destination = "",
  coordinates,
} = {}) {
  const normalizedUrl = normalizeExternalUrl(mapsUrl);

  if (normalizedUrl) {
    try {
      const parsedUrl = new URL(normalizedUrl);

      if (isGoogleMapsHostname(parsedUrl.hostname)) {
        return normalizedUrl;
      }
    } catch {
      return buildGoogleMapsSearchUrl({
        name,
        location,
        destination,
        coordinates,
      });
    }
  }

  return buildGoogleMapsSearchUrl({
    name,
    location,
    destination,
    coordinates,
  });
}
