function normalizeText(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed || fallback;
}

function truncateText(value, maxLength = 180) {
  const text = normalizeText(value);
  if (!text || text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function normalizeRating(value) {
  const parsed = Number.parseFloat(value);

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.min(Math.max(parsed, 0), 5);
}

function normalizeCoordinates(value) {
  if (!value || typeof value !== "object") {
    return { latitude: null, longitude: null };
  }

  const latitude = Number.parseFloat(
    value.latitude ?? value.lat ?? value.latitudeDegrees
  );
  const longitude = Number.parseFloat(
    value.longitude ?? value.lng ?? value.longitudeDegrees
  );

  return {
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
  };
}

function normalizeExternalUrl(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) {
    return fallback;
  }

  return trimmed;
}

function buildMapsSearchUrl(name, location) {
  const query = normalizeText([name, location].filter(Boolean).join(", "));

  if (!query) {
    return "";
  }

  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function normalizeCategory(value, fallback = "place") {
  const category = normalizeText(value, fallback).toLowerCase();
  return category || fallback;
}

function normalizeCollection(items = [], category) {
  if (!Array.isArray(items)) {
    return [];
  }

  const uniqueItems = [];
  const seen = new Set();

  for (const item of items) {
    const normalized = normalizeRecommendationItem(item, {
      category,
    });
    const dedupeKey = `${normalized.name.toLowerCase()}::${normalized.location.toLowerCase()}`;

    if (!normalized.name || seen.has(dedupeKey)) {
      continue;
    }

    uniqueItems.push(normalized);
    seen.add(dedupeKey);
  }

  return uniqueItems;
}

export function normalizeRecommendationItem(item = {}, options = {}) {
  const category = normalizeCategory(
    options.category ?? item.category ?? item.type,
    "place"
  );
  const name = normalizeText(
    item.name ?? item.hotelName ?? item.restaurantName ?? item.title,
    category === "hotel" ? "Recommended Hotel" : "Recommended Spot"
  );
  const location = normalizeText(
    item.location ??
      item.address ??
      item.hotelAddress ??
      item.formattedAddress ??
      item.shortFormattedAddress
  );

  return {
    name,
    location,
    rating: normalizeRating(item.rating),
    description: truncateText(
      item.description ?? item.editorialSummary ?? item.details
    ),
    imageUrl: normalizeExternalUrl(
      item.imageUrl ?? item.photoUrl ?? item.hotelImageUrl
    ),
    priceLabel: normalizeText(item.priceLabel ?? item.price ?? item.priceRange),
    mapsUrl: normalizeExternalUrl(
      item.mapsUrl ?? item.googleMapsUri,
      buildMapsSearchUrl(name, location)
    ),
    typeLabel: normalizeText(item.typeLabel ?? item.primaryTypeDisplayName),
    geoCoordinates: normalizeCoordinates(
      item.geoCoordinates ?? item.coordinates ?? item.locationCoordinates
    ),
    category,
  };
}

export function normalizeDestinationRecommendations(input = {}) {
  return {
    destination: normalizeText(input.destination, "Unknown destination"),
    hotels: normalizeCollection(input.hotels, "hotel"),
    restaurants: normalizeCollection(input.restaurants, "restaurant"),
    provider: normalizeText(input.provider, "mock"),
    warning: normalizeText(input.warning),
    fetchedAt: normalizeText(input.fetchedAt, new Date().toISOString()),
  };
}
