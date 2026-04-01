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
import { Button } from "@/components/ui/button";
import { buildLoginPath } from "@/lib/authRedirect";

const INITIAL_RECOMMENDATION_STATE = {
  hotels: [],
  restaurants: [],
  provider: "",
  warning: "",
  destination: "",
  loading: false,
  errorMessage: "",
};

function toTripHotelRecommendationItem(hotel = {}) {
  const name = hotel.hotelName || "Recommended Hotel";
  const location = hotel.hotelAddress || "Location details unavailable";
  const rating = Number.parseFloat(hotel.rating);

  return {
    name,
    imageUrl: hotel.hotelImageUrl || "",
    rating: Number.isFinite(rating) ? rating : null,
    location,
    description:
      hotel.description ||
      "Hotel recommendation generated from your itinerary preferences.",
    priceLabel: hotel.price || "",
    mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      `${name}, ${location}`
    )}`,
    geoCoordinates: {
      latitude: hotel?.geoCoordinates?.latitude ?? null,
      longitude: hotel?.geoCoordinates?.longitude ?? null,
    },
  };
}

function mapTripHotelsToRecommendationItems(hotels = []) {
  if (!Array.isArray(hotels)) {
    return [];
  }

  return hotels.map((hotel) => toTripHotelRecommendationItem(hotel));
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
  const loginPath = buildLoginPath(`${location.pathname}${location.search}${location.hash}`);

  const fallbackHotelRecommendations = useMemo(
    () => mapTripHotelsToRecommendationItems(trip?.hotels),
    [trip?.hotels]
  );
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

  useEffect(() => {
    const controller = new AbortController();

    if (!tripId || !user) {
      setLoading(false);
      setTrip(null);
      setRecommendations(INITIAL_RECOMMENDATION_STATE);
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
      } catch (error) {
        if (error.name === "AbortError") {
          return;
        }

        console.error("[view-trip] Failed to load trip", error);
        setTrip(null);
        setErrorMessage(error.message ?? "Unable to load this trip.");
        toast.error(error.message ?? "Unable to load this trip.");
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
        if (controller.signal.aborted) {
          return;
        }

        console.error("[view-trip] Failed to load destination recommendations", {
          tripId: trip.id,
          destination,
          message: error?.message,
          status: error?.status ?? null,
        });
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

  const handleRetryRecommendations = () => {
    setRecommendationReloadToken((previous) => previous + 1);
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
        <InfoSection trip={trip} />
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
        <PlacesToVisit trip={trip} />
      </div>
    </section>
  );
}

export default Viewtrip;
