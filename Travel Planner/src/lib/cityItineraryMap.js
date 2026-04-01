import { normalizeGeoCoordinates } from "./maps.js";

export const CITY_ITINERARY_MAP_CANVAS = {
  width: 1440,
  height: 640,
  inset: 64,
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

function closeRing(coordinates = []) {
  if (coordinates.length === 0) {
    return [];
  }

  const firstPoint = coordinates[0];
  const lastPoint = coordinates.at(-1);

  if (
    firstPoint.latitude === lastPoint.latitude &&
    firstPoint.longitude === lastPoint.longitude
  ) {
    return coordinates;
  }

  return [...coordinates, firstPoint];
}

function normalizeOutlineRing(ring = []) {
  const coordinates = (Array.isArray(ring) ? ring : [])
    .map((point) => normalizeGeoCoordinates(point))
    .filter(
      (point) => point.latitude !== null && point.longitude !== null
    );

  if (coordinates.length < 3) {
    return [];
  }

  return closeRing(coordinates);
}

export function buildFallbackCityOutlineFromBounds(bounds = {}) {
  const normalizedBounds = normalizeCityMapBounds(bounds);
  if (!normalizedBounds) {
    return null;
  }

  const latitudeSpan = normalizedBounds.north - normalizedBounds.south;
  const longitudeSpan = normalizedBounds.east - normalizedBounds.west;
  const lat = (ratio) => normalizedBounds.south + latitudeSpan * ratio;
  const lng = (ratio) => normalizedBounds.west + longitudeSpan * ratio;

  return {
    source: "fallback_bounds",
    polygons: [
      closeRing([
        { latitude: lat(0.90), longitude: lng(0.18) },
        { latitude: lat(0.97), longitude: lng(0.45) },
        { latitude: lat(0.92), longitude: lng(0.82) },
        { latitude: lat(0.72), longitude: lng(0.95) },
        { latitude: lat(0.42), longitude: lng(0.92) },
        { latitude: lat(0.12), longitude: lng(0.72) },
        { latitude: lat(0.04), longitude: lng(0.38) },
        { latitude: lat(0.12), longitude: lng(0.12) },
        { latitude: lat(0.44), longitude: lng(0.05) },
        { latitude: lat(0.74), longitude: lng(0.08) },
      ]),
    ],
  };
}

export function normalizeCityMapOutline(outline = null, bounds = null) {
  const polygons = Array.isArray(outline?.polygons)
    ? outline.polygons
        .map((polygon) => normalizeOutlineRing(polygon))
        .filter((polygon) => polygon.length >= 4)
    : [];

  if (polygons.length > 0) {
    return {
      source: outline?.source ?? "administrative_boundary",
      polygons,
    };
  }

  return buildFallbackCityOutlineFromBounds(bounds);
}

function getBoundsCenter(bounds = {}) {
  const normalizedBounds = normalizeCityMapBounds(bounds);
  if (!normalizedBounds) {
    return null;
  }

  return {
    latitude: (normalizedBounds.north + normalizedBounds.south) / 2,
    longitude: (normalizedBounds.east + normalizedBounds.west) / 2,
  };
}

export function getCityMapOutlineCentroid(outline = null, bounds = null) {
  const normalizedOutline = normalizeCityMapOutline(outline, bounds);
  const largestPolygon = (normalizedOutline?.polygons ?? [])
    .map((polygon) => {
      const normalizedPolygon = polygon.slice(0, -1);
      const latitudes = normalizedPolygon.map((point) => point.latitude);
      const longitudes = normalizedPolygon.map((point) => point.longitude);

      return {
        points: normalizedPolygon,
        area:
          (Math.max(...latitudes) - Math.min(...latitudes)) *
          (Math.max(...longitudes) - Math.min(...longitudes)),
      };
    })
    .sort((left, right) => right.area - left.area)[0];

  if (!largestPolygon?.points?.length) {
    return getBoundsCenter(bounds);
  }

  const pointCount = largestPolygon.points.length;
  const latitude =
    largestPolygon.points.reduce((sum, point) => sum + point.latitude, 0) /
    pointCount;
  const longitude =
    largestPolygon.points.reduce((sum, point) => sum + point.longitude, 0) /
    pointCount;

  return { latitude, longitude };
}

const ZOOM_FACTORS = Object.freeze({
  1: 1,
  2: 0.72,
  3: 0.52,
  4: 0.38,
});

export function buildZoomedCityMapBounds({
  bounds,
  outline = null,
  focusCoordinates = null,
  zoomLevel = 1,
} = {}) {
  const normalizedBounds = normalizeCityMapBounds(bounds);
  if (!normalizedBounds) {
    return null;
  }

  const normalizedZoomLevel = clamp(
    Math.round(toFiniteNumber(zoomLevel, 1)),
    1,
    4
  );
  if (normalizedZoomLevel === 1) {
    return normalizedBounds;
  }

  const defaultCenter =
    getCityMapOutlineCentroid(outline, normalizedBounds) ??
    getBoundsCenter(normalizedBounds);
  const candidateFocus = normalizeGeoCoordinates(focusCoordinates);
  const center =
    candidateFocus.latitude !== null &&
    candidateFocus.longitude !== null &&
    candidateFocus.latitude <= normalizedBounds.north &&
    candidateFocus.latitude >= normalizedBounds.south &&
    candidateFocus.longitude <= normalizedBounds.east &&
    candidateFocus.longitude >= normalizedBounds.west
      ? candidateFocus
      : defaultCenter;

  const latitudeSpan = Math.max(
    0.000001,
    normalizedBounds.north - normalizedBounds.south
  );
  const longitudeSpan = Math.max(
    0.000001,
    normalizedBounds.east - normalizedBounds.west
  );
  const zoomFactor = ZOOM_FACTORS[normalizedZoomLevel] ?? ZOOM_FACTORS[4];
  const targetLatitudeSpan = latitudeSpan * zoomFactor;
  const targetLongitudeSpan = longitudeSpan * zoomFactor;

  let north = center.latitude + targetLatitudeSpan / 2;
  let south = center.latitude - targetLatitudeSpan / 2;
  let east = center.longitude + targetLongitudeSpan / 2;
  let west = center.longitude - targetLongitudeSpan / 2;

  if (north > normalizedBounds.north) {
    const delta = north - normalizedBounds.north;
    north -= delta;
    south -= delta;
  }

  if (south < normalizedBounds.south) {
    const delta = normalizedBounds.south - south;
    north += delta;
    south += delta;
  }

  if (east > normalizedBounds.east) {
    const delta = east - normalizedBounds.east;
    east -= delta;
    west -= delta;
  }

  if (west < normalizedBounds.west) {
    const delta = normalizedBounds.west - west;
    east += delta;
    west += delta;
  }

  return {
    north: clamp(north, normalizedBounds.south, normalizedBounds.north),
    south: clamp(south, normalizedBounds.south, normalizedBounds.north),
    east: clamp(east, normalizedBounds.west, normalizedBounds.east),
    west: clamp(west, normalizedBounds.west, normalizedBounds.east),
  };
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

export function projectCityMapCoordinates(
  coordinates = [],
  bounds,
  canvas = CITY_ITINERARY_MAP_CANVAS
) {
  if (!Array.isArray(coordinates)) {
    return [];
  }

  return coordinates
    .map((point) => projectCityMapPoint(point, bounds, canvas))
    .filter(
      (point) => Number.isFinite(point.x) && Number.isFinite(point.y)
    );
}

export function projectCityMapOutline(
  outline = null,
  bounds,
  canvas = CITY_ITINERARY_MAP_CANVAS
) {
  const normalizedOutline = normalizeCityMapOutline(outline, bounds);
  const polygons = Array.isArray(normalizedOutline?.polygons)
    ? normalizedOutline.polygons
        .map((polygon) => {
          const points = projectCityMapCoordinates(polygon, bounds, canvas);
          if (points.length < 3) {
            return null;
          }

          const path = points
            .map((point, index) =>
              `${index === 0 ? "M" : "L"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`
            )
            .concat("Z")
            .join(" ");

          return {
            points,
            path,
          };
        })
        .filter(Boolean)
    : [];

  return {
    source: normalizedOutline?.source ?? "",
    polygons,
  };
}

export function buildCityMapOutlinePath(
  outline = null,
  bounds,
  canvas = CITY_ITINERARY_MAP_CANVAS
) {
  return projectCityMapOutline(outline, bounds, canvas)
    .polygons.map((polygon) => polygon.path)
    .join(" ");
}

function isProjectedPointInsidePolygon(point = {}, polygon = []) {
  let inside = false;

  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const currentPoint = polygon[index];
    const previousPoint = polygon[previous];
    const yCrosses =
      currentPoint.y > point.y !== previousPoint.y > point.y;

    if (!yCrosses) {
      continue;
    }

    const projectedX =
      ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) /
        (previousPoint.y - currentPoint.y) +
      currentPoint.x;

    if (point.x < projectedX) {
      inside = !inside;
    }
  }

  return inside;
}

