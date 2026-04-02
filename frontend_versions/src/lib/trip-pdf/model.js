import {
  getHotelImage,
  getPlaceImage,
  getRestaurantImage,
  getTripImage,
} from "../destinationImages.js";

const MAP_BACKGROUND_IMAGE = "/world-map.svg";
const PLACEHOLDER_TOTAL_COST = "Not specified";
const MAX_ACTIVITY_COUNT_PER_DAY = 6;
const MAX_DAY_COUNT = 30;
const MAX_RECOMMENDATION_COUNT = 8;
const MAX_TIP_COUNT = 10;

function normalizeText(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  const sanitized = value
    .replace(/\s+/g, " ")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim();

  return sanitized || fallback;
}

function clampText(value, maxLength, fallback = "") {
  const normalized = normalizeText(value, fallback);
  if (!normalized) {
    return fallback;
  }

  return normalized.slice(0, maxLength);
}

function normalizeInteger(value, fallback = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function normalizeNumber(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isHttpUrl(value) {
  if (typeof value !== "string") {
    return false;
  }

  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function sanitizeUrl(value, fallback = "") {
  return isHttpUrl(value) ? value : fallback;
}

function sanitizeStringArray(values, { maxItems = 6, fallback = [] } = {}) {
  if (!Array.isArray(values)) {
    return fallback;
  }

  const normalized = [];
  const seen = new Set();

  for (const value of values) {
    const text = clampText(value, 180, "");
    if (!text) {
      continue;
    }

    const key = text.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalized.push(text);

    if (normalized.length >= maxItems) {
      break;
    }
  }

  return normalized;
}

function buildGoogleMapsQueryUrl(query) {
  const safeQuery = clampText(query, 160, "");
  if (!safeQuery) {
    return "";
  }

  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    safeQuery
  )}`;
}

function buildMapUrlFromCoordinates(latitude, longitude) {
  const lat = normalizeNumber(latitude);
  const lng = normalizeNumber(longitude);

  if (lat === null || lng === null) {
    return "";
  }

  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

function normalizeCoordinates(coordinates = {}) {
  const latitude = normalizeNumber(
    coordinates?.latitude ?? coordinates?.lat ?? coordinates?.latitudeDegrees
  );
  const longitude = normalizeNumber(
    coordinates?.longitude ?? coordinates?.lng ?? coordinates?.longitudeDegrees
  );

  return {
    latitude,
    longitude,
  };
}

function buildSlug(value, fallback = "trip") {
  const slug = normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || fallback;
}

function buildTripFileName(destination) {
  return `${buildSlug(destination, "trip")}-travel-brochure.pdf`;
}

function formatDate(value) {
  if (!value) {
    return "Not specified";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Not specified";
  }

  try {
    return new Intl.DateTimeFormat("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(parsed);
  } catch {
    return parsed.toISOString();
  }
}

function resolveCoverTitle(destination, budget) {
  const safeDestination = normalizeText(destination, "Your Destination");
  const normalizedBudget = normalizeText(budget).toLowerCase();

  if (/luxury|premium/.test(normalizedBudget)) {
    return `${safeDestination} Luxury Escape`;
  }

  if (/cheap|budget|economy/.test(normalizedBudget)) {
    return `${safeDestination} Smart Explorer Plan`;
  }

  return `${safeDestination} Curated Journey`;
}

function resolveCoverSubtitle(durationDays, travelStyle, travelers) {
  const dayLabel = `${durationDays} day${durationDays === 1 ? "" : "s"}`;
  const styleLabel = normalizeText(travelStyle, "balanced").toLowerCase();
  const travelerLabel = normalizeText(travelers, "traveler").toLowerCase();

  return `A ${dayLabel} ${styleLabel} itinerary tailored for ${travelerLabel}.`;
}

function buildDayFromAiPlan(aiDay = {}, index, itineraryDay = {}) {
  const dayNumber = normalizeInteger(aiDay.day, index + 1);
  const activities = sanitizeStringArray(aiDay.activities, {
    maxItems: MAX_ACTIVITY_COUNT_PER_DAY,
    fallback: [],
  });
  const placeHints = Array.isArray(itineraryDay.places)
    ? itineraryDay.places
        .map((place) => clampText(place?.placeName, 100, ""))
        .filter(Boolean)
    : [];

  const firstPlace = Array.isArray(itineraryDay.places)
    ? itineraryDay.places.find((place) => normalizeText(place?.placeName))
    : null;

  const routePoints = Array.isArray(itineraryDay.places)
    ? itineraryDay.places
        .map((place) => ({
          label: clampText(place?.placeName, 100, "Stop"),
          ...normalizeCoordinates(place?.geoCoordinates),
          mapsUrl:
            sanitizeUrl(place?.mapsUrl) ||
            buildMapUrlFromCoordinates(
              place?.geoCoordinates?.latitude,
              place?.geoCoordinates?.longitude
            ) ||
            buildGoogleMapsQueryUrl(place?.placeName),
        }))
        .filter((point) => point.latitude !== null && point.longitude !== null)
    : [];

  const firstMapLink = Array.isArray(itineraryDay.places)
    ? itineraryDay.places
        .map((place) =>
          sanitizeUrl(place?.mapsUrl) ||
          buildMapUrlFromCoordinates(
            place?.geoCoordinates?.latitude,
            place?.geoCoordinates?.longitude
          ) ||
          buildGoogleMapsQueryUrl(place?.placeName)
        )
        .find(Boolean)
    : "";

  const dayTitle = clampText(aiDay.title, 120, `Day ${dayNumber}`);
  const firstTip = clampText(aiDay.tips, 220, "");
  const estimatedCost = clampText(aiDay.estimatedCost, 100, "Not specified");
  const resolvedActivities =
    activities.length > 0
      ? activities
      : sanitizeStringArray(placeHints, {
          maxItems: MAX_ACTIVITY_COUNT_PER_DAY,
          fallback: ["Explore local highlights at your pace."],
        });

  return {
    dayNumber,
    title: dayTitle,
    activities: resolvedActivities,
    locationHints: sanitizeStringArray(placeHints, {
      maxItems: 4,
      fallback: [],
    }),
    tip: firstTip,
    estimatedCost,
    mapLink: firstMapLink,
    routePoints,
    featureImageUrl: firstPlace ? getPlaceImage(firstPlace) : getPlaceImage({ placeName: dayTitle }),
  };
}

function buildDayFromItinerary(itineraryDay = {}, index) {
  const dayNumber = normalizeInteger(itineraryDay.dayNumber ?? itineraryDay.day, index + 1);
  const places = Array.isArray(itineraryDay.places) ? itineraryDay.places : [];

  const activities = sanitizeStringArray(
    places.map((place) => normalizeText(place?.placeName)),
    {
      maxItems: MAX_ACTIVITY_COUNT_PER_DAY,
      fallback: ["Explore local highlights at your pace."],
    }
  );

  const tip = clampText(
    places.find((place) => normalizeText(place?.placeDetails))?.placeDetails,
    220,
    ""
  );
  const estimatedCost = clampText(
    places.find((place) => normalizeText(place?.ticketPricing))?.ticketPricing,
    100,
    "Not specified"
  );
  const firstPlace = places.find((place) => normalizeText(place?.placeName));

  const firstMapLink = places
    .map((place) =>
      sanitizeUrl(place?.mapsUrl) ||
      buildMapUrlFromCoordinates(
        place?.geoCoordinates?.latitude,
        place?.geoCoordinates?.longitude
      ) ||
      buildGoogleMapsQueryUrl(place?.placeName)
    )
    .find(Boolean);

  return {
    dayNumber,
    title: clampText(itineraryDay.title, 120, `Day ${dayNumber}`),
    activities,
    locationHints: sanitizeStringArray(
      places.map((place) => normalizeText(place?.placeName)),
      {
        maxItems: 4,
        fallback: [],
      }
    ),
    tip,
    estimatedCost,
    mapLink: firstMapLink || "",
    routePoints: places
      .map((place) => ({
        label: clampText(place?.placeName, 100, "Stop"),
        ...normalizeCoordinates(place?.geoCoordinates),
        mapsUrl:
          sanitizeUrl(place?.mapsUrl) ||
          buildMapUrlFromCoordinates(
            place?.geoCoordinates?.latitude,
            place?.geoCoordinates?.longitude
          ) ||
          buildGoogleMapsQueryUrl(place?.placeName),
      }))
      .filter((point) => point.latitude !== null && point.longitude !== null),
    featureImageUrl: firstPlace
      ? getPlaceImage(firstPlace)
      : getPlaceImage({ placeName: itineraryDay.title }),
  };
}

function normalizeRecommendationItem(item = {}, type = "hotel") {
  const name = clampText(
    item.name ?? item.hotelName ?? item.restaurantName,
    120,
    type === "hotel" ? "Recommended Hotel" : "Recommended Restaurant"
  );
  const location = clampText(item.location ?? item.hotelAddress, 160, "Location unavailable");
  const rating = normalizeNumber(item.rating);
  const priceLabel = clampText(item.priceLabel ?? item.price, 40, "");
  const description = clampText(
    item.description,
    240,
    type === "hotel"
      ? "Comfortable stay selected for this itinerary."
      : "Popular dining recommendation for this destination."
  );

  const mapByCoordinates = buildMapUrlFromCoordinates(
    item?.geoCoordinates?.latitude,
    item?.geoCoordinates?.longitude
  );
  const mapsUrl =
    sanitizeUrl(item.mapsUrl) ||
    mapByCoordinates ||
    buildGoogleMapsQueryUrl(`${name}, ${location}`);

  const coordinates = normalizeCoordinates(item.geoCoordinates);

  const imageUrlSource =
    sanitizeUrl(item.imageUrl) ||
    sanitizeUrl(item.hotelImageUrl) ||
    (type === "hotel" ? getHotelImage(item) : getRestaurantImage(item));

  return {
    name,
    location,
    rating,
    priceLabel,
    description,
    mapsUrl,
    geoCoordinates: coordinates,
    imageUrl: imageUrlSource,
  };
}

function deduplicateRoutePoints(points = []) {
  const seen = new Set();
  const deduped = [];

  for (const point of points) {
    const latitude = normalizeNumber(point?.latitude);
    const longitude = normalizeNumber(point?.longitude);

    if (latitude === null || longitude === null) {
      continue;
    }

    const key = `${latitude.toFixed(4)}:${longitude.toFixed(4)}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push({
      label: clampText(point?.label, 80, "Stop"),
      latitude,
      longitude,
      mapsUrl:
        sanitizeUrl(point?.mapsUrl) ||
        buildMapUrlFromCoordinates(latitude, longitude) ||
        "",
    });
  }

  return deduped;
}

