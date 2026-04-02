import { formatBudgetAmount } from "../../shared/trips.js";
import { haversineDistanceMeters, hasCoordinates } from "./geo.js";
import { derivePlanningConstraints } from "./planningRequest.js";

const PLAN_ATTRACTION_BASE_COST = Object.freeze({
  "Cheap Plan": 15,
  "Moderate Plan": 28,
  "Best Plan": 52,
});

const PLAN_TRANSIT_COST_PER_MINUTE = Object.freeze({
  "Cheap Plan": 0.18,
  "Moderate Plan": 0.28,
  "Best Plan": 0.42,
});

const HOTEL_COST_BY_PRICE_LEVEL = Object.freeze({
  $: 80,
  $$: 140,
  $$$: 220,
  $$$$: 340,
  "": 120,
});

const RESTAURANT_COST_BY_PRICE_LEVEL = Object.freeze({
  $: 18,
  $$: 32,
  $$$: 58,
  $$$$: 96,
  "": 24,
});

function normalizeText(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized || fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function toRoundedNumber(value, digits = 2) {
  const numeric = Number.parseFloat(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }

  return Number(numeric.toFixed(digits));
}

function averageCoordinates(points = []) {
  const validPoints = points.filter((point) => hasCoordinates(point));
  if (validPoints.length === 0) {
    return { latitude: null, longitude: null };
  }

  const latitude =
    validPoints.reduce((total, point) => total + point.latitude, 0) /
    validPoints.length;
  const longitude =
    validPoints.reduce((total, point) => total + point.longitude, 0) /
    validPoints.length;

  return {
    latitude: toRoundedNumber(latitude, 6),
    longitude: toRoundedNumber(longitude, 6),
  };
}

function formatDurationMinutes(totalMinutes) {
  const minutes = Math.max(0, Math.round(Number.parseFloat(totalMinutes) || 0));
  if (minutes === 0) {
    return "Data not available";
  }

  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;

  if (hours === 0) {
    return `${remainder}m`;
  }

  return `${hours}h ${String(remainder).padStart(2, "0")}m`;
}

function buildEdgeLookup(edges = []) {
  const lookup = new Map();
  for (const edge of edges) {
    lookup.set(`${edge.fromPlaceId}:${edge.toPlaceId}`, edge);
  }

  return lookup;
}

function getEdge(edgeLookup, fromPlaceId, toPlaceId) {
  if (!fromPlaceId || !toPlaceId || fromPlaceId === toPlaceId) {
    return null;
  }

  return edgeLookup.get(`${fromPlaceId}:${toPlaceId}`) ?? null;
}

function resolveFoodTags(place = {}) {
  const rawTypes = Array.isArray(place?.metadata?.types) ? place.metadata.types : [];
  const haystack = [
    ...rawTypes,
    place.name,
    place.description,
  ]
    .map((item) => normalizeText(String(item ?? "")).toLowerCase())
    .join(" ");

  const tags = [];
  if (haystack.includes("vegan")) {
    tags.push("Vegan");
  }
  if (haystack.includes("vegetarian")) {
    tags.push("Vegetarian");
  }

  return tags;
}

function getDistanceScore(fromPoint = {}, toPoint = {}) {
  const distance = haversineDistanceMeters(fromPoint, toPoint);
  if (!Number.isFinite(distance)) {
    return 0.25;
  }

  return clamp(1 - distance / 20_000, 0.1, 1);
}

function getRatingScore(value) {
  const rating = Number.parseFloat(value);
  if (!Number.isFinite(rating)) {
    return 0.6;
  }

  return clamp(rating / 5, 0.1, 1);
}

function estimateHotelCost(place = {}) {
  return HOTEL_COST_BY_PRICE_LEVEL[normalizeText(place.priceLevel)] ?? HOTEL_COST_BY_PRICE_LEVEL[""];
}

function estimateRestaurantCost(place = {}) {
  return (
    RESTAURANT_COST_BY_PRICE_LEVEL[normalizeText(place.priceLevel)] ??
    RESTAURANT_COST_BY_PRICE_LEVEL[""]
  );
}

function estimateAttractionCost(planType) {
  return PLAN_ATTRACTION_BASE_COST[planType] ?? PLAN_ATTRACTION_BASE_COST["Moderate Plan"];
}

function estimateTransitCost(totalTransitMinutes, planType) {
  const costPerMinute =
    PLAN_TRANSIT_COST_PER_MINUTE[planType] ??
    PLAN_TRANSIT_COST_PER_MINUTE["Moderate Plan"];
  return Math.round(totalTransitMinutes * costPerMinute);
}

function estimateVisitMinutes(place = {}) {
  if (place.category === "restaurant") {
    return 75;
  }

  if (place.category === "hotel") {
    return 20;
  }

  return 95;
}

function computeFoodMatchScore(place = {}, foodPreferences = []) {
  if (!Array.isArray(foodPreferences) || foodPreferences.length === 0) {
    return 0.7;
  }

  if (foodPreferences.includes("Mixed")) {
    return 0.8;
  }

  const tags = resolveFoodTags(place);
  const exactMatches = foodPreferences.filter((preference) => tags.includes(preference));
  if (exactMatches.length > 0) {
    return 1;
  }

  if (
    foodPreferences.includes("Vegan") ||
    foodPreferences.includes("Vegetarian")
  ) {
    return 0.2;
  }

  return 0.6;
}

function createHotelRecord(place = {}, centroid) {
  const distanceToClusterMeters = Number.isFinite(
    haversineDistanceMeters(place.coordinates, centroid)
  )
    ? Math.round(haversineDistanceMeters(place.coordinates, centroid))
    : null;

  return {
    id: place.id,
    name: place.name,
    category: "hotel",
    address: place.address,
    coordinates: place.coordinates,
    rating: place.rating ?? null,
    priceLevel: place.priceLevel ?? "",
    description: place.description,
    source: place.source ?? "",
    distanceToClusterMeters,
    metadata: place.metadata ?? {},
  };
}

function createRestaurantRecord(place = {}, centroid, _foodPreferences = [], travelTimeFromPreviousMinutes = 0) {
  const distanceToClusterMeters = Number.isFinite(
    haversineDistanceMeters(place.coordinates, centroid)
  )
    ? Math.round(haversineDistanceMeters(place.coordinates, centroid))
    : null;

  return {
    id: place.id,
    name: place.name,
    category: "restaurant",
    address: place.address,
    coordinates: place.coordinates,
    rating: place.rating ?? null,
    priceLevel: place.priceLevel ?? "",
    description: place.description,
    source: place.source ?? "",
    foodTags: resolveFoodTags(place),
    distanceToClusterMeters,
    travelTimeFromPreviousMinutes,
    metadata: place.metadata ?? {},
  };
}

function createPlaceRecord(place = {}, travelTimeFromPreviousMinutes = 0) {
  return {
    id: place.id,
    name: place.name,
    category: place.category || "attraction",
    address: place.address,
    coordinates: place.coordinates,
    rating: place.rating ?? null,
    priceLevel: place.priceLevel ?? "",
    description: place.description,
    source: place.source ?? "",
    travelTimeFromPreviousMinutes,
    metadata: place.metadata ?? {},
  };
}

function chooseHotelForDay(hotels = [], centroid, constraints) {
  if (!Array.isArray(hotels) || hotels.length === 0) {
    return null;
  }

  const targetStayBudget = constraints.perDayBudget
    ? Math.round(constraints.perDayBudget * 0.45)
    : null;

  return [...hotels]
    .map((hotel) => {
      const distanceScore = getDistanceScore(hotel.coordinates, centroid);
      const ratingScore = getRatingScore(hotel.rating);
      const estimatedCost = estimateHotelCost(hotel);
      const budgetScore =
        targetStayBudget && targetStayBudget > 0
          ? clamp(1 - Math.abs(estimatedCost - targetStayBudget) / targetStayBudget, 0.1, 1)
          : 0.75;

      return {
        hotel,
        score: ratingScore * 0.38 + distanceScore * 0.42 + budgetScore * 0.2,
      };
    })
    .sort((left, right) => right.score - left.score)[0]?.hotel ?? null;
}

function chooseRestaurantForDay(restaurants = [], anchorPoint, selection) {
  if (!Array.isArray(restaurants) || restaurants.length === 0) {
    return null;
  }

  return [...restaurants]
    .map((restaurant) => {
      const distanceScore = getDistanceScore(restaurant.coordinates, anchorPoint);
      const ratingScore = getRatingScore(restaurant.rating);
      const foodScore = computeFoodMatchScore(
        restaurant,
        selection.foodPreferences
      );

      return {
        restaurant,
        score: ratingScore * 0.35 + distanceScore * 0.3 + foodScore * 0.35,
      };
    })
    .sort((left, right) => right.score - left.score)[0]?.restaurant ?? null;
}

function computeRouteStats(routeIds = [], edgeLookup) {
  let totalTransitMinutes = 0;
  let usedFallbackEdges = false;
  let fallbackEdgeCount = 0;
  const routeLegs = [];

  for (let index = 0; index < routeIds.length - 1; index += 1) {
    const fromPlaceId = routeIds[index];
    const toPlaceId = routeIds[index + 1];
    const edge = getEdge(edgeLookup, fromPlaceId, toPlaceId);

    if (!edge) {
      routeLegs.push({
        fromPlaceId,
        toPlaceId,
        durationMinutes: null,
        source: "missing_edge",
      });
      continue;
    }

    const durationMinutes = Math.max(
      1,
      Math.round((Number.parseFloat(edge.durationSeconds) || 0) / 60)
    );
    totalTransitMinutes += durationMinutes;

    if (normalizeText(edge.source).includes("haversine")) {
      usedFallbackEdges = true;
      fallbackEdgeCount += 1;
    }

    routeLegs.push({
      fromPlaceId,
      toPlaceId,
      durationMinutes,
      source: edge.source ?? "",
    });
  }

  return {
    routeLegs,
    totalTransitMinutes,
    usedFallbackEdges,
    fallbackEdgeCount,
  };
}

function enrichRecordsWithTravelTimes({ hotelRecord, placeRecords, restaurantRecord, routeLegs }) {
  const durationByToPlaceId = new Map(
    routeLegs
      .filter((leg) => Number.isFinite(leg.durationMinutes))
      .map((leg) => [leg.toPlaceId, leg.durationMinutes])
  );

  const enrichedPlaces = placeRecords.map((place) => ({
    ...place,
    travelTimeFromPreviousMinutes:
      durationByToPlaceId.get(place.id) ?? place.travelTimeFromPreviousMinutes ?? 0,
  }));

  return {
    hotelRecord: hotelRecord
      ? {
          ...hotelRecord,
          travelTimeFromPreviousMinutes: 0,
        }
      : null,
    placeRecords: enrichedPlaces,
    restaurantRecord: restaurantRecord
      ? {
          ...restaurantRecord,
          travelTimeFromPreviousMinutes:
            durationByToPlaceId.get(restaurantRecord.id) ??
            restaurantRecord.travelTimeFromPreviousMinutes ??
            0,
        }
      : null,
  };
}

function buildRouteIdsForDay(day = {}) {
  return [
    ...((day.hotels ?? []).map((hotel) => hotel.id)),
    ...((day.places ?? []).map((place) => place.id)),
    ...((day.restaurants ?? []).map((restaurant) => restaurant.id)),
  ];
}

function syncDayRoute(day, edgeLookup) {
  const route = buildRouteIdsForDay(day);
  const routeStats = computeRouteStats(route, edgeLookup);
  const enriched = enrichRecordsWithTravelTimes({
    hotelRecord: day.hotels?.[0] ?? null,
    placeRecords: day.places ?? [],
    restaurantRecord: day.restaurants?.[0] ?? null,
    routeLegs: routeStats.routeLegs,
  });

  return {
    ...day,
    hotels: enriched.hotelRecord ? [enriched.hotelRecord] : [],
    places: enriched.placeRecords,
    restaurants: enriched.restaurantRecord ? [enriched.restaurantRecord] : [],
    route,
    totalTransitMinutes: routeStats.totalTransitMinutes,
    usedFallbackEdges: routeStats.usedFallbackEdges,
    fallbackEdgeCount: routeStats.fallbackEdgeCount,
    routeLegs: routeStats.routeLegs,
  };
}

function buildTemplateNarrative(day, destination) {
  return {
    title: `Day ${day.day} in ${destination}`,
    summary:
      day.places.length > 0
        ? `This day stays within a practical route through ${destination} and focuses on verified stops selected from grounded destination data.`
        : "Data not available",
    tips: [
      "Follow the verified stop order to reduce unnecessary transit time.",
      "Keep booking confirmations and a map link ready before you start the day.",
    ],
  };
}

function buildDayPlan({
  dayPlan,
  destination,
  candidatePlacesById,
  hotels,
  restaurants,
  edgeLookup,
  selection,
  narrativeDay,
}) {
  const places = dayPlan.visitOrder
    .map((placeIndex) => candidatePlacesById.get(placeIndex))
    .filter(Boolean);
  const centroid = averageCoordinates(places.map((place) => place.coordinates));
  const hotel = chooseHotelForDay(hotels, centroid, derivePlanningConstraints(selection));
  const restaurantAnchor = places.at(-1)?.coordinates ?? centroid;
  const restaurant = chooseRestaurantForDay(restaurants, restaurantAnchor, selection);

  const hotelRecord = hotel ? createHotelRecord(hotel, centroid) : null;
  const routeIds = [
    ...(hotelRecord ? [hotelRecord.id] : []),
    ...places.map((place) => place.id),
    ...(restaurant ? [restaurant.id] : []),
  ];
  const routeStats = computeRouteStats(routeIds, edgeLookup);
  const placeRecords = places.map((place) =>
    createPlaceRecord(place)
  );
  const restaurantRecord = restaurant
    ? createRestaurantRecord(restaurant, centroid, selection.foodPreferences)
    : null;
  const enriched = enrichRecordsWithTravelTimes({
    hotelRecord,
    placeRecords,
    restaurantRecord,
    routeLegs: routeStats.routeLegs,
  });

  return {
    day: dayPlan.day,
    title: normalizeText(
      narrativeDay?.title,
      `Day ${dayPlan.day} in ${destination}`
    ),
    summary: normalizeText(narrativeDay?.summary),
    tips:
      Array.isArray(narrativeDay?.tips) && narrativeDay.tips.length > 0
        ? narrativeDay.tips
        : buildTemplateNarrative({ day: dayPlan.day, places }, destination).tips,
    places: enriched.placeRecords,
    hotels: enriched.hotelRecord ? [enriched.hotelRecord] : [],
    restaurants: enriched.restaurantRecord ? [enriched.restaurantRecord] : [],
    route: routeIds,
    totalTransitMinutes: routeStats.totalTransitMinutes,
    usedFallbackEdges: routeStats.usedFallbackEdges,
    fallbackEdgeCount: routeStats.fallbackEdgeCount,
    routeLegs: routeStats.routeLegs,
  };
}

function recalculateDayMetrics(day, selection, constraints) {
  const totalVisitMinutes =
    day.places.reduce((total, place) => total + estimateVisitMinutes(place), 0) +
    day.restaurants.reduce((total, restaurant) => total + estimateVisitMinutes(restaurant), 0);

  const hotelCost = day.hotels[0] ? estimateHotelCost(day.hotels[0]) : 0;
  const restaurantCost = day.restaurants[0] ? estimateRestaurantCost(day.restaurants[0]) : 0;
  const attractionCost = day.places.length * estimateAttractionCost(selection.planType);
  const transitCost = estimateTransitCost(day.totalTransitMinutes, selection.planType);
  const estimatedCostAmount = hotelCost + restaurantCost + attractionCost + transitCost;
  const estimatedTimeMinutes = totalVisitMinutes + day.totalTransitMinutes;
  const maxAllowedBudget = constraints.perDayBudget
    ? Math.round(constraints.perDayBudget * constraints.budgetToleranceRatio)
    : null;

  return {
    ...day,
    estimatedTimeMinutes,
    estimated_time: formatDurationMinutes(estimatedTimeMinutes),
    estimatedCostAmount,
    cost: formatBudgetAmount(estimatedCostAmount),
    validation: {
      isTimeFeasible: estimatedTimeMinutes <= constraints.maxDailyMinutes,
      isTransitFeasible: day.totalTransitMinutes <= constraints.maxTransitMinutes,
      isStopCountFeasible: day.places.length <= constraints.maxStopsPerDay,
      isBudgetFeasible:
        maxAllowedBudget === null || estimatedCostAmount <= maxAllowedBudget,
    },
  };
}

function trimDayToConstraints(day, selection, constraints, edgeLookup) {
  let currentDay = recalculateDayMetrics(day, selection, constraints);
  let trimmed = false;

  while (
    currentDay.places.length > 1 &&
    (!currentDay.validation.isTimeFeasible ||
      !currentDay.validation.isTransitFeasible ||
      !currentDay.validation.isStopCountFeasible ||
      !currentDay.validation.isBudgetFeasible)
  ) {
    trimmed = true;
    currentDay = recalculateDayMetrics(
      syncDayRoute(
        {
          ...currentDay,
          places: currentDay.places.slice(0, -1),
        },
        edgeLookup
      ),
      selection,
      constraints
    );
  }

  return {
    day: currentDay,
    trimmed,
  };
}

export function validateGroundedPlan({
  groundedPlan,
  knownPlaceIds = new Set(),
  edgeLookup,
  constraints,
}) {
  const errors = [];
  const warnings = [];
  const seenAttractionIds = new Set();
  let usedFallbackEdges = false;
  let fallbackEdgeCount = 0;

  for (const day of groundedPlan.days) {
    for (const entity of [...day.places, ...day.hotels, ...day.restaurants]) {
      if (!knownPlaceIds.has(entity.id)) {
        errors.push(`Unknown place reference detected for day ${day.day}: ${entity.id}`);
      }
    }

    for (const place of day.places) {
      if (seenAttractionIds.has(place.id)) {
        errors.push(`Duplicate attraction detected across days: ${place.name}`);
      }
      seenAttractionIds.add(place.id);
    }

    if (!day.validation.isTimeFeasible) {
      errors.push(`Day ${day.day} exceeds daily time limits.`);
    }

    if (!day.validation.isTransitFeasible) {
      errors.push(`Day ${day.day} exceeds transit time limits.`);
    }

    if (!day.validation.isStopCountFeasible) {
      errors.push(`Day ${day.day} exceeds the stop count allowed for ${constraints.pace} pace.`);
    }

    if (!day.validation.isBudgetFeasible) {
      errors.push(`Day ${day.day} exceeds the budget cap.`);
    }

    if (day.hotels.length === 0) {
      warnings.push(`Day ${day.day} has no verified hotel recommendation.`);
    }

    if (day.restaurants.length === 0) {
      warnings.push(`Day ${day.day} has no verified restaurant recommendation.`);
    }

    for (let index = 0; index < day.route.length - 1; index += 1) {
      const edge = getEdge(edgeLookup, day.route[index], day.route[index + 1]);
      if (!edge) {
        errors.push(`Day ${day.day} contains an unknown route leg.`);
        continue;
      }

      if (normalizeText(edge.source).includes("haversine")) {
        usedFallbackEdges = true;
        fallbackEdgeCount += 1;
      }
    }
  }

  return {
    status: errors.length === 0 ? "verified" : "partial",
    errors,
    warnings,
    usedFallbackEdges,
    fallbackEdgeCount,
  };
}

export function buildGroundedPlan({
  destination,
  selection,
  dayPlans = [],
  candidatePlaces = [],
  placesByCategory = {},
  transportEdges = [],
  narrativeDays = [],
}) {
  const constraints = derivePlanningConstraints(selection);
  const candidatePlacesById = new Map(
    candidatePlaces.map((place, index) => [index, place])
  );
  const edgeLookup = buildEdgeLookup(transportEdges);
  const hotels = Array.isArray(placesByCategory.hotels) ? placesByCategory.hotels : [];
  const restaurants = Array.isArray(placesByCategory.restaurants)
    ? placesByCategory.restaurants
    : [];

  const dayResults = dayPlans.map((dayPlan, index) =>
    trimDayToConstraints(
      buildDayPlan({
        dayPlan,
        destination,
        candidatePlacesById,
        hotels,
        restaurants,
        edgeLookup,
        selection,
        narrativeDay: narrativeDays[index] ?? null,
      }),
      selection,
      constraints,
      edgeLookup
    )
  );

  const days = dayResults.map((result) => {
    const day = result.day;
    const fallbackNarrative = buildTemplateNarrative(day, destination);

    return {
      ...day,
      title: day.title || fallbackNarrative.title,
      summary: day.summary || fallbackNarrative.summary,
      tips:
        Array.isArray(day.tips) && day.tips.length > 0
          ? day.tips
          : fallbackNarrative.tips,
      wasTrimmed: result.trimmed,
    };
  });

  const validation = validateGroundedPlan({
    groundedPlan: { destination, days },
    knownPlaceIds: new Set(
      [...hotels, ...restaurants, ...candidatePlaces].map((place) => place.id)
    ),
    edgeLookup,
    constraints,
  });

  if (dayResults.some((result) => result.trimmed)) {
    validation.warnings.push(
      "One or more days were trimmed to satisfy time or budget feasibility."
    );
  }

  return {
    destination,
    days,
    validation,
  };
}
