import { geoEquirectangular } from "d3-geo";

export const WORLD_MAP_CANVAS = { width: 1600, height: 760 };
export const WORLD_MAP_PROJECTION = {
  name: "geoEquirectangular",
  config: {
    paddingX: 28,
    paddingY: 40,
  },
};

function toFiniteNumber(value, fallback = 0) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampLatitude(latitude) {
  const parsed = Number.parseFloat(latitude);

  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.max(-90, Math.min(90, parsed));
}

function normalizeLongitude(longitude) {
  const parsed = Number.parseFloat(longitude);

  if (!Number.isFinite(parsed)) {
    return 0;
  }

  let normalized = parsed;
  while (normalized < -180) {
    normalized += 360;
  }

  while (normalized > 180) {
    normalized -= 360;
  }

  return normalized;
}

export function toEquirectangularPercent(longitude, latitude) {
  const normalizedLongitude = normalizeLongitude(longitude);
  const normalizedLatitude = clampLatitude(latitude);

  return {
    x: ((normalizedLongitude + 180) / 360) * 100,
    y: ((90 - normalizedLatitude) / 180) * 100,
  };
}

export function createWorldMapProjection() {
  return geoEquirectangular().fitExtent(
    [
      [WORLD_MAP_PROJECTION.config.paddingX, WORLD_MAP_PROJECTION.config.paddingY],
      [
        WORLD_MAP_CANVAS.width - WORLD_MAP_PROJECTION.config.paddingX,
        WORLD_MAP_CANVAS.height - WORLD_MAP_PROJECTION.config.paddingY,
      ],
    ],
    { type: "Sphere" }
  );
}

export function projectDestinationPoint(destination = {}, projection = createWorldMapProjection()) {
  const coordinates = projection([
    normalizeLongitude(destination.longitude),
    clampLatitude(destination.latitude),
  ]);

  if (!coordinates) {
    return {
      x: WORLD_MAP_CANVAS.width / 2,
      y: WORLD_MAP_CANVAS.height / 2,
    };
  }

  return {
    x: coordinates[0],
    y: coordinates[1],
  };
}

export function normalizeMapDestination(destination = {}) {
  return {
    ...destination,
    longitude: normalizeLongitude(destination.longitude),
    latitude: clampLatitude(destination.latitude),
  };
}

export function normalizeMapDestinations(destinations = [], projection) {
  return destinations.map((destination) => {
    const normalized = normalizeMapDestination(destination);

    return projection
      ? {
          ...normalized,
          point: projectDestinationPoint(normalized, projection),
        }
      : normalized;
  });
}

export function getDestinationMarkerPoint(destination = {}, options = {}) {
  const useMarkerOffsets = options.useMarkerOffsets === true;
  const padding = Math.max(0, toFiniteNumber(options.padding, 10));
  const minX = padding;
  const minY = padding;
  const maxX = Math.max(minX, WORLD_MAP_CANVAS.width - padding);
  const maxY = Math.max(minY, WORLD_MAP_CANVAS.height - padding);
  const basePoint = destination.point ?? projectDestinationPoint(destination);

  const markerX = clamp(
    toFiniteNumber(basePoint?.x, WORLD_MAP_CANVAS.width / 2) +
      (useMarkerOffsets ? toFiniteNumber(destination.markerOffsetX, 0) : 0),
    minX,
    maxX
  );
  const markerY = clamp(
    toFiniteNumber(basePoint?.y, WORLD_MAP_CANVAS.height / 2) +
      (useMarkerOffsets ? toFiniteNumber(destination.markerOffsetY, 0) : 0),
    minY,
    maxY
  );

  return {
    x: markerX,
    y: markerY,
  };
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

function getPointDistance(firstPoint, secondPoint) {
  return Math.hypot(firstPoint.x - secondPoint.x, firstPoint.y - secondPoint.y);
}

export function createDestinationMarkerLayout(destinations = [], options = {}) {
  const padding = Math.max(0, toFiniteNumber(options.padding, 12));
  const minDistance = Math.max(8, toFiniteNumber(options.minDistance, 18));
  const step = Math.max(3, toFiniteNumber(options.step, 7));
  const maxRings = Math.max(1, Math.round(toFiniteNumber(options.maxRings, 2)));
  const placedDestinations = [];

  return destinations.map((destination) => {
    const anchorPoint = getDestinationMarkerPoint(destination, {
      padding,
      useMarkerOffsets: false,
    });

    const candidates = [];
    let markerPoint = anchorPoint;
    let hasPlacement = false;

    for (let ring = 0; ring <= maxRings; ring += 1) {
      for (const direction of LAYOUT_DIRECTIONS) {
        const candidatePoint = getDestinationMarkerPoint(
          {
            ...destination,
            point: {
              x: anchorPoint.x + direction.x * step * ring,
              y: anchorPoint.y + direction.y * step * ring,
            },
          },
          { padding }
        );
        const nearestDistance = placedDestinations.reduce((smallestDistance, placed) => {
          const distance = getPointDistance(candidatePoint, placed.markerPoint);
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
    const isShifted = getPointDistance(anchorPoint, markerPoint) > 0.2;

    const markerLayoutDestination = {
      ...destination,
      anchorPoint,
      markerPoint,
      markerShift,
      isShifted,
    };

    placedDestinations.push(markerLayoutDestination);
    return markerLayoutDestination;
  });
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
