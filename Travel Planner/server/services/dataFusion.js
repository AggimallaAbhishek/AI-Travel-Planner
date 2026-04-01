import { normalizeGeoCoordinates } from "../../shared/maps.js";

const SOURCE_CONFIDENCE = {
  "google-places": 0.93,
  openstreetmap: 0.82,
  itinerary: 0.62,
  ai: 0.58,
  mock: 0.45,
  unknown: 0.4,
};

function normalizeText(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed || fallback;
}

function normalizeNumber(value, fallback = null) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeSourceName(value) {
  const normalized = normalizeText(value, "unknown").toLowerCase();
  return SOURCE_CONFIDENCE[normalized] ? normalized : "unknown";
}

function getSourceWeight(source) {
  const sourceName = normalizeSourceName(source);
  return SOURCE_CONFIDENCE[sourceName] ?? SOURCE_CONFIDENCE.unknown;
}

function buildFusionKey(name, location) {
  return `${normalizeText(name).toLowerCase()}::${normalizeText(location).toLowerCase()}`;
}

function toNormalizedCandidate(item = {}, defaults = {}) {
  const name = normalizeText(item.name ?? item.placeName ?? item.hotelName);
  if (!name) {
    return null;
  }

  const location = normalizeText(
    item.location ?? item.placeAddress ?? item.hotelAddress ?? defaults.location
  );

  return {
    key: buildFusionKey(name, location),
    name,
    location,
    category: normalizeText(
      item.category ?? defaults.category,
      "place"
    ).toLowerCase(),
    mapsUrl: normalizeText(item.mapsUrl ?? item.googleMapsUri),
    description: normalizeText(item.description ?? item.placeDetails),
    geoCoordinates: normalizeGeoCoordinates(
      item.geoCoordinates ?? item.coordinates ?? item.locationCoordinates
    ),
    source: normalizeSourceName(item.source ?? defaults.source),
    fetchedAt: normalizeText(item.fetchedAt ?? defaults.fetchedAt),
    sourceType: normalizeText(item.sourceType ?? defaults.sourceType, "api"),
  };
}

function mergeConfidence(currentConfidence, nextConfidence) {
  const left = normalizeNumber(currentConfidence, 0);
  const right = normalizeNumber(nextConfidence, 0);
  return 1 - (1 - left) * (1 - right);
}

function upsertFusionItem(itemsByKey, candidate) {
  const existing = itemsByKey.get(candidate.key);
  const sourceWeight = getSourceWeight(candidate.source);

  if (!existing) {
    itemsByKey.set(candidate.key, {
      id: candidate.key,
      name: candidate.name,
      location: candidate.location,
      category: candidate.category,
      mapsUrl: candidate.mapsUrl,
      description: candidate.description,
      geoCoordinates: candidate.geoCoordinates,
      confidence: sourceWeight,
      sources: [
        {
          provider: candidate.source,
          sourceType: candidate.sourceType,
          fetchedAt: candidate.fetchedAt,
        },
      ],
    });
    return;
  }

  existing.confidence = mergeConfidence(existing.confidence, sourceWeight);
  if (!existing.mapsUrl && candidate.mapsUrl) {
    existing.mapsUrl = candidate.mapsUrl;
  }
  if (!existing.description && candidate.description) {
    existing.description = candidate.description;
  }
  if (
    existing.geoCoordinates.latitude === null &&
    candidate.geoCoordinates.latitude !== null
  ) {
    existing.geoCoordinates = candidate.geoCoordinates;
  }

  existing.sources.push({
    provider: candidate.source,
    sourceType: candidate.sourceType,
    fetchedAt: candidate.fetchedAt,
  });
}

