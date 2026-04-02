import {
  buildGoogleMapsSearchUrl,
  normalizeDestinationLabel,
  normalizeDestinationRecommendations,
  normalizeRecommendationItem,
} from "../../shared/recommendations.js";
import { safeFetch } from "../lib/safeFetch.js";
import { getDestinationSuggestions } from "../../shared/destinationAutocomplete.js";

const GOOGLE_PLACES_TEXT_SEARCH_URL =
  "https://maps.googleapis.com/maps/api/place/textsearch/json";
const GOOGLE_PLACES_AUTOCOMPLETE_URL =
  "https://maps.googleapis.com/maps/api/place/autocomplete/json";
const MAX_DESTINATION_LENGTH = 120;
const MIN_AUTOCOMPLETE_QUERY_LENGTH = 2;
const MAX_AUTOCOMPLETE_RESULTS = 8;
const MAX_ITEMS_PER_CATEGORY = 6;
const DEFAULT_PROVIDER_TIMEOUT_MS = 8_000;
const DEFAULT_LIVE_CACHE_TTL_MS = 5 * 60 * 1_000;
const DEFAULT_MOCK_CACHE_TTL_MS = 30 * 1_000;
const DESTINATION_RECOMMENDATION_CACHE = new Map();
const DESTINATION_DATA_BUNDLE_CACHE = new Map();
const DESTINATION_AUTOCOMPLETE_CACHE = new Map();

const HOTEL_MOCK_TEMPLATES = Object.freeze([
  {
    name: "Grand Horizon Hotel",
    locationSuffix: "City Center",
    description:
      "Comfort-focused rooms, easy transit access, and a reliable base for day-by-day exploration.",
    priceLabel: "$$$",
    rating: 4.6,
    imageUrl:
      "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=1200&q=80&auto=format&fit=crop",
  },
  {
    name: "Riverside Stay Suites",
    locationSuffix: "Old Quarter",
    description:
      "A balanced option for travelers who want walkable landmarks and practical amenities.",
    priceLabel: "$$",
    rating: 4.4,
    imageUrl:
      "https://images.unsplash.com/photo-1445019980597-93fa8acb246c?w=1200&q=80&auto=format&fit=crop",
  },
  {
    name: "Skyline Boutique Inn",
    locationSuffix: "Downtown",
    description:
      "Modern interiors with strong guest reviews for cleanliness, service quality, and location.",
    priceLabel: "$$$",
    rating: 4.5,
    imageUrl:
      "https://images.unsplash.com/photo-1571896349842-33c89424de2d?w=1200&q=80&auto=format&fit=crop",
  },
  {
    name: "Heritage Courtyard Hotel",
    locationSuffix: "Historic District",
    description:
      "Classic architecture and a quieter atmosphere suited for slower-paced itineraries.",
    priceLabel: "$$",
    rating: 4.3,
    imageUrl:
      "https://images.unsplash.com/photo-1542314831-068cd1dbfeeb?w=1200&q=80&auto=format&fit=crop",
  },
  {
    name: "Urban Vista Residences",
    locationSuffix: "Business Hub",
    description:
      "Well-connected stay with consistent ratings and convenient food options nearby.",
    priceLabel: "$$$$",
    rating: 4.7,
    imageUrl:
      "https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=1200&q=80&auto=format&fit=crop",
  },
  {
    name: "Garden Lane Retreat",
    locationSuffix: "Cultural Precinct",
    description:
      "A calm property preferred by couples and small groups looking for central access.",
    priceLabel: "$$",
    rating: 4.2,
    imageUrl:
      "https://images.unsplash.com/photo-1590490360182-c33d57733427?w=1200&q=80&auto=format&fit=crop",
  },
]);

