import { isRemoteImageUrl } from "../../shared/trips.js";
import {
  getCategoryFallback,
  getManifestImageForQuery,
  IMAGE_FALLBACKS,
} from "./imageManifest.js";

export function getDestinationImage(query, fallback = IMAGE_FALLBACKS.destination) {
  return getManifestImageForQuery(query, { category: "destination" }) ?? fallback;
}

export function getTripImage(locationLabel) {
  return getDestinationImage(locationLabel, IMAGE_FALLBACKS.scenic);
}

export function getHotelImage(hotel) {
  const remoteImageUrl = hotel?.hotelImageUrl ?? hotel?.imageUrl;

  if (isRemoteImageUrl(remoteImageUrl)) {
    return remoteImageUrl;
  }

  return (
    getManifestImageForQuery(
      `${hotel?.hotelName ?? hotel?.name ?? ""} ${
        hotel?.hotelAddress ?? hotel?.location ?? ""
      }`,
      {
      category: "hotel",
      }
    ) ?? IMAGE_FALLBACKS.hotel
  );
}

export function getPlaceImage(place) {
  if (isRemoteImageUrl(place?.placeImageUrl)) {
    return place.placeImageUrl;
  }

  const firstCategory = String(place?.category ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .find(Boolean);

  return (
    getManifestImageForQuery(`${place?.placeName ?? ""} ${place?.category ?? ""}`, {
      category: firstCategory || "place",
    }) ?? getCategoryFallback(firstCategory || "place")
  );
}

export function getRestaurantImage(restaurant) {
  if (isRemoteImageUrl(restaurant?.imageUrl)) {
    return restaurant.imageUrl;
  }

  return (
    getManifestImageForQuery(
      `${restaurant?.name ?? ""} ${restaurant?.location ?? ""} ${restaurant?.typeLabel ?? ""}`,
      {
        category: "restaurant",
      }
    ) ?? IMAGE_FALLBACKS.restaurant
  );
}
