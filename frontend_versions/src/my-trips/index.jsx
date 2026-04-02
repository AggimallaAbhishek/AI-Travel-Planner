import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import UserTripCardItem from "./components/UserTripCardItem.jsx";
import { useAuth } from "@/context/AuthContext";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { toast } from "react-toastify";
import { buildLoginPath } from "@/lib/authRedirect";

function MyTrips() {
  const { user, loading, role, isAdmin, capabilities } = useAuth();
  const [userTrips, setUserTrips] = useState([]);
  const [isLoadingTrips, setIsLoadingTrips] = useState(false);
  const loginPath = buildLoginPath("/my-trips");

  useEffect(() => {
    const controller = new AbortController();

    if (!user) {
      setUserTrips([]);
      setIsLoadingTrips(false);
      return () => controller.abort();
    }

    async function loadTrips() {
      setIsLoadingTrips(true);

      try {
        const response = await apiFetch("/api/my-trips", {
          signal: controller.signal,
        });
        setUserTrips(response.trips ?? []);
      } catch (error) {
        // Native AbortError checking works now thanks to api.js fixes.
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        // The API layer automatically handles re-auth prompts for 401s,
        // so we don't need to show a redundant generic error toast here.
        if (error?.details?.requiresReauth) {
          return;
        }

        console.error("[my-trips] Failed to load trips", error);
        toast.error(error.message ?? "Unable to load your saved trips.");
      } finally {
        setIsLoadingTrips(false);
      }
    }

    loadTrips();

    return () => controller.abort();
  }, [user]);

  if (loading) {
    return (
      <section className="voy-trips-page">
        <div className="voy-page-shell py-16">
          <div className="voy-skeleton-block h-10 w-48 rounded" />
        </div>
      </section>
    );
  }

  if (!user) {
    return (
      <section className="voy-trips-page">
        <div className="voy-page-shell py-16">
          <div className="voy-trips-hero text-center">
            <h1 className="voy-page-title">My Trips</h1>
            <p className="voy-page-subtitle mx-auto max-w-xl">
            Sign in to access your saved itineraries and continue planning.
            </p>
            <Link to={loginPath}>
              <Button className="voy-create-primary mt-6">Sign In With Google</Button>
            </Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="voy-trips-page">
      <div className="voy-page-shell pb-16">
        <div className="voy-trips-hero">
          <h1 className="voy-page-title">My Trips</h1>
          <p className="voy-page-subtitle">
            {isAdmin
              ? "Admin view: listing all saved itineraries across users."
              : "View your recent itineraries and jump back into planning."}
          </p>
        </div>

        {isAdmin ? (
          <section className="voy-admin-panel mt-4" aria-live="polite">
            <div className="voy-admin-panel-head">
              <h3>Admin diagnostics</h3>
              <span className="voy-admin-panel-badge">Global trip access</span>
            </div>
            <p>
              Signed in as <strong>{user?.email ?? "unknown"}</strong> with role{" "}
              <strong>{role}</strong>. This page is loading all trips using backend
              cross-user access controls.
            </p>
            <div className="voy-admin-capabilities">
              <span>
                unrestrictedRateLimits:{" "}
                <strong>{capabilities?.unrestrictedRateLimits ? "enabled" : "disabled"}</strong>
              </span>
              <span>
                crossUserTripAccess:{" "}
                <strong>{capabilities?.crossUserTripAccess ? "enabled" : "disabled"}</strong>
              </span>
              <span>
                debugTools: <strong>{capabilities?.debugTools ? "enabled" : "disabled"}</strong>
              </span>
            </div>
          </section>
        ) : null}

        <div className="voy-trips-grid" aria-live="polite">
          {isLoadingTrips
            ? [1, 2, 3].map((item) => (
                <div
                  key={item}
                  className="voy-skeleton-block h-[280px] w-full rounded-2xl"
                />
              ))
            : userTrips.map((trip) => <UserTripCardItem key={trip.id} trip={trip} />)}
        </div>

        {!isLoadingTrips && userTrips.length === 0 ? (
          <div className="voy-trips-empty">
            <h3 className="text-xl font-semibold">No trips saved yet</h3>
            <p className="voy-page-subtitle mt-2">
              Create your first itinerary to see it appear here.
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export default MyTrips;
