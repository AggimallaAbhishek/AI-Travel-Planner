import { createRemoteJWKSet, jwtVerify } from "jose";

const FIREBASE_JWKS_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";

let cachedJwks = null;

function normalizeText(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim();
  return normalized || fallback;
}

export function resolveFirebaseJwtConfig(env = process.env) {
  const projectId =
    normalizeText(env.FIREBASE_AUTH_PROJECT_ID) ||
    normalizeText(env.VITE_FIREBASE_PROJECT_ID) ||
    normalizeText(env.FIREBASE_PROJECT_ID);

  if (!projectId) {
    const error = new Error(
      "Missing Firebase Auth project configuration. Set FIREBASE_AUTH_PROJECT_ID or VITE_FIREBASE_PROJECT_ID."
    );
    error.code = "auth/misconfigured";
    throw error;
  }

  return {
    projectId,
    issuer: `https://securetoken.google.com/${projectId}`,
    audience: projectId,
  };
}

function getFirebaseJwks() {
  if (!cachedJwks) {
    cachedJwks = createRemoteJWKSet(new URL(FIREBASE_JWKS_URL));
  }

  return cachedJwks;
}

export function buildAuthenticatedUserFromFirebaseClaims(payload = {}) {
  const uid = normalizeText(payload.user_id) || normalizeText(payload.sub);

  if (!uid) {
    const error = new Error("Firebase token payload did not contain a subject.");
    error.code = "auth/invalid-token";
    throw error;
  }

  return {
    uid,
    email: normalizeText(payload.email),
    emailVerified: payload.email_verified === true,
    provider: normalizeText(payload.firebase?.sign_in_provider, "firebase"),
    claims: payload,
  };
}

export async function verifyFirebaseIdToken(idToken, env = process.env) {
  const config = resolveFirebaseJwtConfig(env);
  const { payload } = await jwtVerify(idToken, getFirebaseJwks(), {
    issuer: config.issuer,
    audience: config.audience,
  });

  return buildAuthenticatedUserFromFirebaseClaims(payload);
}
