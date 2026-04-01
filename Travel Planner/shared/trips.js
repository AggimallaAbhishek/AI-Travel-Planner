import { normalizeGeoCoordinates } from "./maps.js";

function normalizeText(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed || fallback;
}

function normalizeInteger(value, fallback = 1) {
  if (value === undefined || value === null) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function clampInteger(value, min, max, fallback) {
  const parsed = normalizeInteger(value, fallback);
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

function normalizeChoice(value, fallback = "") {
  if (value === undefined || value === null) {
    return fallback;
  }

  return normalizeText(String(value));
}

function normalizeRating(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeCoordinates(value) {
  return normalizeGeoCoordinates(value);
}

function normalizeStringArray(values, maxItems = 8) {
  if (!Array.isArray(values)) {
    return [];
  }

  const normalized = [];
  const seen = new Set();

  for (const value of values) {
    const text = normalizeText(typeof value === "string" ? value : "");
    if (!text) {
      continue;
    }

    const key = text.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    normalized.push(text);
    seen.add(key);

    if (normalized.length >= maxItems) {
      break;
    }
  }

  return normalized;
}

export const TRIP_OBJECTIVE_OPTIONS = [
  "fastest",
  "cheapest",
  "best_experience",
];
export const TRIP_DISRUPTION_TYPES = [
  "poi_closed",
  "traffic_delay",
  "weather_change",
  "user_skip",
];
const DEFAULT_TRIP_OBJECTIVE = "best_experience";
const DEFAULT_DAILY_TIME_LIMIT_HOURS = 10;
const DEFAULT_ALTERNATIVES_COUNT = 3;

function normalizeLowerText(value, fallback = "") {
  return normalizeText(value, fallback).toLowerCase();
}

function normalizeMealPreferences(value) {
  if (Array.isArray(value)) {
    return normalizeStringArray(value, 8);
  }

  if (typeof value === "string") {
    return normalizeStringArray(
      value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
      8
    );
  }

  return [];
}

export function normalizeTripObjective(value) {
  const normalized = normalizeLowerText(value);
  if (TRIP_OBJECTIVE_OPTIONS.includes(normalized)) {
    return normalized;
  }

  if (normalized === "duration") {
    return "fastest";
  }

  if (normalized === "distance") {
    return "cheapest";
  }

  return DEFAULT_TRIP_OBJECTIVE;
}

export function normalizeAlternativesCount(value) {
  return clampInteger(value, 1, 5, DEFAULT_ALTERNATIVES_COUNT);
}

export function normalizeTripConstraints(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const rawDailyTimeLimit =
    source.dailyTimeLimitHours ?? source.daily_time_limit ?? source.dailyTimeLimit;
  const dailyTimeLimitHours = clampInteger(
    rawDailyTimeLimit,
    4,
    16,
    DEFAULT_DAILY_TIME_LIMIT_HOURS
  );
  const rawBudgetCap = source.budgetCap ?? source.budget_cap;
  const budgetCap = rawBudgetCap === undefined || rawBudgetCap === null || rawBudgetCap === ""
    ? null
    : clampInteger(rawBudgetCap, 50, 100_000, 50);

  return {
    dailyTimeLimitHours,
    budgetCap,
    mobilityPref: normalizeText(
      source.mobilityPref ?? source.mobility_pref,
      "balanced"
    ),
    mealPrefs: normalizeMealPreferences(
      source.mealPrefs ?? source.meal_prefs
    ),
  };
}

export function sanitizePromptValue(value, fallback = "") {
  const text = normalizeText(String(value ?? ""), fallback);
  if (!text) {
    return fallback;
  }

  return text
    .replace(/[{}<>]/g, " ")
    .replace(/[^\p{L}\p{N}\s,.'+&:/()-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDisruptionType(value) {
  const type = normalizeLowerText(value);
  return TRIP_DISRUPTION_TYPES.includes(type) ? type : "user_skip";
}

function normalizeDisruptionItem(item = {}) {
  const normalizedItem = item && typeof item === "object" ? item : {};

  return {
    type: normalizeDisruptionType(normalizedItem.type),
    dayNumber: clampInteger(
      normalizedItem.dayNumber ?? normalizedItem.day ?? 1,
      1,
      30,
      1
    ),
    placeName: normalizeText(normalizedItem.placeName ?? normalizedItem.place),
    reason: normalizeText(normalizedItem.reason, ""),
    severity: normalizeText(normalizedItem.severity, "medium").toLowerCase(),
  };
}

export function normalizeTripDisruptions(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(normalizeDisruptionItem).slice(0, 12);
}

export function getTripDisruptionErrors(value) {
  if (!Array.isArray(value)) {
    return ["Disruptions must be an array."];
  }

  const errors = [];

  value.slice(0, 12).forEach((disruption, index) => {
    const row = index + 1;
    const normalized = normalizeDisruptionItem(disruption);

    if (!TRIP_DISRUPTION_TYPES.includes(normalized.type)) {
      errors.push(`Disruption ${row} has an unsupported type.`);
    }

    if (
      !Number.isInteger(normalized.dayNumber) ||
      normalized.dayNumber < 1 ||
      normalized.dayNumber > 30
    ) {
      errors.push(`Disruption ${row} must target a day between 1 and 30.`);
    }

    if (!normalized.placeName && normalized.type !== "weather_change") {
      errors.push(
        `Disruption ${row} requires a place name unless type is weather_change.`
      );
    }
  });

  return errors;
}

function normalizeDayNumber(rawDay, index) {
  if (typeof rawDay === "number" && rawDay > 0) {
    return rawDay;
  }

  if (typeof rawDay === "string") {
    const match = rawDay.match(/(\d+)/);
    if (match) {
      return normalizeInteger(match[1], index + 1);
    }
  }

  return index + 1;
}

function normalizeActivityLabel(activity, index) {
  if (typeof activity === "string") {
    return normalizeText(activity);
  }

  if (!activity || typeof activity !== "object") {
    return "";
  }

  return normalizeText(
    activity.activity ??
      activity.title ??
      activity.name ??
      activity.placeName ??
      activity.place ??
      activity.description,
    `Activity ${index + 1}`
  );
}

function normalizeActivities(source = []) {
  if (Array.isArray(source)) {
    const labels = source
      .map((item, index) => normalizeActivityLabel(item, index))
      .filter(Boolean);
    return normalizeStringArray(labels, 10);
  }

  if (typeof source === "string") {
    return normalizeStringArray([source], 10);
  }

  return [];
}

function getBudgetCostBand(budget) {
  const normalized = normalizeText(budget).toLowerCase();

  if (/cheap|budget|economy/.test(normalized)) {
    return { min: 45, max: 90 };
  }

  if (/luxury|premium/.test(normalized)) {
    return { min: 220, max: 420 };
  }

  return { min: 90, max: 180 };
}

function buildEstimatedTotalCost(budget, days) {
  const band = getBudgetCostBand(budget);
  const min = band.min * days;
  const max = band.max * days;
  return `Approx. $${min} - $${max}`;
}

function normalizeTravelTips(value, destination) {
  const tips = normalizeStringArray(
    Array.isArray(value)
      ? value
      : typeof value === "string"
        ? [value]
        : []
  );

  if (tips.length > 0) {
    return tips;
  }

  return [
    `Book high-demand attractions in ${destination} at least a few days ahead.`,
    "Keep 10-15% of your budget as a contingency buffer.",
    "Start each day early to avoid peak-time crowds and transport delays.",
    "Save an offline map and emergency contacts before heading out.",
  ];
}

function mapDayActivitiesToPlaces(day) {
  const baseDetails = normalizeText(day.tips, "Planned travel activity.");

  return day.activities.map((activity) =>
    normalizePlace({
      placeName: activity,
      placeDetails: baseDetails,
      ticketPricing: normalizeText(day.estimatedCost, "Included in trip budget"),
      travelTime: "Flexible",
      bestTimeToVisit: "As per daily plan",
      category: "Activity",
    })
  );
}

function mapAiPlanDaysToItinerary(days = []) {
  return {
    days: days.map((day, index) => ({
      dayNumber: normalizeDayNumber(day.day, index),
      title: normalizeText(day.title, `Day ${index + 1}`),
      places: mapDayActivitiesToPlaces(day),
    })),
  };
}

function hasAtLeastOnePlannedPlace(itinerary) {
  return Array.isArray(itinerary?.days)
    ? itinerary.days.some(
        (day) => Array.isArray(day?.places) && day.places.length > 0
      )
    : false;
}

function extractRawPlanDays(payload = {}) {
  const directCandidates = [
    payload?.days,
    payload?.tripData?.days,
    payload?.trip?.days,
    payload?.plan?.days,
    payload?.tripPlan?.days,
  ];

  for (const candidate of directCandidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  const itineraryCandidates = [
    payload?.itinerary,
    payload?.tripData?.itinerary,
    payload?.trip?.itinerary,
  ];

  for (const itinerary of itineraryCandidates) {
    if (Array.isArray(itinerary?.days)) {
      return itinerary.days;
    }

    if (itinerary && typeof itinerary === "object") {
      return Object.entries(itinerary).map(([dayKey, places]) => ({
        day: dayKey,
        title: `Day ${normalizeDayNumber(dayKey, 0)}`,
        activities: Array.isArray(places)
          ? places.map((place) => place?.placeName ?? place?.name ?? place)
          : [],
      }));
    }
  }

  return [];
}

function normalizeAiDay(rawDay = {}, index) {
  const activityCandidates = [
    rawDay.activities,
    rawDay.activityList,
    rawDay.highlights,
    rawDay.places,
  ];

  let activities = [];
  for (const candidate of activityCandidates) {
    const normalized = normalizeActivities(candidate);
    if (normalized.length > 0) {
      activities = normalized;
      break;
    }
  }

  const dayNumber = normalizeDayNumber(rawDay.day ?? rawDay.dayNumber, index);
  const title = normalizeText(rawDay.title ?? rawDay.theme, `Day ${dayNumber}`);

  return {
    day: dayNumber,
    title,
    activities:
      activities.length > 0
        ? activities
        : [`Explore ${title.toLowerCase()} highlights`],
    estimatedCost: normalizeText(
      rawDay.estimated_cost ?? rawDay.estimatedCost ?? rawDay.cost,
      "Not specified"
    ),
    tips: normalizeText(rawDay.tips ?? rawDay.tip ?? rawDay.notes, ""),
  };
}

function buildFallbackPlanDays(selection) {
  const destination = normalizeText(selection.location.label, "your destination");
  const dayCount = clampInteger(selection.days, 1, 30, 1);
  const activitiesByDay = [
    ["Arrive and check in", "Orientation walk around the main district", "Evening local food experience"],
    ["Visit a major landmark", "Explore a cultural neighborhood", "Sunset viewpoint"],
    ["Museum or heritage site tour", "Relaxed cafe break", "Local market shopping"],
    ["Nature or scenic day trip", "Free exploration window", "Dinner in a recommended area"],
  ];

  return Array.from({ length: dayCount }, (_, index) => {
    const template = activitiesByDay[index % activitiesByDay.length];
    return {
      day: index + 1,
      title: `Day ${index + 1} in ${destination}`,
      activities: template,
      estimatedCost: "Not specified",
      tips: `Plan transport between stops in ${destination} to avoid idle time.`,
    };
  });
}

export function isRemoteImageUrl(value) {
  if (typeof value !== "string") {
    return false;
  }

  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return false;
  }

  return !/placeholder|example|unsplash\.com\/featured/i.test(trimmed);
}

export function normalizeLocation(input) {
  if (typeof input === "string") {
    return { label: normalizeText(input) };
  }

  if (input && typeof input === "object") {
    return {
      label: normalizeText(input.label ?? input.description ?? input.value),
    };
  }

  return { label: "" };
}

export function normalizeUserSelection(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const rawTravelerCount =
    source.travelerCount ?? source.numberOfTravelers ?? source.travelersCount;
  const travelerCount =
    rawTravelerCount === undefined || rawTravelerCount === null || rawTravelerCount === ""
      ? null
      : normalizeInteger(rawTravelerCount, 0);
  const constraints = normalizeTripConstraints(
    source.constraints ?? {
      dailyTimeLimitHours:
        source.dailyTimeLimitHours ?? source.daily_time_limit,
      budgetCap: source.budgetCap ?? source.budget_cap,
      mobilityPref: source.mobilityPref ?? source.mobility_pref,
      mealPrefs: source.mealPrefs ?? source.meal_prefs,
    }
  );

  return {
    location: normalizeLocation(source.location ?? source.destination),
    days: normalizeInteger(source.days ?? source.noOfDays, 1),
    budget: normalizeChoice(source.budget),
    travelers: normalizeChoice(
      source.travelers ?? source.travelWith ?? source.traveler
    ),
    travelType: normalizeChoice(
      source.travelType ?? source.tripType ?? source.travelStyle
    ),
    travelerCount,
    objective: normalizeTripObjective(
      source.objective ?? source.optimizeFor ?? source.optimize_for
    ),
    constraints,
    alternativesCount: normalizeAlternativesCount(
      source.alternativesCount ?? source.alternatives_count
    ),
  };
}

export function getUserSelectionErrors(input = {}) {
  const selection = normalizeUserSelection(input);
  const errors = [];
  const MAX_LOCATION_LENGTH = 120;
  const MAX_CHOICE_LENGTH = 40;

  if (!selection.location.label) {
    errors.push("Destination is required.");
  } else if (selection.location.label.length > MAX_LOCATION_LENGTH) {
    errors.push("Destination must be 120 characters or fewer.");
  }

  if (
    !Number.isInteger(selection.days) ||
    selection.days < 1 ||
    selection.days > 30
  ) {
    errors.push("Trip duration must be between 1 and 30 days.");
  }

  if (!selection.budget) {
    errors.push("Budget is required.");
  } else if (selection.budget.length > MAX_CHOICE_LENGTH) {
    errors.push("Budget must be 40 characters or fewer.");
  }

  if (!selection.travelers) {
    errors.push("Traveler type is required.");
  } else if (selection.travelers.length > MAX_CHOICE_LENGTH) {
    errors.push("Traveler type must be 40 characters or fewer.");
  }

  if (
    selection.travelType &&
    selection.travelType.length > MAX_CHOICE_LENGTH
  ) {
    errors.push("Travel type must be 40 characters or fewer.");
  }

  if (
    selection.travelerCount !== null &&
    (!Number.isInteger(selection.travelerCount) ||
      selection.travelerCount < 1 ||
      selection.travelerCount > 50)
  ) {
    errors.push("Traveler count must be between 1 and 50.");
  }

  if (!TRIP_OBJECTIVE_OPTIONS.includes(selection.objective)) {
    errors.push("Objective must be fastest, cheapest, or best_experience.");
  }

  if (
    !Number.isInteger(selection.constraints.dailyTimeLimitHours) ||
    selection.constraints.dailyTimeLimitHours < 4 ||
    selection.constraints.dailyTimeLimitHours > 16
  ) {
    errors.push("Daily time limit must be between 4 and 16 hours.");
  }

  if (
    selection.constraints.budgetCap !== null &&
    (!Number.isInteger(selection.constraints.budgetCap) ||
      selection.constraints.budgetCap < 50 ||
      selection.constraints.budgetCap > 100_000)
  ) {
    errors.push("Budget cap must be between 50 and 100000 when provided.");
  }

  if (
    selection.constraints.mobilityPref &&
    selection.constraints.mobilityPref.length > MAX_CHOICE_LENGTH
  ) {
    errors.push("Mobility preference must be 40 characters or fewer.");
  }

  if (selection.constraints.mealPrefs.some((meal) => meal.length > MAX_CHOICE_LENGTH)) {
    errors.push("Meal preferences must be 40 characters or fewer.");
  }

  if (
    !Number.isInteger(selection.alternativesCount) ||
    selection.alternativesCount < 1 ||
    selection.alternativesCount > 5
  ) {
    errors.push("Alternatives count must be between 1 and 5.");
  }

  return errors;
}

export function normalizeHotel(hotel = {}) {
  const priceSource = hotel.price;
  const price =
    typeof priceSource === "string"
      ? normalizeText(priceSource)
      : normalizeText(
          priceSource?.range ??
            priceSource?.amount ??
            priceSource?.label ??
            hotel.priceRange
        );

  return {
    hotelName: normalizeText(hotel.hotelName ?? hotel.name, "Recommended Hotel"),
    hotelAddress: normalizeText(hotel.hotelAddress ?? hotel.address),
    price,
    hotelImageUrl: isRemoteImageUrl(hotel.hotelImageUrl) ? hotel.hotelImageUrl : "",
    geoCoordinates: normalizeCoordinates(
      hotel.geoCoordinates ?? hotel.coordinates ?? hotel.location
    ),
    rating: normalizeRating(hotel.rating),
    description: normalizeText(hotel.description ?? hotel.details),
  };
}

const PLACE_GEOCODE_STATUSES = ["resolved", "unresolved", "inferred"];
const PLACE_GEOCODE_SOURCES = [
  "google_places",
  "world_poi_index",
  "stored",
  "fallback_inferred",
];

function normalizeGeocodeStatus(value, fallback = "unresolved") {
  const normalized = normalizeLowerText(value);
  return PLACE_GEOCODE_STATUSES.includes(normalized) ? normalized : fallback;
}

function normalizeGeocodeSource(value, fallback = "") {
  const normalized = normalizeLowerText(value);
  return PLACE_GEOCODE_SOURCES.includes(normalized) ? normalized : fallback;
}

export function normalizePlace(place = {}) {
  const coordinates = normalizeCoordinates(
    place.geoCoordinates ?? place.coordinates ?? place.location
  );
  const hasCoordinates =
    coordinates.latitude !== null && coordinates.longitude !== null;

  return {
    placeName: normalizeText(place.placeName ?? place.name, "Recommended Stop"),
    placeDetails: normalizeText(
      place.placeDetails ?? place.description ?? place.details
    ),
    placeImageUrl: isRemoteImageUrl(place.placeImageUrl) ? place.placeImageUrl : "",
    geoCoordinates: coordinates,
    location: normalizeText(place.location ?? place.address),
    mapsUrl: normalizeText(place.mapsUrl ?? place.googleMapsUri),
    geocodeStatus: normalizeGeocodeStatus(
      place.geocodeStatus,
      hasCoordinates ? "resolved" : "unresolved"
    ),
    geocodeSource: normalizeGeocodeSource(
      place.geocodeSource,
      hasCoordinates ? "stored" : ""
    ),
    geocodedAt: normalizeText(place.geocodedAt),
    ticketPricing: normalizeText(place.ticketPricing ?? place.ticketPrice, "N/A"),
    rating: normalizeRating(place.rating),
    travelTime: normalizeText(place.travelTime, "N/A"),
    bestTimeToVisit: normalizeText(place.bestTimeToVisit, "Flexible"),
    category: normalizeText(place.category),
  };
}

export function normalizeItinerary(itinerary = {}) {
  let days = [];

  if (Array.isArray(itinerary?.days)) {
    days = itinerary.days.map((day, index) => ({
      dayNumber: normalizeDayNumber(day?.dayNumber ?? day?.day, index),
      title: normalizeText(day?.title ?? day?.theme, `Day ${index + 1}`),
      places: Array.isArray(day?.places)
        ? day.places.map(normalizePlace).filter((place) => place.placeName)
        : [],
    }));
  } else if (itinerary && typeof itinerary === "object") {
    days = Object.entries(itinerary).map(([dayKey, places], index) => ({
      dayNumber: normalizeDayNumber(dayKey, index),
      title: `Day ${index + 1}`,
      places: Array.isArray(places)
        ? places.map(normalizePlace).filter((place) => place.placeName)
        : [],
    }));
  }

  days.sort((left, right) => left.dayNumber - right.dayNumber);

  return { days };
}

function stripJsonCodeFence(value) {
  return value
    .replace(/^```json/i, "")
    .replace(/^```/i, "")
    .replace(/```$/i, "")
    .trim();
}

export function parseAiTripPayload(input) {
  if (typeof input !== "string") {
    return input;
  }

  const cleaned = stripJsonCodeFence(input);

  try {
    return JSON.parse(cleaned);
  } catch (error) {
    const firstObjectIndex = cleaned.indexOf("{");
    const lastObjectIndex = cleaned.lastIndexOf("}");

    if (firstObjectIndex >= 0 && lastObjectIndex > firstObjectIndex) {
      const candidate = cleaned.slice(firstObjectIndex, lastObjectIndex + 1);
      return JSON.parse(candidate);
    }

    throw error;
  }
}

export function normalizeAiPlan(payload = {}, fallbackSelection = {}) {
  const selection = normalizeUserSelection(fallbackSelection);
  const fallbackDestination = normalizeText(
    selection.location.label,
    "Unknown destination"
  );
  const destination = normalizeText(
    payload?.destination ??
      payload?.tripData?.destination ??
      payload?.trip?.destination ??
      payload?.location,
    fallbackDestination
  );

  const rawDays = extractRawPlanDays(payload);
  let days = rawDays
    .map((rawDay, index) => normalizeAiDay(rawDay, index))
    .sort((left, right) => left.day - right.day);

  if (days.length === 0) {
    days = buildFallbackPlanDays({
      ...selection,
      location: { label: destination },
    });
  }

  const totalEstimatedCost = normalizeText(
    payload?.total_estimated_cost ??
      payload?.totalEstimatedCost ??
      payload?.estimated_total_cost ??
      payload?.costSummary,
    buildEstimatedTotalCost(selection.budget, days.length)
  );

  const travelTips = normalizeTravelTips(
    payload?.travel_tips ?? payload?.travelTips ?? payload?.tips,
    destination
  );

  return {
    destination,
    days,
    totalEstimatedCost,
    travelTips,
  };
}

export function normalizeGeneratedTrip(input = {}, options = {}) {
  const payload = parseAiTripPayload(input);

  const hotels =
    payload?.hotels ??
    payload?.tripData?.hotels ??
    payload?.trip?.hotels ??
    [];

  const itinerarySource =
    payload?.itinerary ??
    payload?.tripData?.itinerary ??
    payload?.trip?.itinerary ??
    {};

  const normalizedItinerary = normalizeItinerary(itinerarySource);
  const aiPlan = normalizeAiPlan(payload, options.userSelection);

  return {
    hotels: Array.isArray(hotels)
      ? hotels.map(normalizeHotel).filter((hotel) => hotel.hotelName)
      : [],
    itinerary: hasAtLeastOnePlannedPlace(normalizedItinerary)
      ? normalizedItinerary
      : mapAiPlanDaysToItinerary(aiPlan.days),
    aiPlan,
  };
}

function normalizeCreatedAt(value) {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value?.toDate === "function") {
    return value.toDate().toISOString();
  }

  return null;
}

function normalizeFiniteNumber(value, fallback = null) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function normalizeSerializableObject(value, fallback = {}) {
  if (!value || typeof value !== "object") {
    return fallback;
  }

  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_error) {
    return fallback;
  }
}

function normalizeMapBounds(value = {}) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const north = Number.parseFloat(value.north);
  const south = Number.parseFloat(value.south);
  const east = Number.parseFloat(value.east);
  const west = Number.parseFloat(value.west);

  if (
    !Number.isFinite(north) ||
    !Number.isFinite(south) ||
    !Number.isFinite(east) ||
    !Number.isFinite(west) ||
    north < south ||
    east < west
  ) {
    return null;
  }

  return { north, south, east, west };
}

function normalizeMapEnrichment(value = {}, fallbackTrip = {}) {
  const source = value && typeof value === "object" ? value : {};
  const fallbackPlaces = Array.isArray(fallbackTrip?.itinerary?.days)
    ? fallbackTrip.itinerary.days.flatMap((day) =>
        Array.isArray(day?.places) ? day.places : []
      )
    : [];
  const inferredGeocodedStopCount = fallbackPlaces.filter(
    (place) =>
      place?.geoCoordinates?.latitude !== null &&
      place?.geoCoordinates?.longitude !== null
  ).length;
  const inferredUnresolvedStopCount = Math.max(
    0,
    fallbackPlaces.length - inferredGeocodedStopCount
  );
  const geocodedStopCount = clampInteger(
    source.geocodedStopCount,
    0,
    500,
    inferredGeocodedStopCount
  );
  const unresolvedStopCount = clampInteger(
    source.unresolvedStopCount,
    0,
    500,
    inferredUnresolvedStopCount
  );
  const explicitStatus = normalizeLowerText(source.status);
  const status = ["complete", "partial", "missing"].includes(explicitStatus)
    ? explicitStatus
    : geocodedStopCount > 0
      ? unresolvedStopCount > 0
        ? "partial"
        : "complete"
      : "missing";

  const markerDays = Array.isArray(source.markerDays)
    ? source.markerDays.map((day, index) => ({
        dayNumber: normalizeDayNumber(day?.dayNumber ?? day?.day, index),
        title: normalizeText(day?.title ?? day?.theme, `Day ${index + 1}`),
        places: Array.isArray(day?.places)
          ? day.places.map(normalizePlace).filter((place) => place.placeName)
          : [],
      }))
    : [];

  return {
    status,
    lastAttemptedAt: normalizeText(source.lastAttemptedAt),
    geocodedStopCount,
    unresolvedStopCount,
    cityBounds: normalizeMapBounds(source.cityBounds),
    markerDays,
  };
}

function normalizeLatencyBreakdown(value = {}) {
  const source = value && typeof value === "object" ? value : {};

  return {
    total: normalizeFiniteNumber(source.total, 0),
    planner: normalizeFiniteNumber(source.planner, 0),
    critic: normalizeFiniteNumber(source.critic, 0),
    repair: normalizeFiniteNumber(source.repair, 0),
    optimize: normalizeFiniteNumber(source.optimize, 0),
    fusion: normalizeFiniteNumber(source.fusion, 0),
    persist: normalizeFiniteNumber(source.persist, 0),
  };
}

function normalizeConstraintReport(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const hardViolations = Array.isArray(source.hardViolations)
    ? source.hardViolations.map((violation) => normalizeText(String(violation))).filter(Boolean)
    : [];
  const softViolations = Array.isArray(source.softViolations)
    ? source.softViolations.map((violation) => normalizeText(String(violation))).filter(Boolean)
    : [];

  return {
    valid: source.valid !== false && hardViolations.length === 0,
    hardViolations,
    softViolations,
    stats: normalizeSerializableObject(source.stats, {}),
  };
}

function normalizeSourceProvenance(value = {}) {
  const source = value && typeof value === "object" ? value : {};

  return {
    primaryProvider: normalizeText(source.primaryProvider, ""),
    sources: Array.isArray(source.sources)
      ? source.sources
          .map((item) => normalizeSerializableObject(item, null))
          .filter(Boolean)
      : [],
    cache: normalizeSerializableObject(source.cache, {}),
  };
}

function normalizeOptimizationMeta(value = {}) {
  const source = value && typeof value === "object" ? value : {};

  return {
    objective: normalizeTripObjective(source.objective),
    alternativesCount: normalizeAlternativesCount(source.alternativesCount),
    method: normalizeText(source.method, "multi-objective-graph"),
    generatedAt: normalizeText(source.generatedAt, new Date().toISOString()),
    constraints: normalizeTripConstraints(source.constraints),
  };
}

export function buildStoredTrip({
  id,
  ownerId,
  ownerEmail,
  userSelection,
  generatedTrip,
  createdAt = new Date().toISOString(),
  updatedAt = new Date().toISOString(),
  llmArtifacts = {},
  optimizationMeta = {},
  constraintReport = {},
  sourceProvenance = {},
  latencyBreakdownMs = {},
  routeAlternatives = [],
  mapEnrichment = {},
}) {
  const normalizedGeneratedTrip = normalizeGeneratedTrip(generatedTrip, {
    userSelection,
  });

  return {
    id,
    ownerId,
    ownerEmail: normalizeText(ownerEmail),
    createdAt,
    updatedAt,
    userSelection: normalizeUserSelection(userSelection),
    hotels: normalizedGeneratedTrip.hotels,
    itinerary: normalizedGeneratedTrip.itinerary,
    aiPlan: normalizedGeneratedTrip.aiPlan,
    llmArtifacts: normalizeSerializableObject(
      generatedTrip?.llmArtifacts ?? llmArtifacts,
      {}
    ),
    optimizationMeta: normalizeOptimizationMeta(
      generatedTrip?.optimizationMeta ?? optimizationMeta
    ),
    constraintReport: normalizeConstraintReport(
      generatedTrip?.constraintReport ?? constraintReport
    ),
    sourceProvenance: normalizeSourceProvenance(
      generatedTrip?.sourceProvenance ?? sourceProvenance
    ),
    latencyBreakdownMs: normalizeLatencyBreakdown(
      generatedTrip?.latencyBreakdownMs ?? latencyBreakdownMs
    ),
    mapEnrichment: normalizeMapEnrichment(
      generatedTrip?.mapEnrichment ?? mapEnrichment,
      normalizedGeneratedTrip
    ),
    routeAlternatives: Array.isArray(generatedTrip?.routeAlternatives)
      ? generatedTrip.routeAlternatives
      : Array.isArray(routeAlternatives)
        ? routeAlternatives
        : [],
  };
}

export function normalizeStoredTrip(input = {}) {
  const normalizedTrip = buildStoredTrip({
    id: normalizeText(input.id),
    ownerId: normalizeText(input.ownerId ?? input.userId),
    ownerEmail: normalizeText(input.ownerEmail ?? input.userEmail),
    userSelection: input.userSelection ?? input.selection,
    generatedTrip: {
      hotels: input.hotels ?? input.tripData?.hotels,
      itinerary: input.itinerary ?? input.tripData?.itinerary,
      destination:
        input.aiPlan?.destination ??
        input.destination ??
        input.tripData?.destination,
      days: input.aiPlan?.days ?? input.days ?? input.tripData?.days,
      total_estimated_cost:
        input.aiPlan?.totalEstimatedCost ??
        input.totalEstimatedCost ??
        input.total_estimated_cost ??
        input.tripData?.total_estimated_cost,
      travel_tips:
        input.aiPlan?.travelTips ??
        input.travelTips ??
        input.travel_tips ??
        input.tripData?.travel_tips,
      llmArtifacts: input.llmArtifacts,
      optimizationMeta: input.optimizationMeta,
      constraintReport: input.constraintReport,
      sourceProvenance: input.sourceProvenance,
      latencyBreakdownMs: input.latencyBreakdownMs,
      mapEnrichment: input.mapEnrichment,
      routeAlternatives: input.routeAlternatives,
    },
    createdAt: normalizeCreatedAt(input.createdAt) ?? new Date().toISOString(),
    updatedAt: normalizeCreatedAt(input.updatedAt) ?? new Date().toISOString(),
    llmArtifacts: input.llmArtifacts,
    optimizationMeta: input.optimizationMeta,
    constraintReport: input.constraintReport,
    sourceProvenance: input.sourceProvenance,
    latencyBreakdownMs: input.latencyBreakdownMs,
    mapEnrichment: input.mapEnrichment,
    routeAlternatives: input.routeAlternatives,
  });

  if (!normalizedTrip.id && input?.id) {
    normalizedTrip.id = String(input.id);
  }

  return normalizedTrip;
}

export function sortTripsNewestFirst(trips = []) {
  return [...trips].sort((left, right) => {
    const leftDate = Date.parse(left.createdAt ?? 0);
    const rightDate = Date.parse(right.createdAt ?? 0);
    return rightDate - leftDate;
  });
}

export function buildTripPrompt(input = {}) {
  const selection = normalizeUserSelection(input);
  const destination = sanitizePromptValue(selection.location.label, "Not provided");
  const budget = sanitizePromptValue(selection.budget, "Not provided");
  const travelers = sanitizePromptValue(selection.travelers, "Not provided");
  const travelType = sanitizePromptValue(
    selection.travelType,
    selection.travelers || "General"
  );
  const travelerCount = selection.travelerCount ?? "Not specified";
  const objective = selection.objective;
  const constraints = selection.constraints;

  return `You are a travel expert planner.

Generate a personalized itinerary as strict JSON only. Never use markdown fences.
Return valid JSON with no extra keys.

Trip request:
- Destination: ${destination}
- Duration: ${selection.days} day(s)
- Budget: ${budget}
- Travel Type: ${travelType}
- Number of Travelers: ${travelerCount}
- Traveler Profile: ${travelers}
- Optimization objective: ${objective}
- Daily time limit (hours): ${constraints.dailyTimeLimitHours}
- Budget cap (optional): ${constraints.budgetCap ?? "Not specified"}
- Mobility preference: ${sanitizePromptValue(constraints.mobilityPref, "balanced")}
- Meal preferences: ${constraints.mealPrefs.join(", ") || "Flexible"}

Return JSON with this exact shape:
{
  "destination": "string",
  "days": [
    {
      "day": 1,
      "title": "string",
      "activities": ["string"],
      "estimated_cost": "string",
      "tips": "string"
    }
  ],
  "total_estimated_cost": "string",
  "travel_tips": ["string"]
}

Rules:
- The "days" array length must exactly match requested Duration.
- "day" values must be sequential starting at 1.
- Each day should have 3-5 concise activities.
- Keep travel segments realistic for the daily time limit.
- Respect budget style and optional budget cap when estimating costs.
- Prefer activities matching the optimization objective.
- Keep tips actionable and specific to the destination.
- Use plain text cost ranges when exact costs are unknown.
- Output JSON only.`;
}

export function buildFallbackGeneratedTrip(userSelection = {}) {
  const selection = normalizeUserSelection(userSelection);
  const destination = normalizeText(selection.location.label, "Unknown destination");
  const days = buildFallbackPlanDays({
    ...selection,
    location: { label: destination },
  });
  const aiPlan = {
    destination,
    days,
    totalEstimatedCost: buildEstimatedTotalCost(selection.budget, days.length),
    travelTips: normalizeTravelTips([], destination),
  };

  return {
    hotels: [],
    itinerary: mapAiPlanDaysToItinerary(aiPlan.days),
    aiPlan,
  };
}