const RESTAURANT_MOCK_TEMPLATES = Object.freeze([
  {
    name: "Spice & Story Kitchen",
    locationSuffix: "Market District",
    description:
      "Popular local dining pick known for signature regional plates and evening atmosphere.",
    priceLabel: "$$",
    rating: 4.6,
    imageUrl:
      "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=1200&q=80&auto=format&fit=crop",
  },
  {
    name: "Harbor Flame Bistro",
    locationSuffix: "Waterfront",
    description:
      "A strong mid-range option with consistent reviews for service and balanced menu variety.",
    priceLabel: "$$$",
    rating: 4.5,
    imageUrl:
      "https://images.unsplash.com/photo-1552566626-52f8b828add9?w=1200&q=80&auto=format&fit=crop",
  },
  {
    name: "Olive Terrace Dining",
    locationSuffix: "City Center",
    description:
      "Well-rated choice for relaxed dinners, often recommended for first-time visitors.",
    priceLabel: "$$$",
    rating: 4.4,
    imageUrl:
      "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=1200&q=80&auto=format&fit=crop",
  },
  {
    name: "Copper Pan House",
    locationSuffix: "Creative Quarter",
    description:
      "A contemporary kitchen with rotating specials and strong feedback on flavor depth.",
    priceLabel: "$$",
    rating: 4.3,
    imageUrl:
      "https://images.unsplash.com/photo-1424847651672-bf20a4b0982b?w=1200&q=80&auto=format&fit=crop",
  },
  {
    name: "Night Market Table",
    locationSuffix: "Old Town",
    description:
      "Recommended for travelers prioritizing authentic dishes and vibrant local dining scenes.",
    priceLabel: "$",
    rating: 4.5,
    imageUrl:
      "https://images.unsplash.com/photo-1515669097368-22e68427d265?w=1200&q=80&auto=format&fit=crop",
  },
  {
    name: "Summit View Grill",
    locationSuffix: "Central Avenue",
    description:
      "Reliable dinner spot with broad cuisine coverage and high repeat-visitor ratings.",
    priceLabel: "$$$",
    rating: 4.2,
    imageUrl:
      "https://images.unsplash.com/photo-1559339352-11d035aa65de?w=1200&q=80&auto=format&fit=crop",
  },
]);

const ATTRACTION_MOCK_TEMPLATES = Object.freeze([
  {
    name: "Heritage Walk District",
    locationSuffix: "Old Town",
    description:
      "A high-density cluster of landmarks ideal for daylight exploration and photography.",
    rating: 4.6,
    imageUrl:
      "https://images.unsplash.com/photo-1505761671935-60b3a7427bad?w=1200&q=80&auto=format&fit=crop",
  },
  {
    name: "City Panorama Viewpoint",
    locationSuffix: "Scenic Ridge",
    description:
      "Well-rated panoramic stop with broad city visibility and strong visitor sentiment.",
    rating: 4.5,
    imageUrl:
      "https://images.unsplash.com/photo-1476514525535-07fb3b4ae5f1?w=1200&q=80&auto=format&fit=crop",
  },
  {
    name: "Cultural Museum Quarter",
    locationSuffix: "Central District",
    description:
      "Museum-rich area preferred by first-time travelers focused on local history.",
    rating: 4.4,
    imageUrl:
      "https://images.unsplash.com/photo-1566127992631-137a642a90f4?w=1200&q=80&auto=format&fit=crop",
  },
  {
    name: "Riverside Promenade",
    locationSuffix: "Waterfront",
    description:
      "Walkable promenade with nearby transit access and multiple short-duration stops.",
    rating: 4.3,
    imageUrl:
      "https://images.unsplash.com/photo-1505764706515-aa95265c5abc?w=1200&q=80&auto=format&fit=crop",
  },
  {
    name: "Botanical Garden Loop",
    locationSuffix: "Green Belt",
    description:
      "Lower-intensity attraction suitable for relaxed pacing and mixed-age groups.",
    rating: 4.5,
    imageUrl:
      "https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=1200&q=80&auto=format&fit=crop",
  },
  {
    name: "Landmark Plaza",
    locationSuffix: "City Core",
    description:
      "Central plaza surrounded by architecture, local vendors, and cultural activities.",
    rating: 4.2,
    imageUrl:
      "https://images.unsplash.com/photo-1514565131-fce0801e5785?w=1200&q=80&auto=format&fit=crop",
  },
]);

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }

  return fallback;
}

