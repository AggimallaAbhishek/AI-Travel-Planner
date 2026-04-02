import { buildGoogleMapsQueryUrl, resolveGoogleMapsUrl } from "./maps.js";

function normalizeText(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed || fallback;
}

function normalizeNumber(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeRating(value) {
  const rating = normalizeNumber(value);

  if (rating === null) {
    return null;
  }

  if (rating < 0) {
    return 0;
  }

  if (rating > 5) {
    return 5;
  }

  return Number(rating.toFixed(1));
}

function normalizeCoordinates(coordinates = {}) {
  if (!coordinates || typeof coordinates !== "object") {
    return { latitude: null, longitude: null };
  }

  const latitude = normalizeNumber(
    coordinates.latitude ?? coordinates.lat ?? coordinates.latitudeDegrees
  );
  const longitude = normalizeNumber(
    coordinates.longitude ?? coordinates.lng ?? coordinates.longitudeDegrees
  );

  return {
    latitude,
    longitude,
  };
}

function isRemoteUrl(value) {
  if (typeof value !== "string") {
    return false;
  }

  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed);
}

function toPriceLabel(value) {
  const text = normalizeText(
    typeof value === "string" ? value : String(value ?? "")
  );

  if (!text) {
    return "";
  }

  if (/^\$+$/.test(text)) {
    return text;
  }

  const numericLevel = Number.parseInt(text, 10);
  if (Number.isInteger(numericLevel) && numericLevel >= 0 && numericLevel <= 4) {
    if (numericLevel === 0) {
      return "$";
    }

    return "$".repeat(numericLevel);
  }

  return text;
}

export function normalizeDestinationLabel(destination, fallback = "") {
  return normalizeText(destination, fallback);
}

export function buildGoogleMapsSearchUrl(query) {
  return buildGoogleMapsQueryUrl(query);
}

export function normalizeRecommendationItem(item = {}, type = "hotel") {
  const defaultLabel = type === "restaurant" ? "Recommended Restaurant" : "Recommended Hotel";
  const defaultDescription =
    type === "restaurant"
      ? "A curated dining option for this destination."
      : "A curated stay option for this destination.";

  const name = normalizeText(item.name ?? item.hotelName ?? item.restaurantName, defaultLabel);
  const location = normalizeText(item.location ?? item.hotelAddress ?? item.address);
  const description = normalizeText(item.description ?? item.details, defaultDescription);
  const geoCoordinates = normalizeCoordinates(
    item.geoCoordinates ?? item.coordinates ?? item.locationCoordinates
  );
  const externalPlaceId = normalizeText(item.externalPlaceId ?? item.placeId);
  const mapsUrl = resolveGoogleMapsUrl({
    mapsUrl: isRemoteUrl(item.mapsUrl) ? item.mapsUrl : "",
    placeId: normalizeText(item.placeId),
    externalPlaceId,
    coordinates: geoCoordinates,
    name,
    address: location,
  });
  const imageUrlSource =
    item.imageUrl ??
    item.image ??
    item.photoUrl ??
    item.hotelImageUrl ??
    item.placeImageUrl;

  return {
    name,
    imageUrl: isRemoteUrl(imageUrlSource) ? imageUrlSource : "",
    rating: normalizeRating(item.rating),
    location,
    description,
    priceLabel: toPriceLabel(
      item.priceLabel ?? item.price ?? item.priceRange ?? item.price_level
    ),
    mapsUrl,
    geoCoordinates,
    externalPlaceId,
    source: normalizeText(item.source),
  };
}

export function normalizeDestinationRecommendations(input = {}) {
  const hotels = Array.isArray(input.hotels)
    ? input.hotels.map((item) => normalizeRecommendationItem(item, "hotel"))
    : [];
  const restaurants = Array.isArray(input.restaurants)
    ? input.restaurants.map((item) => normalizeRecommendationItem(item, "restaurant"))
    : [];

  return {
    destination: normalizeDestinationLabel(input.destination),
    provider: normalizeText(input.provider),
    warning: normalizeText(input.warning),
    hotels,
    restaurants,
  };
}
