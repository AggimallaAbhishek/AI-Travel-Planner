import express from "express";
import { requireAuth } from "../middleware/auth.js";
import {
  replanRateLimit,
  tripGenerationRateLimit,
} from "../middleware/rateLimit.js";
import {
  backfillTripMapEnrichment,
  createTripForUser,
  getTripForUser,
  listTripsForUser,
  replanTripForUser,
  validateReplanRequest,
  validateTripRequest,
} from "../services/trips.js";
import {
  buildMockDestinationRecommendations,
  getRecommendationsForDestination,
} from "../services/recommendations.js";
import { getRoutesForTrip } from "../services/routeOptimization.js";
import { getStaticCityBasemap } from "../services/cityStaticMap.js";
import { buildTripCityMapPayload } from "../services/tripCityMap.js";
import { getUnifiedTripMap } from "../services/unifiedTripMap.js";
import {
  normalizeAlternativesCount,
  normalizeTripConstraints,
  normalizeTripObjective,
} from "../../shared/trips.js";

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

function parseConstraintsFromQuery(query = {}) {
  return normalizeTripConstraints({
    dailyTimeLimitHours:
      query.daily_time_limit ??
      query.dailyTimeLimitHours ??
      query.dailyTimeLimit,
    budgetCap: query.budget_cap ?? query.budgetCap,
    mobilityPref: query.mobility_pref ?? query.mobilityPref,
    mealPrefs: query.meal_prefs ?? query.mealPrefs,
  });
}

