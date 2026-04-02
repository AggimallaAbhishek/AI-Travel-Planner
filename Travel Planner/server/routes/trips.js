import express from "express";
import { optionalAuth, requireAuth } from "../middleware/auth.js";
import {
  placesAutocompleteRateLimit,
  recommendationsRateLimit,
  routeOptimizationRateLimit,
  tripGenerationRateLimit,
} from "../middleware/rateLimit.js";
import {
  createTripForUser,
  getTripForUser,
  listTripsForUser,
  validateTripRequest,
} from "../services/trips.js";
import { getDestinationAutocompleteSuggestions } from "../services/recommendations.js";
import {
  getDestinationRecommendations,
} from "../services/recommendations.js";
import { getTripRoutePlan } from "../services/tripRoutes.js";

const router = express.Router();
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

function parseBooleanQueryFlag(value) {
  if (typeof value === "boolean") {
    return value;
  }

  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

function parseRouteDayOrNull(value, maxDays) {
  if (value === undefined || value === null || value === "") {
    return 1;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maxDays) {
    return null;
  }

  return parsed;
}

export function resolveTripGenerationFailure(error) {
  const errorText = getErrorText(error).toLowerCase();
  const errorCode = String(error?.code ?? "");

  if (
    includesAny(errorText, [
      "firestore database was not found",
      "database (default) does not exist",
      "cloud firestore api has not been used",
      "firestore api has not been used",
      "create/enable firestore",
    ]) ||
    errorCode.toLowerCase().includes("firestore/database-not-found")
  ) {
    return {
      message:
        "Trip generation succeeded but saving failed. Create/enable Firestore for your Firebase project and try again.",
      hint:
        "Firebase Console -> Build -> Firestore Database -> Create database (Native mode), then retry. If Firestore already exists, verify FIREBASE_PROJECT_ID matches that project.",
    };
  }

  if (
    includesAny(errorText, [
      "missing or insufficient permissions",
      "permission_denied",
      "insufficient permissions",
    ]) &&
    !includesAny(errorText, ["generativelanguage", "gemini"])
  ) {
    return {
      message:
        "Trip save failed due to Firestore permissions. Grant Firestore access to your Firebase service account and retry.",
      hint:
        "Google Cloud IAM -> service account from FIREBASE_CLIENT_EMAIL -> role Cloud Datastore User (or broader Firestore access).",
    };
  }

  if (
    errorCode.toLowerCase().includes("firestore/timeout") ||
    (includesAny(errorText, ["deadline exceeded", "timed out"]) &&
      includesAny(errorText, ["firestore", "datastore"]))
  ) {
    return {
      message:
        "Trip generation completed, but the trip store timed out. Retry once and verify Firestore/network availability.",
      hint:
        "If this repeats, check Firestore status, outbound access to Google APIs, and FIRESTORE_OPERATION_TIMEOUT_MS.",
    };
  }

  if (
    includesAny(errorText, [
      "missing google_gemini_api_key",
      "api key not valid",
      "quota",
      "model not found",
      "permission denied",
      "forbidden",
    ])
  ) {
    return {
      message:
        "Gemini request failed. Verify GOOGLE_GEMINI_API_KEY, model access, and billing/quota in Google AI Studio.",
      hint:
        "Ensure Generative Language API is enabled for the key and GEMINI_MODEL is available for that key.",
    };
  }

  if (
    includesAny(errorText, [
      "error fetching from https://generativelanguage.googleapis.com",
      "fetch failed",
      "timed out",
      "socket hang up",
      "econnreset",
      "enotfound",
      "eai_again",
      "etimedout",
      "network error",
    ])
  ) {
    return {
      message:
        "Trip generation service is currently unreachable. Check your internet connection and Gemini API availability, then retry.",
      hint:
        "If this persists, verify outbound network access from the server and Gemini service status.",
    };
  }

  if (
    errorCode.includes("app/invalid-credential") ||
    errorText.includes("could not load the default credentials") ||
    errorText.includes("private key") ||
    errorText.includes("invalid_grant")
  ) {
    return {
      message:
        "Server Firebase Admin credentials are invalid. Check FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY.",
      hint:
        "Use a fresh service account key JSON and keep newline escapes in FIREBASE_PRIVATE_KEY.",
    };
  }

  if (
    includesAny(errorText, [
      "cannot use undefined as a firestore value",
      "invalid firestore document",
      "value for argument \"data\" is not a valid firestore document",
    ])
  ) {
    return {
      message:
        "Trip generation completed, but the generated payload could not be saved safely.",
      hint:
        "Retry once. If it repeats, inspect server logs for invalid fields in the Firestore document payload.",
    };
  }

  return {
    message: "Unable to generate a trip right now.",
    hint:
      "Check server logs for [trips] Failed to generate trip, then verify Firestore setup, Firebase Admin credentials, and Gemini API connectivity.",
  };
}

router.get(
  "/places/autocomplete",
  optionalAuth,
  placesAutocompleteRateLimit,
  async (req, res) => {
    try {
      const suggestions = await getDestinationAutocompleteSuggestions({
        query: req.query.q,
        forceRefresh: parseBooleanQueryFlag(req.query.force),
      });

      res.json({ suggestions });
    } catch (error) {
      if (error?.code === "recommendations/invalid-query") {
        res.status(400).json({
          message: error.message,
        });
        return;
      }

      console.error("[places] Failed to load autocomplete suggestions", {
        query: String(req.query.q ?? ""),
        errorMessage: getErrorText(error),
      });
      res.status(500).json({
        message: "Unable to load destination suggestions right now.",
      });
    }
  }
);

router.post("/trips/generate", requireAuth, tripGenerationRateLimit, async (req, res) => {
  const { userSelection, errors, planningRequest } = validateTripRequest(req.body);

  if (errors.length > 0) {
    res.status(400).json({
      message: "Trip request is invalid.",
      errors,
    });
    return;
  }

  try {
    const trip = await createTripForUser({
      user: req.user,
      userSelection,
      planningRequest,
      traceId: req.traceId,
    });

    res.status(201).json({ trip });
  } catch (error) {
    const resolvedFailure = resolveTripGenerationFailure(error);
    console.error("[trips] Failed to generate trip", {
      errorMessage: getErrorText(error),
      errorCode: error?.code ?? null,
      resolvedMessage: resolvedFailure.message,
    });

    res.status(500).json({
      message: resolvedFailure.message,
      ...(IS_PRODUCTION || !resolvedFailure.hint
        ? {}
        : {
            hint: resolvedFailure.hint,
            debug: getErrorText(error),
            errorCode: String(error?.code ?? ""),
          }),
    });
  }
});

router.get(
  "/trips/:tripId/recommendations",
  requireAuth,
  recommendationsRateLimit,
  async (req, res) => {
    try {
      const trip = await getTripForUser({
        tripId: req.params.tripId,
        user: req.user,
      });

      if (!trip) {
        res.status(404).json({
          message: "Trip not found.",
        });
        return;
      }

      if (trip === "forbidden") {
        res.status(403).json({
          message: "You do not have access to this trip.",
        });
        return;
      }

      const destination =
        trip?.userSelection?.location?.label ?? trip?.aiPlan?.destination ?? "";
      const forceRefresh = parseBooleanQueryFlag(req.query.force);
      const recommendations = await getDestinationRecommendations({
        destination,
        forceRefresh,
      });

      res.json({
        recommendations,
        planningMeta: {
          dataProvider: recommendations.provider ?? "",
          algorithmVersion: trip?.optimization?.algorithmVersion ?? "",
          cacheHit: !forceRefresh,
          generatedAt: new Date().toISOString(),
          freshness: null,
        },
      });
    } catch (error) {
      if (error?.code === "recommendations/invalid-destination") {
        res.status(400).json({
          message: error.message,
        });
        return;
      }

      console.error("[trips] Failed to load destination recommendations", {
        tripId: req.params.tripId,
        traceId: req.traceId ?? null,
        errorMessage: getErrorText(error),
      });
      res.status(500).json({
        message: "Unable to load destination recommendations right now.",
      });
    }
  }
);

router.get(
  "/trips/:tripId/routes",
  requireAuth,
  routeOptimizationRateLimit,
  async (req, res) => {
    try {
      const trip = await getTripForUser({
        tripId: req.params.tripId,
        user: req.user,
      });

      if (!trip) {
        res.status(404).json({
          message: "Trip not found.",
        });
        return;
      }

      if (trip === "forbidden") {
        res.status(403).json({
          message: "You do not have access to this trip.",
        });
        return;
      }

      const maxDays = Math.max(
        1,
        Number.parseInt(trip?.userSelection?.days ?? "1", 10) || 1
      );
      const requestedDay = parseRouteDayOrNull(req.query.day, maxDays);
      if (!requestedDay) {
        res.status(400).json({
          message: `Route day must be an integer between 1 and ${maxDays}.`,
        });
        return;
      }

      const routePlan = await getTripRoutePlan({
        trip,
        day: requestedDay,
        forceRefresh: parseBooleanQueryFlag(req.query.force),
        traceId: req.traceId,
      });

      res.json({
        day: routePlan.day,
        totalDays: routePlan.totalDays,
        route: routePlan.dayPlan,
        optimization: routePlan.optimization,
        planningMeta: routePlan.planningMeta,
      });
    } catch (error) {
      if (error?.code === "recommendations/invalid-destination") {
        res.status(400).json({
          message: error.message,
        });
        return;
      }

      console.error("[trips] Failed to compute trip route", {
        tripId: req.params.tripId,
        traceId: req.traceId ?? null,
        errorMessage: getErrorText(error),
      });
      res.status(500).json({
        message: "Unable to compute trip routes right now.",
      });
    }
  }
);

router.get("/trips/:tripId", requireAuth, async (req, res) => {
  try {
    const trip = await getTripForUser({
      tripId: req.params.tripId,
      user: req.user,
    });

    if (!trip) {
      res.status(404).json({
        message: "Trip not found.",
      });
      return;
    }

    if (trip === "forbidden") {
      res.status(403).json({
        message: "You do not have access to this trip.",
      });
      return;
    }

    res.json({ trip });
  } catch (error) {
    console.error("[trips] Failed to load trip", error);
    res.status(500).json({
      message: "Unable to load the trip right now.",
    });
  }
});

router.get("/my-trips", requireAuth, async (req, res) => {
  try {
    const trips = await listTripsForUser(req.user);
    res.json({ trips });
  } catch (error) {
    console.error("[trips] Failed to list trips", error);
    res.status(500).json({
      message: "Unable to load saved trips right now.",
    });
  }
});

export default router;
