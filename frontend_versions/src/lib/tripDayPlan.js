import {
  calculateGreatCircleDistanceMeters,
  formatCityMapDistance,
} from "./cityItineraryMap.js";
import { normalizeGeoCoordinates, resolveGoogleMapsUrl } from "./maps.js";

function normalizeText(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed || fallback;
}

function resolveDayNumber(day = {}, index = 0) {
  return Number.parseInt(day?.dayNumber ?? day?.day, 10) || index + 1;
}

function normalizePlace(place = {}, destination = "", dayNumber = 1, index = 0) {
  const geoCoordinates = normalizeGeoCoordinates(place?.geoCoordinates);
  const isResolved =
    geoCoordinates.latitude !== null && geoCoordinates.longitude !== null;
  const placeName = normalizeText(place?.placeName ?? place?.name, "Recommended stop");

  return {
    id: normalizeText(
      place?.id,
      `${dayNumber}-${index}-${placeName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`
    ),
    index: index + 1,
    dayNumber,
    placeName,
    placeDetails: normalizeText(place?.placeDetails ?? place?.description),
    location: normalizeText(place?.location, destination),
    geoCoordinates,
    mapsUrl: resolveGoogleMapsUrl({
      mapsUrl: place?.mapsUrl ?? place?.googleMapsUri,
      name: placeName,
      location: place?.location,
      destination,
      coordinates: geoCoordinates,
    }),
    isResolved,
  };
}

function buildPlaceLegDistances(places = []) {
  const resolvedPlaces = places.filter((place) => place.isResolved);
  const legDistances = [];

  for (let index = 1; index < resolvedPlaces.length; index += 1) {
    const fromPlace = resolvedPlaces[index - 1];
    const toPlace = resolvedPlaces[index];
    const distanceMeters = calculateGreatCircleDistanceMeters(
      fromPlace.geoCoordinates,
      toPlace.geoCoordinates
    );

    legDistances.push({
      id: `${fromPlace.id}-${toPlace.id}`,
      fromPlace,
      toPlace,
      distanceMeters,
      distanceLabel: formatCityMapDistance(distanceMeters),
    });
  }

  return legDistances;
}

function buildStructuredDayPlan({
  structuredDay = {},
  itineraryDay = {},
  destination = "",
  index = 0,
}) {
  const dayNumber = resolveDayNumber(structuredDay, index);
  const places = (Array.isArray(itineraryDay?.places) ? itineraryDay.places : []).map(
    (place, placeIndex) => normalizePlace(place, destination, dayNumber, placeIndex)
  );
  const legDistances = buildPlaceLegDistances(places);
  const totalDistanceMeters = legDistances.reduce((total, leg) => {
    return Number.isFinite(leg.distanceMeters) ? total + leg.distanceMeters : total;
  }, 0);

  return {
    dayNumber,
    title: normalizeText(structuredDay?.title, `Day ${dayNumber}`),
    estimatedCost: normalizeText(structuredDay?.estimatedCost),
    tips: normalizeText(structuredDay?.tips),
    activities: (Array.isArray(structuredDay?.activities)
      ? structuredDay.activities
      : []
    )
      .map((activity) => normalizeText(activity))
      .filter(Boolean),
    places,
    legDistances,
    totalDistanceMeters,
  };
}

function buildItineraryOnlyDayPlan({ itineraryDay = {}, destination = "", index = 0 }) {
  const dayNumber = resolveDayNumber(itineraryDay, index);
  const places = (Array.isArray(itineraryDay?.places) ? itineraryDay.places : []).map(
    (place, placeIndex) => normalizePlace(place, destination, dayNumber, placeIndex)
  );
  const legDistances = buildPlaceLegDistances(places);
  const totalDistanceMeters = legDistances.reduce((total, leg) => {
    return Number.isFinite(leg.distanceMeters) ? total + leg.distanceMeters : total;
  }, 0);

  return {
    dayNumber,
    title: normalizeText(itineraryDay?.title, `Day ${dayNumber}`),
    estimatedCost: "",
    tips: "",
    activities: [],
    places,
    legDistances,
    totalDistanceMeters,
  };
}

export function buildTripDayPlans(trip = {}) {
  const destination = normalizeText(
    trip?.userSelection?.location?.label ?? trip?.aiPlan?.destination
  );
  const structuredDays = Array.isArray(trip?.aiPlan?.days) ? trip.aiPlan.days : [];
  const itineraryDays = Array.isArray(trip?.itinerary?.days) ? trip.itinerary.days : [];
  const itineraryDayByNumber = new Map(
    itineraryDays.map((day, index) => [resolveDayNumber(day, index), day])
  );

  if (structuredDays.length > 0) {
    return structuredDays.map((structuredDay, index) => {
      const dayNumber = resolveDayNumber(structuredDay, index);
      const itineraryDay =
        itineraryDayByNumber.get(dayNumber) ?? itineraryDays[index] ?? {};

      return buildStructuredDayPlan({
        structuredDay,
        itineraryDay,
        destination,
        index,
      });
    });
  }

  return itineraryDays.map((itineraryDay, index) =>
    buildItineraryOnlyDayPlan({
      itineraryDay,
      destination,
      index,
    })
  );
}

export function summarizeTripDayPlans(dayPlans = []) {
  return dayPlans.reduce(
    (summary, dayPlan) => {
      return {
        totalDays: summary.totalDays + 1,
        totalActivities: summary.totalActivities + dayPlan.activities.length,
        totalPlaces: summary.totalPlaces + dayPlan.places.length,
        totalResolvedPlaces:
          summary.totalResolvedPlaces +
          dayPlan.places.filter((place) => place.isResolved).length,
        totalDistanceMeters:
          summary.totalDistanceMeters +
          (Number.isFinite(dayPlan.totalDistanceMeters)
            ? dayPlan.totalDistanceMeters
            : 0),
      };
    },
    {
      totalDays: 0,
      totalActivities: 0,
      totalPlaces: 0,
      totalResolvedPlaces: 0,
      totalDistanceMeters: 0,
    }
  );
}
