import { createHash } from "node:crypto";
import {
  estimateDurationSeconds,
  haversineDistanceMeters,
  hasCoordinates,
} from "./geo.js";

function normalizeText(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized || fallback;
}

function normalizeNumber(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getCategoryWeight(category, travelStyle) {
  const normalizedCategory = normalizeText(category).toLowerCase();
  const normalizedTravelStyle = normalizeText(travelStyle).toLowerCase();

  if (normalizedCategory === "hotel") {
    return 0.4;
  }

  if (normalizedCategory === "restaurant") {
    return normalizedTravelStyle.includes("food") ? 1 : 0.75;
  }

  if (normalizedTravelStyle.includes("adventure")) {
    return 1;
  }

  if (normalizedTravelStyle.includes("relax")) {
    return 0.8;
  }

  if (normalizedTravelStyle.includes("cultural")) {
    return 0.95;
  }

  return 0.85;
}

function getRatingScore(rating) {
  const normalizedRating = normalizeNumber(rating);
  if (!Number.isFinite(normalizedRating)) {
    return 0.5;
  }

  return clamp(normalizedRating / 5, 0, 1);
}

function getDistanceScore(place, centerPoint = {}) {
  if (!hasCoordinates(place?.coordinates) || !hasCoordinates(centerPoint)) {
    return 0.6;
  }

  const distanceMeters = haversineDistanceMeters(place.coordinates, centerPoint);
  if (!Number.isFinite(distanceMeters)) {
    return 0.6;
  }

  // Within 2km => near 1.0; around 20km => near 0.2.
  const scaled = 1 - distanceMeters / 20_000;
  return clamp(scaled, 0.2, 1);
}

export function computePreferenceScore(place = {}, userSelection = {}, destination = {}) {
  const travelStyle = userSelection?.travelStyle ?? userSelection?.travelType ?? "";
  const ratingScore = getRatingScore(place.rating);
  const categoryScore = getCategoryWeight(place.category, travelStyle);
  const distanceScore = getDistanceScore(place, destination.centerPoint);

  return Number((ratingScore * 0.55 + categoryScore * 0.3 + distanceScore * 0.15).toFixed(4));
}

export function rankCandidatePlaces(
  places = [],
  userSelection = {},
  destination = {},
  options = {}
) {
  const limit = Number.parseInt(options.limit, 10);
  const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 20;
  const preferredCategories = Array.isArray(options.preferredCategories)
    ? options.preferredCategories
    : ["attraction", "restaurant"];

  return places
    .filter((place) => preferredCategories.includes(place.category))
    .map((place) => ({
      ...place,
      preferenceScore: computePreferenceScore(place, userSelection, destination),
    }))
    .sort((left, right) => right.preferenceScore - left.preferenceScore)
    .slice(0, safeLimit);
}

export function buildWeightMatrixFromEdges(places = [], edges = []) {
  const size = places.length;
  const matrix = Array.from({ length: size }, (_, rowIndex) =>
    Array.from({ length: size }, (_, columnIndex) =>
      rowIndex === columnIndex ? 0 : Number.POSITIVE_INFINITY
    )
  );
  const placeIndexById = new Map(places.map((place, index) => [place.id, index]));

  for (const edge of edges) {
    const fromIndex = placeIndexById.get(edge.fromPlaceId);
    const toIndex = placeIndexById.get(edge.toPlaceId);
    if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex)) {
      continue;
    }

    const weight = normalizeNumber(edge.weight);
    if (!Number.isFinite(weight) || weight < 0) {
      continue;
    }

    matrix[fromIndex][toIndex] = weight;
  }

  // Fill missing values using estimated transit duration so matrix units stay consistent.
  for (let fromIndex = 0; fromIndex < size; fromIndex += 1) {
    for (let toIndex = 0; toIndex < size; toIndex += 1) {
      if (fromIndex === toIndex) {
        continue;
      }

      if (Number.isFinite(matrix[fromIndex][toIndex])) {
        continue;
      }

      const fallbackDistance = haversineDistanceMeters(
        places[fromIndex]?.coordinates,
        places[toIndex]?.coordinates
      );
      const fallbackDurationSeconds = estimateDurationSeconds(
        fallbackDistance,
        "drive"
      );
      matrix[fromIndex][toIndex] = Number.isFinite(fallbackDurationSeconds)
        ? fallbackDurationSeconds
        : Number.POSITIVE_INFINITY;
    }
  }

  return matrix;
}

export function hashPlanningInput(input = {}) {
  const serialized = JSON.stringify(input);
  return createHash("sha256").update(serialized).digest("hex");
}

export function normalizeClusterAssignments(assignments = {}, size = 0, dayCount = 1) {
  const normalized = Array.from({ length: size }, (_unused, index) => {
    const assignment = Number.parseInt(assignments[index], 10);
    if (Number.isInteger(assignment) && assignment >= 0) {
      return assignment;
    }

    return index % dayCount;
  });

  return normalized;
}
