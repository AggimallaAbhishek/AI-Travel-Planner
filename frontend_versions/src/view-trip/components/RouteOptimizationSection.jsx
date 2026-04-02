import React from "react";
import { Button } from "@/components/ui/button";
import {
  FaRoute,
  FaMapMarkerAlt,
  FaRoad,
  FaClock,
  FaRedoAlt,
  FaStar,
} from "react-icons/fa";

function formatDistanceMeters(distanceMeters) {
  const distance = Number.parseFloat(distanceMeters);
  if (!Number.isFinite(distance) || distance <= 0) {
    return "N/A";
  }

  if (distance < 1_000) {
    return `${Math.round(distance)} m`;
  }

  return `${(distance / 1_000).toFixed(1)} km`;
}

function formatTimestamp(value) {
  if (typeof value !== "string" || !value) {
    return "";
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return value;
  }

  return new Date(timestamp).toLocaleString();
}

function RouteOptimizationSection({
  routeData,
  selectedDay = 1,
  onDayChange,
  isLoading = false,
  errorMessage = "",
  onRetry,
}) {
  const totalDays = Math.max(1, routeData?.totalDays ?? 1);
  const route = routeData?.route ?? {
    day: selectedDay,
    stopCount: 0,
    stops: [],
  };
  const planningMeta = routeData?.planningMeta ?? {};
  const optimization = routeData?.optimization ?? {};
  const totalDistance = formatDistanceMeters(optimization.totalWeight);
  const hasStops = Array.isArray(route.stops) && route.stops.length > 0;

  return (
    <section className="relative mt-10 w-full px-0 py-8 md:px-2" aria-live="polite">
      <div className="relative mx-auto max-w-7xl rounded-2xl border border-[var(--voy-border)] bg-[var(--voy-surface)] p-8 shadow-lg">
        <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="flex items-center gap-3 text-3xl font-semibold text-[var(--voy-text)] md:text-4xl">
              <FaRoute className="text-[var(--voy-gold)]" />
              Optimized Route Plan
            </h2>
            <p className="mt-3 max-w-3xl text-md text-[var(--voy-text-muted)]">
              Daily stops are selected and ordered using graph-based optimization, with LLM
              output limited to narrative enrichment.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <label className="inline-flex items-center gap-2 rounded-xl border border-[var(--voy-border)] bg-[var(--voy-surface2)] px-3 py-2 text-sm text-[var(--voy-text-muted)]">
              <FaClock className="text-[var(--voy-gold)]" />
              <span>Day</span>
              <select
                className="bg-transparent font-medium text-[var(--voy-text)] outline-none"
                value={selectedDay}
                onChange={(event) => onDayChange?.(Number.parseInt(event.target.value, 10))}
                disabled={isLoading}
              >
                {Array.from({ length: totalDays }, (_unused, index) => (
                  <option key={`route-day-${index + 1}`} value={index + 1}>
                    {index + 1}
                  </option>
                ))}
              </select>
            </label>

            {onRetry ? (
              <Button
                type="button"
                className="voy-create-primary"
                onClick={onRetry}
                disabled={isLoading}
              >
                <FaRedoAlt className={isLoading ? "animate-spin" : ""} />
                <span className="ml-2">Refresh Route</span>
              </Button>
            ) : null}
          </div>
        </div>

        <div className="mb-6 grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-[var(--voy-border)] bg-[var(--voy-surface2)] p-4">
            <p className="text-xs uppercase tracking-wider text-[var(--voy-text-faint)]">
              Objective
            </p>
            <p className="mt-2 text-lg font-semibold text-[var(--voy-text)]">
              {optimization.objective || "minimize_total_distance"}
            </p>
          </div>
          <div className="rounded-2xl border border-[var(--voy-border)] bg-[var(--voy-surface2)] p-4">
            <p className="text-xs uppercase tracking-wider text-[var(--voy-text-faint)]">
              Total Distance
            </p>
            <p className="mt-2 flex items-center gap-2 text-lg font-semibold text-[var(--voy-text)]">
              <FaRoad className="text-[var(--voy-gold)]" />
              {totalDistance}
            </p>
          </div>
          <div className="rounded-2xl border border-[var(--voy-border)] bg-[var(--voy-surface2)] p-4">
            <p className="text-xs uppercase tracking-wider text-[var(--voy-text-faint)]">
              Algorithm
            </p>
            <p className="mt-2 text-lg font-semibold text-[var(--voy-text)]">
              {planningMeta.algorithmVersion || optimization.algorithmVersion || "N/A"}
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="grid gap-3">
            {[1, 2, 3].map((row) => (
              <div
                key={`route-loading-${row}`}
                className="h-20 animate-pulse rounded-2xl bg-[var(--voy-surface2)]"
              />
            ))}
          </div>
        ) : null}

        {!isLoading && errorMessage ? (
          <div className="rounded-2xl border border-[var(--voy-border)] bg-[var(--voy-surface2)] px-6 py-10 text-center">
            <h3 className="text-2xl font-semibold text-[var(--voy-text)]">
              Unable to load route optimization
            </h3>
            <p className="mx-auto mt-3 max-w-xl text-[var(--voy-text-muted)]">
              {errorMessage}
            </p>
          </div>
        ) : null}

        {!isLoading && !errorMessage && hasStops ? (
          <div className="space-y-3">
            {route.stops.map((stop, index) => (
              <article
                key={`${stop.placeId || stop.name}-${index}`}
                className="rounded-2xl border border-[var(--voy-border)] bg-[var(--voy-surface2)] p-4 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-md"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-wider text-[var(--voy-text-faint)]">
                      Stop {stop.order}
                    </p>
                    <h3 className="text-xl font-semibold text-[var(--voy-text)]">{stop.name}</h3>
                    <p className="mt-1 flex items-center gap-2 text-sm text-[var(--voy-text-muted)]">
                      <FaMapMarkerAlt className="text-[var(--voy-gold)]" />
                      {stop.address || "Address unavailable"}
                    </p>
                  </div>
                  {typeof stop.rating === "number" ? (
                    <span className="inline-flex items-center gap-2 rounded-full bg-[var(--voy-gold-dim)] px-3 py-1 text-xs font-medium text-[var(--voy-gold)]">
                      <FaStar />
                      {stop.rating.toFixed(1)}
                    </span>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        ) : null}

        {!isLoading && !errorMessage && !hasStops ? (
          <div className="rounded-2xl border border-[var(--voy-border)] bg-[var(--voy-surface2)] px-6 py-10 text-center">
            <h3 className="text-2xl font-semibold text-[var(--voy-text)]">No route stops yet</h3>
            <p className="mx-auto mt-3 max-w-xl text-[var(--voy-text-muted)]">
              Add more destination data or refresh this route to compute optimized stop ordering.
            </p>
          </div>
        ) : null}

        {(planningMeta.generatedAt || planningMeta.freshness) && !isLoading ? (
          <div className="mt-6 rounded-xl border border-[var(--voy-border)] bg-[var(--voy-bg2)] px-4 py-3 text-xs text-[var(--voy-text-faint)]">
            {planningMeta.generatedAt ? (
              <p>Generated: {formatTimestamp(planningMeta.generatedAt)}</p>
            ) : null}
            {planningMeta.freshness ? (
              <p>Fresh Until: {formatTimestamp(planningMeta.freshness)}</p>
            ) : null}
            {planningMeta.dataProvider ? <p>Data Source: {planningMeta.dataProvider}</p> : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

export default RouteOptimizationSection;

