import { normalizeDestinationRecommendations } from "../../shared/recommendations.js";

const GOOGLE_PLACES_TEXT_SEARCH_URL =
  "https://places.googleapis.com/v1/places:searchText";
const DEFAULT_CACHE_TTL_MS = 15 * 60 * 1000;
const DEFAULT_RESULT_LIMIT = 6;
const DEFAULT_REQUEST_TIMEOUT_MS = 12_000;

const GOOGLE_PLACES_FIELD_MASK = [
  "places.displayName",
  "places.formattedAddress",
  "places.shortFormattedAddress",
  "places.rating",
  "places.priceLevel",
  "places.primaryTypeDisplayName",
  "places.editorialSummary",
  "places.location",
  "places.googleMapsUri",
].join(",");

const HOTEL_DISTRICTS = [
  "City Center",
  "Old Town",
  "Waterfront",
  "Cultural Quarter",
  "Garden District",
  "Riverside",
  "Marina District",
  "Arts Quarter",
];

const HOTEL_PREFIXES = [
  "Harbor",
  "Luma",
  "Atlas",
  "Solstice",
  "Cedar",
  "Vista",
  "Drift",
  "Crown",
];

const HOTEL_SUFFIXES = [
  "Suites",
  "Residences",
  "Retreat",
  "House",
  "Stay",
  "Haven",
  "Lodge",
  "Grand",
];

const RESTAURANT_PREFIXES = [
  "Saffron",
  "Olive",
  "Ember",
  "Tamarind",
  "Salt",
  "Juniper",
  "Golden",
  "Cedar",
];

const RESTAURANT_SUFFIXES = [
  "Kitchen",
  "Table",
  "House",
  "Bistro",
  "Social",
  "Grill",
  "Atelier",
  "Garden",
];

const DINING_STYLES = [
  "Regional tasting menus",
  "Modern local plates",
  "Seafood-forward dining",
  "Street-food inspired comfort dishes",
  "Rooftop sunset dining",
  "Chef-led seasonal specials",
  "Cafe and brunch staples",
  "Late-evening sharing plates",
];

function normalizeText(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed || fallback;
}

function resolveRecommendationLimit() {
  const parsed = Number.parseInt(
    process.env.DESTINATION_RECOMMENDATION_LIMIT ?? "",
    10
  );

  if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 12) {
    return parsed;
  }

  return DEFAULT_RESULT_LIMIT;
}

function resolveRecommendationCacheTtlMs() {
  const parsed = Number.parseInt(
    process.env.DESTINATION_RECOMMENDATION_CACHE_TTL_MS ?? "",
    10
  );

  if (Number.isInteger(parsed) && parsed >= 30_000 && parsed <= 86_400_000) {
    return parsed;
  }

  return DEFAULT_CACHE_TTL_MS;
}

function resolveRequestTimeoutMs() {
  const parsed = Number.parseInt(
    process.env.DESTINATION_RECOMMENDATION_TIMEOUT_MS ?? "",
    10
  );

  if (Number.isInteger(parsed) && parsed >= 2_000 && parsed <= 30_000) {
    return parsed;
  }

  return DEFAULT_REQUEST_TIMEOUT_MS;
}

export function resolveGooglePlacesApiKey() {
  return process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY ?? "";
}

function createSeed(value) {
  return [...normalizeText(value)].reduce(
    (total, character, index) => total + character.charCodeAt(0) * (index + 1),
    0
  );
}

function selectBySeed(values, seed, offset = 0) {
  return values[(seed + offset) % values.length];
}

function formatHotelPriceLabel(budget, offset) {
  const normalizedBudget = normalizeText(budget).toLowerCase();

  if (/luxury|premium/.test(normalizedBudget)) {
    return [`$260-$340 / night`, `$320-$420 / night`, `$380-$520 / night`][
      offset % 3
    ];
  }

  if (/cheap|budget|economy/.test(normalizedBudget)) {
    return [`$70-$110 / night`, `$85-$130 / night`, `$95-$145 / night`][
      offset % 3
    ];
  }

  return [`$130-$190 / night`, `$150-$220 / night`, `$180-$260 / night`][
    offset % 3
  ];
}

function formatRestaurantPriceLabel(budget, offset) {
  const normalizedBudget = normalizeText(budget).toLowerCase();

  if (/luxury|premium/.test(normalizedBudget)) {
    return [`$$$ Signature dining`, `$$$$ Fine dining`, `$$$ Chef's table`][
      offset % 3
    ];
  }

  if (/cheap|budget|economy/.test(normalizedBudget)) {
    return [`$ Casual`, `$$ Neighborhood spot`, `$ Street food favorite`][
      offset % 3
    ];
  }

  return [`$$ Casual`, `$$$ Elevated local`, `$$ Bistro`][offset % 3];
}

