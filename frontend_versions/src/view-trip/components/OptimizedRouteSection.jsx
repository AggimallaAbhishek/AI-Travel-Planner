import React, { useEffect, useMemo, useState } from "react";
import {
  FaClock,
  FaMapMarkedAlt,
  FaMapPin,
  FaRoute,
  FaRoad,
} from "react-icons/fa";
import { Button } from "@/components/ui/button";
import TripDayMap from "./TripDayMap";

function formatDuration(durationSeconds) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return "Duration unavailable";
  }

  const totalMinutes = Math.round(durationSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) {
    return `${totalMinutes} min`;
  }

  if (minutes === 0) {
    return `${hours} hr`;
  }

  return `${hours} hr ${minutes} min`;
}

function formatDistance(distanceMeters) {
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) {
    return "Distance unavailable";
  }

  if (distanceMeters < 950) {
    return `${Math.max(50, Math.round(distanceMeters / 50) * 50)} m`;
  }

  return `${(distanceMeters / 1000).toFixed(1)} km`;
}

function formatStatusLabel(dayRoute = {}) {
  if (dayRoute.status === "ready") {
    return "Route ready";
  }

  if (dayRoute.status === "insufficient-geocoded-stops") {
    return "More geocodes needed";
  }

  return "Needs more places";
}

function resolveActiveDayNumber(dayRoutes = [], selectedDayDefault, activeDayNumber) {
  if (dayRoutes.length === 0) {
    return null;
  }

  if (
    activeDayNumber !== null &&
    dayRoutes.some((dayRoute) => dayRoute.dayNumber === activeDayNumber)
  ) {
    return activeDayNumber;
  }

  if (
    selectedDayDefault !== null &&
    dayRoutes.some((dayRoute) => dayRoute.dayNumber === selectedDayDefault)
  ) {
    return selectedDayDefault;
  }

  return dayRoutes[0]?.dayNumber ?? null;
}

function LoadingLayout() {
  return (
    <div className="mt-10 grid gap-6 xl:grid-cols-[0.95fr_1.35fr]">
      <div className="space-y-5">
        <div className="rounded-[1.8rem] border border-[var(--voy-border)] bg-[var(--voy-surface2)] p-5">
          <div className="h-5 w-40 animate-pulse rounded bg-[var(--voy-bg2)]" />
          <div className="mt-4 space-y-3">
            {[1, 2, 3].map((item) => (
              <div
                key={item}
                className="h-20 animate-pulse rounded-2xl bg-[var(--voy-bg2)]"
              />
            ))}
          </div>
        </div>
        <div className="rounded-[1.8rem] border border-[var(--voy-border)] bg-[var(--voy-surface2)] p-5">
          <div className="h-6 w-1/2 animate-pulse rounded bg-[var(--voy-bg2)]" />
          <div className="mt-4 h-24 animate-pulse rounded-2xl bg-[var(--voy-bg2)]" />
          <div className="mt-4 h-48 animate-pulse rounded-2xl bg-[var(--voy-bg2)]" />
        </div>
      </div>
      <div className="rounded-[2rem] border border-[var(--voy-border)] bg-[var(--voy-surface2)] p-4">
        <div className="h-[420px] animate-pulse rounded-[1.75rem] bg-[var(--voy-bg2)] lg:h-[620px]" />
      </div>
    </div>
  );
}

