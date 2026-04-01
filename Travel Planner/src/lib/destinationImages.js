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
  if (isRemoteImageUrl(hotel?.hotelImageUrl)) {
    return hotel.hotelImageUrl;
  }

  return (
    getManifestImageForQuery(`${hotel?.hotelName ?? ""} ${hotel?.hotelAddress ?? ""}`, {
      category: "hotel",
    }) ?? IMAGE_FALLBACKS.hotel
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
