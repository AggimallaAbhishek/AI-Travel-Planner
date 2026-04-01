import React, { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import InfoSection from "./components/InfoSection";
import Hotels from "./components/Hotels";
import Restaurants from "./components/Restaurants";
import PlacesToVisit from "./components/PlacesToVisit";
import OptimizedRouteSection from "./components/OptimizedRouteSection";
import { toast } from "react-toastify";
import { useAuth } from "@/context/AuthContext";
import { apiFetch } from "@/lib/api";
import { fetchTripRecommendations } from "@/lib/tripRecommendations";
import { fetchTripRoutes } from "@/lib/tripRoutes";
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

const INITIAL_ROUTE_STATE = {
  days: [],
  destination: "",
  optimizeFor: "duration",
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
  const [routes, setRoutes] = useState(INITIAL_ROUTE_STATE);
  const [recommendationReloadToken, setRecommendationReloadToken] = useState(0);
  const [routeReloadToken, setRouteReloadToken] = useState(0);
  const loginPath = buildLoginPath(`${location.pathname}${location.search}${location.hash}`);

  useEffect(() => {
    const controller = new AbortController();

    if (!tripId || !user) {
      setLoading(false);
      setTrip(null);
      setRecommendations(INITIAL_RECOMMENDATION_STATE);
      setRoutes(INITIAL_ROUTE_STATE);
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
        setRecommendations(INITIAL_RECOMMENDATION_STATE);
        setRoutes(INITIAL_ROUTE_STATE);
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
      setRoutes(INITIAL_ROUTE_STATE);
      return () => controller.abort();
    }

    async function loadRoutes() {
      setRoutes((previous) => ({
        ...previous,
        days: routeReloadToken > 0 ? [] : previous.days,
        destination,
        loading: true,
        errorMessage: "",
      }));

      try {
        const response = await fetchTripRoutes(trip.id, {
          signal: controller.signal,
          force: routeReloadToken > 0,
        });

        setRoutes({
          ...response,
          destination,
          loading: false,
          errorMessage: "",
        });
      } catch (error) {
        if (error.name === "AbortError") {
          return;
        }

        console.error("[view-trip] Failed to load optimized routes", {
          tripId: trip.id,
          destination,
          message: error?.message,
        });

        setRoutes((previous) => ({
          ...previous,
          destination,
          loading: false,
          errorMessage:
            error.message ?? "Unable to load optimized trip routes right now.",
        }));
      }
    }

    loadRoutes();

    return () => controller.abort();
  }, [trip?.id, trip?.userSelection?.location?.label, user, routeReloadToken]);

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

  const handleRetryRoutes = () => {
    setRouteReloadToken((previous) => previous + 1);
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
        <OptimizedRouteSection
          routes={routes}
          isLoading={routes.loading}
          errorMessage={routes.errorMessage}
          onRetry={handleRetryRoutes}
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