export function isProjectedPointInsidePolygons(point = {}, polygons = []) {
  return (Array.isArray(polygons) ? polygons : []).some((polygon) =>
    isProjectedPointInsidePolygon(point, polygon?.points ?? polygon)
  );
}

export function buildCityMapFeaturePath(
  feature = {},
  bounds,
  canvas = CITY_ITINERARY_MAP_CANVAS
) {
  const points = projectCityMapCoordinates(feature?.coordinates, bounds, canvas);
  if (points.length < 2) {
    return "";
  }

  const commands = points.map((point, index) => {
    const prefix = index === 0 ? "M" : "L";
    return `${prefix}${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
  });

  if (feature?.closed && points.length >= 3) {
    commands.push("Z");
  }

  return commands.join(" ");
}

function getPointDistance(firstPoint, secondPoint) {
  return Math.hypot(firstPoint.x - secondPoint.x, firstPoint.y - secondPoint.y);
}

export function calculateGreatCircleDistanceMeters(firstCoordinates = {}, secondCoordinates = {}) {
  const firstPoint = normalizeGeoCoordinates(firstCoordinates);
  const secondPoint = normalizeGeoCoordinates(secondCoordinates);

  if (
    firstPoint.latitude === null ||
    firstPoint.longitude === null ||
    secondPoint.latitude === null ||
    secondPoint.longitude === null
  ) {
    return null;
  }

  const toRadians = (value) => (value * Math.PI) / 180;
  const earthRadiusMeters = 6_371_000;
  const latitudeDelta = toRadians(secondPoint.latitude - firstPoint.latitude);
  const longitudeDelta = toRadians(secondPoint.longitude - firstPoint.longitude);
  const startLatitude = toRadians(firstPoint.latitude);
  const endLatitude = toRadians(secondPoint.latitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(startLatitude) *
      Math.cos(endLatitude) *
      Math.sin(longitudeDelta / 2) ** 2;

  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export function formatCityMapDistance(distanceMeters) {
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) {
    return "—";
  }

  if (distanceMeters < 950) {
    return `${Math.max(50, Math.round(distanceMeters / 50) * 50)} m`;
  }

  return `${(distanceMeters / 1000).toFixed(distanceMeters < 10_000 ? 1 : 0)} km`;
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
  {
    bounds,
    canvas = CITY_ITINERARY_MAP_CANVAS,
    minDistance = 26,
    step = 10,
    maxRings = 3,
    containsPoint = null,
  } = {}
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
        if (typeof containsPoint === "function" && !containsPoint(candidatePoint)) {
          continue;
        }
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

export function buildCityMapDistanceMatrix(places = []) {
  return places.map((originPlace) =>
    places.map((destinationPlace) => {
      if (originPlace.id === destinationPlace.id) {
        return {
          meters: null,
          label: "—",
        };
      }

      const meters = calculateGreatCircleDistanceMeters(
        originPlace.coordinates ?? originPlace.geoCoordinates,
        destinationPlace.coordinates ?? destinationPlace.geoCoordinates
      );

      return {
        meters,
        label: formatCityMapDistance(meters),
      };
    })
  );
}
