import { randomUUID } from "node:crypto";
import {
  buildStoredTrip,
  getUserSelectionErrors,
  normalizeStoredTrip,
  normalizeUserSelection,
  sortTripsNewestFirst,
} from "../../shared/trips.js";
import { getAdminDb } from "../lib/firebaseAdmin.js";
import { buildDataDrivenTripPlan } from "./planningEngine.js";

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

export async function createTripForUser({ user, userSelection, traceId = "" }) {
  const tripId = randomUUID();
  const dataDrivenPlan = await buildDataDrivenTripPlan({
    tripId,
    user,
    userSelection,
    traceId,
  });
  const trip = buildStoredTrip({
    id: tripId,
    ownerId: user.uid,
    ownerEmail: user.email ?? "",
    userSelection,
    generatedTrip: dataDrivenPlan.generatedTrip,
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
    await getTripsCollection().doc(trip.id).set(trip);
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
    throw resolvedError;
  }

  return trip;
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
