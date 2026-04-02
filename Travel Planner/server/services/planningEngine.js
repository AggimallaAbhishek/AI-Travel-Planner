import {
  buildBudgetBreakdown,
  formatBudgetAmount,
  normalizeUserSelection,
} from "../../shared/trips.js";
import {
  getHybridStoreMode,
  getLatestStructuredRouteRun,
  saveStructuredRouteRun,
  saveStructuredTripCandidates,
  upsertStructuredTrip,
  upsertStructuredUser,
} from "../data/hybridStore.js";
import { createMultiLayerCache } from "../lib/multiLevelCache.js";
import {
  buildRecommendationsFromStructuredPlaces,
  ensureStructuredDestinationData,
} from "./destinationIngestion.js";
import { generateTripPlan, resolveGeminiApiKey } from "./gemini.js";
import {
  buildWeightMatrixFromEdges,
  hashPlanningInput,
  normalizeClusterAssignments,
  rankCandidatePlaces,
} from "./planningMath.js";
import { runPythonRouteOptimization } from "./pythonOptimizer.js";

const routeOptimizationCache = createMultiLayerCache({
  namespace: "trip-route-optimization",
  defaultTtlMs: 5 * 60 * 1_000,
});

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }

  return fallback;
}

function parseBoolean(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }

  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return fallback;
  }

  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function normalizeText(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized || fallback;
}

function resolveCandidateLimit(dayCount) {
  const configured = parsePositiveInteger(process.env.ROUTE_CANDIDATE_LIMIT, dayCount * 8);
  return Math.min(60, Math.max(8, configured));
}

function resolveNarrativeEnabled() {
  const hasGeminiKey = Boolean(normalizeText(resolveGeminiApiKey()));
  if (!hasGeminiKey) {
    return false;
  }

  return parseBoolean(process.env.PLANNING_USE_GEMINI_NARRATIVE, true);
}

function toHotelCard(place = {}) {
  return {
    hotelName: place.name,
    hotelAddress: place.address,
    price: place.priceLevel,
    hotelImageUrl: place?.metadata?.imageUrl ?? "",
    rating: place.rating,
    description: place.description,
    geoCoordinates: {
      latitude: place?.coordinates?.latitude ?? null,
      longitude: place?.coordinates?.longitude ?? null,
    },
  };
}

function toItineraryPlace(place = {}, order) {
  return {
    placeName: place.name,
    placeDetails: place.description || "Recommended stop generated from structured place data.",
    placeImageUrl: place?.metadata?.imageUrl ?? "",
    geoCoordinates: {
      latitude: place?.coordinates?.latitude ?? null,
      longitude: place?.coordinates?.longitude ?? null,
    },
    ticketPricing: place.priceLevel || "Included in trip budget",
    rating: place.rating ?? null,
    travelTime: "Optimized by route planner",
    bestTimeToVisit: "Flexible",
    category: place.category || "Attraction",
    visitOrder: order,
  };
}

function splitVisitOrderByDays(visitOrder = [], dayCount = 1) {
  const safeDayCount = Math.max(1, dayCount);
  if (visitOrder.length === 0) {
    return Array.from({ length: safeDayCount }, (_unused, index) => ({
      day: index + 1,
      visitOrder: [],
      clusterId: index,
    }));
  }

  const chunks = [];
  const chunkSize = Math.ceil(visitOrder.length / safeDayCount);
  for (let dayIndex = 0; dayIndex < safeDayCount; dayIndex += 1) {
    const startIndex = dayIndex * chunkSize;
    const endIndex = startIndex + chunkSize;
    const dayOrder = visitOrder.slice(startIndex, endIndex);
    chunks.push({
      day: dayIndex + 1,
      clusterId: dayIndex,
      visitOrder: dayOrder,
      stopCount: dayOrder.length,
    });
  }

  return chunks;
}

function createDayPlansFromOptimization(result = {}, dayCount) {
  if (Array.isArray(result.dayPlans) && result.dayPlans.length > 0) {
    return result.dayPlans.map((dayPlan, index) => ({
      day: Number.parseInt(dayPlan.day, 10) || index + 1,
      clusterId: Number.parseInt(dayPlan.clusterId, 10) || index,
      visitOrder: Array.isArray(dayPlan.visitOrder)
        ? dayPlan.visitOrder.filter((value) => Number.isInteger(value))
        : [],
      stopCount: Number.parseInt(dayPlan.stopCount, 10) || 0,
    }));
  }

  return splitVisitOrderByDays(result.visitOrder ?? [], dayCount);
}

