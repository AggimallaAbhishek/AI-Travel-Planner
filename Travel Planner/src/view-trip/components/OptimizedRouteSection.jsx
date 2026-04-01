import React from "react";
import {
  FaClock,
  FaCoins,
  FaMapMarkedAlt,
  FaRoute,
  FaRoad,
  FaStar,
} from "react-icons/fa";
import { Button } from "@/components/ui/button";
import { decodeGooglePolyline, normalizeGeoCoordinates } from "@/lib/maps";

function formatDuration(durationSeconds) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return "Duration unavailable";
  }

  const totalMinutes = Math.round(durationSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) {
    return `${minutes} min`;
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

function formatCost(value) {
  if (!Number.isFinite(value) || value <= 0) {
    return "Cost unavailable";
  }

  return `~₹${Math.round(value).toLocaleString()}`;
}

const OBJECTIVE_OPTIONS = [
  { value: "fastest", label: "Fastest" },
  { value: "cheapest", label: "Cheapest" },
  { value: "best_experience", label: "Best Experience" },
];

function getPreviewCoordinates(dayRoute) {
  const decodedPolyline = decodeGooglePolyline(dayRoute?.polyline);
  if (decodedPolyline.length >= 2) {
    return decodedPolyline;
  }

  const orderedStops = Array.isArray(dayRoute?.orderedStops)
    ? dayRoute.orderedStops
    : [];

  const coordinates = orderedStops
    .map((stop) => normalizeGeoCoordinates(stop.geoCoordinates))
    .filter(
      (coordinates) =>
        coordinates.latitude !== null && coordinates.longitude !== null
    );

  const bounds = dayRoute?.cityBounds;
  if (bounds) {
    coordinates.push(
      { latitude: bounds.north, longitude: bounds.east },
      { latitude: bounds.south, longitude: bounds.west }
    );
  }

  return coordinates;
}

function projectPreviewPoints(coordinates = []) {
  if (coordinates.length < 2) {
    return [];
  }

  const latitudes = coordinates.map((point) => point.latitude);
  const longitudes = coordinates.map((point) => point.longitude);
  const minLatitude = Math.min(...latitudes);
  const maxLatitude = Math.max(...latitudes);
  const minLongitude = Math.min(...longitudes);
  const maxLongitude = Math.max(...longitudes);
  const latitudeSpan = Math.max(0.0001, maxLatitude - minLatitude);
  const longitudeSpan = Math.max(0.0001, maxLongitude - minLongitude);

  return coordinates.map((point) => ({
    x: 10 + ((point.longitude - minLongitude) / longitudeSpan) * 80,
    y: 88 - ((point.latitude - minLatitude) / latitudeSpan) * 76,
  }));
}

function RoutePreview({ dayRoute }) {
  const previewPoints = projectPreviewPoints(getPreviewCoordinates(dayRoute));

  if (previewPoints.length < 2) {
    return (
      <div className="flex h-40 items-center justify-center rounded-2xl border border-[var(--voy-border)] bg-[var(--voy-surface2)] text-sm text-[var(--voy-text-faint)]">
        Route preview is not available for these stops yet.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-[var(--voy-border)] bg-[radial-gradient(circle_at_top,_rgba(201,164,92,0.18),_transparent_55%),var(--voy-surface2)]">
      <svg
        viewBox="0 0 100 100"
        className="h-40 w-full"
        role="img"
        aria-label={`${dayRoute.title} route preview`}
      >
        <defs>
          <linearGradient id={`route-gradient-${dayRoute.dayNumber}`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="var(--voy-gold-light)" />
            <stop offset="100%" stopColor="var(--voy-gold)" />
          </linearGradient>
        </defs>
        <polyline
          fill="none"
          stroke={`url(#route-gradient-${dayRoute.dayNumber})`}
          strokeWidth="2.75"
          strokeLinejoin="round"
          strokeLinecap="round"
          points={previewPoints.map((point) => `${point.x},${point.y}`).join(" ")}
        />
        {previewPoints.map((point, index) => (
          <g key={`${dayRoute.dayNumber}-point-${index}`}>
            <circle
              cx={point.x}
              cy={point.y}
              r={index === 0 || index === previewPoints.length - 1 ? 3.5 : 2.4}
              fill="var(--voy-surface)"
              stroke="var(--voy-gold)"
              strokeWidth="1.6"
            />
            <text
              x={point.x}
              y={point.y - 5}
              textAnchor="middle"
              fontSize="4"
              fill="var(--voy-text)"
            >
              {index + 1}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function LoadingCards() {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {[1, 2].map((item) => (
        <div
          key={item}
          className="overflow-hidden rounded-2xl border border-[var(--voy-border)] bg-[var(--voy-surface)] p-6 shadow-md"
        >
          <div className="h-6 w-1/3 animate-pulse rounded bg-[var(--voy-bg2)]" />
          <div className="mt-4 h-40 animate-pulse rounded-2xl bg-[var(--voy-bg2)]" />
          <div className="mt-4 h-4 w-2/3 animate-pulse rounded bg-[var(--voy-bg2)]" />
          <div className="mt-2 h-4 w-1/2 animate-pulse rounded bg-[var(--voy-bg2)]" />
        </div>
      ))}
    </div>
  );
}

function RouteDayCard({ dayRoute }) {
  return (
    <article className="overflow-hidden rounded-2xl border border-[var(--voy-border)] bg-[var(--voy-surface)] p-6 shadow-md">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-[var(--voy-text-faint)]">
            Day {dayRoute.dayNumber}
          </p>
          <h3 className="mt-1 text-2xl font-semibold text-[var(--voy-text)]">
            {dayRoute.title}
          </h3>
        </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="rounded-full border border-[var(--voy-border)] bg-[var(--voy-surface2)] px-3 py-1 text-[var(--voy-text-muted)]">
              {dayRoute.algorithm}
            </span>
            <span className="rounded-full bg-[var(--voy-gold-dim)] px-3 py-1 text-[var(--voy-gold)]">
              {dayRoute.routeProvider}
            </span>
            <span className="rounded-full border border-[var(--voy-border)] bg-[var(--voy-surface2)] px-3 py-1 text-[var(--voy-text-muted)]">
              City scoped
            </span>
          </div>
        </div>

      <div className="mt-5 grid gap-4 md:grid-cols-[1.2fr_0.8fr]">
        <RoutePreview dayRoute={dayRoute} />

        <div className="space-y-4">
          {dayRoute.cityBounds &&
          Number.isFinite(dayRoute.cityBounds.north) &&
          Number.isFinite(dayRoute.cityBounds.south) &&
          Number.isFinite(dayRoute.cityBounds.east) &&
          Number.isFinite(dayRoute.cityBounds.west) ? (
            <div className="rounded-2xl border border-[var(--voy-border)] bg-[var(--voy-surface2)] p-3 text-xs text-[var(--voy-text-muted)]">
              Map constrained to city bounds (N {dayRoute.cityBounds.north.toFixed(3)}, S {dayRoute.cityBounds.south.toFixed(3)}, E {dayRoute.cityBounds.east.toFixed(3)}, W {dayRoute.cityBounds.west.toFixed(3)}).
            </div>
          ) : null}

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

          <div className="rounded-2xl border border-[var(--voy-border)] bg-[var(--voy-surface2)] p-4">
            <div className="flex items-center gap-2 text-sm font-medium text-[var(--voy-text)]">
              <FaRoute className="text-[var(--voy-gold)]" />
              <span>Optimized stop order</span>
            </div>
            <ol className="mt-3 space-y-2">
              {(dayRoute.orderedStops ?? []).map((stop, index) => (
                <li
                  key={`${dayRoute.dayNumber}-${stop.id ?? stop.name}`}
                  className="flex items-start gap-3 rounded-xl border border-[var(--voy-border)] bg-[var(--voy-surface)] px-3 py-3"
                >
                  <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--voy-gold)] text-xs font-semibold text-black">
                    {index + 1}
                  </span>
                  <div>
                    <p className="font-medium text-[var(--voy-text)]">{stop.name}</p>
                    <p className="text-sm text-[var(--voy-text-muted)]">
                      {stop.location || "Location unavailable"}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          {dayRoute.warning ? (
            <div className="rounded-2xl border border-[var(--voy-border)] bg-[var(--voy-surface2)] px-4 py-3 text-sm text-[var(--voy-text-muted)]">
              {dayRoute.warning}
            </div>
          ) : null}

          {dayRoute.directionsUrl ? (
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
          ) : null}
        </div>
      </div>
    </article>
  );
}

function OptimizedRouteSection({
  routes,
  isLoading = false,
  errorMessage = "",
  onRetry,
}) {
  const dayRoutes = Array.isArray(routes?.days) ? routes.days : [];
  const readyRoutes = dayRoutes.filter((dayRoute) => dayRoute.status === "ready");
  const skippedRoutes = dayRoutes.filter((dayRoute) => dayRoute.status !== "ready");

  return (
    <section className="mt-10 w-full px-0 py-8 md:px-2">
      <div className="mx-auto max-w-7xl rounded-2xl border border-[var(--voy-border)] bg-[var(--voy-surface)] p-8 shadow-lg">
        <div className="text-center">
          <h2 className="text-3xl font-semibold text-[var(--voy-text)] md:text-4xl">
            Optimized Daily Routes
          </h2>
          <p className="mx-auto mt-3 max-w-3xl text-md text-[var(--voy-text-muted)]">
            Route planning uses Google Places and Routes data when available, then applies graph-based optimization to order the day’s stops efficiently.
          </p>
        </div>

        {isLoading ? <div className="mt-10"><LoadingCards /></div> : null}

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

        {!isLoading && !errorMessage && readyRoutes.length > 0 ? (
          <div className="mt-10 grid gap-6">
            {readyRoutes.map((dayRoute) => (
              <RouteDayCard
                key={`route-day-${dayRoute.dayNumber}`}
                dayRoute={dayRoute}
              />
            ))}
          </div>
        ) : null}

        {!isLoading && !errorMessage && readyRoutes.length === 0 ? (
          <div className="mt-10 rounded-2xl border border-[var(--voy-border)] bg-[var(--voy-surface2)] px-6 py-12 text-center">
            <h3 className="text-2xl font-semibold text-[var(--voy-text)]">
              Route optimization is not available yet
            </h3>
            <p className="mx-auto mt-3 max-w-2xl text-[var(--voy-text-muted)]">
              Add at least two recognizable places to a day itinerary to compute an optimized route.
            </p>
          </div>
        ) : null}

        {!isLoading && !errorMessage && skippedRoutes.length > 0 ? (
          <div className="mt-8 rounded-2xl border border-[var(--voy-border)] bg-[var(--voy-surface2)] px-5 py-4 text-sm text-[var(--voy-text-muted)]">
            Skipped route days:{" "}
            {skippedRoutes.map((dayRoute) => `Day ${dayRoute.dayNumber}`).join(", ")}.
          </div>
        ) : null}
      </div>
    </section>
  );
}

export default OptimizedRouteSection;