export function extractRoutePoints({ days = [], hotels = [], restaurants = [] } = {}) {
  const pointCandidates = [];

  for (const day of days) {
    for (const point of day.routePoints ?? []) {
      pointCandidates.push(point);
    }
  }

  for (const hotel of hotels) {
    pointCandidates.push({
      label: hotel.name,
      latitude: hotel.geoCoordinates?.latitude,
      longitude: hotel.geoCoordinates?.longitude,
      mapsUrl: hotel.mapsUrl,
    });
  }

  for (const restaurant of restaurants) {
    pointCandidates.push({
      label: restaurant.name,
      latitude: restaurant.geoCoordinates?.latitude,
      longitude: restaurant.geoCoordinates?.longitude,
      mapsUrl: restaurant.mapsUrl,
    });
  }

  return deduplicateRoutePoints(pointCandidates).slice(0, 14);
}

export function parseBudgetRange(value) {
  const text = normalizeText(value);
  if (!text) {
    return null;
  }

  const currencyMatch = text.match(/([A-Z]{0,3}\$|[$€£₹]|AED|USD|EUR|GBP|INR)/i);
  const currency = normalizeText(currencyMatch?.[1], "$").toUpperCase() || "$";

  const numbers = [...text.matchAll(/(\d[\d,]*)/g)]
    .map((match) => Number.parseInt(match[1].replace(/,/g, ""), 10))
    .filter(Number.isFinite);

  if (numbers.length < 2) {
    return null;
  }

  return {
    currency,
    min: Math.min(numbers[0], numbers[1]),
    max: Math.max(numbers[0], numbers[1]),
  };
}

