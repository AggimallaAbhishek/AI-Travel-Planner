import { randomUUID } from "node:crypto";
import {
  buildStoredTrip,
  getTripDisruptionErrors,
  getUserSelectionErrors,
  normalizeTripDisruptions,
  normalizeStoredTrip,
  normalizeUserSelection,
  sortTripsNewestFirst,
} from "../../shared/trips.js";
import { getAdminDb } from "../lib/firebaseAdmin.js";
import { generateTripPlan } from "./gemini.js";
import {
  applyDeterministicTripRepairs,
  buildRepairDiff,
  evaluateTripConstraints,
} from "./constraints.js";
import { enrichTripWithPersistedGeocodes } from "./tripMapEnrichment.js";

const COLLECTION_NAME = "AITrips";

function getTripsCollection() {
  return getAdminDb().collection(COLLECTION_NAME);
}

function getErrorText(error) {
  if (!error) {
    return "";
  }

  if (error instanceof Error) {
    return error.message ?? "";
  }

  return String(error);
}

export function resolveTripPersistenceFailure(error) {
  const errorText = getErrorText(error).toLowerCase();
  const errorCode = String(error?.code ?? "").toLowerCase();
  const projectId = process.env.FIREBASE_PROJECT_ID ?? "configured Firebase project";

  if (
    errorText.includes("5 not_found") ||
    errorText.includes("not_found") ||
    errorCode === "5" ||
    errorCode.includes("not-found")
  ) {
    const wrappedError = new Error(
      `Firestore database was not found for project ${projectId}. Create Firestore in Native mode or verify FIREBASE_PROJECT_ID points to the correct Firebase project.`
    );
    wrappedError.code = "firestore/database-not-found";
    wrappedError.cause = error;
    return wrappedError;
  }

  return error;
}

function isTripOwnedByUser(trip, user) {
  if (trip.ownerId) {
    return trip.ownerId === user.uid;
  }

  return Boolean(user.email && trip.ownerEmail === user.email);
}

async function backfillLegacyOwnership(docRef, user) {
  await docRef.set(
    {
      ownerId: user.uid,
      ownerEmail: user.email ?? "",
    },
    { merge: true }
  );
}

export function validateTripRequest(body = {}) {
  const userSelection = normalizeUserSelection(body.userSelection ?? body);
  const errors = getUserSelectionErrors(userSelection);

  return { userSelection, errors };
}

