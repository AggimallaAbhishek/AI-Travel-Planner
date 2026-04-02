import { formatBudgetAmount } from "../../shared/trips.js";
import { resolveGoogleMapsUrl } from "../../shared/maps.js";
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
import {
  generateGroundedNarrative,
  resolveGeminiApiKey,
} from "./gemini.js";
import { buildGroundedPlan } from "./groundedPlanBuilder.js";
import { getIndiaTransportOptions } from "./indiaData.js";
import { normalizePlanningRequest } from "./planningRequest.js";
import { incrementPlanningMetric } from "../lib/planningMetrics.js";
import {
  buildWeightMatrixFromEdges,
  hashPlanningInput,
  normalizeClusterAssignments,
  rankCandidatePlaces,
} from "./planningMath.js";
import { runPythonRouteOptimization } from "./pythonOptimizer.js";
import { buildGroundedTransportEdges } from "./transportEdges.js";

const routeOptimizationCache = createMultiLayerCache({
  namespace: "trip-route-optimization",
  defaultTtlMs: 5 * 60 * 1_000,
});
const TARGET_MIN_STOPS_PER_DAY = 3;
const TARGET_MAX_STOPS_PER_DAY = 4;

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }

  return fallback;
}

function parsePositiveFloat(value, fallback = null) {
  const parsed = Number.parseFloat(value ?? "");
  if (Number.isFinite(parsed) && parsed > 0) {
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
  const configured = parsePositiveInteger(
    process.env.ROUTE_CANDIDATE_LIMIT,
    dayCount * TARGET_MAX_STOPS_PER_DAY
  );
  return Math.min(32, Math.max(TARGET_MAX_STOPS_PER_DAY, configured));
}

function resolveNarrativeEnabled() {
  const hasGeminiKey = Boolean(normalizeText(resolveGeminiApiKey()));
  if (!hasGeminiKey) {
    return false;
  }

  return parseBoolean(process.env.PLANNING_USE_GEMINI_NARRATIVE, true);
}

function toHotelCard(place = {}) {
  const geoCoordinates = {
    latitude: place?.coordinates?.latitude ?? null,
    longitude: place?.coordinates?.longitude ?? null,
  };
  const externalPlaceId = normalizeText(place?.externalPlaceId);

  return {
    hotelName: place.name,
    hotelAddress: place.address,
    price: place.priceLevel,
    hotelImageUrl: place?.metadata?.imageUrl ?? "",
    rating: place.rating,
    description: place.description,
    geoCoordinates,
    mapsUrl: resolveGoogleMapsUrl({
      mapsUrl: place?.metadata?.mapsUrl,
      externalPlaceId,
      coordinates: geoCoordinates,
      name: place.name,
      address: place.address,
    }),
    externalPlaceId,
    source: normalizeText(place.source),
  };
}

function toItineraryPlace(place = {}, order) {
  const travelTimeMinutes = Number.isFinite(place?.travelTimeFromPreviousMinutes)
    ? Math.max(0, Math.round(place.travelTimeFromPreviousMinutes))
    : null;
  const travelDistanceMeters = Number.isFinite(place?.travelDistanceFromPreviousMeters)
    ? Math.max(0, Math.round(place.travelDistanceFromPreviousMeters))
    : null;
  const travelDistanceFromPreviousKm =
    travelDistanceMeters !== null
      ? Number((travelDistanceMeters / 1000).toFixed(1))
      : null;
  const transportMode = normalizeText(place.transportModeFromPrevious, "drive");
  const placeSummary = normalizeText(
    place.description,
    "Verified attraction selected from grounded destination data."
  );
  const geoCoordinates = {
    latitude: place?.coordinates?.latitude ?? null,
    longitude: place?.coordinates?.longitude ?? null,
  };
  const externalPlaceId = normalizeText(place?.externalPlaceId);

  return {
    placeName: place.name,
    placeDetails: placeSummary,
    placeSummary,
    // Activity cards are rendered text-first to reduce noisy visual repetition.
    placeImageUrl: "",
    geoCoordinates,
    mapsUrl: resolveGoogleMapsUrl({
      mapsUrl: place?.metadata?.mapsUrl,
      externalPlaceId,
      coordinates: geoCoordinates,
      name: place.name,
      address: place.address,
    }),
    externalPlaceId,
    source: normalizeText(place.source),
    ticketPricing: place.priceLevel || "Included in trip budget",
    rating: place.rating ?? null,
    travelTime: travelTimeMinutes && travelTimeMinutes > 0
      ? `${travelTimeMinutes} min`
      : "Start point",
    travelTimeMinutes,
    travelDistanceFromPreviousMeters: travelDistanceMeters,
    travelDistanceFromPreviousKm,
    travelDistance:
      parsePositiveFloat(travelDistanceFromPreviousKm) !== null
        ? `${travelDistanceFromPreviousKm} km`
        : "Distance not available",
    transportMode,
    transportSource: normalizeText(place.transportSourceFromPrevious),
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
  const baseSize = Math.floor(visitOrder.length / safeDayCount);
  const remainder = visitOrder.length % safeDayCount;

  let currentIndex = 0;
  for (let dayIndex = 0; dayIndex < safeDayCount; dayIndex += 1) {
    // Distribute remainder evenly across the first 'remainder' days
    const chunkSize = baseSize + (dayIndex < remainder ? 1 : 0);
    const dayOrder = visitOrder.slice(currentIndex, currentIndex + chunkSize);
    
    chunks.push({
      day: dayIndex + 1,
      clusterId: dayIndex,
      visitOrder: dayOrder,
      stopCount: dayOrder.length,
    });
    
    currentIndex += chunkSize;
  }

  return chunks;
}

function normalizeVisitOrder(visitOrder = []) {
  const seen = new Set();
  const normalized = [];
  for (const value of visitOrder) {
    if (!Number.isInteger(value) || seen.has(value)) {
      continue;
    }
    seen.add(value);
    normalized.push(value);
  }
  return normalized;
}

export function rebalanceDayPlansForTargetStops({
  dayCount = 1,
  visitOrder = [],
  existingDayPlans = [],
  minStopsPerDay = TARGET_MIN_STOPS_PER_DAY,
  maxStopsPerDay = TARGET_MAX_STOPS_PER_DAY,
} = {}) {
  const safeDayCount = Math.max(1, Number.parseInt(dayCount, 10) || 1);
  const normalizedVisitOrder = normalizeVisitOrder(visitOrder);
  const existingClusterIds = Array.isArray(existingDayPlans)
    ? existingDayPlans.map((plan, index) => {
        const clusterId = Number.parseInt(plan?.clusterId, 10);
        return Number.isInteger(clusterId) ? clusterId : index;
      })
    : [];

  const dayVisitOrders = Array.from({ length: safeDayCount }, () => []);
  let cursor = 0;
  let droppedStops = 0;

  if (normalizedVisitOrder.length >= safeDayCount * minStopsPerDay) {
    for (let dayIndex = 0; dayIndex < safeDayCount; dayIndex += 1) {
      while (
        dayVisitOrders[dayIndex].length < minStopsPerDay &&
        cursor < normalizedVisitOrder.length
      ) {
        dayVisitOrders[dayIndex].push(normalizedVisitOrder[cursor]);
        cursor += 1;
      }
    }

    while (cursor < normalizedVisitOrder.length) {
      let assignedInCycle = false;
      for (let dayIndex = 0; dayIndex < safeDayCount; dayIndex += 1) {
        if (cursor >= normalizedVisitOrder.length) {
          break;
        }
        if (dayVisitOrders[dayIndex].length >= maxStopsPerDay) {
          continue;
        }
        dayVisitOrders[dayIndex].push(normalizedVisitOrder[cursor]);
        cursor += 1;
        assignedInCycle = true;
      }

      if (!assignedInCycle) {
        droppedStops = normalizedVisitOrder.length - cursor;
        break;
      }
    }
  } else {
    console.info("[planning] Candidate pool below minimum 3-stop/day target", {
      dayCount: safeDayCount,
      availableStops: normalizedVisitOrder.length,
      requiredStops: safeDayCount * minStopsPerDay,
    });

    const base = Math.floor(normalizedVisitOrder.length / safeDayCount);
    const remainder = normalizedVisitOrder.length % safeDayCount;
    for (let dayIndex = 0; dayIndex < safeDayCount; dayIndex += 1) {
      const dayTarget = Math.min(
        maxStopsPerDay,
        base + (dayIndex < remainder ? 1 : 0)
      );
      for (
        let stopIndex = 0;
        stopIndex < dayTarget && cursor < normalizedVisitOrder.length;
        stopIndex += 1
      ) {
        dayVisitOrders[dayIndex].push(normalizedVisitOrder[cursor]);
        cursor += 1;
      }
    }
  }

  const dayPlans = dayVisitOrders.map((dayStops, index) => ({
    day: index + 1,
    clusterId: existingClusterIds[index] ?? index,
    visitOrder: dayStops,
    stopCount: dayStops.length,
  }));

  console.info("[planning] Rebalanced day plans for target stop range", {
    dayCount: safeDayCount,
    totalStops: normalizedVisitOrder.length,
    assignedStops: dayPlans.reduce((total, day) => total + day.stopCount, 0),
    minStopsPerDay,
    maxStopsPerDay,
    droppedStops,
    dayStopCounts: dayPlans.map((day) => day.stopCount),
  });

  return dayPlans;
}

function createDayPlansFromOptimization(result = {}, dayCount) {
  const rawDayPlans =
    Array.isArray(result.dayPlans) && result.dayPlans.length > 0
      ? result.dayPlans.map((dayPlan, index) => ({
          day: Number.parseInt(dayPlan.day, 10) || index + 1,
          clusterId: Number.parseInt(dayPlan.clusterId, 10) || index,
          visitOrder: Array.isArray(dayPlan.visitOrder)
            ? dayPlan.visitOrder.filter((value) => Number.isInteger(value))
            : [],
          stopCount: Number.parseInt(dayPlan.stopCount, 10) || 0,
        }))
      : splitVisitOrderByDays(result.visitOrder ?? [], dayCount);

  const visitOrder = Array.isArray(result.visitOrder)
    ? result.visitOrder.filter((value) => Number.isInteger(value))
    : rawDayPlans.flatMap((dayPlan) => dayPlan.visitOrder);

  return rebalanceDayPlansForTargetStops({
    dayCount,
    visitOrder,
    existingDayPlans: rawDayPlans,
    minStopsPerDay: TARGET_MIN_STOPS_PER_DAY,
    maxStopsPerDay: TARGET_MAX_STOPS_PER_DAY,
  });
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
    objective: "minimize_total_travel_time",
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

function collectUniqueHotelsFromGroundedPlan(groundedPlan = {}) {
  const hotelsById = new Map();

  for (const day of groundedPlan.days ?? []) {
    for (const hotel of day.hotels ?? []) {
      if (!hotelsById.has(hotel.id)) {
        hotelsById.set(hotel.id, hotel);
      }
    }
  }

  return [...hotelsById.values()];
}

function buildItineraryDaysFromGroundedPlan(groundedPlan = {}) {
  return (groundedPlan.days ?? []).map((day) => {
    const places = day.places.map((place, index) => toItineraryPlace(place, index + 1));
    const placeCount = places.length;

    return {
      dayNumber: day.day,
      title: day.title,
      places,
      placeCount,
      place_count: placeCount,
      placeCountTargetMet:
        placeCount >= TARGET_MIN_STOPS_PER_DAY &&
        placeCount <= TARGET_MAX_STOPS_PER_DAY,
      place_count_target_met:
        placeCount >= TARGET_MIN_STOPS_PER_DAY &&
        placeCount <= TARGET_MAX_STOPS_PER_DAY,
    };
  });
}

function buildAiPlanDaysFromGroundedPlan(groundedPlan = {}) {
  return (groundedPlan.days ?? []).map((day) => ({
    day: day.day,
    title: day.title,
    summary: day.summary,
    activities: day.places.map((place) => place.name),
    estimatedCost: day.cost,
    tips: Array.isArray(day.tips) ? day.tips.join(" ") : "",
  }));
}

function buildTravelTipsFromGroundedPlan(groundedPlan = {}, narrativeSource = "template") {
  const warnings = Array.isArray(groundedPlan?.validation?.warnings)
    ? groundedPlan.validation.warnings
    : [];
  const baseTips = [
    "Use the verified stop order to reduce cumulative transit time.",
    "Keep a small budget buffer for dynamic pricing and local transport changes.",
    "Open saved map links before you start the day in case connectivity is limited.",
  ];

  if (narrativeSource !== "gemini") {
    baseTips.push("Narrative details used the deterministic fallback because Gemini output was unavailable or invalid.");
  }

  return [...warnings, ...baseTips].slice(0, 6);
}

function resolvePreferredModesFromSelection(selection = {}) {
  if (!Array.isArray(selection?.preferredModes)) {
    return [];
  }

  return [
    ...new Set(
      selection.preferredModes
        .map((mode) => normalizeText(mode).toLowerCase())
        .filter((mode) => ["flight", "train", "road"].includes(mode))
    ),
  ];
}

async function buildIntercityTransportContext({
  selection = {},
  destinationLabel = "",
  traceId = "",
} = {}) {
  const originLabel = normalizeText(selection?.origin?.label);
  if (!originLabel) {
    return {
      transportOptions: [],
      routeVerification: {
        status: "not_requested",
        provider: "none",
        confidence: 0,
        notes: ["Origin was not provided, so intercity transport optimization was skipped."],
      },
      transportSummary: {
        objective: "fastest_feasible",
        algorithm: "not_requested",
        preferredModes: [],
        maxTransfers: selection?.maxTransfers ?? null,
        topK: 0,
        cacheHit: false,
        fallbackUsed: false,
      },
      message: "",
    };
  }

  try {
    const payload = await getIndiaTransportOptions({
      origin: originLabel,
      destination: destinationLabel,
      preferredModes: resolvePreferredModesFromSelection(selection),
      maxTransfers: selection?.maxTransfers,
      traceId,
    });

    return {
      transportOptions: Array.isArray(payload?.options) ? payload.options : [],
      routeVerification:
        payload?.route_verification && typeof payload.route_verification === "object"
          ? payload.route_verification
          : {
              status: "not_requested",
              provider: "none",
              confidence: 0,
              notes: [],
            },
      transportSummary:
        payload?.transport_summary && typeof payload.transport_summary === "object"
          ? payload.transport_summary
          : {
              objective: "fastest_feasible",
              algorithm: "python-multimodal-dijkstra-v2",
              preferredModes: resolvePreferredModesFromSelection(selection),
              maxTransfers: selection?.maxTransfers ?? null,
              topK: 0,
              cacheHit: false,
              fallbackUsed: false,
            },
      message: normalizeText(payload?.message),
      resolvedOrigin: payload?.origin ?? null,
      resolvedDestination: payload?.destination ?? null,
    };
  } catch (error) {
    console.warn("[planning] Intercity transport optimization skipped", {
      destination: destinationLabel,
      origin: originLabel,
      message: error instanceof Error ? error.message : String(error),
      traceId: traceId || null,
    });

    return {
      transportOptions: [],
      routeVerification: {
        status: "partial",
        provider: "none",
        confidence: 0.25,
        notes: ["Intercity transport optimization failed; route options are temporarily unavailable."],
      },
      transportSummary: {
        objective: "fastest_feasible",
        algorithm: "failed",
        preferredModes: resolvePreferredModesFromSelection(selection),
        maxTransfers: selection?.maxTransfers ?? null,
        topK: 0,
        cacheHit: false,
        fallbackUsed: true,
      },
      message: "Intercity transport optimization is temporarily unavailable.",
      resolvedOrigin: null,
      resolvedDestination: null,
    };
  }
}

function buildTotalEstimatedCostLabel(groundedPlan = {}, selection = {}) {
  const totalEstimatedCostAmount = (groundedPlan.days ?? []).reduce(
    (total, day) => total + (Number.parseInt(day.estimatedCostAmount, 10) || 0),
    0
  );

  if (totalEstimatedCostAmount > 0) {
    return formatBudgetAmount(totalEstimatedCostAmount);
  }

  return formatBudgetAmount(selection.budgetAmount || 0) || "Budget not specified";
}

function mergeNarrativeIntoGroundedPlan(groundedPlan = {}, narrative = {}) {
  return {
    ...groundedPlan,
    days: (groundedPlan.days ?? []).map((day, index) => ({
      ...day,
      title: narrative.days?.[index]?.title || day.title,
      summary: narrative.days?.[index]?.summary || day.summary,
      tips:
        Array.isArray(narrative.days?.[index]?.tips) &&
        narrative.days[index].tips.length > 0
          ? narrative.days[index].tips
          : day.tips,
    })),
    validation: {
      ...(groundedPlan.validation ?? {}),
      narrativeSource: narrative.source ?? "template",
      warnings: [
        ...((groundedPlan.validation?.warnings ?? []).filter(Boolean)),
        ...(narrative.source === "gemini"
          ? []
          : [
              "Narrative fallback was used because Gemini output was unavailable or invalid.",
            ]),
      ],
    },
  };
}

export async function computeStructuredTripOptimization({
  tripId,
  destinationRecord,
  places = [],
  edges = [],
  planningRequest,
  userSelection,
  forceRefresh = false,
  traceId = "",
} = {}) {
  const resolvedPlanningRequest = normalizePlanningRequest(
    planningRequest?.selection ?? planningRequest ?? userSelection ?? {}
  );
  const selection = resolvedPlanningRequest.selection;
  const dayCount = Math.max(1, selection.days || 1);
  const candidatePlaces = rankCandidatePlaces(
    places,
    selection,
    destinationRecord,
    {
      limit: resolveCandidateLimit(dayCount),
      preferredCategories: ["attraction"],
    }
  );
  const fallbackCandidates =
    candidatePlaces.length > 0
      ? candidatePlaces
      : places
          .filter((place) => place.category === "attraction")
          .slice(0, dayCount * 4);

  if (fallbackCandidates.length === 0) {
    return {
      optimization: {
        objective: "minimize_total_travel_time",
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
      transportEdges: edges,
    };
  }

  const matrix = buildWeightMatrixFromEdges(fallbackCandidates, edges);
  const inputHash = hashPlanningInput({
    destinationVersion: destinationRecord?.version ?? 0,
    dayCount,
    pace: selection.pace,
    travelStyle: selection.travelStyle,
    foodPreferences: selection.foodPreferences,
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
        transportEdges: edges,
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
        transportEdges: edges,
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
    transportEdges: edges,
  };
}

export async function buildDataDrivenTripPlan({
  tripId,
  user,
  userSelection,
  planningRequest,
  forceRefresh = false,
  traceId = "",
}) {
  const resolvedPlanningRequest =
    planningRequest && typeof planningRequest === "object"
      ? planningRequest
      : normalizePlanningRequest(userSelection);
  const selection = resolvedPlanningRequest.selection;
  const structuredUser = await upsertStructuredUser({
    firebaseUid: user.uid,
    email: user.email ?? "",
  });

  console.info("[planning] Normalized planning request", {
    destination: resolvedPlanningRequest.destination,
    days: resolvedPlanningRequest.days,
    budgetAmount: resolvedPlanningRequest.budgetAmount,
    travelStyle: resolvedPlanningRequest.travelStyle,
    pace: resolvedPlanningRequest.pace,
    isComplete: resolvedPlanningRequest.isComplete,
    missingFields: resolvedPlanningRequest.missingFields,
    traceId: traceId || null,
  });

  const ingestion = await ensureStructuredDestinationData({
    destination: selection.location.label,
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
  if (transportContext.cacheHits > 0) {
    incrementPlanningMetric("transport_cache_hit", {
      source: "structured_edges",
    });
  }
  if (transportContext.liveRefreshedEdges > 0) {
    incrementPlanningMetric("transport_live_refresh", {
      source: "distance_matrix",
    });
  }
  if (transportContext.fallbackEdges > 0) {
    incrementPlanningMetric("transport_fallback_edge", {
      source: "haversine",
    });
  }

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
      intentStatus: resolvedPlanningRequest.isComplete ? "complete" : "incomplete",
      missingFields: resolvedPlanningRequest.missingFields,
      validation: {
        status: "planning",
        usedFallbackEdges: transportContext.usedFallbackEdges,
        fallbackEdgeCount: transportContext.fallbackEdges,
        narrativeSource: "pending",
      },
    },
    createdAt: new Date().toISOString(),
  });

  const optimizationPayload = await computeStructuredTripOptimization({
    tripId,
    destinationRecord: ingestion.destination,
    places: ingestion.places,
    edges: transportContext.edges,
    planningRequest: resolvedPlanningRequest,
    forceRefresh,
    traceId,
  });

  let groundedPlan = buildGroundedPlan({
    destination: ingestion.destination.canonicalName,
    selection,
    dayPlans: optimizationPayload.dayPlans,
    candidatePlaces: optimizationPayload.candidatePlaces,
    placesByCategory: ingestion.placesByCategory,
    transportEdges: transportContext.edges,
    narrativeDays: [],
  });

  if (
    groundedPlan.validation.errors.length > 0 &&
    optimizationPayload.candidatePlaces.length > Math.max(selection.days, 1)
  ) {
    incrementPlanningMetric("degraded_partial_plan", {
      reason: "initial_validation_failed",
    });
    console.warn("[planning] Retrying grounded plan with fewer stops", {
      tripId,
      originalCandidateCount: optimizationPayload.candidatePlaces.length,
      errorCount: groundedPlan.validation.errors.length,
      traceId: traceId || null,
    });
    const reducedCandidatePlaces = optimizationPayload.candidatePlaces.slice(
      0,
      Math.max(selection.days * 2, selection.days)
    );

    groundedPlan = buildGroundedPlan({
      destination: ingestion.destination.canonicalName,
      selection,
      dayPlans: rebalanceDayPlansForTargetStops({
        dayCount: Math.max(1, selection.days),
        visitOrder: reducedCandidatePlaces.map((_place, index) => index),
        existingDayPlans: [],
        minStopsPerDay: TARGET_MIN_STOPS_PER_DAY,
        maxStopsPerDay: TARGET_MAX_STOPS_PER_DAY,
      }),
      candidatePlaces: reducedCandidatePlaces,
      placesByCategory: ingestion.placesByCategory,
      transportEdges: transportContext.edges,
      narrativeDays: [],
    });
    groundedPlan.validation.status =
      groundedPlan.validation.errors.length === 0 ? "verified" : "partial";
    groundedPlan.validation.warnings = [
      ...(groundedPlan.validation.warnings ?? []),
      "A reduced-stop partial itinerary was used to keep the route feasible.",
    ];
  }

  const narrative = resolveNarrativeEnabled()
    ? await generateGroundedNarrative({
        planningRequest: resolvedPlanningRequest,
        groundedPlan,
        traceId,
      })
    : {
        days: groundedPlan.days.map((day) => ({
          day: day.day,
          title: day.title,
          summary: day.summary,
          tips: day.tips,
        })),
        source: "template",
      };

  groundedPlan = mergeNarrativeIntoGroundedPlan(groundedPlan, narrative);
  if (groundedPlan.validation.usedFallbackEdges) {
    incrementPlanningMetric("grounded_plan_used_fallback_edges", {
      destination: ingestion.destination.canonicalName,
    });
  }

  const itineraryDays = buildItineraryDaysFromGroundedPlan(groundedPlan);
  const aiPlanDays = buildAiPlanDaysFromGroundedPlan(groundedPlan);
  const recommendations = buildRecommendationsFromStructuredPlaces({
    destination: ingestion.destination.canonicalName,
    provider: ingestion.provider,
    warning: ingestion.warning,
    places: ingestion.places,
  });
  const hotels = collectUniqueHotelsFromGroundedPlan(groundedPlan).map(toHotelCard);
  const totalEstimatedCostLabel = buildTotalEstimatedCostLabel(
    groundedPlan,
    selection
  );
  const travelTips = buildTravelTipsFromGroundedPlan(
    groundedPlan,
    narrative.source
  );
  const intercityTransport = await buildIntercityTransportContext({
    selection,
    destinationLabel: ingestion.destination.canonicalName,
    traceId,
  });

  const planningMeta = {
    dataProvider: ingestion.provider,
    algorithmVersion: optimizationPayload.optimization.algorithmVersion,
    cacheHit:
      optimizationPayload.optimization.cacheHit &&
      transportContext.liveRefreshedEdges === 0,
    generatedAt: new Date().toISOString(),
    freshness: ingestion.freshness?.freshUntil ?? null,
    storageMode: getHybridStoreMode(),
    recommendationProvider: recommendations.provider,
    intentStatus: resolvedPlanningRequest.isComplete ? "complete" : "incomplete",
    missingFields: resolvedPlanningRequest.missingFields,
    validation: {
      ...groundedPlan.validation,
      narrativeSource: narrative.source,
    },
    transport: {
      cacheHits: transportContext.cacheHits,
      liveRefreshedEdges: transportContext.liveRefreshedEdges,
      fallbackEdges: transportContext.fallbackEdges,
    },
    intercityTransport: {
      objective: "fastest_feasible",
      algorithm: intercityTransport.transportSummary?.algorithm ?? "",
      preferredModes: intercityTransport.transportSummary?.preferredModes ?? [],
      maxTransfers: intercityTransport.transportSummary?.maxTransfers ?? null,
      topK: intercityTransport.transportSummary?.topK ?? 0,
      cacheHit: Boolean(intercityTransport.transportSummary?.cacheHit),
      fallbackUsed: Boolean(intercityTransport.transportSummary?.fallbackUsed),
      optionCount: intercityTransport.transportOptions.length,
      verification: intercityTransport.routeVerification,
      message: intercityTransport.message || "",
    },
  };

  const generatedTrip = {
    groundedPlan,
    hotels,
    itinerary: {
      days: itineraryDays,
    },
    aiPlan: {
      destination: ingestion.destination.canonicalName,
      days: aiPlanDays,
      totalEstimatedCost: totalEstimatedCostLabel,
      travelTips,
    },
    recommendations,
    optimization: optimizationPayload.optimization,
    routePlans: optimizationPayload.optimization.dayPlans,
    transportOptions: intercityTransport.transportOptions,
    transport_options: intercityTransport.transportOptions,
    routeVerification: intercityTransport.routeVerification,
    route_verification: intercityTransport.routeVerification,
    transportSummary: intercityTransport.transportSummary,
    transport_summary: intercityTransport.transportSummary,
    transportMessage: intercityTransport.message || "",
    transport_message: intercityTransport.message || "",
  };

  await upsertStructuredTrip({
    id: tripId,
    userId: structuredUser.id,
    destinationId: ingestion.destination.id,
    days: selection.days,
    budgetAmount: selection.budgetAmount,
    preferences: selection,
    status: groundedPlan.validation.status === "verified" ? "active" : "partial",
    planningMeta,
    createdAt: new Date().toISOString(),
  });

  return {
    generatedTrip,
    groundedPlan,
    planningMeta,
    optimization: optimizationPayload.optimization,
  };
}