function formatCurrencyRange(currency, min, max) {
  const safeCurrency = normalizeText(currency, "$");
  return `${safeCurrency}${Math.round(min).toLocaleString("en-US")} - ${safeCurrency}${Math.round(
    max
  ).toLocaleString("en-US")}`;
}

function buildBudgetBreakdown(totalEstimatedCost) {
  const parsed = parseBudgetRange(totalEstimatedCost);
  const slices = [
    {
      key: "travel",
      label: "Travel",
      share: 0.3,
      note: "Flights, rail, and intercity transfers",
    },
    {
      key: "stay",
      label: "Stay",
      share: 0.45,
      note: "Hotels, taxes, and service fees",
    },
    {
      key: "food",
      label: "Food",
      share: 0.2,
      note: "Meals, cafes, and dining experiences",
    },
    {
      key: "buffer",
      label: "Buffer",
      share: 0.05,
      note: "Unexpected costs and contingencies",
    },
  ];

  if (!parsed) {
    return slices.map((slice) => ({
      ...slice,
      amount: "Included in overall estimate",
    }));
  }

  return slices.map((slice) => ({
    ...slice,
    amount: formatCurrencyRange(
      parsed.currency,
      parsed.min * slice.share,
      parsed.max * slice.share
    ),
  }));
}

