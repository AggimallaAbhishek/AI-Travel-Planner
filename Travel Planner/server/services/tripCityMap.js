import { normalizeGeoCoordinates, resolveGoogleMapsUrl } from "../../shared/maps.js";

function normalizeText(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed || fallback;
}

function getDestinationLabel(trip = {}) {
  return normalizeText(
    trip?.userSelection?.location?.label ?? trip?.aiPlan?.destination,
    "Selected destination"
  );
}

function buildDayTitle(day = {}, index) {
  return normalizeText(day?.title ?? day?.theme, `Day ${index + 1}`);
}

function normalizeDayPlaces(day = {}, destination = "", index = 0) {
  const dayNumber = Number.parseInt(day?.dayNumber ?? day?.day, 10) || index + 1;
  const dayTitle = buildDayTitle(day, index);
  const places = Array.isArray(day?.places) ? day.places : [];

  return {
    dayNumber,
    title: dayTitle,
    places: places.map((place, placeIndex) => {
      const coordinates = normalizeGeoCoordinates(place?.geoCoordinates);
      const isResolved =
        coordinates.latitude !== null && coordinates.longitude !== null;

      return {
        id: `${dayNumber}-${placeIndex}-${normalizeText(place?.placeName ?? place?.name, "stop")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")}`,
        dayNumber,
        dayTitle,
        placeName: normalizeText(place?.placeName ?? place?.name, "Recommended stop"),
        placeDetails: normalizeText(place?.placeDetails ?? place?.description),
        location: normalizeText(place?.location, destination),
        geoCoordinates: coordinates,
        mapsUrl: resolveGoogleMapsUrl({
          mapsUrl: place?.mapsUrl,
          name: place?.placeName ?? place?.name,
          location: place?.location,
          destination,
          coordinates,
        }),
        geocodeStatus: normalizeText(
          place?.geocodeStatus,
          isResolved ? "resolved" : "unresolved"
        ),
        geocodeSource: normalizeText(place?.geocodeSource),
        geocodedAt: normalizeText(place?.geocodedAt),
        isResolved,
        category: normalizeText(place?.category),
      };
    }),
  };
}

export function buildTripCityMapPayload({
  trip,
  basemap = null,
} = {}) {
  const destination = getDestinationLabel(trip);
  const markerDaysSource =
    Array.isArray(trip?.mapEnrichment?.markerDays) &&
    trip.mapEnrichment.markerDays.length > 0
      ? trip.mapEnrichment.markerDays
      : Array.isArray(trip?.itinerary?.days)
        ? trip.itinerary.days
        : [];
  const days = markerDaysSource.map((day, index) =>
    normalizeDayPlaces(day, destination, index)
  );
  const places = days.flatMap((day) => day.places);
  const markers = places.filter((place) => place.isResolved);
  const unresolvedPlaces = places.filter((place) => !place.isResolved);

  return {
    destination,
    cityBounds: trip?.mapEnrichment?.cityBounds ?? basemap?.cityBounds ?? null,
    basemap,
    dayCount: days.length,
    mappedPlaceCount: markers.length,
    unresolvedPlaceCount: unresolvedPlaces.length,
    days,
    markers: markers.map((place) => ({
      id: place.id,
      name: place.placeName,
      dayNumber: place.dayNumber,
      dayTitle: place.dayTitle,
      location: place.location,
      coordinates: place.geoCoordinates,
      mapsUrl: place.mapsUrl,
      status: place.geocodeStatus,
    })),
    generatedAt: new Date().toISOString(),
  };
}
