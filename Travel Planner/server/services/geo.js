const EARTH_RADIUS_METERS = 6_371_000;

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function toFiniteNumber(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function hasCoordinates(location = {}) {
  const latitude = toFiniteNumber(location.latitude ?? location.lat);
  const longitude = toFiniteNumber(location.longitude ?? location.lng);
  return latitude !== null && longitude !== null;
}

export function normalizeCoordinates(location = {}) {
  if (!hasCoordinates(location)) {
    return { latitude: null, longitude: null };
  }

  return {
    latitude: toFiniteNumber(location.latitude ?? location.lat),
    longitude: toFiniteNumber(location.longitude ?? location.lng),
  };
}

export function haversineDistanceMeters(fromLocation = {}, toLocation = {}) {
  const from = normalizeCoordinates(fromLocation);
  const to = normalizeCoordinates(toLocation);

  if (!hasCoordinates(from) || !hasCoordinates(to)) {
    return Number.POSITIVE_INFINITY;
  }

  const latitudeDelta = toRadians(to.latitude - from.latitude);
  const longitudeDelta = toRadians(to.longitude - from.longitude);
  const fromLatitude = toRadians(from.latitude);
  const toLatitude = toRadians(to.latitude);

  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(fromLatitude) * Math.cos(toLatitude) * Math.sin(longitudeDelta / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

export function estimateDurationSeconds(distanceMeters, mode = "drive") {
  const distance = Number.parseFloat(distanceMeters);
  if (!Number.isFinite(distance) || distance <= 0) {
    return 0;
  }

  const speedKmPerHourByMode = {
    walk: 4.5,
    drive: 32,
    transit: 24,
  };

  const normalizedMode = String(mode ?? "drive").toLowerCase();
  const speedKmPerHour = speedKmPerHourByMode[normalizedMode] ?? speedKmPerHourByMode.drive;
  const speedMetersPerSecond = (speedKmPerHour * 1_000) / 3_600;
  return Math.round(distance / speedMetersPerSecond);
}

export function buildCompleteTransportEdges(
  places = [],
  options = {}
) {
  const mode = String(options.mode ?? "drive").trim() || "drive";
  const source = String(options.source ?? "haversine").trim() || "haversine";
  const edges = [];

  for (let i = 0; i < places.length; i += 1) {
    const fromPlace = places[i];

    for (let j = 0; j < places.length; j += 1) {
      if (i === j) {
        continue;
      }

      const toPlace = places[j];
      const distanceMeters = haversineDistanceMeters(
        fromPlace.coordinates,
        toPlace.coordinates
      );

      if (!Number.isFinite(distanceMeters)) {
        continue;
      }

      const durationSeconds = estimateDurationSeconds(distanceMeters, mode);
      edges.push({
        fromPlaceId: fromPlace.id,
        toPlaceId: toPlace.id,
        mode,
        distanceMeters,
        durationSeconds,
        // Keep optimization weights unit-consistent with Distance Matrix edges.
        // `weight` is always interpreted as transit duration in seconds.
        weight: durationSeconds,
        source,
      });
    }
  }

  return edges;
}
