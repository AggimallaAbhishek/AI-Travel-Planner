import React, { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import InfoSection from "./components/InfoSection";
import Hotels from "./components/Hotels";
import PlacesToVisit from "./components/PlacesToVisit";
import { toast } from "react-toastify";
import { useAuth } from "@/context/AuthContext";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { buildLoginPath } from "@/lib/authRedirect";

function Viewtrip() {
  const { tripId } = useParams();
  const location = useLocation();
  const { user, loading: authLoading } = useAuth();
  const [trip, setTrip] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const loginPath = buildLoginPath(`${location.pathname}${location.search}${location.hash}`);

  useEffect(() => {
    const controller = new AbortController();

    if (!tripId || !user) {
      setLoading(false);
      setTrip(null);
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
        <Hotels trip={trip} />
        <PlacesToVisit trip={trip} />
      </div>
    </section>
  );
}

export default Viewtrip;
