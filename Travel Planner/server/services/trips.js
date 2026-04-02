import { randomUUID } from "node:crypto";
import {
  buildFallbackGeneratedTrip,
  buildStoredTrip,
  getUserSelectionErrors,
  normalizeStoredTrip,
  sortTripsNewestFirst,
} from "../../shared/trips.js";
import { getAdminDb } from "../lib/firebaseAdmin.js";
import { buildDataDrivenTripPlan } from "./planningEngine.js";
import { normalizePlanningRequest } from "./planningRequest.js";

const COLLECTION_NAME = "AITrips";
const MEMORY_TRIP_STORE = new Map();
const DEFAULT_FIRESTORE_OPERATION_TIMEOUT_MS = 12_000;

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

function parseBoolean(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }

  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (!normalized) {
    return fallback;
  }

  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }

  return fallback;
}

export function resolveTripPlanningFallbackEnabled() {
  return parseBoolean(process.env.TRIP_PLANNING_FALLBACK_ENABLED, true);
}

export function resolveTripMemoryFallbackEnabled() {
  return parseBoolean(
    process.env.TRIP_MEMORY_FALLBACK_ENABLED,
    process.env.NODE_ENV !== "production"
  );
}

export function resolveFirestoreOperationTimeoutMs() {
  return parsePositiveInteger(
    process.env.FIRESTORE_OPERATION_TIMEOUT_MS,
    DEFAULT_FIRESTORE_OPERATION_TIMEOUT_MS
  );
}

function createFirestoreTimeoutError({ operationLabel = "operation", timeoutMs }) {
  const error = new Error(`Firestore ${operationLabel} timed out after ${timeoutMs}ms.`);
  error.code = "firestore/timeout";
  return error;
}