function buildCandidateRecords({ tripId, candidatePlaces, dayPlans, clusterAssignments }) {
  const visitMeta = new Map();
  for (const dayPlan of dayPlans) {
    dayPlan.visitOrder.forEach((placeIndex, orderIndex) => {
      visitMeta.set(placeIndex, {
        visitDay: dayPlan.day,
        visitOrder: orderIndex + 1,
      });
    });
  }

  return candidatePlaces.map((place, index) => {
    const visit = visitMeta.get(index);
    return {
      tripId,
      placeId: place.id,
      preferenceScore: place.preferenceScore ?? 0,
      clusterId: clusterAssignments[index] ?? null,
      visitDay: visit?.visitDay ?? null,
      visitOrder: visit?.visitOrder ?? null,
    };
  });
}

function buildDaySummaries({
  destination,
  dayPlans = [],
  candidatePlaces = [],
  userSelection = {},
  narrativePlan = null,
}) {
  const selection = normalizeUserSelection(userSelection);
  const budgetBreakdown = buildBudgetBreakdown(selection.budgetAmount, selection.planType);
  const safeDayCount = Math.max(1, selection.days || dayPlans.length || 1);
  const dailyBudget = Math.max(1, Math.round((budgetBreakdown.total || 0) / safeDayCount));

  return dayPlans.map((dayPlan, index) => {
    const stops = dayPlan.visitOrder
      .map((placeIndex) => candidatePlaces[placeIndex])
      .filter(Boolean);
    const itineraryPlaces = stops.map((stop, stopIndex) =>
      toItineraryPlace(stop, stopIndex + 1)
    );
    const narrativeDay = narrativePlan?.aiPlan?.days?.[index] ?? null;
    const fallbackTitle = `Day ${dayPlan.day} in ${destination}`;

    return {
      day: dayPlan.day,
      title: normalizeText(narrativeDay?.title, fallbackTitle),
      activities: itineraryPlaces.map((place) => place.placeName),
      estimatedCost: `${formatBudgetAmount(dailyBudget)} approx.`,
      tips: normalizeText(
        narrativeDay?.tips,
        "Follow the optimized stop order to reduce transit overhead."
      ),
      itineraryPlaces,
    };
  });
}

function buildOptimizationResponse({
  result,
  dayPlans,
  clusterAssignments,
  candidatePlaces,
  inputHash,
  cacheHit,
}) {
  const stopsByDay = dayPlans.map((dayPlan) => ({
    day: dayPlan.day,
    clusterId: dayPlan.clusterId,
    stopCount: dayPlan.visitOrder.length,
    visitOrder: dayPlan.visitOrder,
    stops: dayPlan.visitOrder
      .map((index) => candidatePlaces[index])
      .filter(Boolean)
      .map((place, orderIndex) => ({
        order: orderIndex + 1,
        placeId: place.id,
        name: place.name,
        address: place.address,
        category: place.category,
        rating: place.rating ?? null,
        coordinates: place.coordinates,
      })),
  }));

  return {
    objective: "minimize_total_distance",
    algorithmVersion: normalizeText(result.algorithm, "python-nearest-neighbor-2opt"),
    totalWeight: Number.parseFloat(result.totalWeight) || 0,
    visitOrder: Array.isArray(result.visitOrder) ? result.visitOrder : [],
    shortestPaths: Array.isArray(result.shortestPathsFromOrigin)
      ? result.shortestPathsFromOrigin
      : [],
    previous: Array.isArray(result.previous) ? result.previous : [],
    clusters: Array.isArray(result.clusters) ? result.clusters : [],
    clusterAssignments,
    dayPlans: stopsByDay,
    inputHash,
    cacheHit,
  };
}

