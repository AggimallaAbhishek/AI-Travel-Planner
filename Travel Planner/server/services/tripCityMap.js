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

function isPointWithinBounds(coordinates = {}, bounds = null) {
  if (!bounds) {
    return true;
  }

  const point = normalizeGeoCoordinates(coordinates);
  if (point.latitude === null || point.longitude === null) {
    return false;
  }

  return (
    point.latitude <= bounds.north &&
    point.latitude >= bounds.south &&
    point.longitude <= bounds.east &&
    point.longitude >= bounds.west
  );
}

function normalizeOutlinePolygons(outline = null) {
  const polygons = Array.isArray(outline?.polygons) ? outline.polygons : [];

  return polygons
    .map((polygon) =>
      (Array.isArray(polygon) ? polygon : [])
        .map((point) => normalizeGeoCoordinates(point))
        .filter(
          (point) =>
            point.latitude !== null && point.longitude !== null
        )
    )
    .filter((polygon) => polygon.length >= 3);
}

function isPointInsidePolygon(point, polygon = []) {
  let inside = false;

  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const currentPoint = polygon[index];
    const previousPoint = polygon[previous];
    const longitudeCrosses =
      currentPoint.longitude > point.longitude !==
      previousPoint.longitude > point.longitude;

    if (!longitudeCrosses) {
      continue;
    }

    const projectedLatitude =
      ((previousPoint.latitude - currentPoint.latitude) *
        (point.longitude - currentPoint.longitude)) /
        (previousPoint.longitude - currentPoint.longitude) +
      currentPoint.latitude;

    if (point.latitude < projectedLatitude) {
      inside = !inside;
    }
  }

  return inside;
}

function isPointInsideOutline(coordinates = {}, outline = null) {
  const point = normalizeGeoCoordinates(coordinates);
  if (point.latitude === null || point.longitude === null) {
    return false;
  }

  const polygons = normalizeOutlinePolygons(outline);
  if (polygons.length === 0) {
    return false;
  }

  return polygons.some((polygon) => isPointInsidePolygon(point, polygon));
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
  const cityBounds = trip?.mapEnrichment?.cityBounds ?? basemap?.cityBounds ?? null;
  const outline = basemap?.outline ?? null;
  const markerDaysSource =
    Array.isArray(trip?.mapEnrichment?.markerDays) &&
    trip.mapEnrichment.markerDays.length > 0
      ? trip.mapEnrichment.markerDays
      : Array.isArray(trip?.itinerary?.days)
        ? trip.itinerary.days
        : [];
  const rawDays = markerDaysSource.map((day, index) =>
    normalizeDayPlaces(day, destination, index)
  );
  const days = rawDays.map((day) => ({
    ...day,
    places: day.places.map((place) => {
      const isPinned =
        place.isResolved &&
        isPointWithinBounds(place.geoCoordinates, cityBounds) &&
        (outline ? isPointInsideOutline(place.geoCoordinates, outline) : true);

      return {
        ...place,
        isPinned,
      };
    }),
  }));
  const places = days.flatMap((day) => day.places);
  const markers = places.filter((place) => place.isPinned);
  const unresolvedPlaces = places.filter((place) => !place.isPinned);

  return {
    destination,
    cityBounds,
    basemap,
    outline,
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