export { buildBudgetBreakdown };

function resolveTravelTips(trip) {
  const aiTips = sanitizeStringArray(trip?.aiPlan?.travelTips, {
    maxItems: MAX_TIP_COUNT,
    fallback: [],
  });

  if (aiTips.length > 0) {
    return aiTips;
  }

  const destination = clampText(
    trip?.userSelection?.location?.label ?? trip?.aiPlan?.destination,
    120,
    "your destination"
  );

  return [
    `Book high-demand attractions in ${destination} at least a few days in advance.`,
    "Keep 10-15% of your budget as a contingency.",
    "Use offline maps and keep local emergency contacts saved on your phone.",
    "Start day plans early to avoid peak crowd and transport delays.",
  ];
}

function resolveTravelStyle(selection = {}) {
  return clampText(selection.travelType || selection.travelers, 80, "Balanced");
}

function resolveOverviewHighlights(days = []) {
  const highlights = days
    .map((day) => day.activities[0])
    .filter(Boolean)
    .slice(0, 3)
    .map((activity) => clampText(activity, 140, ""));

  return highlights.length > 0
    ? highlights
    : [
        "Balanced pacing between landmarks and local culture.",
        "Includes dedicated dining and recovery windows.",
        "Built with practical movement and budget guidance.",
      ];
}

function resolveMapExplanation(routePoints = [], destination = "") {
  if (routePoints.length >= 2) {
    const start = routePoints[0].label;
    const end = routePoints[routePoints.length - 1].label;
    return `This route links ${routePoints.length} mapped stops from ${start} to ${end}, optimized for practical daily movement in ${destination}.`;
  }

  if (routePoints.length === 1) {
    return `A single mapped anchor point is available (${routePoints[0].label}) for ${destination}. Open the linked map for live routing.`;
  }

  return `Exact coordinates were not available for this itinerary. Use the listed map links to explore route options in ${destination}.`;
}

function resolveMapLinks({ days = [], hotels = [], restaurants = [] } = {}) {
  const links = [];

  for (const day of days) {
    if (day.mapLink) {
      links.push({
        label: `Day ${day.dayNumber} route`,
        url: day.mapLink,
      });
    }
  }

  for (const hotel of hotels.slice(0, 2)) {
    if (hotel.mapsUrl) {
      links.push({ label: `Stay: ${hotel.name}`, url: hotel.mapsUrl });
    }
  }

  for (const restaurant of restaurants.slice(0, 2)) {
    if (restaurant.mapsUrl) {
      links.push({ label: `Dining: ${restaurant.name}`, url: restaurant.mapsUrl });
    }
  }

  const deduped = [];
  const seen = new Set();

  for (const link of links) {
    const url = sanitizeUrl(link.url);
    if (!url || seen.has(url)) {
      continue;
    }

    seen.add(url);
    deduped.push({
      label: clampText(link.label, 100, "Map link"),
      url,
    });

    if (deduped.length >= 6) {
      break;
    }
  }

  return deduped;
}

function buildItineraryDays(trip = {}) {
  const aiDays = Array.isArray(trip?.aiPlan?.days) ? trip.aiPlan.days : [];
  const itineraryDays = Array.isArray(trip?.itinerary?.days) ? trip.itinerary.days : [];

  if (aiDays.length > 0) {
    return aiDays
      .slice(0, MAX_DAY_COUNT)
      .map((day, index) => buildDayFromAiPlan(day, index, itineraryDays[index] || {}));
  }

  if (itineraryDays.length > 0) {
    return itineraryDays
      .slice(0, MAX_DAY_COUNT)
      .map((day, index) => buildDayFromItinerary(day, index));
  }

  return [
    {
      dayNumber: 1,
      title: "Arrival and Orientation",
      activities: ["Arrive, check in, and explore nearby highlights."],
      locationHints: [],
      tip: "",
      estimatedCost: "Not specified",
      mapLink: "",
      routePoints: [],
      featureImageUrl: getPlaceImage({ placeName: "Travel destination" }),
    },
  ];
}