export async function createTripForUser({ user, userSelection }) {
  const tripId = randomUUID();
  const buildAndPersistTrip = async (payload) => {
    let trip = buildStoredTrip({
      id: tripId,
      ownerId: user.uid,
      ownerEmail: user.email ?? "",
      userSelection,
      ...payload,
    });

    try {
      const enrichmentResult = await enrichTripWithPersistedGeocodes({ trip });
      trip = enrichmentResult.trip;
      console.info("[trips] Trip map enrichment completed", {
        tripId: trip.id,
        geocodedStopCount: enrichmentResult.stats.geocodedStopCount,
        unresolvedStopCount: enrichmentResult.stats.unresolvedStopCount,
        status: enrichmentResult.stats.status,
        hasPlacesKey: enrichmentResult.stats.hasPlacesKey,
        hasCityBounds: enrichmentResult.stats.hasCityBounds,
      });
    } catch (error) {
      console.warn("[trips] Trip map enrichment failed, persisting partial trip", {
        tripId,
        message: error instanceof Error ? error.message : String(error),
      });
    }

    const docRef = getTripsCollection().doc(trip.id);
    const persistStartedAt = Date.now();
    await docRef.set(trip);
    const persistMs = Date.now() - persistStartedAt;

    if (payload?.latencyBreakdownMs) {
      trip.latencyBreakdownMs = {
        ...trip.latencyBreakdownMs,
        persist: persistMs,
      };

      try {
        await docRef.set(
          {
            latencyBreakdownMs: trip.latencyBreakdownMs,
          },
          { merge: true }
        );
      } catch (error) {
        console.warn("[trips] Failed to persist latency breakdown update", {
          tripId: trip.id,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return trip;
  };

  const generatedTrip = await generateTripPlan(userSelection);
  return buildAndPersistTrip({
    generatedTrip,
    llmArtifacts: generatedTrip.llmArtifacts,
    optimizationMeta: generatedTrip.optimizationMeta,
    constraintReport: generatedTrip.constraintReport,
    sourceProvenance: generatedTrip.sourceProvenance,
    latencyBreakdownMs: generatedTrip.latencyBreakdownMs,
    routeAlternatives: generatedTrip.routeAlternatives,
  });
}

export async function persistTripMapEnrichment({
  tripId,
  itinerary,
  mapEnrichment,
  updatedAt = new Date().toISOString(),
}) {
  const docRef = getTripsCollection().doc(tripId);

  await docRef.set(
    {
      itinerary,
      mapEnrichment,
      updatedAt,
    },
    { merge: true }
  );
}

export async function backfillTripMapEnrichment({
  trip,
  enrichFn = enrichTripWithPersistedGeocodes,
  persistFn = persistTripMapEnrichment,
  logContext = "trip detail",
} = {}) {
  if (!trip || typeof trip !== "object") {
    return {
      trip,
      changed: false,
      stats: {
        geocodedStopCount: 0,
        unresolvedStopCount: 0,
        status: "missing",
        hasPlacesKey: false,
        hasCityBounds: false,
        worldPoiIndexHits: 0,
        liveLookupCount: 0,
      },
    };
  }

  const enrichmentResult = await enrichFn({ trip });

  if (enrichmentResult.changed) {
    await persistFn({
      tripId: enrichmentResult.trip.id,
      itinerary: enrichmentResult.trip.itinerary,
      mapEnrichment: enrichmentResult.trip.mapEnrichment,
    });

    console.info("[trips] Auto-backfilled trip map enrichment", {
      tripId: enrichmentResult.trip.id,
      geocodedStopCount: enrichmentResult.stats.geocodedStopCount,
      unresolvedStopCount: enrichmentResult.stats.unresolvedStopCount,
      status: enrichmentResult.stats.status,
      logContext,
    });
  }

  return enrichmentResult;
}

function removeActivityFromDay(day = {}, disruption = {}) {
  const normalizedTarget = String(disruption.placeName ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

  if (!normalizedTarget) {
    return day;
  }

  const nextActivities = Array.isArray(day.activities)
    ? day.activities.filter(
        (activity) => !String(activity).toLowerCase().includes(normalizedTarget)
      )
    : [];

  return {
    ...day,
    activities: nextActivities,
  };
}

function removeItineraryPlaceFromDay(day = {}, disruption = {}) {
  const target = String(disruption.placeName ?? "").trim().toLowerCase();
  if (!target) {
    return day;
  }

  const places = Array.isArray(day.places) ? day.places : [];
  return {
    ...day,
    places: places.filter(
      (place) =>
        !String(place?.placeName ?? place?.name ?? "")
          .toLowerCase()
          .includes(target)
    ),
  };
}

function applyDisruptionsToTrip({
  trip,
  disruptions,
}) {
  const aiPlanDays = Array.isArray(trip?.aiPlan?.days) ? trip.aiPlan.days : [];
  const itineraryDays = Array.isArray(trip?.itinerary?.days)
    ? trip.itinerary.days
    : [];
  const byDayDisruptions = new Map();

  for (const disruption of disruptions) {
    const dayNumber = Number.parseInt(disruption.dayNumber, 10);
    const dayEvents = byDayDisruptions.get(dayNumber) ?? [];
    dayEvents.push(disruption);
    byDayDisruptions.set(dayNumber, dayEvents);
  }

  const nextAiPlanDays = aiPlanDays.map((day) => {
    const dayEvents = byDayDisruptions.get(day.day) ?? [];
    let nextDay = { ...day };

    for (const event of dayEvents) {
      if (event.type === "weather_change") {
        nextDay = {
          ...nextDay,
          tips: `${nextDay.tips ? `${nextDay.tips} ` : ""}Weather conditions changed; prioritize indoor options and flexible transport.`,
        };
      } else if (event.type === "traffic_delay") {
        nextDay = {
          ...nextDay,
          tips: `${nextDay.tips ? `${nextDay.tips} ` : ""}Traffic disruption detected; keep extra transfer buffer for this day.`,
        };
      } else {
        nextDay = removeActivityFromDay(nextDay, event);
      }
    }

    return nextDay;
  });

  const nextItineraryDays = itineraryDays.map((day) => {
    const dayEvents = byDayDisruptions.get(day.dayNumber) ?? [];
    let nextDay = { ...day };

    for (const event of dayEvents) {
      if (event.type === "poi_closed" || event.type === "user_skip") {
        nextDay = removeItineraryPlaceFromDay(nextDay, event);
      }
    }

    return nextDay;
  });

  return {
    ...trip,
    aiPlan: {
      ...trip.aiPlan,
      days: nextAiPlanDays,
    },
    itinerary: {
      days: nextItineraryDays,
    },
  };
}

export function validateReplanRequest(body = {}) {
  const disruptions = normalizeTripDisruptions(
    body.disruptions ?? body.events ?? []
  );
  const errors = getTripDisruptionErrors(disruptions);

  if (disruptions.length === 0) {
    errors.push("At least one disruption event is required.");
  }

  return {
    disruptions,
    errors,
  };
}

export async function replanTripForUser({
  tripId,
  user,
  disruptions,
}) {
  const replanStartedAt = Date.now();
  const docRef = getTripsCollection().doc(tripId);
  const snapshot = await docRef.get();

  if (!snapshot.exists) {
    return null;
  }

  const existingTrip = normalizeStoredTrip({ id: snapshot.id, ...snapshot.data() });
  if (!isTripOwnedByUser(existingTrip, user)) {
    return "forbidden";
  }

  const disruptedTrip = applyDisruptionsToTrip({
    trip: existingTrip,
    disruptions,
  });
  const repairedTrip = applyDeterministicTripRepairs({
    generatedTrip: disruptedTrip,
    userSelection: existingTrip.userSelection,
  });
  const repairDiff = buildRepairDiff({
    beforeTrip: existingTrip,
    afterTrip: repairedTrip,
  });
  const constraintReport = evaluateTripConstraints({
    generatedTrip: repairedTrip,
    userSelection: existingTrip.userSelection,
  });
  const updatedAt = new Date().toISOString();
  const nextTrip = buildStoredTrip({
    id: existingTrip.id,
    ownerId: existingTrip.ownerId,
    ownerEmail: existingTrip.ownerEmail,
    userSelection: existingTrip.userSelection,
    generatedTrip: {
      ...repairedTrip,
      llmArtifacts: {
        ...(existingTrip.llmArtifacts ?? {}),
        replan_disruptions: disruptions,
        repair_diff: repairDiff,
      },
      constraintReport,
      sourceProvenance: existingTrip.sourceProvenance,
      latencyBreakdownMs: {
        ...(existingTrip.latencyBreakdownMs ?? {}),
        repair: Date.now() - replanStartedAt,
      },
      optimizationMeta: {
        ...(existingTrip.optimizationMeta ?? {}),
        generatedAt: updatedAt,
      },
      routeAlternatives: existingTrip.routeAlternatives ?? [],
    },
    createdAt: existingTrip.createdAt,
    updatedAt,
    llmArtifacts: {
      ...(existingTrip.llmArtifacts ?? {}),
      replan_disruptions: disruptions,
      repair_diff: repairDiff,
    },
    optimizationMeta: {
      ...(existingTrip.optimizationMeta ?? {}),
      generatedAt: updatedAt,
    },
    constraintReport,
    sourceProvenance: existingTrip.sourceProvenance,
    latencyBreakdownMs: existingTrip.latencyBreakdownMs,
    routeAlternatives: existingTrip.routeAlternatives ?? [],
  });

  await docRef.set(nextTrip);

  return {
    trip: nextTrip,
    replanSummary: {
      disruptionCount: disruptions.length,
      changed: repairDiff.changed,
      removedActivities: repairDiff.removedActivities,
      addedActivities: repairDiff.addedActivities,
      unchangedActivityCount: repairDiff.unchangedActivityCount,
      hardViolationCount: constraintReport.hardViolations.length,
      softViolationCount: constraintReport.softViolations.length,
      updatedAt,
    },
  };
}

export async function getTripForUser({ tripId, user }) {
  const docRef = getTripsCollection().doc(tripId);
  const snapshot = await docRef.get();

  if (!snapshot.exists) {
    return null;
  }

  const trip = normalizeStoredTrip(snapshot.data());

  if (!isTripOwnedByUser(trip, user)) {
    return "forbidden";
  }

  if (!trip.ownerId) {
    await backfillLegacyOwnership(docRef, user);
    trip.ownerId = user.uid;
    trip.ownerEmail = user.email ?? "";
  }

  return trip;
}

export async function listTripsForUser(user) {
  const collection = getTripsCollection();
  const queries = [collection.where("ownerId", "==", user.uid).get()];

  if (user.email) {
    queries.push(collection.where("ownerEmail", "==", user.email).get());
    queries.push(collection.where("userEmail", "==", user.email).get());
  }

  const snapshots = await Promise.all(queries);
  const tripsById = new Map();

  for (const snapshot of snapshots) {
    snapshot.forEach((doc) => {
      const trip = normalizeStoredTrip({ id: doc.id, ...doc.data() });

      if (!isTripOwnedByUser(trip, user)) {
        return;
      }

      tripsById.set(trip.id, trip);

      if (!trip.ownerId) {
        backfillLegacyOwnership(doc.ref, user).catch((error) => {
          console.error("[trips] Failed to backfill owner metadata", error);
        });
      }
    });
  }

  return sortTripsNewestFirst([...tripsById.values()]);
}
