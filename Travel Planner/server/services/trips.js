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
const DEFAULT_FIRESTORE_TRIP_SOFT_LIMIT_BYTES = 850_000;
const DEFAULT_PERSISTED_TEXT_PREVIEW_CHARS = 12_000;
const DEFAULT_PERSISTED_ARRAY_ITEMS = 24;

function shouldEnrichTripMapOnCreate() {
  return String(process.env.ENRICH_TRIP_MAP_ON_CREATE ?? "")
    .trim()
    .toLowerCase() === "true";
}

function getTripsCollection() {
  try {
    return getAdminDb().collection(COLLECTION_NAME);
  } catch (error) {
    throw resolveTripPersistenceFailure(error);
  }
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

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getFirestoreTripSoftLimitBytes() {
  return parsePositiveInteger(
    process.env.FIRESTORE_TRIP_SOFT_LIMIT_BYTES,
    DEFAULT_FIRESTORE_TRIP_SOFT_LIMIT_BYTES
  );
}

function truncateText(value, maxChars = DEFAULT_PERSISTED_TEXT_PREVIEW_CHARS) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) {
    return "";
  }

  if (text.length <= maxChars) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxChars - 14))}… [truncated]`;
}

function cloneSerializable(value, fallback = null) {
  if (value === undefined) {
    return fallback;
  }

  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_error) {
    return fallback;
  }
}

function summarizeSerializableValue(
  value,
  {
    maxDepth = 4,
    maxArrayItems = DEFAULT_PERSISTED_ARRAY_ITEMS,
    maxObjectKeys = DEFAULT_PERSISTED_ARRAY_ITEMS,
    maxStringLength = 1_000,
  } = {}
) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    return truncateText(value, maxStringLength);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (maxDepth <= 0) {
    return Array.isArray(value)
      ? `[Array(${value.length})]`
      : "[Object truncated]";
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, maxArrayItems)
      .map((item) =>
        summarizeSerializableValue(item, {
          maxDepth: maxDepth - 1,
          maxArrayItems,
          maxObjectKeys,
          maxStringLength,
        })
      )
      .filter((item) => item !== undefined);
  }

  if (typeof value === "object") {
    const result = {};

    for (const [key, entry] of Object.entries(value).slice(0, maxObjectKeys)) {
      const summarized = summarizeSerializableValue(entry, {
        maxDepth: maxDepth - 1,
        maxArrayItems,
        maxObjectKeys,
        maxStringLength,
      });

      if (summarized !== undefined) {
        result[key] = summarized;
      }
    }

    return result;
  }

  return String(value);
}

function summarizeLowConfidenceActivities(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.slice(0, DEFAULT_PERSISTED_ARRAY_ITEMS).map((activity) => ({
    name: truncateText(activity?.name ?? "", 140),
    dayNumber:
      Number.isFinite(Number(activity?.dayNumber)) && Number(activity.dayNumber) > 0
        ? Number(activity.dayNumber)
        : null,
    confidence: Number.isFinite(Number(activity?.confidence))
      ? Number(activity.confidence)
      : null,
    rationale: truncateText(activity?.rationale ?? "", 280),
  }));
}

function summarizeLlmArtifacts(value = {}, { minimal = false } = {}) {
  const source = value && typeof value === "object" ? value : {};
  const plannerOutputKey = Object.prototype.hasOwnProperty.call(source, "planner_output")
    ? "planner_output"
    : null;
  const nextArtifacts = {
    ...(plannerOutputKey
      ? {
          planner_output: truncateText(
            typeof source.planner_output === "string"
              ? source.planner_output
              : JSON.stringify(cloneSerializable(source.planner_output, null)),
            minimal ? 2_000 : DEFAULT_PERSISTED_TEXT_PREVIEW_CHARS
          ),
        }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(source, "critic_report")
      ? {
          critic_report: summarizeSerializableValue(source.critic_report, {
            maxDepth: minimal ? 2 : 4,
            maxArrayItems: minimal ? 8 : 16,
            maxObjectKeys: minimal ? 8 : 16,
            maxStringLength: minimal ? 240 : 800,
          }),
        }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(source, "repair_diff")
      ? {
          repair_diff: summarizeSerializableValue(source.repair_diff, {
            maxDepth: minimal ? 2 : 4,
            maxArrayItems: minimal ? 8 : 20,
            maxObjectKeys: minimal ? 8 : 20,
            maxStringLength: minimal ? 200 : 600,
          }),
        }
      : {}),
    ...(Object.prototype.hasOwnProperty.call(source, "low_confidence_activities")
      ? {
          low_confidence_activities: summarizeLowConfidenceActivities(
            source.low_confidence_activities
          ),
        }
      : {}),
  };

  for (const [key, entry] of Object.entries(source)) {
    if (Object.prototype.hasOwnProperty.call(nextArtifacts, key)) {
      continue;
    }

    nextArtifacts[key] = summarizeSerializableValue(entry, {
      maxDepth: minimal ? 2 : 3,
      maxArrayItems: minimal ? 6 : 12,
      maxObjectKeys: minimal ? 6 : 12,
      maxStringLength: minimal ? 160 : 400,
    });
  }

  return nextArtifacts;
}

function summarizeRouteAlternatives(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(0, 3)
    .map((alternative) =>
      summarizeSerializableValue(alternative, {
        maxDepth: 4,
        maxArrayItems: 12,
        maxObjectKeys: 18,
        maxStringLength: 600,
      })
    )
    .filter(Boolean);
}

function getJsonByteLength(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch (_error) {
    return Number.POSITIVE_INFINITY;
  }
}

export function buildPersistableTripForFirestore(trip) {
  const softLimitBytes = getFirestoreTripSoftLimitBytes();
  let persistedTrip = {
    ...trip,
    llmArtifacts: summarizeLlmArtifacts(trip?.llmArtifacts),
    routeAlternatives: summarizeRouteAlternatives(trip?.routeAlternatives),
  };
  let sizeBytes = getJsonByteLength(persistedTrip);

  if (sizeBytes <= softLimitBytes) {
    return {
      trip: persistedTrip,
      trimmed: false,
      trimStage: null,
      sizeBytes,
    };
  }

  persistedTrip = {
    ...persistedTrip,
    llmArtifacts: summarizeLlmArtifacts(trip?.llmArtifacts, {
      minimal: true,
    }),
    routeAlternatives: [],
  };
  sizeBytes = getJsonByteLength(persistedTrip);

  if (sizeBytes <= softLimitBytes) {
    return {
      trip: persistedTrip,
      trimmed: true,
      trimStage: "minimal_artifacts",
      sizeBytes,
    };
  }

  persistedTrip = {
    ...persistedTrip,
    llmArtifacts: {
      persisted: false,
      omittedReason: "trimmed_for_firestore_limit",
    },
    routeAlternatives: [],
  };
  sizeBytes = getJsonByteLength(persistedTrip);

  return {
    trip: persistedTrip,
    trimmed: true,
    trimStage: "omit_artifacts",
    sizeBytes,
  };
}

function wrapTripStageFailure(error, code, stage) {
  const wrappedError = error instanceof Error ? error : new Error(String(error));

  if (!wrappedError.code) {
    wrappedError.code = code;
  }

  if (!wrappedError.stage) {
    wrappedError.stage = stage;
  }

  return wrappedError;
}

export function resolveTripPersistenceFailure(error) {
  const errorText = getErrorText(error).toLowerCase();
  const errorCode = String(error?.code ?? "").toLowerCase();
  const projectId = process.env.FIREBASE_PROJECT_ID ?? "configured Firebase project";

  if (
    errorText.includes("request payload size exceeds") ||
    errorText.includes("document exceeds the maximum allowed size") ||
    errorText.includes("maximum allowed size") ||
    errorText.includes("transaction too large") ||
    errorCode.includes("resource-exhausted")
  ) {
    const wrappedError = new Error(
      "Trip payload exceeded the Firestore document size limit. Reduce persisted artifacts before retrying."
    );
    wrappedError.code = "firestore/document-too-large";
    wrappedError.cause = error;
    return wrappedError;
  }

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
  try {
    await docRef.set(
      {
        ownerId: user.uid,
        ownerEmail: user.email ?? "",
      },
      { merge: true }
    );
  } catch (error) {
    throw resolveTripPersistenceFailure(error);
  }
}

export function validateTripRequest(body = {}) {
  const userSelection = normalizeUserSelection(body.userSelection ?? body);
  const errors = getUserSelectionErrors(userSelection);

  return { userSelection, errors };
}

export async function createTripForUser({ user, userSelection }) {
  const tripId = randomUUID();
  const enrichMapOnCreate = shouldEnrichTripMapOnCreate();
  const buildAndPersistTrip = async (payload) => {
    let trip = buildStoredTrip({
      id: tripId,
      ownerId: user.uid,
      ownerEmail: user.email ?? "",
      userSelection,
      ...payload,
    });

    if (enrichMapOnCreate) {
      try {
        const enrichmentResult = await enrichTripWithPersistedGeocodes({ trip });
        trip = enrichmentResult.trip;
        console.info("[trips] Trip map enrichment completed during create", {
          tripId: trip.id,
          geocodedStopCount: enrichmentResult.stats.geocodedStopCount,
          unresolvedStopCount: enrichmentResult.stats.unresolvedStopCount,
          status: enrichmentResult.stats.status,
          hasPlacesKey: enrichmentResult.stats.hasPlacesKey,
          hasCityBounds: enrichmentResult.stats.hasCityBounds,
        });
      } catch (error) {
        console.warn("[trips] Trip map enrichment failed during create, persisting partial trip", {
          tripId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    } else {
      console.info("[trips] Deferring trip map enrichment until follow-up reads", {
        tripId,
      });
    }

    const docRef = getTripsCollection().doc(trip.id);
    const persistableTrip = buildPersistableTripForFirestore(trip);
    if (persistableTrip.trimmed) {
      console.warn("[trips] Trimmed trip payload before Firestore persistence", {
        tripId: trip.id,
        trimStage: persistableTrip.trimStage,
        sizeBytes: persistableTrip.sizeBytes,
      });
    }
    const persistStartedAt = Date.now();
    try {
      await docRef.set(persistableTrip.trip);
    } catch (error) {
      throw resolveTripPersistenceFailure(error);
    }
    const persistMs = Date.now() - persistStartedAt;
    trip = persistableTrip.trip;

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

  let generatedTrip;

  try {
    generatedTrip = await generateTripPlan(userSelection);
  } catch (error) {
    throw wrapTripStageFailure(error, "trip/generation-failed", "generation");
  }

  try {
    return await buildAndPersistTrip({
      generatedTrip,
      llmArtifacts: generatedTrip.llmArtifacts,
      optimizationMeta: generatedTrip.optimizationMeta,
      constraintReport: generatedTrip.constraintReport,
      sourceProvenance: generatedTrip.sourceProvenance,
      latencyBreakdownMs: generatedTrip.latencyBreakdownMs,
      routeAlternatives: generatedTrip.routeAlternatives,
    });
  } catch (error) {
    throw wrapTripStageFailure(error, "trip/persistence-failed", "persistence");
  }
}

export async function persistTripMapEnrichment({
  tripId,
  itinerary,
  mapEnrichment,
  updatedAt = new Date().toISOString(),
}) {
  const docRef = getTripsCollection().doc(tripId);

  try {
    await docRef.set(
      {
        itinerary,
        mapEnrichment,
        updatedAt,
      },
      { merge: true }
    );
  } catch (error) {
    throw resolveTripPersistenceFailure(error);
  }
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

  const persistableTrip = buildPersistableTripForFirestore(nextTrip);
  if (persistableTrip.trimmed) {
    console.warn("[trips] Trimmed replanned trip payload before Firestore persistence", {
      tripId,
      trimStage: persistableTrip.trimStage,
      sizeBytes: persistableTrip.sizeBytes,
    });
  }

  await docRef.set(persistableTrip.trip);

  return {
    trip: persistableTrip.trip,
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
