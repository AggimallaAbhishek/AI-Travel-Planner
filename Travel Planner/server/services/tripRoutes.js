import { normalizeUserSelection } from "../../shared/trips.js";
import { ensureStructuredDestinationData } from "./destinationIngestion.js";
import { computeStructuredTripOptimization } from "./planningEngine.js";
import { buildGroundedTransportEdges } from "./transportEdges.js";

function normalizeText(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized || fallback;
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }

  if (parsed < min) {
    return min;
  }

  if (parsed > max) {
    return max;
  }

  return parsed;
}

export function resolveRequestedRouteDay(day, fallbackDay, maxDays) {
  return clampInteger(day, 1, maxDays, fallbackDay);
}

export async function getTripRoutePlan({
  trip,
  day,
  forceRefresh = false,
  traceId = "",
}) {
  const destination = normalizeText(
    trip?.userSelection?.location?.label ?? trip?.aiPlan?.destination
  );
  if (!destination) {
    const error = new Error("Trip destination is required to compute routes.");
    error.code = "recommendations/invalid-destination";
    throw error;
  }

  const selection = normalizeUserSelection(trip.userSelection);
  const totalDays = Math.max(1, selection.days || 1);
  const resolvedDay = resolveRequestedRouteDay(day, 1, totalDays);

  const ingestion = await ensureStructuredDestinationData({
    destination,
    forceRefresh,
    traceId,
  });
  const transportContext = await buildGroundedTransportEdges({
    destinationId: ingestion.destination.id,
    places: ingestion.places,
    existingEdges: ingestion.edges,
    forceRefresh,
    traceId,
  });
  const optimization = await computeStructuredTripOptimization({
    tripId: trip.id,
    destinationRecord: ingestion.destination,
    places: ingestion.places,
    edges: transportContext.edges,
    userSelection: selection,
    forceRefresh,
    traceId,
  });

  const dayPlan =
    optimization.optimization.dayPlans.find((item) => item.day === resolvedDay) ??
    optimization.optimization.dayPlans[0] ??
    {
      day: resolvedDay,
      clusterId: 0,
      stopCount: 0,
      visitOrder: [],
      stops: [],
    };

  return {
    day: resolvedDay,
    totalDays,
    dayPlan,
    optimization: optimization.optimization,
    planningMeta: {
      dataProvider: ingestion.provider,
      algorithmVersion: optimization.optimization.algorithmVersion,
      cacheHit: optimization.optimization.cacheHit,
      generatedAt: new Date().toISOString(),
      freshness: ingestion.freshness?.freshUntil ?? null,
      usedFallbackEdges: transportContext.usedFallbackEdges,
    },
  };
}