function resolveProviderTimeoutMs() {
  return parsePositiveInteger(
    process.env.RECOMMENDATIONS_PROVIDER_TIMEOUT_MS,
    DEFAULT_PROVIDER_TIMEOUT_MS
  );
}

function resolveLiveCacheTtlMs() {
  return parsePositiveInteger(
    process.env.RECOMMENDATIONS_CACHE_TTL_MS,
    DEFAULT_LIVE_CACHE_TTL_MS
  );
}

function resolveMockCacheTtlMs() {
  return parsePositiveInteger(
    process.env.RECOMMENDATIONS_MOCK_CACHE_TTL_MS,
    DEFAULT_MOCK_CACHE_TTL_MS
  );
}

function resolvePriceLabelFromGoogleLevel(level) {
  const numericLevel = Number.parseInt(level, 10);
  if (!Number.isInteger(numericLevel) || numericLevel < 0) {
    return "";
  }

  if (numericLevel === 0) {
    return "$";
  }

  return "$".repeat(Math.min(numericLevel, 4));
}

function getCacheKey(destination) {
  return normalizeDestinationLabel(destination).toLowerCase();
}

function resolveRecommendationsCacheTtlMs(recommendations = {}) {
  return recommendations.provider === "mock"
    ? resolveMockCacheTtlMs()
    : resolveLiveCacheTtlMs();
}

function readCachedRecommendations(cacheKey) {
  const cacheEntry = DESTINATION_RECOMMENDATION_CACHE.get(cacheKey);
  const now = Date.now();

  if (!cacheEntry) {
    return null;
  }

  if (cacheEntry.expiresAt <= now) {
    DESTINATION_RECOMMENDATION_CACHE.delete(cacheKey);
    return null;
  }

  return cacheEntry.value;
}

function writeCachedRecommendations(cacheKey, recommendations) {
  const ttlMs = resolveRecommendationsCacheTtlMs(recommendations);
  DESTINATION_RECOMMENDATION_CACHE.set(cacheKey, {
    value: recommendations,
    expiresAt: Date.now() + ttlMs,
  });
}

function readCachedDestinationDataBundle(cacheKey) {
  const cacheEntry = DESTINATION_DATA_BUNDLE_CACHE.get(cacheKey);
  if (!cacheEntry) {
    return null;
  }

  if (cacheEntry.expiresAt <= Date.now()) {
    DESTINATION_DATA_BUNDLE_CACHE.delete(cacheKey);
    return null;
  }

  return cacheEntry.value;
}

function writeCachedDestinationDataBundle(cacheKey, bundle) {
  const ttlMs = resolveRecommendationsCacheTtlMs(bundle?.recommendations ?? {});
  DESTINATION_DATA_BUNDLE_CACHE.set(cacheKey, {
    value: bundle,
    expiresAt: Date.now() + ttlMs,
  });
}

function getAutocompleteCacheKey(query) {
  return String(query ?? "")
    .trim()
    .toLowerCase();
}

function readCachedAutocompleteSuggestions(cacheKey) {
  const cacheEntry = DESTINATION_AUTOCOMPLETE_CACHE.get(cacheKey);
  if (!cacheEntry) {
    return null;
  }

  if (cacheEntry.expiresAt <= Date.now()) {
    DESTINATION_AUTOCOMPLETE_CACHE.delete(cacheKey);
    return null;
  }

  return cacheEntry.value;
}

function writeCachedAutocompleteSuggestions(cacheKey, suggestions) {
  DESTINATION_AUTOCOMPLETE_CACHE.set(cacheKey, {
    value: suggestions,
    expiresAt: Date.now() + resolveLiveCacheTtlMs(),
  });
}

function withTimeout(promise, timeoutMs, errorMessage) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(errorMessage));
    }, timeoutMs);

    promise
      .then(resolve)
      .catch(reject)
      .finally(() => clearTimeout(timeout));
  });
}