function buildMapsSearchUrl(name, location) {
  const query = normalizeText([name, location].filter(Boolean).join(", "));
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function buildMockHotelDescription({
  destination,
  district,
  travelers,
  budget,
}) {
  const travelerTone = normalizeText(travelers, "travelers").toLowerCase();
  const budgetTone = normalizeText(budget, "balanced").toLowerCase();

  return `A ${budgetTone} stay in ${district} with dependable access to ${destination}'s main sights, well-suited for ${travelerTone} who want a smooth home base between activities.`;
}

function buildMockRestaurantDescription({
  destination,
  diningStyle,
  district,
}) {
  return `${diningStyle} near ${district}, chosen to make it easy to pair a memorable meal with the rest of your ${destination} itinerary.`;
}

function mapPriceLevel(priceLevel) {
  switch (priceLevel) {
    case "PRICE_LEVEL_FREE":
      return "Free";
    case "PRICE_LEVEL_INEXPENSIVE":
      return "$ Budget-friendly";
    case "PRICE_LEVEL_MODERATE":
      return "$$ Moderate";
    case "PRICE_LEVEL_EXPENSIVE":
      return "$$$ Upscale";
    case "PRICE_LEVEL_VERY_EXPENSIVE":
      return "$$$$ Premium";
    default:
      return "";
  }
}

function buildLiveDescription(place, category, destination) {
  const editorialSummary = normalizeText(place.editorialSummary?.text);
  if (editorialSummary) {
    return editorialSummary;
  }

  const typeLabel = normalizeText(place.primaryTypeDisplayName?.text);
  if (typeLabel && category === "hotel") {
    return `${typeLabel} in ${destination} with easy access to nearby attractions and transport.`;
  }

  if (typeLabel && category === "restaurant") {
    return `${typeLabel} in ${destination} known for convenient dining access near popular travel zones.`;
  }

  return category === "hotel"
    ? `Recommended stay in ${destination} with convenient access to the surrounding neighborhoods.`
    : `Recommended dining stop in ${destination} for easy inclusion in your itinerary.`;
}

function mapGooglePlaceToRecommendation(place, category, destination) {
  const name = normalizeText(place.displayName?.text);
  const location = normalizeText(
    place.shortFormattedAddress ?? place.formattedAddress,
    destination
  );

  return {
    name,
    location,
    rating: place.rating,
    description: buildLiveDescription(place, category, destination),
    priceLabel: mapPriceLevel(place.priceLevel),
    mapsUrl: normalizeText(place.googleMapsUri, buildMapsSearchUrl(name, location)),
    typeLabel: normalizeText(place.primaryTypeDisplayName?.text),
    geoCoordinates: place.location,
    category,
  };
}

async function parseErrorResponse(response) {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    const payload = await response.json();
    return (
      payload?.error?.message ??
      payload?.message ??
      `HTTP ${response.status}`
    );
  }

  const text = await response.text();
  return normalizeText(text, `HTTP ${response.status}`);
}

async function searchGooglePlacesCategory({
  destination,
  category,
  apiKey,
  fetchImpl,
  limit,
  timeoutMs,
}) {
  const textQuery =
    category === "hotel"
      ? `best hotels in ${destination}`
      : `best restaurants in ${destination}`;

  console.info("[recommendations] Fetching Google Places results", {
    destination,
    category,
    limit,
  });

  const response = await fetchImpl(GOOGLE_PLACES_TEXT_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": GOOGLE_PLACES_FIELD_MASK,
    },
    body: JSON.stringify({
      textQuery,
      languageCode: "en",
      includedType: category === "hotel" ? "lodging" : "restaurant",
      strictTypeFiltering: true,
      minRating: 3.8,
      maxResultCount: limit,
      openNow: false,
      rankPreference: "RELEVANCE",
    }),
    ...(typeof AbortSignal !== "undefined" &&
    typeof AbortSignal.timeout === "function"
      ? { signal: AbortSignal.timeout(timeoutMs) }
      : {}),
  });

  if (!response.ok) {
    const message = await parseErrorResponse(response);
    throw new Error(
      `Google Places ${category} search failed with status ${response.status}: ${message}`
    );
  }

  const data = await response.json();
  const places = Array.isArray(data.places) ? data.places : [];

  return places
    .map((place) => mapGooglePlaceToRecommendation(place, category, destination))
    .filter((place) => place.name);
}

async function fetchGooglePlacesRecommendations({
  destination,
  apiKey,
  fetchImpl,
  limit,
  timeoutMs,
}) {
  const [hotels, restaurants] = await Promise.all([
    searchGooglePlacesCategory({
      destination,
      category: "hotel",
      apiKey,
      fetchImpl,
      limit,
      timeoutMs,
    }),
    searchGooglePlacesCategory({
      destination,
      category: "restaurant",
      apiKey,
      fetchImpl,
      limit,
      timeoutMs,
    }),
  ]);

  return normalizeDestinationRecommendations({
    destination,
    hotels,
    restaurants,
    provider: "google-places",
    fetchedAt: new Date().toISOString(),
  });
}