function DaySelector({ dayRoutes, activeDayNumber, onSelectDay }) {
  return (
    <div className="rounded-[1.8rem] border border-[var(--voy-border)] bg-[var(--voy-surface)] p-5 shadow-md">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-[var(--voy-text-faint)]">
            Day Maps
          </p>
          <h3 className="mt-1 text-xl font-semibold text-[var(--voy-text)]">
            Switch itinerary days
          </h3>
        </div>
        <span className="rounded-full border border-[var(--voy-border)] bg-[var(--voy-surface2)] px-3 py-1 text-xs text-[var(--voy-text-muted)]">
          Shared city map
        </span>
      </div>

      <div className="mt-4 space-y-3">
        {dayRoutes.map((dayRoute) => {
          const isActive = dayRoute.dayNumber === activeDayNumber;

          return (
            <button
              key={`route-day-selector-${dayRoute.dayNumber}`}
              type="button"
              onClick={() => onSelectDay(dayRoute.dayNumber)}
              className={`w-full rounded-[1.5rem] border px-4 py-4 text-left transition ${
                isActive
                  ? "border-[var(--voy-gold)] bg-[rgba(201,164,92,0.12)] shadow-sm"
                  : "border-[var(--voy-border)] bg-[var(--voy-surface2)] hover:border-[var(--voy-gold)]/60"
              }`}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.22em] text-[var(--voy-text-faint)]">
                    Day {dayRoute.dayNumber}
                  </p>
                  <p className="mt-1 text-lg font-semibold text-[var(--voy-text)]">
                    {dayRoute.title}
                  </p>
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-xs ${
                    dayRoute.status === "ready"
                      ? "bg-[var(--voy-gold-dim)] text-[var(--voy-gold)]"
                      : "border border-[var(--voy-border)] bg-[var(--voy-surface)] text-[var(--voy-text-muted)]"
                  }`}
                >
                  {formatStatusLabel(dayRoute)}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SummaryCards({ dayRoute }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-2xl border border-[var(--voy-border)] bg-[var(--voy-surface2)] p-4">
        <div className="flex items-center gap-2 text-sm text-[var(--voy-text-muted)]">
          <FaRoad className="text-[var(--voy-gold)]" />
          <span>Total distance</span>
        </div>
        <p className="mt-2 text-lg font-semibold text-[var(--voy-text)]">
          {formatDistance(dayRoute.totalDistanceMeters)}
        </p>
      </div>
      <div className="rounded-2xl border border-[var(--voy-border)] bg-[var(--voy-surface2)] p-4">
        <div className="flex items-center gap-2 text-sm text-[var(--voy-text-muted)]">
          <FaClock className="text-[var(--voy-gold)]" />
          <span>Total travel time</span>
        </div>
        <p className="mt-2 text-lg font-semibold text-[var(--voy-text)]">
          {formatDuration(dayRoute.totalDurationSeconds)}
        </p>
      </div>
    </div>
  );
}

function StopList({
  dayRoute,
  highlightedStopId,
  onHighlightStop,
}) {
  const orderedStops = Array.isArray(dayRoute?.orderedStops) ? dayRoute.orderedStops : [];
  const title =
    dayRoute?.status === "ready" ? "Optimized stop order" : "Recognized places";

  return (
    <div className="rounded-[1.8rem] border border-[var(--voy-border)] bg-[var(--voy-surface)] p-5 shadow-md">
      <div className="flex items-center gap-2 text-sm font-medium text-[var(--voy-text)]">
        <FaRoute className="text-[var(--voy-gold)]" />
        <span>{title}</span>
      </div>
      <p className="mt-2 text-sm text-[var(--voy-text-muted)]">
        Hover or click a stop to highlight the matching map marker.
      </p>

      <div className="mt-4 space-y-3">
        {orderedStops.length === 0 ? (
          <div className="rounded-2xl border border-[var(--voy-border)] bg-[var(--voy-surface2)] px-4 py-5 text-sm text-[var(--voy-text-muted)]">
            No mapped places are available for this day yet.
          </div>
        ) : (
          orderedStops.map((stop, index) => {
            const stopId = stop.id ?? `${dayRoute?.dayNumber}-${index}`;
            const isHighlighted = highlightedStopId === stopId;

            return (
              <button
                key={`${dayRoute?.dayNumber}-${stopId}`}
                type="button"
                onMouseEnter={() => onHighlightStop(stopId)}
                onMouseLeave={() => onHighlightStop(null)}
                onClick={() => onHighlightStop(stopId)}
                className={`flex w-full items-start gap-3 rounded-2xl border px-4 py-4 text-left transition ${
                  isHighlighted
                    ? "border-[var(--voy-gold)] bg-[rgba(201,164,92,0.12)] shadow-sm"
                    : "border-[var(--voy-border)] bg-[var(--voy-surface2)] hover:border-[var(--voy-gold)]/60"
                }`}
              >
                <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--voy-gold)] text-xs font-semibold text-black">
                  {index + 1}
                </span>
                <div className="min-w-0">
                  <p className="font-medium text-[var(--voy-text)]">{stop.name}</p>
                  <p className="mt-1 text-sm text-[var(--voy-text-muted)]">
                    {stop.location || "Location unavailable"}
                  </p>
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

function ActiveDayDetails({
  dayRoute,
  destination,
  highlightedStopId,
  onHighlightStop,
}) {
  if (!dayRoute) {
    return (
      <div className="rounded-[1.8rem] border border-[var(--voy-border)] bg-[var(--voy-surface)] px-6 py-10 text-center shadow-md">
        <h3 className="text-2xl font-semibold text-[var(--voy-text)]">
          Route optimization is not available yet
        </h3>
        <p className="mx-auto mt-3 max-w-xl text-[var(--voy-text-muted)]">
          Add at least two recognizable places to a day itinerary to compute an optimized route.
        </p>
      </div>
    );
  }

  return (
    <article className="rounded-[1.8rem] border border-[var(--voy-border)] bg-[var(--voy-surface)] p-6 shadow-md">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-[var(--voy-text-faint)]">
            Day {dayRoute.dayNumber}
          </p>
          <h3 className="mt-1 text-2xl font-semibold text-[var(--voy-text)]">
            {dayRoute.title}
          </h3>
          <p className="mt-2 text-sm text-[var(--voy-text-muted)]">
            The city map is scoped to {destination || "the selected destination"} and only plots this day’s recognized itinerary places.
          </p>
        </div>

        <div className="flex flex-wrap gap-2 text-xs">
          <span className="rounded-full border border-[var(--voy-border)] bg-[var(--voy-surface2)] px-3 py-1 text-[var(--voy-text-muted)]">
            {dayRoute.algorithm}
          </span>
          <span className="rounded-full bg-[var(--voy-gold-dim)] px-3 py-1 text-[var(--voy-gold)]">
            {dayRoute.routeProvider}
          </span>
          <span className="rounded-full border border-[var(--voy-border)] bg-[var(--voy-surface2)] px-3 py-1 text-[var(--voy-text-muted)]">
            {dayRoute.objectiveLabel}
          </span>
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-[var(--voy-border)] bg-[var(--voy-surface2)] p-4">
        <div className="flex items-center gap-2 text-sm font-medium text-[var(--voy-text)]">
          <FaMapPin className="text-[var(--voy-gold)]" />
          <span>City-scoped map sync</span>
        </div>
        <p className="mt-2 text-sm text-[var(--voy-text-muted)]">
          Switching days updates the map markers and route instantly. Marker clicks on the map and place selection here stay synchronized.
        </p>
      </div>

      <div className="mt-5">
        <SummaryCards dayRoute={dayRoute} />
      </div>

      <div className="mt-5">
        <StopList
          dayRoute={dayRoute}
          highlightedStopId={highlightedStopId}
          onHighlightStop={onHighlightStop}
        />
      </div>

      {dayRoute.warning ? (
        <div className="mt-5 rounded-2xl border border-[var(--voy-border)] bg-[var(--voy-surface2)] px-4 py-3 text-sm text-[var(--voy-text-muted)]">
          {dayRoute.warning}
        </div>
      ) : null}

      {dayRoute.directionsUrl ? (
        <div className="mt-5">
          <a
            href={dayRoute.directionsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex"
          >
            <Button className="voy-create-primary inline-flex items-center gap-2">
              <FaMapMarkedAlt />
              <span>Open Route In Google Maps</span>
            </Button>
          </a>
        </div>
      ) : null}
    </article>
  );
}

function OptimizedRouteSection({
  routes,
  isLoading = false,
  errorMessage = "",
  onRetry,
}) {
  const dayRoutes = useMemo(
    () => (Array.isArray(routes?.days) ? routes.days : []),
    [routes?.days]
  );
  const [activeDayNumber, setActiveDayNumber] = useState(null);
  const [highlightedStopId, setHighlightedStopId] = useState(null);

  useEffect(() => {
    const nextActiveDayNumber = resolveActiveDayNumber(
      dayRoutes,
      routes?.selectedDayDefault ?? null,
      activeDayNumber
    );

    if (nextActiveDayNumber !== activeDayNumber) {
      console.info("[optimized-routes] Updating active day", {
        activeDayNumber: nextActiveDayNumber,
      });
      setActiveDayNumber(nextActiveDayNumber);
    }
  }, [activeDayNumber, dayRoutes, routes?.selectedDayDefault]);

  useEffect(() => {
    setHighlightedStopId(null);
  }, [activeDayNumber]);

  const activeDayRoute =
    dayRoutes.find((dayRoute) => dayRoute.dayNumber === activeDayNumber) ??
    dayRoutes[0] ??
    null;
  const skippedRoutes = dayRoutes.filter((dayRoute) => dayRoute.status !== "ready");

  const handleSelectDay = (dayNumber) => {
    console.info("[optimized-routes] Day selected for shared map", {
      dayNumber,
    });
    setActiveDayNumber(dayNumber);
  };

  return (
    <section className="mt-10 w-full px-0 py-8 md:px-2">
      <div className="mx-auto max-w-7xl rounded-2xl border border-[var(--voy-border)] bg-[var(--voy-surface)] p-8 shadow-lg">
        <div className="text-center">
          <h2 className="text-3xl font-semibold text-[var(--voy-text)] md:text-4xl">
            Optimized Daily Routes
          </h2>
          <p className="mx-auto mt-3 max-w-3xl text-md text-[var(--voy-text-muted)]">
            Every itinerary day now shares a city-focused map. The plotted markers and route update as you switch days, keeping the itinerary and map in sync.
          </p>
        </div>

        {isLoading ? <LoadingLayout /> : null}

        {!isLoading && errorMessage ? (
          <div className="mt-10 rounded-2xl border border-[var(--voy-border)] bg-[var(--voy-surface2)] px-6 py-10 text-center">
            <h3 className="text-2xl font-semibold text-[var(--voy-text)]">
              Unable to load optimized routes
            </h3>
            <p className="mx-auto mt-3 max-w-xl text-[var(--voy-text-muted)]">
              {errorMessage}
            </p>
            {onRetry ? (
              <Button className="voy-create-primary mt-6" onClick={onRetry}>
                Try Again
              </Button>
            ) : null}
          </div>
        ) : null}

        {!isLoading && !errorMessage && dayRoutes.length > 0 ? (
          <div className="mt-10 grid gap-6 xl:grid-cols-[0.95fr_1.35fr]">
            <div className="space-y-5">
              <DaySelector
                dayRoutes={dayRoutes}
                activeDayNumber={activeDayNumber}
                onSelectDay={handleSelectDay}
              />
              <ActiveDayDetails
                dayRoute={activeDayRoute}
                destination={routes?.destination ?? ""}
                highlightedStopId={highlightedStopId}
                onHighlightStop={setHighlightedStopId}
              />
              {skippedRoutes.length > 0 ? (
                <div className="rounded-2xl border border-[var(--voy-border)] bg-[var(--voy-surface2)] px-5 py-4 text-sm text-[var(--voy-text-muted)]">
                  Route-ready days are still limited. Needs attention:{" "}
                  {skippedRoutes.map((dayRoute) => `Day ${dayRoute.dayNumber}`).join(", ")}.
                </div>
              ) : null}
            </div>

            <div className="space-y-4">
              <div className="rounded-[1.8rem] border border-[var(--voy-border)] bg-[var(--voy-surface)] p-5 shadow-md">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.24em] text-[var(--voy-text-faint)]">
                      City map
                    </p>
                    <h3 className="mt-1 text-xl font-semibold text-[var(--voy-text)]">
                      {routes?.destination || "Selected destination"}
                    </h3>
                  </div>
                  <span className="rounded-full border border-[var(--voy-border)] bg-[var(--voy-surface2)] px-3 py-1 text-xs text-[var(--voy-text-muted)]">
                    Day {activeDayRoute?.dayNumber ?? "—"} only
                  </span>
                </div>
                <p className="mt-2 text-sm text-[var(--voy-text-muted)]">
                  The shared map stays constrained to the destination city bounds and displays only the active day’s pinned itinerary places and optimized route.
                </p>
              </div>

              <TripDayMap
                dayRoute={activeDayRoute}
                destination={routes?.destination ?? ""}
                highlightedStopId={highlightedStopId}
                onHighlightStop={setHighlightedStopId}
              />
            </div>
          </div>
        ) : null}

        {!isLoading && !errorMessage && dayRoutes.length === 0 ? (
          <div className="mt-10 rounded-2xl border border-[var(--voy-border)] bg-[var(--voy-surface2)] px-6 py-12 text-center">
            <h3 className="text-2xl font-semibold text-[var(--voy-text)]">
              Route optimization is not available yet
            </h3>
            <p className="mx-auto mt-3 max-w-2xl text-[var(--voy-text-muted)]">
              Add at least two recognizable places to a day itinerary to compute an optimized route.
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export default OptimizedRouteSection;
