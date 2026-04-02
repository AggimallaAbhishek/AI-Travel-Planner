import React, { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import InfoSection from "./components/InfoSection";
import Hotels from "./components/Hotels";
import Restaurants from "./components/Restaurants";
import PlacesToVisit from "./components/PlacesToVisit";
import { toast } from "react-toastify";
import { useAuth } from "@/context/AuthContext";
import { apiFetch } from "@/lib/api";
import { fetchTripRecommendations } from "@/lib/tripRecommendations";
import { fetchTripRoute } from "@/lib/tripRoutes";
import { downloadTripPdf, printTripPdf } from "@/lib/trip-pdf";
import { Button } from "@/components/ui/button";
import { buildLoginPath } from "@/lib/authRedirect";
import RouteOptimizationSection from "./components/RouteOptimizationSection";
import { resolveGoogleMapsUrl } from "../../shared/maps.js";

const INITIAL_RECOMMENDATION_STATE = {
  hotels: [],
  restaurants: [],
  provider: "",
  warning: "",
  destination: "",
  loading: false,
  errorMessage: "",
};

const INITIAL_ROUTE_STATE = {
  day: 1,
  totalDays: 1,
  route: {
    day: 1,
    clusterId: 0,
    stopCount: 0,
    visitOrder: [],
    stops: [],
  },
  optimization: {},
  planningMeta: {},
  loading: false,
  errorMessage: "",
};

function toTripHotelRecommendationItem(hotel = {}) {
  const name = hotel.hotelName || "Recommended Hotel";
  const location = hotel.hotelAddress || "Location details unavailable";
  const rating = Number.parseFloat(hotel.rating);
  const geoCoordinates = {
    latitude: hotel?.geoCoordinates?.latitude ?? null,
    longitude: hotel?.geoCoordinates?.longitude ?? null,
  };
  const mapsUrl = resolveGoogleMapsUrl({
    mapsUrl: hotel.mapsUrl,
    externalPlaceId: hotel.externalPlaceId,
    coordinates: geoCoordinates,
    name,
    address: location,
  });

  return {
    name,
    imageUrl: hotel.hotelImageUrl || "",
    rating: Number.isFinite(rating) ? rating : null,
    location,
    description:
      hotel.description ||
      "Hotel recommendation generated from your itinerary preferences.",
    priceLabel: hotel.price || "",
    mapsUrl,
    geoCoordinates,
    externalPlaceId: hotel.externalPlaceId || "",
    source: hotel.source || "",
  };
}

function mapTripHotelsToRecommendationItems(hotels = []) {
  if (!Array.isArray(hotels)) {
    return [];
  }

  return hotels.map((hotel) => toTripHotelRecommendationItem(hotel));
}

function isVerifiedOnlineRecommendation(item = {}) {
  const source = String(item?.source ?? "")
    .trim()
    .toLowerCase();

  if (source === "google_places" || source === "india_dataset") {
    return true;
  }

  return Boolean(
    String(item?.externalPlaceId ?? "").trim() ||
      (item?.geoCoordinates?.latitude !== null &&
        item?.geoCoordinates?.latitude !== undefined &&
        item?.geoCoordinates?.longitude !== null &&
        item?.geoCoordinates?.longitude !== undefined)
  );
}

function Viewtrip() {
  const { tripId } = useParams();
  const location = useLocation();
  const { user, loading: authLoading } = useAuth();
  const [trip, setTrip] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [recommendations, setRecommendations] = useState(
    INITIAL_RECOMMENDATION_STATE
  );
  const [recommendationReloadToken, setRecommendationReloadToken] = useState(0);
  const [routePlan, setRoutePlan] = useState(INITIAL_ROUTE_STATE);
  const [routeReloadToken, setRouteReloadToken] = useState(0);
  const [selectedRouteDay, setSelectedRouteDay] = useState(1);
  const [pdfAction, setPdfAction] = useState("");
  const loginPath = buildLoginPath(`${location.pathname}${location.search}${location.hash}`);

  const fallbackHotelRecommendations = useMemo(() => {
    return mapTripHotelsToRecommendationItems(trip?.hotels).filter(
      isVerifiedOnlineRecommendation
    );
  }, [trip?.hotels]);
  const hasLiveHotels = recommendations.hotels.length > 0;
  const hotelsToDisplay = hasLiveHotels
    ? recommendations.hotels
    : fallbackHotelRecommendations;
  const hotelSectionError =
    hotelsToDisplay.length === 0 ? recommendations.errorMessage : "";
  const restaurantSectionError =
    recommendations.restaurants.length === 0 ? recommendations.errorMessage : "";
  const fallbackHotelNote =
    fallbackHotelRecommendations.length > 0 && !hasLiveHotels
      ? "Showing hotel suggestions from your generated itinerary while live hotel recommendations are unavailable."
      : "";
  const hotelNote = [recommendations.warning, fallbackHotelNote]
    .filter(Boolean)
    .join(" ");
  const restaurantNote = recommendations.warning;
  const recommendationsForPdf = useMemo(
    () => ({
      ...recommendations,
      hotels: hotelsToDisplay,
      restaurants: recommendations.restaurants,
    }),
    [recommendations, hotelsToDisplay]
  );

  useEffect(() => {
    const controller = new AbortController();

    if (!tripId || !user) {
      setLoading(false);
      setTrip(null);
      setRecommendations(INITIAL_RECOMMENDATION_STATE);
      setRoutePlan(INITIAL_ROUTE_STATE);
      setSelectedRouteDay(1);
      return () => controller.abort();
    }

    async function loadTrip() {
      setLoading(true);
      setErrorMessage("");

      try {
        const response = await apiFetch(`/api/trips/${tripId}`, {
          signal: controller.signal,
        });
        setTrip(response.trip ?? null);
        setSelectedRouteDay(1);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        console.error("[view-trip] Failed to load trip", error);
        setTrip(null);
        setErrorMessage(error.message ?? "Unable to load this trip.");
        setRoutePlan(INITIAL_ROUTE_STATE);

        // Suppress toast if the API client is popping the re-auth modal
        if (!error?.details?.requiresReauth) {
          toast.error(error.message ?? "Unable to load this trip.");
        }
      } finally {
        setLoading(false);
      }
    }

    loadTrip();

    return () => controller.abort();
  }, [tripId, user]);

  useEffect(() => {
    const controller = new AbortController();
    const destination = trip?.userSelection?.location?.label ?? "";

    if (!trip?.id || !user) {
      setRecommendations(INITIAL_RECOMMENDATION_STATE);
      return () => controller.abort();
    }

    if (!destination) {
      setRecommendations({
        ...INITIAL_RECOMMENDATION_STATE,
        errorMessage:
          "A destination is required before hotels and restaurants can be loaded.",
      });
      return () => controller.abort();
    }

    async function loadRecommendations() {
      setRecommendations((previous) => ({
        ...previous,
        ...(recommendationReloadToken > 0 ? { hotels: [], restaurants: [] } : {}),
        destination,
        loading: true,
        errorMessage: "",
      }));

      try {
        const response = await fetchTripRecommendations(trip.id, {
          signal: controller.signal,
          force: recommendationReloadToken > 0,
          destination,
        });

        console.info("[view-trip] Destination recommendations loaded", {
          tripId: trip.id,
          destination: response.destination || destination,
          provider: response.provider,
          hotels: response.hotels.length,
          restaurants: response.restaurants.length,
        });
        setRecommendations({
          ...response,
          loading: false,
          errorMessage: "",
        });
      } catch (error) {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
          return;
        }

        console.error("[view-trip] Failed to load destination recommendations", {
          tripId: trip.id,
          destination,
          message: error?.message,
          status: error?.status ?? null,
        });

        // Don't show inline errors if the global re-auth modal is handling it
        if (error?.details?.requiresReauth) {
          return;
        }

        setRecommendations((previous) => ({
          ...previous,
          destination,
          loading: false,
          errorMessage:
            error.message ??
            "Unable to load destination recommendations right now.",
        }));
      }
    }

    loadRecommendations();

    return () => controller.abort();
  }, [trip?.id, trip?.userSelection?.location?.label, user, recommendationReloadToken]);

  useEffect(() => {
    const controller = new AbortController();

    if (!trip?.id || !user) {
      setRoutePlan(INITIAL_ROUTE_STATE);
      return () => controller.abort();
    }

    async function loadRoutePlan() {
      setRoutePlan((previous) => ({
        ...previous,
        loading: true,
        errorMessage: "",
      }));

      try {
        const response = await fetchTripRoute(trip.id, {
          signal: controller.signal,
          day: selectedRouteDay,
          force: routeReloadToken > 0,
        });

        setRoutePlan({
          ...response,
          loading: false,
          errorMessage: "",
        });
      } catch (error) {
        if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
          return;
        }

        console.error("[view-trip] Failed to load route optimization", {
          tripId: trip.id,
          day: selectedRouteDay,
          message: error?.message,
          status: error?.status ?? null,
        });

        // Don't show inline errors if the global re-auth modal is handling it
        if (error?.details?.requiresReauth) {
          return;
        }

        setRoutePlan((previous) => ({
          ...previous,
          day: selectedRouteDay,
          loading: false,
          errorMessage:
            error?.message ?? "Unable to load optimized route details right now.",
        }));
      }
    }

    loadRoutePlan();
    return () => controller.abort();
  }, [trip?.id, selectedRouteDay, user, routeReloadToken]);

  const handleRetryRecommendations = () => {
    setRecommendationReloadToken((previous) => previous + 1);
  };

  const handleRetryRoutePlan = () => {
    setRouteReloadToken((previous) => previous + 1);
  };

  const handleDownloadPdf = async () => {
    if (!trip || pdfAction) {
      return;
    }

    setPdfAction("download");

    try {
      const result = await downloadTripPdf({
        trip,
        recommendations: recommendationsForPdf,
      });

      toast.success(`Travel brochure downloaded (${result.pageCount} pages).`);
    } catch (error) {
      console.error("[view-trip] Failed to download brochure PDF", {
        tripId: trip.id,
        message: error instanceof Error ? error.message : String(error),
      });
      toast.error(error?.message ?? "Unable to generate the PDF brochure right now.");
    } finally {
      setPdfAction("");
    }
  };

  const handlePrintPdf = async () => {
    if (!trip || pdfAction) {
      return;
    }

    setPdfAction("print");

    try {
      const result = await printTripPdf({
        trip,
        recommendations: recommendationsForPdf,
      });

      toast.success(`Print ready (${result.pageCount} pages).`);
    } catch (error) {
      console.error("[view-trip] Failed to print brochure PDF", {
        tripId: trip.id,
        message: error instanceof Error ? error.message : String(error),
      });
      toast.error(error?.message ?? "Unable to open print preview right now.");
    } finally {
      setPdfAction("");
    }
  };

  if (authLoading) {
    return (
      <section className="voy-view-shell">
        <div className="voy-view-state flex justify-center items-center h-64">
          <div className="text-center">
          <div className="voy-loading-spinner mx-auto" />
          <p className="mt-4 text-[var(--voy-text-muted)]">Checking your session...</p>
          </div>
        </div>
      </section>
    );
  }

  if (!user) {
    return (
      <section className="voy-view-shell">
        <div className="voy-view-state">
          <div className="voy-view-state-card">
            <h2 className="voy-page-title text-[2rem]">Sign in to view this trip</h2>
            <p className="voy-page-subtitle mt-2">
              Your itineraries are protected and can only be viewed by their owner.
            </p>
            <Link to={loginPath}>
              <Button className="voy-create-primary mt-6">Sign In With Google</Button>
            </Link>
          </div>
        </div>
      </section>
    );
  }

  if (loading) {
    return (
      <section className="voy-view-shell">
        <div className="voy-view-state flex justify-center items-center h-64">
          <div className="text-center">
          <div className="voy-loading-spinner mx-auto" />
          <p className="mt-4 text-[var(--voy-text-muted)]">Loading trip details...</p>
          </div>
        </div>
      </section>
    );
  }

  if (!trip) {
    return (
      <section className="voy-view-shell">
        <div className="voy-view-state">
          <div className="voy-view-state-card">
            <h2 className="voy-page-title text-[2rem]">Trip Not Available</h2>
            <p className="voy-page-subtitle mt-2">
              {errorMessage || "The requested trip could not be found."}
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="voy-view-shell">
      <div className="voy-view-content">
        <InfoSection
          trip={trip}
          pdfAction={pdfAction}
          onDownloadPdf={handleDownloadPdf}
          onPrintPdf={handlePrintPdf}
        />
        <Hotels
          trip={trip}
          hotels={hotelsToDisplay}
          isLoading={recommendations.loading && hotelsToDisplay.length === 0}
          errorMessage={hotelSectionError}
          note={hotelNote}
          onRetry={handleRetryRecommendations}
        />
        <Restaurants
          trip={trip}
          restaurants={recommendations.restaurants}
          isLoading={
            recommendations.loading && recommendations.restaurants.length === 0
          }
          errorMessage={restaurantSectionError}
          note={restaurantNote}
          onRetry={handleRetryRecommendations}
        />
        <RouteOptimizationSection
          routeData={routePlan}
          selectedDay={selectedRouteDay}
          isLoading={routePlan.loading}
          errorMessage={routePlan.errorMessage}
          onDayChange={(nextDay) => {
            if (!Number.isInteger(nextDay) || nextDay < 1) {
              return;
            }

            setSelectedRouteDay(nextDay);
          }}
          onRetry={handleRetryRoutePlan}
        />
        <PlacesToVisit trip={trip} />
      </div>
    </section>
  );
}

export default Viewtrip;