function resolveDestinationOrThrow(destination) {
  const normalized = normalizeDestinationLabel(destination);

  if (!normalized) {
    const error = new Error("Destination is required for recommendations.");
    error.code = "recommendations/invalid-destination";
    throw error;
  }

  if (normalized.length > MAX_DESTINATION_LENGTH) {
    const error = new Error(
      `Destination must be ${MAX_DESTINATION_LENGTH} characters or fewer.`
    );
    error.code = "recommendations/invalid-destination";
    throw error;
  }

  return normalized;
}

function resolveAutocompleteQueryOrThrow(query) {
  const normalized = normalizeDestinationLabel(query);

  if (!normalized || normalized.length < MIN_AUTOCOMPLETE_QUERY_LENGTH) {
    const error = new Error(
      `Autocomplete query must be at least ${MIN_AUTOCOMPLETE_QUERY_LENGTH} characters long.`
    );
    error.code = "recommendations/invalid-query";
    throw error;
  }

  if (normalized.length > MAX_DESTINATION_LENGTH) {
    const error = new Error(
      `Autocomplete query must be ${MAX_DESTINATION_LENGTH} characters or fewer.`
    );
    error.code = "recommendations/invalid-query";
    throw error;
  }

  if (/[^\p{L}\p{N}\s,.'-]/u.test(normalized)) {
    const error = new Error("Autocomplete query contains unsupported characters.");
    error.code = "recommendations/invalid-query";
    throw error;
  }

  return normalized;
}

function mapGooglePredictionToAutocompleteSuggestion(prediction = {}) {
  const primaryText = String(
    prediction?.structured_formatting?.main_text ?? prediction?.description ?? ""
  ).trim();
  const secondaryText = String(
    prediction?.structured_formatting?.secondary_text ?? ""
  ).trim();
  const label = String(prediction?.description ?? primaryText).trim();

  return {
    label,
    name: primaryText,
    country: secondaryText,
    primaryText,
    secondaryText,
    placeId: String(prediction?.place_id ?? "").trim(),
    source: "google_places",
  };
}

async function fetchPlaceAutocomplete(query, apiKey) {
  const endpoint = new URL(GOOGLE_PLACES_AUTOCOMPLETE_URL);
  endpoint.searchParams.set("input", query);
  endpoint.searchParams.set("key", apiKey);

  const response = await safeFetch(endpoint);

  if (!response.ok) {
    throw new Error(
      `Google Places autocomplete request failed with status ${response.status}.`
    );
  }

  const payload = await response.json();
  const status = String(payload?.status ?? "");

  if (
    status &&
    status !== "OK" &&
    status !== "ZERO_RESULTS"
  ) {
    throw new Error(`Google Places autocomplete returned status ${status}.`);
  }

  return Array.isArray(payload?.predictions) ? payload.predictions : [];
}

function buildLocalAutocompleteSuggestions(query) {
  return getDestinationSuggestions(query, {
    limit: MAX_AUTOCOMPLETE_RESULTS,
  });
}

function mapGooglePlaceToRecommendation(place = {}, category, destination) {
  const name = String(place.name ?? "").trim();
  const location = String(place.formatted_address ?? place.vicinity ?? "").trim();
  const query = [name, location || destination].filter(Boolean).join(", ");

  const defaultDescription =
    category === "restaurant"
      ? `Popular dining recommendation in ${destination} with strong traveler ratings.`
      : `Top-rated stay option in ${destination} selected for location and guest reviews.`;

  return normalizeRecommendationItem(
    {
      name,
      location: location || destination,
      description: defaultDescription,
      rating: place.rating,
      priceLabel: resolvePriceLabelFromGoogleLevel(place.price_level),
      mapsUrl: buildGoogleMapsSearchUrl(query || destination),
      geoCoordinates: {
        latitude: place?.geometry?.location?.lat ?? null,
        longitude: place?.geometry?.location?.lng ?? null,
      },
    },
    category
  );
}

function mapGooglePlaceToStructuredPlace(place = {}, category, destination) {
  const name = String(place.name ?? "").trim();
  const location = String(place.formatted_address ?? place.vicinity ?? "").trim();
  const recommendation = mapGooglePlaceToRecommendation(place, category, destination);

  return {
    source: "google_places",
    externalPlaceId: String(
      place.place_id ??
        `${category}:${name || "place"}:${location || destination}`
    )
      .trim()
      .toLowerCase(),
    category,
    name: recommendation.name,
    address: recommendation.location || location || destination,
    coordinates: {
      latitude: place?.geometry?.location?.lat ?? null,
      longitude: place?.geometry?.location?.lng ?? null,
    },
    rating: recommendation.rating,
    priceLevel: recommendation.priceLabel,
    description: recommendation.description,
    metadata: {
      mapsUrl: recommendation.mapsUrl,
      imageUrl: recommendation.imageUrl,
      providerStatus: "live",
      types: Array.isArray(place?.types)
        ? place.types.filter((value) => typeof value === "string")
        : [],
    },
  };
}

async function fetchPlacesByTextSearch(query, apiKey) {
  const endpoint = new URL(GOOGLE_PLACES_TEXT_SEARCH_URL);
  endpoint.searchParams.set("query", query);
  endpoint.searchParams.set("key", apiKey);

  const response = await safeFetch(endpoint);

  if (!response.ok) {
    throw new Error(`Google Places request failed with status ${response.status}.`);
  }

  const payload = await response.json();
  const status = String(payload?.status ?? "");

  if (status && status !== "OK" && status !== "ZERO_RESULTS") {
    throw new Error(`Google Places returned status ${status}.`);
  }

  return Array.isArray(payload?.results) ? payload.results : [];
}

async function fetchLiveRecommendations(destination, apiKey) {
  const timeoutMs = resolveProviderTimeoutMs();
  const hotelsQuery = `best hotels in ${destination}`;
  const restaurantsQuery = `best restaurants in ${destination}`;

  const [hotelResults, restaurantResults] = await Promise.all([
    withTimeout(
      fetchPlacesByTextSearch(hotelsQuery, apiKey),
      timeoutMs,
      "Hotel recommendation provider timed out."
    ),
    withTimeout(
      fetchPlacesByTextSearch(restaurantsQuery, apiKey),
      timeoutMs,
      "Restaurant recommendation provider timed out."
    ),
  ]);

  return normalizeDestinationRecommendations({
    destination,
    provider: "google_places",
    warning: "",
    hotels: hotelResults
      .map((place) => mapGooglePlaceToRecommendation(place, "hotel", destination))
      .slice(0, MAX_ITEMS_PER_CATEGORY),
    restaurants: restaurantResults
      .map((place) =>
        mapGooglePlaceToRecommendation(place, "restaurant", destination)
      )
      .slice(0, MAX_ITEMS_PER_CATEGORY),
  });
}

async function fetchLiveDestinationDataBundle(destination, apiKey) {
  const timeoutMs = resolveProviderTimeoutMs();
  const hotelsQuery = `best hotels in ${destination}`;
  const restaurantsQuery = `best restaurants in ${destination}`;
  const attractionsQuery = `top attractions in ${destination}`;

  const [hotelResults, restaurantResults, attractionResults] = await Promise.all([
    withTimeout(
      fetchPlacesByTextSearch(hotelsQuery, apiKey),
      timeoutMs,
      "Hotel recommendation provider timed out."
    ),
    withTimeout(
      fetchPlacesByTextSearch(restaurantsQuery, apiKey),
      timeoutMs,
      "Restaurant recommendation provider timed out."
    ),
    withTimeout(
      fetchPlacesByTextSearch(attractionsQuery, apiKey),
      timeoutMs,
      "Attraction provider timed out."
    ),
  ]);

  const hotels = hotelResults
    .map((place) => mapGooglePlaceToRecommendation(place, "hotel", destination))
    .slice(0, MAX_ITEMS_PER_CATEGORY);
  const restaurants = restaurantResults
    .map((place) => mapGooglePlaceToRecommendation(place, "restaurant", destination))
    .slice(0, MAX_ITEMS_PER_CATEGORY);
  const attractions = attractionResults
    .map((place) => mapGooglePlaceToStructuredPlace(place, "attraction", destination))
    .slice(0, MAX_ITEMS_PER_CATEGORY);

  const hotelPlaces = hotelResults
    .map((place) => mapGooglePlaceToStructuredPlace(place, "hotel", destination))
    .slice(0, MAX_ITEMS_PER_CATEGORY);
  const restaurantPlaces = restaurantResults
    .map((place) => mapGooglePlaceToStructuredPlace(place, "restaurant", destination))
    .slice(0, MAX_ITEMS_PER_CATEGORY);

  return {
    destination,
    provider: "google_places",
    warning: "",
    recommendations: normalizeDestinationRecommendations({
      destination,
      provider: "google_places",
      warning: "",
      hotels,
      restaurants,
    }),
    places: {
      hotels: hotelPlaces,
      restaurants: restaurantPlaces,
      attractions,
    },
  };
}

function buildMockItems(destination, category) {
  const templates =
    category === "restaurant"
      ? RESTAURANT_MOCK_TEMPLATES
      : category === "attraction"
        ? ATTRACTION_MOCK_TEMPLATES
        : HOTEL_MOCK_TEMPLATES;

  return templates.map((template) =>
    normalizeRecommendationItem(
      {
        name: `${template.name}`,
        location: `${template.locationSuffix}, ${destination}`,
        description: template.description,
        priceLabel: template.priceLabel,
        rating: template.rating,
        imageUrl: template.imageUrl,
        mapsUrl: buildGoogleMapsSearchUrl(
          `${template.name}, ${template.locationSuffix}, ${destination}`
        ),
      },
      category
    )
  );
}

function buildMockStructuredPlaces(destination, category) {
  return buildMockItems(destination, category).map((item, index) => ({
    source: "mock",
    externalPlaceId: `mock-${category}-${destination.toLowerCase()}-${index + 1}`,
    category,
    name: item.name,
    address: item.location || destination,
    coordinates: {
      latitude: item?.geoCoordinates?.latitude ?? null,
      longitude: item?.geoCoordinates?.longitude ?? null,
    },
    rating: item.rating ?? null,
    priceLevel: item.priceLabel ?? "",
    description: item.description,
    metadata: {
      mapsUrl: item.mapsUrl,
      imageUrl: item.imageUrl,
      providerStatus: "mock",
    },
  }));
}

function buildMockRecommendations(destination, warning) {
  return normalizeDestinationRecommendations({
    destination,
    provider: "mock",
    warning,
    hotels: buildMockItems(destination, "hotel"),
    restaurants: buildMockItems(destination, "restaurant"),
  });
}

function buildMockDestinationDataBundle(destination, warning) {
  return {
    destination,
    provider: "mock",
    warning,
    recommendations: buildMockRecommendations(destination, warning),
    places: {
      hotels: buildMockStructuredPlaces(destination, "hotel"),
      restaurants: buildMockStructuredPlaces(destination, "restaurant"),
      attractions: buildMockStructuredPlaces(destination, "attraction"),
    },
  };
}

function combineLiveWithMockIfRequired(liveRecommendations) {
  const destination = liveRecommendations.destination;
  const fallback = buildMockRecommendations(destination, "");

  const missingHotels = liveRecommendations.hotels.length === 0;
  const missingRestaurants = liveRecommendations.restaurants.length === 0;

  if (!missingHotels && !missingRestaurants) {
    return liveRecommendations;
  }

  return normalizeDestinationRecommendations({
    ...liveRecommendations,
    warning:
      "Some live recommendations were unavailable. Missing sections were filled with curated samples.",
    hotels: missingHotels ? fallback.hotels : liveRecommendations.hotels,
    restaurants: missingRestaurants
      ? fallback.restaurants
      : liveRecommendations.restaurants,
  });
}

function combineLiveDestinationDataBundleWithMockIfRequired(liveBundle) {
  const destination = liveBundle.destination;
  const fallbackBundle = buildMockDestinationDataBundle(destination, "");
  const missingHotels = liveBundle.recommendations.hotels.length === 0;
  const missingRestaurants = liveBundle.recommendations.restaurants.length === 0;
  const missingAttractions = liveBundle.places.attractions.length === 0;

  if (!missingHotels && !missingRestaurants && !missingAttractions) {
    return liveBundle;
  }

  const warning =
    "Some live destination data was unavailable. Missing sections were filled with curated samples.";

  return {
    ...liveBundle,
    warning,
    recommendations: normalizeDestinationRecommendations({
      ...liveBundle.recommendations,
      warning,
      hotels: missingHotels
        ? fallbackBundle.recommendations.hotels
        : liveBundle.recommendations.hotels,
      restaurants: missingRestaurants
        ? fallbackBundle.recommendations.restaurants
        : liveBundle.recommendations.restaurants,
    }),
    places: {
      hotels: missingHotels ? fallbackBundle.places.hotels : liveBundle.places.hotels,
      restaurants: missingRestaurants
        ? fallbackBundle.places.restaurants
        : liveBundle.places.restaurants,
      attractions: missingAttractions
        ? fallbackBundle.places.attractions
        : liveBundle.places.attractions,
    },
  };
}

export function resolveGooglePlacesApiKey() {
  return String(process.env.GOOGLE_PLACES_API_KEY ?? "").trim();
}

export function clearDestinationRecommendationsCache(destination = "") {
  if (destination) {
    const cacheKey = getCacheKey(destination);
    DESTINATION_RECOMMENDATION_CACHE.delete(cacheKey);
    DESTINATION_DATA_BUNDLE_CACHE.delete(cacheKey);
    return;
  }

  DESTINATION_RECOMMENDATION_CACHE.clear();
  DESTINATION_DATA_BUNDLE_CACHE.clear();
}

export function clearDestinationAutocompleteCache(query = "") {
  if (query) {
    DESTINATION_AUTOCOMPLETE_CACHE.delete(getAutocompleteCacheKey(query));
    return;
  }

  DESTINATION_AUTOCOMPLETE_CACHE.clear();
}

export async function getDestinationAutocompleteSuggestions({
  query,
  forceRefresh = false,
} = {}) {
  const resolvedQuery = resolveAutocompleteQueryOrThrow(query);
  const cacheKey = getAutocompleteCacheKey(resolvedQuery);

  if (!forceRefresh) {
    const cached = readCachedAutocompleteSuggestions(cacheKey);
    if (cached) {
      console.info("[recommendations] Returning cached autocomplete suggestions", {
        query: resolvedQuery,
        count: cached.length,
      });
      return cached;
    }
  }

  const apiKey = resolveGooglePlacesApiKey();

  if (!apiKey) {
    const fallbackSuggestions = buildLocalAutocompleteSuggestions(resolvedQuery);
    writeCachedAutocompleteSuggestions(cacheKey, fallbackSuggestions);
    return fallbackSuggestions;
  }

  try {
    console.info("[recommendations] Fetching live autocomplete suggestions", {
      query: resolvedQuery,
    });
    const predictions = await withTimeout(
      fetchPlaceAutocomplete(resolvedQuery, apiKey),
      resolveProviderTimeoutMs(),
      "Autocomplete provider timed out."
    );
    const liveSuggestions = predictions
      .map(mapGooglePredictionToAutocompleteSuggestion)
      .filter((suggestion) => suggestion.label)
      .slice(0, MAX_AUTOCOMPLETE_RESULTS);
    const resolvedSuggestions =
      liveSuggestions.length > 0
        ? liveSuggestions
        : buildLocalAutocompleteSuggestions(resolvedQuery);

    writeCachedAutocompleteSuggestions(cacheKey, resolvedSuggestions);
    return resolvedSuggestions;
  } catch (error) {
    console.warn("[recommendations] Autocomplete provider failed, falling back to local", {
      query: resolvedQuery,
      message: error instanceof Error ? error.message : String(error),
    });

    const fallbackSuggestions = buildLocalAutocompleteSuggestions(resolvedQuery);
    writeCachedAutocompleteSuggestions(cacheKey, fallbackSuggestions);
    return fallbackSuggestions;
  }
}

export async function getDestinationDataBundle({
  destination,
  forceRefresh = false,
} = {}) {
  const resolvedDestination = resolveDestinationOrThrow(destination);
  const cacheKey = getCacheKey(resolvedDestination);

  if (!forceRefresh) {
    const cached = readCachedDestinationDataBundle(cacheKey);
    if (cached) {
      console.info("[recommendations] Returning cached destination data bundle", {
        destination: resolvedDestination,
        provider: cached.provider,
      });
      return cached;
    }
  }

  const apiKey = resolveGooglePlacesApiKey();
  if (!apiKey) {
    const mockBundle = buildMockDestinationDataBundle(
      resolvedDestination,
      "Live provider is unavailable. Showing curated sample recommendations."
    );
    writeCachedDestinationDataBundle(cacheKey, mockBundle);
    writeCachedRecommendations(cacheKey, mockBundle.recommendations);
    return mockBundle;
  }

  try {
    console.info("[recommendations] Fetching live destination data bundle", {
      destination: resolvedDestination,
    });
    const liveBundle = await fetchLiveDestinationDataBundle(
      resolvedDestination,
      apiKey
    );
    const mergedBundle = combineLiveDestinationDataBundleWithMockIfRequired(
      liveBundle
    );
    writeCachedDestinationDataBundle(cacheKey, mergedBundle);
    writeCachedRecommendations(cacheKey, mergedBundle.recommendations);
    return mergedBundle;
  } catch (error) {
    console.warn("[recommendations] Destination data bundle failed, falling back to mock", {
      destination: resolvedDestination,
      message: error instanceof Error ? error.message : String(error),
    });
    const mockBundle = buildMockDestinationDataBundle(
      resolvedDestination,
      "Live recommendations are temporarily unavailable. Showing curated sample recommendations."
    );
    writeCachedDestinationDataBundle(cacheKey, mockBundle);
    writeCachedRecommendations(cacheKey, mockBundle.recommendations);
    return mockBundle;
  }
}

export async function getDestinationRecommendations({
  destination,
  forceRefresh = false,
} = {}) {
  const resolvedDestination = resolveDestinationOrThrow(destination);
  const cacheKey = getCacheKey(resolvedDestination);

  if (!forceRefresh) {
    const cached = readCachedRecommendations(cacheKey);
    if (cached) {
      console.info("[recommendations] Returning cached destination recommendations", {
        destination: resolvedDestination,
        provider: cached.provider,
      });
      return cached;
    }
  }

  const apiKey = resolveGooglePlacesApiKey();

  if (!apiKey) {
    const mockRecommendations = buildMockRecommendations(
      resolvedDestination,
      "Live provider is unavailable. Showing curated sample recommendations."
    );
    writeCachedRecommendations(cacheKey, mockRecommendations);
    return mockRecommendations;
  }

  try {
    console.info("[recommendations] Fetching live recommendations", {
      destination: resolvedDestination,
    });
    const liveRecommendations = await fetchLiveRecommendations(
      resolvedDestination,
      apiKey
    );
    const mergedRecommendations = combineLiveWithMockIfRequired(liveRecommendations);
    writeCachedRecommendations(cacheKey, mergedRecommendations);
    return mergedRecommendations;
  } catch (error) {
    console.warn("[recommendations] Live provider failed, falling back to mock", {
      destination: resolvedDestination,
      message: error instanceof Error ? error.message : String(error),
    });

    const mockRecommendations = buildMockRecommendations(
      resolvedDestination,
      "Live recommendations are temporarily unavailable. Showing curated sample recommendations."
    );
    writeCachedRecommendations(cacheKey, mockRecommendations);
    return mockRecommendations;
  }
}
