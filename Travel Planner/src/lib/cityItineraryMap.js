import { normalizeGeoCoordinates } from "./maps.js";

export const CITY_ITINERARY_MAP_CANVAS = {
  width: 1120,
  height: 720,
  inset: 56,
};

function toFiniteNumber(value, fallback = null) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getValidCoordinates(places = []) {
  return places
    .map((place) => normalizeGeoCoordinates(place?.geoCoordinates ?? place?.coordinates))
    .filter(
      (coordinates) =>
        coordinates.latitude !== null && coordinates.longitude !== null
    );
}

export function normalizeCityMapBounds(bounds = {}) {
  if (!bounds || typeof bounds !== "object") {
    return null;
  }

  const north = toFiniteNumber(bounds.north);
  const south = toFiniteNumber(bounds.south);
  const east = toFiniteNumber(bounds.east);
  const west = toFiniteNumber(bounds.west);

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

export function deriveCityMapBoundsFromPlaces(places = [], options = {}) {
  const coordinates = getValidCoordinates(places);

  if (coordinates.length === 0) {
    return null;
  }

  const latitudes = coordinates.map((item) => item.latitude);
  const longitudes = coordinates.map((item) => item.longitude);
  const minLatitude = Math.min(...latitudes);
  const maxLatitude = Math.max(...latitudes);
  const minLongitude = Math.min(...longitudes);
  const maxLongitude = Math.max(...longitudes);
  const latitudeSpan = Math.max(
    maxLatitude - minLatitude,
    toFiniteNumber(options.minLatitudeSpan, 0.018)
  );
  const longitudeSpan = Math.max(
    maxLongitude - minLongitude,
    toFiniteNumber(options.minLongitudeSpan, 0.024)
  );
  const paddingRatio = clamp(
    toFiniteNumber(options.paddingRatio, 0.18),
    0.08,
    0.35
  );
  const latitudePadding = latitudeSpan * paddingRatio;
  const longitudePadding = longitudeSpan * paddingRatio;

  return {
    north: maxLatitude + latitudePadding,
    south: minLatitude - latitudePadding,
    east: maxLongitude + longitudePadding,
    west: minLongitude - longitudePadding,
  };
}

export function resolveCityMapBounds({ cityBounds, places = [] } = {}) {
  return (
    normalizeCityMapBounds(cityBounds) ?? deriveCityMapBoundsFromPlaces(places)
  );
}

export function projectCityMapPoint(
  coordinates = {},
  bounds,
  canvas = CITY_ITINERARY_MAP_CANVAS
) {
  const normalizedBounds = normalizeCityMapBounds(bounds);
  const normalizedCoordinates = normalizeGeoCoordinates(coordinates);

  if (
    !normalizedBounds ||
    normalizedCoordinates.latitude === null ||
    normalizedCoordinates.longitude === null
  ) {
    return {
      x: canvas.width / 2,
      y: canvas.height / 2,
    };
  }

  const inset = clamp(
    toFiniteNumber(canvas.inset, CITY_ITINERARY_MAP_CANVAS.inset),
    12,
    Math.min(canvas.width / 3, canvas.height / 3)
  );
  const drawableWidth = Math.max(1, canvas.width - inset * 2);
  const drawableHeight = Math.max(1, canvas.height - inset * 2);
  const longitudeSpan = Math.max(
    0.000001,
    normalizedBounds.east - normalizedBounds.west
  );
  const latitudeSpan = Math.max(
    0.000001,
    normalizedBounds.north - normalizedBounds.south
  );
  const longitudeRatio =
    (normalizedCoordinates.longitude - normalizedBounds.west) / longitudeSpan;
  const latitudeRatio =
    (normalizedBounds.north - normalizedCoordinates.latitude) / latitudeSpan;

  return {
    x: clamp(inset + longitudeRatio * drawableWidth, inset, canvas.width - inset),
    y: clamp(inset + latitudeRatio * drawableHeight, inset, canvas.height - inset),
  };
}

function getPointDistance(firstPoint, secondPoint) {
  return Math.hypot(firstPoint.x - secondPoint.x, firstPoint.y - secondPoint.y);
}

const LAYOUT_DIRECTIONS = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
  { x: 0.707, y: 0.707 },
  { x: -0.707, y: 0.707 },
  { x: 0.707, y: -0.707 },
  { x: -0.707, y: -0.707 },
];

export function createCityMapMarkerLayout(
  markers = [],
  { bounds, canvas = CITY_ITINERARY_MAP_CANVAS, minDistance = 26, step = 10, maxRings = 3 } = {}
) {
  const inset = clamp(
    toFiniteNumber(canvas.inset, CITY_ITINERARY_MAP_CANVAS.inset),
    12,
    Math.min(canvas.width / 3, canvas.height / 3)
  );
  const placedMarkers = [];

  return markers.map((marker) => {
    const anchorPoint =
      marker.point ??
      projectCityMapPoint(marker.geoCoordinates ?? marker.coordinates, bounds, canvas);
    const candidates = [];
    let markerPoint = anchorPoint;
    let hasPlacement = false;

    for (let ring = 0; ring <= maxRings; ring += 1) {
      for (const direction of LAYOUT_DIRECTIONS) {
        const candidatePoint = {
          x: clamp(anchorPoint.x + direction.x * step * ring, inset, canvas.width - inset),
          y: clamp(anchorPoint.y + direction.y * step * ring, inset, canvas.height - inset),
        };
        const nearestDistance = placedMarkers.reduce((smallestDistance, placedMarker) => {
          const distance = getPointDistance(candidatePoint, placedMarker.markerPoint);
          return Math.min(smallestDistance, distance);
        }, Number.POSITIVE_INFINITY);

        candidates.push({ candidatePoint, nearestDistance, ring });

        if (nearestDistance >= minDistance) {
          markerPoint = candidatePoint;
          hasPlacement = true;
          break;
        }
      }

      if (hasPlacement) {
        break;
      }
    }

    if (!hasPlacement && candidates.length > 0) {
      candidates.sort((left, right) => {
        if (right.nearestDistance !== left.nearestDistance) {
          return right.nearestDistance - left.nearestDistance;
        }

        return left.ring - right.ring;
      });

      markerPoint = candidates[0].candidatePoint;
    }

    const markerShift = {
      x: Number((markerPoint.x - anchorPoint.x).toFixed(2)),
      y: Number((markerPoint.y - anchorPoint.y).toFixed(2)),
    };

    const laidOutMarker = {
      ...marker,
      point: anchorPoint,
      markerPoint,
      markerShift,
      isShifted: getPointDistance(anchorPoint, markerPoint) > 0.2,
    };

    placedMarkers.push(laidOutMarker);
    return laidOutMarker;
  });
}
