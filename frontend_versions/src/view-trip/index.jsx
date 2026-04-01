import React, { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import InfoSection from "./components/InfoSection";
import Hotels from "./components/Hotels";
import Restaurants from "./components/Restaurants";
import PlacesToVisit from "./components/PlacesToVisit";
import UnifiedTripRouteMapSection from "./components/UnifiedTripRouteMapSection";
import { toast } from "react-toastify";
import { useAuth } from "@/context/AuthContext";
import { apiFetch } from "@/lib/api";
import { clearTripMapCache } from "@/lib/tripMap";
import { fetchTripRecommendations } from "@/lib/tripRecommendations";
import { replanTrip } from "@/lib/tripRoutes";
import { Button } from "@/components/ui/button";
import { buildLoginPath } from "@/lib/authRedirect";

const TRIP_DETAIL_REQUEST_TIMEOUT_MS = 25_000;

const INITIAL_RECOMMENDATION_STATE = {
  hotels: [],
  restaurants: [],
  provider: "",
  warning: "",
  destination: "",
  loading: false,
  errorMessage: "",
};

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
  const [disruptionDraft, setDisruptionDraft] = useState({
    type: "traffic_delay",
    dayNumber: 1,
    placeName: "",
  });
  const [replanLoading, setReplanLoading] = useState(false);
  const [recommendationReloadToken, setRecommendationReloadToken] = useState(0);
  const [tripReloadToken, setTripReloadToken] = useState(0);
  const loginPath = buildLoginPath(`${location.pathname}${location.search}${location.hash}`);
  const firstItineraryDayNumber =
    Array.isArray(trip?.itinerary?.days) && trip.itinerary.days.length > 0
      ? trip.itinerary.days[0].dayNumber
      : 1;

  useEffect(() => {
    const controller = new AbortController();

    if (!tripId || !user) {
      setLoading(false);
      setTrip(null);
      setRecommendations(INITIAL_RECOMMENDATION_STATE);
      console.info("[view-trip] Skipping trip detail load without trip id or authenticated user");
      return () => controller.abort();
    }

    async function loadTrip() {
      setLoading(true);
      setErrorMessage("");

      try {
        const response = await apiFetch(`/api/trips/${tripId}`, {
          signal: controller.signal,
          timeoutMs: TRIP_DETAIL_REQUEST_TIMEOUT_MS,
        });
        setTrip(response.trip ?? null);
      } catch (error) {
        if (error.name === "AbortError") {
          return;
        }

        console.error("[view-trip] Failed to load trip", error);
        setTrip(null);
        setRecommendations(INITIAL_RECOMMENDATION_STATE);
        setErrorMessage(error.message ?? "Unable to load this trip.");
        toast.error(error.message ?? "Unable to load this trip.");
      } finally {
        setLoading(false);
      }
    }

    loadTrip();

    return () => controller.abort();
  }, [tripId, user, tripReloadToken]);

  useEffect(() => {
    if (!trip?.userSelection) {
      return;
    }

    setDisruptionDraft((previous) => ({
      ...previous,
      dayNumber: firstItineraryDayNumber,
    }));
  }, [firstItineraryDayNumber, trip?.id, trip?.userSelection]);

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
        errorMessage: "A destination is required before hotels and restaurants can be loaded.",
      });
      return () => controller.abort();
    }

    async function loadRecommendations() {
      setRecommendations((previous) => ({
        ...previous,
        hotels: recommendationReloadToken > 0 ? [] : previous.hotels,
        restaurants: recommendationReloadToken > 0 ? [] : previous.restaurants,
        destination,
        loading: true,
        errorMessage: "",
      }));

      try {
        const response = await fetchTripRecommendations(trip.id, {
          signal: controller.signal,
          force: recommendationReloadToken > 0,
        });

        setRecommendations({
          ...response,
          loading: false,
          errorMessage: "",
        });
      } catch (error) {
        if (error.name === "AbortError") {
          return;
        }

        console.error("[view-trip] Failed to load recommendations", {
          tripId: trip.id,
          destination,
          message: error?.message,
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

  const handleReplan = async () => {
    if (!trip?.id) {
      return;
    }

    const trimmedPlace = disruptionDraft.placeName.trim();
    if (
      disruptionDraft.type !== "weather_change" &&
      disruptionDraft.type !== "traffic_delay" &&
      !trimmedPlace
    ) {
      toast.error("Select a place name for this disruption type.");
      return;
    }

    setReplanLoading(true);

    try {
      const payload = [
        {
          type: disruptionDraft.type,
          dayNumber: Number.parseInt(disruptionDraft.dayNumber, 10) || 1,
          placeName: trimmedPlace,
        },
      ];
      const response = await replanTrip(trip.id, payload);
      setTrip(response.trip ?? trip);
      clearTripMapCache(trip.id);
      setTripReloadToken((previous) => previous + 1);
      setRecommendationReloadToken((previous) => previous + 1);
      toast.success("Trip replanned with the selected disruption.");
    } catch (error) {
      console.error("[view-trip] Failed to replan trip", {
        tripId: trip?.id,
        message: error?.message,
      });
      toast.error(error?.message ?? "Unable to replan this trip right now.");
    } finally {
      setReplanLoading(false);
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
        <InfoSection trip={trip} />
        <section className="mt-10 rounded-2xl border border-[var(--voy-border)] bg-[var(--voy-surface)] p-6 shadow-md">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h3 className="text-xl font-semibold text-[var(--voy-text)]">
                Dynamic Replanning Simulator
              </h3>
              <p className="mt-1 text-sm text-[var(--voy-text-muted)]">
                Simulate a disruption and instantly regenerate a minimally changed itinerary.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="text-xs uppercase tracking-[0.14em] text-[var(--voy-text-faint)]">
                  Disruption Type
                </label>
                <select
                  className="voy-create-field mt-1 w-full"
                  value={disruptionDraft.type}
                  onChange={(event) =>
                    setDisruptionDraft((previous) => ({
                      ...previous,
                      type: event.target.value,
                    }))
                  }
                >
                  <option value="traffic_delay">Traffic delay</option>
                  <option value="poi_closed">POI closed</option>
                  <option value="weather_change">Weather change</option>
                  <option value="user_skip">User skip</option>
                </select>
              </div>

              <div>
                <label className="text-xs uppercase tracking-[0.14em] text-[var(--voy-text-faint)]">
                  Day Number
                </label>
                <input
                  className="voy-create-field mt-1 w-full"
                  type="number"
                  min={1}
                  max={trip?.userSelection?.days ?? 30}
                  value={disruptionDraft.dayNumber}
                  onChange={(event) =>
                    setDisruptionDraft((previous) => ({
                      ...previous,
                      dayNumber: event.target.value,
                    }))
                  }
                />
              </div>

              <div className="sm:col-span-2">
                <label className="text-xs uppercase tracking-[0.14em] text-[var(--voy-text-faint)]">
                  Place Name (optional for weather)
                </label>
                <input
                  className="voy-create-field mt-1 w-full"
                  placeholder="Ex. Louvre Museum"
                  value={disruptionDraft.placeName}
                  onChange={(event) =>
                    setDisruptionDraft((previous) => ({
                      ...previous,
                      placeName: event.target.value,
                    }))
                  }
                />
              </div>
            </div>
          </div>

          <div className="mt-4 flex justify-end">
            <Button
              className="voy-create-primary"
              onClick={handleReplan}
              disabled={replanLoading}
            >
              {replanLoading ? "Replanning..." : "Apply Disruption & Replan"}
            </Button>
          </div>
        </section>
        <UnifiedTripRouteMapSection
          trip={trip}
          reloadToken={tripReloadToken}
        />
        <Hotels
          trip={trip}
          hotels={recommendations.hotels}
          isLoading={recommendations.loading}
          errorMessage={recommendations.errorMessage}
          note={recommendations.warning}
          onRetry={handleRetryRecommendations}
        />
        <Restaurants
          trip={trip}
          restaurants={recommendations.restaurants}
          isLoading={recommendations.loading}
          errorMessage={recommendations.errorMessage}
          note={recommendations.warning}
          onRetry={handleRetryRecommendations}
        />
        <PlacesToVisit trip={trip} />
      </div>
    </section>
  );
}

export default Viewtrip;