function resolveHotels(trip = {}, recommendations = {}) {
  const sourceHotels = Array.isArray(recommendations?.hotels)
    ? recommendations.hotels
    : Array.isArray(trip?.hotels)
      ? trip.hotels
      : [];

  const hotels = sourceHotels
    .map((item) => normalizeRecommendationItem(item, "hotel"))
    .slice(0, MAX_RECOMMENDATION_COUNT);

  if (hotels.length > 0) {
    return hotels;
  }

  const destination = clampText(
    trip?.userSelection?.location?.label ?? trip?.aiPlan?.destination,
    120,
    "your destination"
  );

  return [
    normalizeRecommendationItem(
      {
        name: `${destination} Central Stay`,
        location: destination,
        description:
          "Curated central stay area when live hotel data is unavailable.",
        mapsUrl: buildGoogleMapsQueryUrl(destination),
      },
      "hotel"
    ),
  ];
}

function resolveRestaurants(recommendations = {}, destination = "") {
  const sourceRestaurants = Array.isArray(recommendations?.restaurants)
    ? recommendations.restaurants
    : [];

  const restaurants = sourceRestaurants
    .map((item) => normalizeRecommendationItem(item, "restaurant"))
    .slice(0, MAX_RECOMMENDATION_COUNT);

  if (restaurants.length > 0) {
    return restaurants;
  }

  return [
    normalizeRecommendationItem(
      {
        name: `${destination} Local Dining Pick`,
        location: destination,
        description:
          "Suggested dining area generated when restaurant recommendations are unavailable.",
        mapsUrl: buildGoogleMapsQueryUrl(`${destination} restaurants`),
      },
      "restaurant"
    ),
  ];
}

function resolveCoverSummary(destination, days, hotels, restaurants) {
  const activityCount = days.reduce(
    (total, day) => total + (Array.isArray(day.activities) ? day.activities.length : 0),
    0
  );

  return `${destination} in ${days.length} day${days.length === 1 ? "" : "s"} with ${activityCount} planned activities, ${hotels.length} stay options, and ${restaurants.length} dining recommendations.`;
}

export function buildTripPdfModel({ trip = {}, recommendations = {}, generatedAt } = {}) {
  const destination = clampText(
    trip?.userSelection?.location?.label ?? trip?.aiPlan?.destination,
    120,
    "Unknown destination"
  );
  const normalizedGeneratedAt = generatedAt || new Date().toISOString();
  const days = buildItineraryDays(trip);
  const hotels = resolveHotels(trip, recommendations);
  const restaurants = resolveRestaurants(recommendations, destination);
  const routePoints = extractRoutePoints({ days, hotels, restaurants });
  const mapLinks = resolveMapLinks({ days, hotels, restaurants });
  const totalEstimatedCost = clampText(
    trip?.aiPlan?.totalEstimatedCost,
    100,
    PLACEHOLDER_TOTAL_COST
  );

  const overview = {
    duration: `${days.length} day${days.length === 1 ? "" : "s"}`,
    budget: clampText(trip?.userSelection?.budget, 60, "Not specified"),
    travelStyle: resolveTravelStyle(trip?.userSelection),
    travelers: clampText(trip?.userSelection?.travelers, 80, "Not specified"),
    totalEstimatedCost,
    createdAt: formatDate(trip?.createdAt),
    generatedAt: formatDate(normalizedGeneratedAt),
    highlights: resolveOverviewHighlights(days),
  };

  const model = {
    fileName: buildTripFileName(destination),
    title: `${destination} Premium Travel Brochure`,
    destination,
    generatedAt: normalizedGeneratedAt,
    cover: {
      title: resolveCoverTitle(destination, trip?.userSelection?.budget),
      subtitle: resolveCoverSubtitle(days.length, overview.travelStyle, overview.travelers),
      summary: resolveCoverSummary(destination, days, hotels, restaurants),
      heroImageUrl: getTripImage(destination),
    },
    overview,
    itinerary: {
      days,
    },
    mapRoute: {
      backgroundImageUrl: MAP_BACKGROUND_IMAGE,
      routePoints,
      explanation: resolveMapExplanation(routePoints, destination),
      links: mapLinks,
    },
    recommendations: {
      hotels,
      restaurants,
      note: clampText(recommendations?.warning, 240, ""),
    },
    budget: {
      totalEstimatedCost,
      breakdown: buildBudgetBreakdown(totalEstimatedCost),
    },
    travelTips: resolveTravelTips(trip),
  };

  console.info("[trip-pdf:model] Brochure model built", {
    destination: model.destination,
    dayCount: model.itinerary.days.length,
    hotelCount: model.recommendations.hotels.length,
    restaurantCount: model.recommendations.restaurants.length,
    routePointCount: model.mapRoute.routePoints.length,
  });

  return model;
}