async function maybeGenerateNarrativePlan(userSelection) {
  if (!resolveNarrativeEnabled()) {
    return null;
  }

  try {
    return await generateTripPlan(userSelection);
  } catch (error) {
    console.warn("[planning] Narrative enrichment failed; continuing with algorithmic plan", {
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function computeStructuredTripOptimization({
  tripId,
  destinationRecord,
  places = [],
  edges = [],
  userSelection = {},
  forceRefresh = false,
  traceId = "",
} = {}) {
  const selection = normalizeUserSelection(userSelection);
  const dayCount = Math.max(1, selection.days || 1);
  const candidatePlaces = rankCandidatePlaces(
    places,
    selection,
    destinationRecord,
    {
      limit: resolveCandidateLimit(dayCount),
      preferredCategories: ["attraction", "restaurant"],
    }
  );
  const fallbackCandidates =
    candidatePlaces.length > 0
      ? candidatePlaces
      : places.filter((place) => place.category !== "hotel").slice(0, dayCount * 6);

  if (fallbackCandidates.length === 0) {
    return {
      optimization: {
        objective: "minimize_total_distance",
        algorithmVersion: "none",
        totalWeight: 0,
        visitOrder: [],
        shortestPaths: [],
        previous: [],
        clusters: [],
        clusterAssignments: [],
        dayPlans: [],
        inputHash: "",
        cacheHit: false,
      },
      dayPlans: [],
      candidatePlaces: [],
    };
  }

  const matrix = buildWeightMatrixFromEdges(fallbackCandidates, edges);
  const inputHash = hashPlanningInput({
    destinationVersion: destinationRecord?.version ?? 0,
    dayCount,
    matrix,
    places: fallbackCandidates.map((place) => ({
      id: place.id,
      category: place.category,
      rating: place.rating ?? null,
    })),
  });
  const cacheKey = `${tripId}:${destinationRecord?.version ?? 0}:${inputHash}`;

  if (!forceRefresh) {
    const cacheResult = await routeOptimizationCache.get(cacheKey);
    if (cacheResult.value) {
      console.info("[planning] Returning cached route optimization", {
        tripId,
        destination: destinationRecord?.canonicalName ?? "",
        cacheLayer: cacheResult.layer,
        traceId: traceId || null,
      });

      return {
        optimization: {
          ...cacheResult.value.optimization,
          cacheHit: true,
        },
        dayPlans: cacheResult.value.dayPlans,
        candidatePlaces: fallbackCandidates,
      };
    }

    const savedRun = await getLatestStructuredRouteRun({
      tripId,
      dayNo: 0,
      inputHash,
    });
    if (savedRun?.result) {
      const savedDayPlans = createDayPlansFromOptimization(savedRun.result, dayCount);
      const savedAssignments = normalizeClusterAssignments(
        savedRun.result.clusterAssignments,
        fallbackCandidates.length,
        dayCount
      );
      const optimization = buildOptimizationResponse({
        result: savedRun.result,
        dayPlans: savedDayPlans,
        clusterAssignments: savedAssignments,
        candidatePlaces: fallbackCandidates,
        inputHash,
        cacheHit: true,
      });

      await routeOptimizationCache.set(cacheKey, {
        optimization,
        dayPlans: savedDayPlans,
      });

      return {
        optimization,
        dayPlans: savedDayPlans,
        candidatePlaces: fallbackCandidates,
      };
    }
  }

  const optimizationResult = await runPythonRouteOptimization(
    {
      matrix,
      originIndex: 0,
      clusterCount: dayCount,
      nodeCoordinates: fallbackCandidates.map((place) => ({
        latitude: place?.coordinates?.latitude ?? null,
        longitude: place?.coordinates?.longitude ?? null,
      })),
    },
    {
      traceId,
    }
  );
  const dayPlans = createDayPlansFromOptimization(optimizationResult, dayCount);
  const clusterAssignments = normalizeClusterAssignments(
    optimizationResult.clusterAssignments,
    fallbackCandidates.length,
    dayCount
  );

  const optimization = buildOptimizationResponse({
    result: optimizationResult,
    dayPlans,
    clusterAssignments,
    candidatePlaces: fallbackCandidates,
    inputHash,
    cacheHit: false,
  });

  await saveStructuredTripCandidates(
    tripId,
    buildCandidateRecords({
      tripId,
      candidatePlaces: fallbackCandidates,
      dayPlans,
      clusterAssignments,
    })
  );
  await saveStructuredRouteRun({
    tripId,
    dayNo: 0,
    algorithmVersion: optimization.algorithmVersion,
    inputHash,
    result: optimizationResult,
  });
  await routeOptimizationCache.set(cacheKey, {
    optimization,
    dayPlans,
  });

  return {
    optimization,
    dayPlans,
    candidatePlaces: fallbackCandidates,
  };
}

export async function buildDataDrivenTripPlan({
  tripId,
  user,
  userSelection,
  forceRefresh = false,
  traceId = "",
}) {
  const selection = normalizeUserSelection(userSelection);
  const structuredUser = await upsertStructuredUser({
    firebaseUid: user.uid,
    email: user.email ?? "",
  });

  const ingestion = await ensureStructuredDestinationData({
    destination: selection.location.label,
    forceRefresh,
    traceId,
  });

  await upsertStructuredTrip({
    id: tripId,
    userId: structuredUser.id,
    destinationId: ingestion.destination.id,
    days: selection.days,
    budgetAmount: selection.budgetAmount,
    preferences: selection,
    status: "planning",
    planningMeta: {
      dataProvider: ingestion.provider,
      generatedAt: new Date().toISOString(),
      freshness: ingestion.freshness?.freshUntil ?? null,
      storageMode: getHybridStoreMode(),
    },
    createdAt: new Date().toISOString(),
  });

  const optimizationPayload = await computeStructuredTripOptimization({
    tripId,
    destinationRecord: ingestion.destination,
    places: ingestion.places,
    edges: ingestion.edges,
    userSelection: selection,
    forceRefresh,
    traceId,
  });
  const narrativePlan = await maybeGenerateNarrativePlan(selection);
  const daySummaries = buildDaySummaries({
    destination: ingestion.destination.canonicalName,
    dayPlans: optimizationPayload.dayPlans,
    candidatePlaces: optimizationPayload.candidatePlaces,
    userSelection: selection,
    narrativePlan,
  });

  const itineraryDays = daySummaries.map((daySummary) => ({
    dayNumber: daySummary.day,
    title: daySummary.title,
    places: daySummary.itineraryPlaces,
  }));
  const aiPlanDays = daySummaries.map((daySummary) => ({
    day: daySummary.day,
    title: daySummary.title,
    activities: daySummary.activities,
    estimatedCost: daySummary.estimatedCost,
    tips: daySummary.tips,
  }));

  const recommendations = buildRecommendationsFromStructuredPlaces({
    destination: ingestion.destination.canonicalName,
    provider: ingestion.provider,
    warning: ingestion.warning,
    places: ingestion.places,
  });
  const hotels = ingestion.placesByCategory.hotels.slice(0, 8).map(toHotelCard);
  const travelTips = Array.isArray(narrativePlan?.aiPlan?.travelTips)
    ? narrativePlan.aiPlan.travelTips
    : [
        "Use the optimized stop order to reduce cumulative transit distance.",
        "Batch nearby activities together to keep daily plans efficient.",
        "Reserve a small budget buffer for delays and dynamic price changes.",
      ];

  const planningMeta = {
    dataProvider: ingestion.provider,
    algorithmVersion: optimizationPayload.optimization.algorithmVersion,
    cacheHit: optimizationPayload.optimization.cacheHit,
    generatedAt: new Date().toISOString(),
    freshness: ingestion.freshness?.freshUntil ?? null,
    storageMode: getHybridStoreMode(),
    recommendationProvider: recommendations.provider,
  };

  const generatedTrip = {
    hotels,
    itinerary: {
      days: itineraryDays,
    },
    aiPlan: {
      destination: ingestion.destination.canonicalName,
      days: aiPlanDays,
      totalEstimatedCost: formatBudgetAmount(selection.budgetAmount || 0),
      travelTips,
    },
    recommendations,
    optimization: optimizationPayload.optimization,
    routePlans: optimizationPayload.optimization.dayPlans,
  };

  await upsertStructuredTrip({
    id: tripId,
    userId: structuredUser.id,
    destinationId: ingestion.destination.id,
    days: selection.days,
    budgetAmount: selection.budgetAmount,
    preferences: selection,
    status: "active",
    planningMeta,
    createdAt: new Date().toISOString(),
  });

  return {
    generatedTrip,
    planningMeta,
    optimization: optimizationPayload.optimization,
  };
}