router.post("/trips/generate", requireAuth, tripGenerationRateLimit, async (req, res) => {
  const { userSelection, errors } = validateTripRequest(req.body);

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

router.get("/trips/:tripId", requireAuth, async (req, res) => {
  try {
    let trip = await getTripForUser({
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

    try {
      const enrichmentResult = await backfillTripMapEnrichment({
        trip,
        logContext: "trip detail",
      });
      trip = enrichmentResult.trip;
    } catch (error) {
      console.warn("[trips] Trip detail map enrichment backfill failed", {
        tripId: trip.id,
        message: getErrorText(error),
      });
    }

    res.json({ trip });
  } catch (error) {
    console.error("[trips] Failed to load trip", error);
    res.status(500).json({
      message: "Unable to load the trip right now.",
    });
  }
});

router.get("/trips/:tripId/recommendations", requireAuth, async (req, res) => {
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
      trip.userSelection?.location?.label ?? trip.aiPlan?.destination ?? "";

    if (!destination) {
      res.status(400).json({
        message: "This trip does not have a destination to search.",
      });
      return;
    }

    let recommendations;

    try {
      recommendations = await getRecommendationsForDestination({
        destination,
        userSelection: trip.userSelection,
      });
    } catch (error) {
      console.error("[trips] Recommendation providers failed, using mock data", {
        tripId: trip.id,
        destination,
        message: getErrorText(error),
      });

      recommendations = buildMockDestinationRecommendations({
        destination,
        userSelection: trip.userSelection,
        warning:
          "Live destination data could not be loaded, so curated sample recommendations are being shown instead.",
      });
    }

    console.info("[trips] Destination recommendations loaded", {
      tripId: trip.id,
      destination,
      provider: recommendations.provider,
      hotels: recommendations.hotels.length,
      restaurants: recommendations.restaurants.length,
    });

    res.json({ recommendations });
  } catch (error) {
    console.error("[trips] Failed to load destination recommendations", {
      tripId: req.params.tripId,
      message: getErrorText(error),
    });
    res.status(500).json({
      message: "Unable to load destination recommendations right now.",
    });
  }
});

router.get("/trips/:tripId/map", requireAuth, async (req, res) => {
  try {
    let trip = await getTripForUser({
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

    try {
      const enrichmentResult = await backfillTripMapEnrichment({
        trip,
        logContext: "unified map",
      });
      trip = enrichmentResult.trip;
    } catch (error) {
      console.warn("[trips] Trip unified map enrichment backfill failed", {
        tripId: trip.id,
        message: getErrorText(error),
      });
    }

    const tripMap = await getUnifiedTripMap({
      trip,
      dayNumber: req.query.day,
    });

    res.json({ tripMap });
  } catch (error) {
    console.error("[trips] Failed to load unified trip map", {
      tripId: req.params.tripId,
      message: getErrorText(error),
    });
    res.status(500).json({
      message: "Unable to load the trip map right now.",
    });
  }
});

// Deprecated internal endpoint retained during unified-map migration.
router.get("/trips/:tripId/city-map", requireAuth, async (req, res) => {
  try {
    let trip = await getTripForUser({
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

    try {
      const enrichmentResult = await backfillTripMapEnrichment({
        trip,
        logContext: "city map",
      });
      trip = enrichmentResult.trip;
    } catch (error) {
      console.warn("[trips] Trip city map enrichment backfill failed", {
        tripId: trip.id,
        message: getErrorText(error),
      });
    }

    const basemap = await getStaticCityBasemap({
      destination:
        trip.userSelection?.location?.label ?? trip.aiPlan?.destination ?? "",
      cityBounds: trip?.mapEnrichment?.cityBounds,
    });
    const cityMap = buildTripCityMapPayload({
      trip,
      basemap,
    });

    console.info("[trips] Trip city map loaded", {
      tripId: trip.id,
      destination: cityMap.destination,
      mappedPlaceCount: cityMap.mappedPlaceCount,
      unresolvedPlaceCount: cityMap.unresolvedPlaceCount,
      roadFeatures: cityMap.basemap?.roads?.length ?? 0,
    });

    res.json({ cityMap });
  } catch (error) {
    console.error("[trips] Failed to load trip city map", {
      tripId: req.params.tripId,
      message: getErrorText(error),
    });
    res.status(500).json({
      message: "Unable to load the city map right now.",
    });
  }
});

// Deprecated internal endpoint retained during unified-map migration.
router.get("/trips/:tripId/routes", requireAuth, async (req, res) => {
  try {
    let trip = await getTripForUser({
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

    try {
      const enrichmentResult = await backfillTripMapEnrichment({
        trip,
        logContext: "routes",
      });
      trip = enrichmentResult.trip;
    } catch (error) {
      console.warn("[trips] Trip map enrichment backfill failed", {
        tripId: trip.id,
        message: getErrorText(error),
      });
    }

    const objective = normalizeTripObjective(
      typeof req.query.objective === "string"
        ? req.query.objective
        : typeof req.query.optimizeFor === "string"
          ? req.query.optimizeFor
          : trip.userSelection?.objective
    );
    const alternativesCount = normalizeAlternativesCount(
      req.query.alternatives_count ??
        req.query.alternativesCount ??
        trip.userSelection?.alternativesCount
    );
    const constraints = parseConstraintsFromQuery(req.query);
    const routes = await getRoutesForTrip({
      trip,
      optimizeFor:
        typeof req.query.optimizeFor === "string"
          ? req.query.optimizeFor
          : objective === "cheapest"
            ? "distance"
            : "duration",
      objective,
      alternativesCount,
      constraints,
      dayNumber: req.query.day,
    });

    console.info("[trips] Trip routes loaded", {
      tripId: trip.id,
      destination: routes.destination,
      dayCount: routes.dayCount,
      optimizeFor: routes.optimizeFor,
      objective: routes.objective,
    });

    res.json({ routes });
  } catch (error) {
    console.error("[trips] Failed to load trip routes", {
      tripId: req.params.tripId,
      message: getErrorText(error),
    });
    res.status(500).json({
      message: "Unable to load optimized routes right now.",
    });
  }
});

router.get("/trips/:tripId/alternatives", requireAuth, async (req, res) => {
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

    const objective = normalizeTripObjective(
      typeof req.query.objective === "string"
        ? req.query.objective
        : trip.userSelection?.objective
    );
    const alternativesCount = normalizeAlternativesCount(
      req.query.alternatives_count ??
        req.query.alternativesCount ??
        trip.userSelection?.alternativesCount
    );
    const constraints = parseConstraintsFromQuery(req.query);
    const routes = await getRoutesForTrip({
      trip,
      objective,
      alternativesCount,
      constraints,
      dayNumber: req.query.day,
    });

    const alternatives = {
      tripId: trip.id,
      destination: routes.destination,
      objective: routes.objective,
      alternativesCount: routes.alternativesCount,
      generatedAt: routes.generatedAt,
      days: (Array.isArray(routes.days) ? routes.days : []).map((day) => ({
        dayNumber: day.dayNumber,
        title: day.title,
        status: day.status,
        alternatives: Array.isArray(day.alternatives) ? day.alternatives : [],
        explanation: day.explanation ?? null,
      })),
    };

    res.json({ alternatives });
  } catch (error) {
    console.error("[trips] Failed to load trip route alternatives", {
      tripId: req.params.tripId,
      message: getErrorText(error),
    });
    res.status(500).json({
      message: "Unable to load route alternatives right now.",
    });
  }
});

router.post(
  "/trips/:tripId/replan",
  requireAuth,
  replanRateLimit,
  async (req, res) => {
    const { disruptions, errors } = validateReplanRequest(req.body);

    if (errors.length > 0) {
      res.status(400).json({
        message: "Replan request is invalid.",
        errors,
      });
      return;
    }

    try {
      const result = await replanTripForUser({
        tripId: req.params.tripId,
        user: req.user,
        disruptions,
      });

      if (!result) {
        res.status(404).json({
          message: "Trip not found.",
        });
        return;
      }

      if (result === "forbidden") {
        res.status(403).json({
          message: "You do not have access to this trip.",
        });
        return;
      }

      console.info("[trips] Trip replanned", {
        tripId: result.trip.id,
        disruptionCount: disruptions.length,
        changed: result.replanSummary.changed,
      });

      res.json(result);
    } catch (error) {
      console.error("[trips] Failed to replan trip", {
        tripId: req.params.tripId,
        message: getErrorText(error),
      });
      res.status(500).json({
        message: "Unable to replan this trip right now.",
      });
    }
  }
);

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
