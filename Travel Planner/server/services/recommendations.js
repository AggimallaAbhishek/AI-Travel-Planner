import {
  buildGoogleMapsSearchUrl,
  normalizeDestinationLabel,
  normalizeDestinationRecommendations,
  normalizeRecommendationItem,
} from "../../shared/recommendations.js";

const GOOGLE_PLACES_TEXT_SEARCH_URL =
  "https://maps.googleapis.com/maps/api/place/textsearch/json";
const MAX_DESTINATION_LENGTH = 120;
const MAX_ITEMS_PER_CATEGORY = 6;
const DEFAULT_PROVIDER_TIMEOUT_MS = 8_000;
const DEFAULT_LIVE_CACHE_TTL_MS = 5 * 60 * 1_000;
const DEFAULT_MOCK_CACHE_TTL_MS = 30 * 1_000;
const DESTINATION_RECOMMENDATION_CACHE = new Map();

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

async function fetchPlacesByTextSearch(query, apiKey) {
  const endpoint = new URL(GOOGLE_PLACES_TEXT_SEARCH_URL);
  endpoint.searchParams.set("query", query);
  endpoint.searchParams.set("key", apiKey);

  const response = await fetch(endpoint);

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

function buildMockItems(destination, category) {
  const templates =
    category === "restaurant" ? RESTAURANT_MOCK_TEMPLATES : HOTEL_MOCK_TEMPLATES;

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

function buildMockRecommendations(destination, warning) {
  return normalizeDestinationRecommendations({
    destination,
    provider: "mock",
    warning,
    hotels: buildMockItems(destination, "hotel"),
    restaurants: buildMockItems(destination, "restaurant"),
  });
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

export function resolveGooglePlacesApiKey() {
  return String(process.env.GOOGLE_PLACES_API_KEY ?? "").trim();
}

export function clearDestinationRecommendationsCache(destination = "") {
  if (destination) {
    DESTINATION_RECOMMENDATION_CACHE.delete(getCacheKey(destination));
    return;
  }

  DESTINATION_RECOMMENDATION_CACHE.clear();
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