export function buildMockDestinationRecommendations({
  destination,
  userSelection = {},
  limit = DEFAULT_RESULT_LIMIT,
  warning = "",
}) {
  const normalizedDestination = normalizeText(destination, "Unknown destination");
  const seed = createSeed(normalizedDestination);
  const hotels = Array.from({ length: limit }, (_, index) => {
    const district = selectBySeed(HOTEL_DISTRICTS, seed, index);
    const hotelPrefix = selectBySeed(HOTEL_PREFIXES, seed, index);
    const hotelSuffix = selectBySeed(HOTEL_SUFFIXES, seed, index + 2);
    const name = `${hotelPrefix} ${hotelSuffix}`;

    return {
      name,
      location: `${district}, ${normalizedDestination}`,
      rating: (4.1 + ((seed + index) % 8) * 0.1).toFixed(1),
      description: buildMockHotelDescription({
        destination: normalizedDestination,
        district,
        travelers: userSelection.travelers,
        budget: userSelection.budget,
      }),
      priceLabel: formatHotelPriceLabel(userSelection.budget, index),
      mapsUrl: buildMapsSearchUrl(name, `${district}, ${normalizedDestination}`),
      typeLabel: "Curated stay",
      category: "hotel",
    };
  });

  const restaurants = Array.from({ length: limit }, (_, index) => {
    const district = selectBySeed(HOTEL_DISTRICTS, seed, index + 3);
    const name = `${selectBySeed(RESTAURANT_PREFIXES, seed, index)} ${selectBySeed(
      RESTAURANT_SUFFIXES,
      seed,
      index + 1
    )}`;

    return {
      name,
      location: `${district}, ${normalizedDestination}`,
      rating: (4.2 + ((seed + index + 2) % 7) * 0.1).toFixed(1),
      description: buildMockRestaurantDescription({
        destination: normalizedDestination,
        district,
        diningStyle: selectBySeed(DINING_STYLES, seed, index),
      }),
      priceLabel: formatRestaurantPriceLabel(userSelection.budget, index),
      mapsUrl: buildMapsSearchUrl(name, `${district}, ${normalizedDestination}`),
      typeLabel: "Curated dining spot",
      category: "restaurant",
    };
  });

  return normalizeDestinationRecommendations({
    destination: normalizedDestination,
    hotels,
    restaurants,
    provider: "mock",
    warning,
    fetchedAt: new Date().toISOString(),
  });
}

export function createDestinationRecommendationService({
  now = () => Date.now(),
  cache = new Map(),
  fetchImpl = fetch,
  cacheTtlMs = resolveRecommendationCacheTtlMs(),
  limit = resolveRecommendationLimit(),
  timeoutMs = resolveRequestTimeoutMs(),
  resolveApiKey = resolveGooglePlacesApiKey,
} = {}) {
  async function getRecommendationsForDestination({
    destination,
    userSelection = {},
  }) {
    const normalizedDestination = normalizeText(destination);

    if (!normalizedDestination) {
      throw new Error("Destination is required to load recommendations.");
    }

    const cacheKey = [
      normalizedDestination.toLowerCase(),
      normalizeText(userSelection.budget).toLowerCase(),
      normalizeText(userSelection.travelers).toLowerCase(),
    ].join("::");
    const cached = cache.get(cacheKey);

    if (cached && now() - cached.createdAt < cacheTtlMs) {
      console.info("[recommendations] Cache hit", {
        destination: normalizedDestination,
        provider: cached.value.provider,
      });
      return cached.value;
    }

    console.info("[recommendations] Cache miss", {
      destination: normalizedDestination,
    });

    const apiKey = normalizeText(resolveApiKey());
    let recommendations;

    if (apiKey) {
      try {
        recommendations = await fetchGooglePlacesRecommendations({
          destination: normalizedDestination,
          apiKey,
          fetchImpl,
          limit,
          timeoutMs,
        });
      } catch (error) {
        console.error("[recommendations] Live provider failed, using fallback", {
          destination: normalizedDestination,
          message: error instanceof Error ? error.message : String(error),
        });
        recommendations = buildMockDestinationRecommendations({
          destination: normalizedDestination,
          userSelection,
          limit,
          warning:
            "Live destination data is temporarily unavailable, so these curated sample recommendations are being shown instead.",
        });
      }
    } else {
      console.info("[recommendations] Using mock provider", {
        destination: normalizedDestination,
      });
      recommendations = buildMockDestinationRecommendations({
        destination: normalizedDestination,
        userSelection,
        limit,
        warning:
          "Live destination data is not configured, so these curated sample recommendations are being shown.",
      });
    }

    cache.set(cacheKey, {
      createdAt: now(),
      value: recommendations,
    });

    return recommendations;
  }

  return {
    getRecommendationsForDestination,
    cache,
  };
}

const destinationRecommendationService = createDestinationRecommendationService();

export const getRecommendationsForDestination =
  destinationRecommendationService.getRecommendationsForDestination;
