import { getAdminAuth } from "../lib/firebaseAdmin.js";

const IS_PRODUCTION = process.env.NODE_ENV === "production";

function getErrorText(error) {
  if (!error) {
    return "";
  }

  if (error instanceof Error) {
    return error.message ?? "";
  }

  return String(error);
}

function includesAny(text, patterns = []) {
  return patterns.some((pattern) => text.includes(pattern));
}

export function classifyAuthFailure(error) {
  const code = String(error?.code ?? "").trim();
  const normalizedCode = code.toLowerCase();
  const message = getErrorText(error);
  const normalizedMessage = message.toLowerCase();

  const isTokenFailure =
    normalizedCode === "auth/id-token-expired" ||
    normalizedCode === "auth/id-token-revoked" ||
    normalizedCode === "auth/invalid-id-token" ||
    includesAny(normalizedMessage, [
      "id token has expired",
      "id token has been revoked",
      "decoding firebase id token failed",
      "firebase id token has invalid signature",
      "firebase id token has incorrect \"sub\"",
      "firebase id token has incorrect \"iss\"",
      "firebase id token has incorrect \"iat\"",
    ]);

  if (isTokenFailure) {
    return {
      status: 401,
      code: code || "auth/session-invalid",
      message: "Your session is no longer valid. Please sign in again.",
      requiresReauth: true,
      hint: "Sign out and sign in again to refresh your authentication session.",
    };
  }

  const isConfigurationFailure =
    normalizedCode === "app/invalid-credential" ||
    normalizedCode === "auth/invalid-credential" ||
    includesAny(normalizedMessage, [
      "incorrect \"aud\" (audience) claim",
      "firebase id token has incorrect \"aud\"",
      "project id",
      "could not load the default credentials",
      "credential implementation provided to initializeapp()",
      "failed to determine project id",
      "service account",
      "certificate",
    ]);

  if (isConfigurationFailure) {
    return {
      status: 500,
      code: code || "auth/configuration-error",
      message:
        "Authentication service is misconfigured. Verify server Firebase credentials and project ID.",
      requiresReauth: false,
      hint:
        "Set matching FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY values for the same Firebase project used by the frontend.",
    };
  }

  return {
    status: 401,
    code: code || "auth/verification-failed",
    message: "Unable to verify your session token.",
    requiresReauth: true,
    hint: "Sign in again. If this continues, inspect server auth logs for token verification errors.",
  };
}

export async function requireAuth(req, res, next) {
  const authorization = req.headers.authorization ?? "";

  if (!authorization.startsWith("Bearer ")) {
    res.status(401).json({
      message: "Authentication is required.",
      code: "auth/missing-token",
      requiresReauth: true,
    });
    return;
  }

  const idToken = authorization.replace("Bearer ", "").trim();

  try {
    // Pass checkRevoked: true to proactively reject tokens if the user
    // signed out on another device, overriding the typical 1-hr expiration.
    req.user = await getAdminAuth().verifyIdToken(idToken, true);
    next();
  } catch (error) {
    const failure = classifyAuthFailure(error);
    console.error("[auth] Failed to verify Firebase ID token", {
      code: error?.code ?? null,
      message: getErrorText(error),
      resolvedStatus: failure.status,
      resolvedCode: failure.code,
      requiresReauth: failure.requiresReauth,
    });

    res.status(failure.status).json({
      message: failure.message,
      code: failure.code,
      requiresReauth: failure.requiresReauth,
      ...(IS_PRODUCTION ? {} : { hint: failure.hint }),
    });
  }
}
