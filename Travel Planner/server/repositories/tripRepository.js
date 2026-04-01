import { isPostgresConfigured } from "../lib/db/postgres.js";
import { createFirestoreTripRepository } from "./firestoreTripRepository.js";
import { createPostgresTripRepository } from "./postgresTripRepository.js";

let cachedRepository = null;

function normalizeText(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim();
  return normalized || fallback;
}

export function resolveTripPersistenceDriver(env = process.env) {
  const configuredDriver = normalizeText(env.TRIP_PERSISTENCE_BACKEND, "").toLowerCase();

  if (configuredDriver === "postgres") {
    return "postgres";
  }

  if (configuredDriver === "firestore") {
    return "firestore";
  }

  return isPostgresConfigured(env) ? "postgres" : "firestore";
}

export function createTripRepository(env = process.env) {
  const driver = resolveTripPersistenceDriver(env);

  if (driver === "postgres") {
    return createPostgresTripRepository(env);
  }

  return createFirestoreTripRepository();
}

export function getTripRepository(env = process.env) {
  const driver = resolveTripPersistenceDriver(env);

  if (!cachedRepository || cachedRepository.driver !== driver) {
    cachedRepository = createTripRepository(env);
    console.info("[trips] Initialized trip repository", {
      driver: cachedRepository.driver,
    });
  }

  return cachedRepository;
}

export function resetTripRepository() {
  cachedRepository = null;
}