async function withFirestoreOperationTimeout(operationPromise, operationLabel) {
  const timeoutMs = resolveFirestoreOperationTimeoutMs();
  let timeoutId;
  try {
    return await Promise.race([
      operationPromise,
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(createFirestoreTimeoutError({ operationLabel, timeoutMs }));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export function buildPlanningFallbackResult({
  userSelection = {},
  planningRequest = {},
  error = null,
} = {}) {
  const fallbackGeneratedTrip = buildFallbackGeneratedTrip(userSelection);
  const destinationLabel =
    planningRequest?.destination ??
    userSelection?.location?.label ??
    "Unknown destination";
  const fallbackMessage =
    "Advanced planning services were unavailable, so a template itinerary was generated.";
  const warningDetails = getErrorText(error);

  return {
    generatedTrip: {
      ...fallbackGeneratedTrip,
      recommendations: {
        destination: destinationLabel,
        provider: "template_fallback",
        warning: fallbackMessage,
        hotels: [],
        restaurants: [],
      },
      routePlans: [],
      optimization: {
        objective: "fallback_template",
        algorithmVersion: "template-fallback-v1",
        cacheHit: false,
        totalWeight: 0,
        visitOrder: [],
        shortestPaths: [],
      },
    },
    groundedPlan: {},
    planningMeta: {
      dataProvider: "template_fallback",
      generatedAt: new Date().toISOString(),
      freshness: null,
      storageMode: "firestore_projection",
      recommendationProvider: "template_fallback",
      intentStatus: planningRequest?.isComplete ? "complete" : "incomplete",
      missingFields: Array.isArray(planningRequest?.missingFields)
        ? planningRequest.missingFields
        : [],
      validation: {
        status: "partial",
        narrativeSource: "template",
        warnings: [fallbackMessage],
      },
      fallbackReason: warningDetails,
    },
    optimization: {
      objective: "fallback_template",
      algorithmVersion: "template-fallback-v1",
      cacheHit: false,
      totalWeight: 0,
      visitOrder: [],
      shortestPaths: [],
    },
  };
}

function addMemoryPersistenceWarning(trip = {}) {
  const existingPlanningMeta =
    trip.planningMeta && typeof trip.planningMeta === "object"
      ? trip.planningMeta
      : {};
  const existingValidation =
    existingPlanningMeta.validation &&
    typeof existingPlanningMeta.validation === "object"
      ? existingPlanningMeta.validation
      : {};
  const existingWarnings = Array.isArray(existingValidation.warnings)
    ? existingValidation.warnings
    : [];
  const fallbackWarning =
    "Trip was stored in temporary server memory because Firestore was unavailable.";

  return {
    ...trip,
    planningMeta: {
      ...existingPlanningMeta,
      storageMode: "memory_fallback",
      validation: {
        ...existingValidation,
        warnings: [...new Set([...existingWarnings, fallbackWarning])],
      },
    },
  };
}

function saveTripToMemoryStore(trip = {}) {
  if (!trip?.id) {
    return;
  }

  const normalizedTrip = normalizeStoredTrip(trip);
  MEMORY_TRIP_STORE.set(normalizedTrip.id, normalizedTrip);
}

function getTripFromMemoryStore(tripId) {
  if (!tripId) {
    return null;
  }

  const stored = MEMORY_TRIP_STORE.get(tripId);
  if (!stored) {
    return null;
  }

  return normalizeStoredTrip(stored);
}

function listTripsFromMemoryStoreForUser(user) {
  const trips = [];

  for (const trip of MEMORY_TRIP_STORE.values()) {
    const normalizedTrip = normalizeStoredTrip(trip);
    if (isTripOwnedByUser(normalizedTrip, user)) {
      trips.push(normalizedTrip);
    }
  }

  return trips;
}

export function resolveTripPersistenceFailure(error) {
  const errorText = getErrorText(error).toLowerCase();
  const errorCode = String(error?.code ?? "").toLowerCase();
  const projectId = process.env.FIREBASE_PROJECT_ID ?? "configured Firebase project";

  if (
    errorCode.includes("firestore/timeout") ||
    errorCode.includes("deadline-exceeded") ||
    errorText.includes("deadline exceeded") ||
    errorText.includes("timed out")
  ) {
    const wrappedError = new Error(
      `Firestore request timed out for project ${projectId}. Check Firestore availability, network egress, and FIRESTORE_OPERATION_TIMEOUT_MS.`
    );
    wrappedError.code = "firestore/timeout";
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
  await withFirestoreOperationTimeout(
    docRef.set(
      {
        ownerId: user.uid,
        ownerEmail: user.email ?? "",
      },
      { merge: true }
    ),
    "ownership backfill write"
  );
}

export function validateTripRequest(body = {}) {
  const planningRequest = normalizePlanningRequest(body.userSelection ?? body);
  const userSelection = planningRequest.selection;
  const errors = getUserSelectionErrors(userSelection);

  return { userSelection, errors, planningRequest };
}

export async function createTripForUser({
  user,
  userSelection,
  planningRequest,
  traceId = "",
}) {
  const tripId = randomUUID();
  let dataDrivenPlan;

  try {
    dataDrivenPlan = await buildDataDrivenTripPlan({
      tripId,
      user,
      userSelection,
      planningRequest,
      traceId,
    });
  } catch (error) {
    console.error("[trips] Data-driven planning failed", {
      tripId,
      errorMessage: getErrorText(error),
      traceId: traceId || null,
    });

    if (!resolveTripPlanningFallbackEnabled()) {
      throw error;
    }

    dataDrivenPlan = buildPlanningFallbackResult({
      userSelection,
      planningRequest,
      error,
    });
  }

  const trip = buildStoredTrip({
    id: tripId,
    ownerId: user.uid,
    ownerEmail: user.email ?? "",
    userSelection,
    generatedTrip: dataDrivenPlan.generatedTrip,
    groundedPlan: dataDrivenPlan.groundedPlan,
    planningMeta: dataDrivenPlan.planningMeta,
    optimization: dataDrivenPlan.optimization,
    routePlans: dataDrivenPlan.generatedTrip.routePlans,
    recommendations: dataDrivenPlan.generatedTrip.recommendations,
  });

  try {
    console.info("[trips] Saving generated trip", {
      tripId: trip.id,
      projectId: process.env.FIREBASE_PROJECT_ID ?? null,
      collection: COLLECTION_NAME,
      traceId: traceId || null,
    });
    await withFirestoreOperationTimeout(
      getTripsCollection().doc(trip.id).set(trip),
      "trip write"
    );
    console.info("[trips] Generated trip saved", {
      tripId: trip.id,
      traceId: traceId || null,
    });
  } catch (error) {
    const resolvedError = resolveTripPersistenceFailure(error);
    console.error("[trips] Failed to save generated trip", {
      tripId: trip.id,
      projectId: process.env.FIREBASE_PROJECT_ID ?? null,
      collection: COLLECTION_NAME,
      errorMessage: getErrorText(error),
      errorCode: error?.code ?? null,
      resolvedMessage: getErrorText(resolvedError),
      traceId: traceId || null,
    });

    if (resolveTripMemoryFallbackEnabled()) {
      const memoryFallbackTrip = addMemoryPersistenceWarning(trip);
      saveTripToMemoryStore(memoryFallbackTrip);
      console.warn("[trips] Falling back to in-memory trip storage", {
        tripId: trip.id,
        traceId: traceId || null,
      });
      return memoryFallbackTrip;
    }

    throw resolvedError;
  }

  return trip;
}

export async function getTripForUser({ tripId, user }) {
  const docRef = getTripsCollection().doc(tripId);
  let snapshot;
  try {
    snapshot = await withFirestoreOperationTimeout(docRef.get(), "trip read");
  } catch (error) {
    if (!resolveTripMemoryFallbackEnabled()) {
      throw resolveTripPersistenceFailure(error);
    }

    console.warn("[trips] Firestore read failed; checking in-memory fallback", {
      tripId,
      errorMessage: getErrorText(error),
    });
    const fallbackTrip = getTripFromMemoryStore(tripId);
    if (!fallbackTrip) {
      return null;
    }
    if (!isTripOwnedByUser(fallbackTrip, user)) {
      return "forbidden";
    }
    return fallbackTrip;
  }

  if (!snapshot.exists) {
    if (resolveTripMemoryFallbackEnabled()) {
      const fallbackTrip = getTripFromMemoryStore(tripId);
      if (fallbackTrip) {
        if (!isTripOwnedByUser(fallbackTrip, user)) {
          return "forbidden";
        }
        return fallbackTrip;
      }
    }
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

  let snapshots = [];
  try {
    snapshots = await withFirestoreOperationTimeout(
      Promise.all(queries),
      "trip list query"
    );
  } catch (error) {
    if (!resolveTripMemoryFallbackEnabled()) {
      throw resolveTripPersistenceFailure(error);
    }
    console.warn("[trips] Firestore list failed; using in-memory fallback", {
      errorMessage: getErrorText(error),
      userId: user.uid,
    });
  }
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

  if (resolveTripMemoryFallbackEnabled()) {
    const memoryTrips = listTripsFromMemoryStoreForUser(user);
    for (const trip of memoryTrips) {
      tripsById.set(trip.id, trip);
    }
  }

  return sortTripsNewestFirst([...tripsById.values()]);
}