export function buildTripFusionIndex({
  trip = {},
  recommendations = {},
  transportSignals = [],
}) {
  const destination = normalizeText(
    trip?.userSelection?.location?.label ??
      recommendations?.destination ??
      trip?.aiPlan?.destination,
    "Unknown destination"
  );
  const generatedAt = new Date().toISOString();
  const itemsByKey = new Map();
  const itineraryDays = Array.isArray(trip?.itinerary?.days) ? trip.itinerary.days : [];
  const hotels = Array.isArray(trip?.hotels) ? trip.hotels : [];
  const recommendationHotels = Array.isArray(recommendations?.hotels)
    ? recommendations.hotels
    : [];
  const recommendationRestaurants = Array.isArray(recommendations?.restaurants)
    ? recommendations.restaurants
    : [];
  const recommendationSource = normalizeSourceName(recommendations?.provider);

  for (const day of itineraryDays) {
    const places = Array.isArray(day?.places) ? day.places : [];
    for (const place of places) {
      const candidate = toNormalizedCandidate(place, {
        location: destination,
        category: "activity",
        source: "itinerary",
        sourceType: "structured",
        fetchedAt: generatedAt,
      });
      if (candidate) {
        upsertFusionItem(itemsByKey, candidate);
      }
    }
  }

  for (const hotel of hotels) {
    const candidate = toNormalizedCandidate(hotel, {
      location: destination,
      category: "hotel",
      source: "ai",
      sourceType: "generated",
      fetchedAt: generatedAt,
    });
    if (candidate) {
      upsertFusionItem(itemsByKey, candidate);
    }
  }

  for (const hotel of recommendationHotels) {
    const candidate = toNormalizedCandidate(hotel, {
      location: destination,
      category: "hotel",
      source: recommendationSource,
      sourceType: "api",
      fetchedAt: recommendations?.fetchedAt ?? generatedAt,
    });
    if (candidate) {
      upsertFusionItem(itemsByKey, candidate);
    }
  }

  for (const restaurant of recommendationRestaurants) {
    const candidate = toNormalizedCandidate(restaurant, {
      location: destination,
      category: "restaurant",
      source: recommendationSource,
      sourceType: "api",
      fetchedAt: recommendations?.fetchedAt ?? generatedAt,
    });
    if (candidate) {
      upsertFusionItem(itemsByKey, candidate);
    }
  }

  for (const transportSignal of transportSignals) {
    const candidate = toNormalizedCandidate(transportSignal, {
      location: destination,
      category: "transport",
      source: "unknown",
      sourceType: "transport",
      fetchedAt: generatedAt,
    });
    if (candidate) {
      upsertFusionItem(itemsByKey, candidate);
    }
  }

  const items = [...itemsByKey.values()]
    .sort((left, right) => right.confidence - left.confidence)
    .map((item) => ({
      ...item,
      confidence: Number(item.confidence.toFixed(3)),
    }));
  const highConfidenceItems = items.filter((item) => item.confidence >= 0.8).length;

  return {
    destination,
    generatedAt,
    items,
    stats: {
      itemCount: items.length,
      highConfidenceItems,
      sourceCount: new Set(
        items.flatMap((item) => item.sources.map((source) => source.provider))
      ).size,
    },
  };
}

export function findLowConfidenceActivities({
  trip = {},
  fusionIndex = {},
  minConfidence = 0.55,
}) {
  const lookup = new Map(
    (Array.isArray(fusionIndex?.items) ? fusionIndex.items : []).map((item) => [
      normalizeText(item?.name).toLowerCase(),
      normalizeNumber(item?.confidence, 0),
    ])
  );
  const itineraryDays = Array.isArray(trip?.itinerary?.days) ? trip.itinerary.days : [];
  const missing = [];

  for (const day of itineraryDays) {
    const places = Array.isArray(day?.places) ? day.places : [];
    for (const place of places) {
      const name = normalizeText(place?.placeName ?? place?.name);
      if (!name) {
        continue;
      }

      const confidence = lookup.get(name.toLowerCase()) ?? 0;
      if (confidence >= minConfidence) {
        continue;
      }

      missing.push({
        dayNumber: day.dayNumber ?? null,
        name,
        confidence,
      });
    }
  }

  return missing;
}
