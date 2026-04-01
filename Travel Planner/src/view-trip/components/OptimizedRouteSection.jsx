import React, { useEffect, useMemo, useState } from "react";
import {
  FaBolt,
  FaClock,
  FaCoins,
  FaCompass,
  FaMapMarkedAlt,
  FaMapPin,
  FaRoute,
  FaRoad,
  FaStar,
} from "react-icons/fa";
import { Button } from "@/components/ui/button";
import TripDayMap from "./TripDayMap";

const OBJECTIVE_OPTIONS = [
  {
    value: "fastest",
    label: "Fastest",
    shortLabel: "Fastest (Dijkstra)",
    hint: "Minimize travel time with Dijkstra shortest-path costs.",
  },
  {
    value: "cheapest",
    label: "Cheapest",
    shortLabel: "Cheapest",
    hint: "Reduce route cost while keeping the day feasible.",
  },
  {
    value: "best_experience",
    label: "Best Experience",
    shortLabel: "Best Experience",
    hint: "Balance travel time with stronger stop quality.",
  },
];

function formatDuration(durationSeconds) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return "Unavailable";
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
    return "Unavailable";
  }

  if (distanceMeters < 950) {
    return `${Math.max(50, Math.round(distanceMeters / 50) * 50)} m`;
  }

  return `${(distanceMeters / 1000).toFixed(1)} km`;
}

function formatEstimatedCost(cost) {
  if (!Number.isFinite(cost) || cost <= 0) {
    return "Unavailable";
  }

  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(cost);
}

function formatStatusLabel(dayRoute = {}) {
  if (dayRoute.status === "ready") {
    return "Route ready";
  }

  if (dayRoute.status === "map_only") {
    return dayRoute.geocodedStopCount > 0 ? "Map ready" : "Locating stops";
  }

  return "Need places";
}

function formatRouteProvider(provider = "") {
  const normalized = String(provider ?? "").trim();

  if (normalized === "google-routes-matrix") {
    return "Google Routes";
  }

  if (normalized === "estimated-haversine") {
    return "Estimated fallback";
  }

  if (!normalized || normalized === "not-applicable") {
    return "Not available";
  }

  return normalized.replace(/[-_]/g, " ");
}

function formatAlgorithmLabel(algorithm = "") {
  const normalized = String(algorithm ?? "").trim();

  if (normalized === "dijkstra-fastest") {
    return "Dijkstra shortest path";
  }

  if (!normalized || normalized === "not-applicable") {
    return "Not available";
  }

  return normalized.replace(/[-_]/g, " ");
}

function formatViewportSourceLabel(viewportSource = "") {
  if (viewportSource === "day_cluster") {
    return "Localized city cluster";
  }

  if (viewportSource === "destination_fallback") {
    return "Destination fallback";
  }

  return "Map unavailable";
}

function formatStopSourceLabel(source = "") {
  if (source === "inferred") {
    return "Inferred";
  }

  if (source === "ai_plan") {
    return "AI plan";
  }

  if (source === "itinerary") {
    return "Itinerary";
  }

  return "Mapped";
}

function formatTradeoffDelta(tradeoff = {}) {
  const parts = [];

  if (Number.isFinite(tradeoff?.minutesVsFastest) && tradeoff.minutesVsFastest !== 0) {
    parts.push(
      `${tradeoff.minutesVsFastest > 0 ? "+" : ""}${tradeoff.minutesVsFastest} min`
    );
  }

  if (Number.isFinite(tradeoff?.costVsFastest) && tradeoff.costVsFastest !== 0) {
    parts.push(
      `${tradeoff.costVsFastest > 0 ? "+" : ""}${tradeoff.costVsFastest} cost`
    );
  }

  if (
    Number.isFinite(tradeoff?.experienceVsFastest) &&
    tradeoff.experienceVsFastest !== 0
  ) {
    parts.push(
      `${tradeoff.experienceVsFastest > 0 ? "+" : ""}${tradeoff.experienceVsFastest} exp`
    );
  }

  return parts.length > 0 ? parts.join(" • ") : "Baseline route";
}

function resolveObjectiveMeta(objective = "") {
  return (
    OBJECTIVE_OPTIONS.find((option) => option.value === objective) ??
    OBJECTIVE_OPTIONS[0]
  );
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
    <div className="voy-route-loading-grid grid items-start gap-6 xl:grid-cols-[minmax(360px,420px)_minmax(0,1fr)]">
      <div className="voy-route-loading-rail">
        <div className="voy-route-card voy-route-loading-card">
          <div className="voy-route-skeleton voy-route-skeleton-title" />
          <div className="voy-route-skeleton-list">
            {[1, 2, 3, 4].map((item) => (
              <div key={item} className="voy-route-skeleton voy-route-skeleton-item" />
            ))}
          </div>
        </div>
      </div>

      <div className="voy-route-loading-main">
        <div className="voy-route-card voy-route-loading-card">
          <div className="voy-route-skeleton voy-route-skeleton-title" />
          <div className="voy-route-skeleton voy-route-skeleton-wide" />
          <div className="voy-route-skeleton-grid">
            {[1, 2, 3, 4].map((item) => (
              <div key={item} className="voy-route-skeleton voy-route-skeleton-stat" />
            ))}
          </div>
        </div>
        <div className="voy-route-card voy-route-map-card">
          <div className="voy-route-skeleton voy-route-skeleton-map h-[320px] sm:h-[360px] lg:h-[420px] xl:h-[460px] 2xl:h-[500px]" />
        </div>
      </div>
    </div>
  );
}

function ObjectiveToolbar({
  objective,
  onObjectiveChange,
  alternativesCount,
  onAlternativesCountChange,
  defaultObjective,
}) {
  const activeMeta = resolveObjectiveMeta(objective);

  return (
    <div className="voy-route-toolbar">
      <div className="voy-route-toolbar-main">
        <p className="voy-route-toolbar-label">Route Profiles</p>
        <div className="voy-route-tabs" role="tablist" aria-label="Route objective profiles">
          {OBJECTIVE_OPTIONS.map((option) => {
            const isActive = option.value === objective;

            return (
              <button
                key={option.value}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`voy-route-tab ${isActive ? "is-active" : ""}`}
                onClick={() => {
                  if (option.value === objective) {
                    return;
                  }

                  console.info("[optimized-routes] Objective selected", {
                    objective: option.value,
                  });
                  onObjectiveChange?.(option.value);
                }}
              >
                <span className="voy-route-tab-title">{option.shortLabel}</span>
                <span className="voy-route-tab-hint">{option.hint}</span>
              </button>
            );
          })}
        </div>
        <p className="voy-route-toolbar-note">
          Default visible profile:{" "}
          <strong>{resolveObjectiveMeta(defaultObjective).shortLabel}</strong>. Current map
          view: <strong>{activeMeta.shortLabel}</strong>.
        </p>
      </div>

      <div className="voy-route-toolbar-side">
        <label className="voy-route-select-label" htmlFor="route-alt-count">
          Alternatives to compare
        </label>
        <select
          id="route-alt-count"
          className="voy-route-select"
          value={alternativesCount}
          onChange={(event) => {
            const nextValue = Number.parseInt(event.target.value, 10);

            if (!Number.isInteger(nextValue) || nextValue === alternativesCount) {
              return;
            }

            console.info("[optimized-routes] Alternatives count changed", {
              alternativesCount: nextValue,
            });
            onAlternativesCountChange?.(nextValue);
          }}
        >
          {[1, 2, 3, 4, 5].map((value) => (
            <option key={value} value={value}>
              Top {value}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function DaySelector({ dayRoutes, activeDayNumber, onSelectDay }) {
  return (
    <div className="voy-route-card voy-route-rail-card">
      <div className="voy-route-card-header">
        <div>
          <p className="voy-route-eyebrow">Day Maps</p>
          <h3 className="voy-route-card-title">Switch itinerary days</h3>
        </div>
        <span className="voy-route-chip voy-route-chip-soft">Localized views</span>
      </div>

      <div className="voy-route-day-list">
        {dayRoutes.map((dayRoute) => {
          const isActive = dayRoute.dayNumber === activeDayNumber;
          const hasMap = Boolean(dayRoute.mapReady);
          const mappedStopCount = Number.isFinite(dayRoute.geocodedStopCount)
            ? dayRoute.geocodedStopCount
            : Array.isArray(dayRoute.markers)
              ? dayRoute.markers.length
              : 0;

          return (
            <button
              key={`route-day-selector-${dayRoute.dayNumber}`}
              type="button"
              className={`voy-route-day-button ${isActive ? "is-active" : ""}`}
              onClick={() => onSelectDay(dayRoute.dayNumber)}
            >
              <div className="voy-route-day-row">
                <div>
                  <p className="voy-route-day-label">Day {dayRoute.dayNumber}</p>
                  <p className="voy-route-day-title">{dayRoute.title}</p>
                </div>
                <span
                  className={`voy-route-chip ${
                    dayRoute.status === "ready"
                      ? "voy-route-chip-gold"
                      : "voy-route-chip-soft"
                  }`}
                >
                  {formatStatusLabel(dayRoute)}
                </span>
              </div>

              <div className="voy-route-day-meta">
                <span>{dayRoute.localityLabel || "Destination focus"}</span>
                <span>
                  {hasMap
                    ? `${mappedStopCount} mapped stop${mappedStopCount === 1 ? "" : "s"}`
                    : "We’re still locating some stops"}
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
  const cards = [
    {
      label: "Travel time",
      value: formatDuration(dayRoute?.totalDurationSeconds),
      icon: <FaClock className="text-[var(--voy-gold)]" />,
    },
    {
      label: "Distance",
      value: formatDistance(dayRoute?.totalDistanceMeters),
      icon: <FaRoad className="text-[var(--voy-gold)]" />,
    },
    {
      label: "Est. route cost",
      value: formatEstimatedCost(dayRoute?.estimatedCost),
      icon: <FaCoins className="text-[var(--voy-gold)]" />,
    },
    {
      label: "Experience score",
      value: Number.isFinite(dayRoute?.experienceScore)
        ? String(dayRoute.experienceScore)
        : "Unavailable",
      icon: <FaStar className="text-[var(--voy-gold)]" />,
    },
  ];

  return (
    <div className="voy-route-stat-grid">
      {cards.map((card) => (
        <div key={card.label} className="voy-route-stat-card">
          <div className="voy-route-stat-label">
            {card.icon}
            <span>{card.label}</span>
          </div>
          <p className="voy-route-stat-value">{card.value}</p>
        </div>
      ))}
    </div>
  );
}

function AlternativeCards({ alternatives = [], objective, onObjectiveChange }) {
  if (!Array.isArray(alternatives) || alternatives.length === 0) {
    return null;
  }

  return (
    <div className="voy-route-card">
      <div className="voy-route-card-header">
        <div>
          <p className="voy-route-eyebrow">Tradeoffs</p>
          <h3 className="voy-route-card-title">Compare objective profiles</h3>
        </div>
      </div>

      <div className="voy-route-alternative-grid">
        {alternatives.map((alternative) => {
          const isActive = alternative.objective === objective;

          return (
            <button
              key={alternative.objective}
              type="button"
              className={`voy-route-alternative-card ${isActive ? "is-active" : ""}`}
              onClick={() => onObjectiveChange?.(alternative.objective)}
            >
              <div className="voy-route-alternative-top">
                <div>
                  <p className="voy-route-alternative-title">
                    {alternative.objective === "fastest"
                      ? "Fastest (Dijkstra)"
                      : alternative.objectiveLabel}
                  </p>
                  <p className="voy-route-alternative-meta">
                    {formatDuration(alternative.totalDurationSeconds)} •{" "}
                    {formatDistance(alternative.totalDistanceMeters)}
                  </p>
                </div>
                <span className="voy-route-chip voy-route-chip-soft">
                  Rank {alternative.rank}
                </span>
              </div>

              <p className="voy-route-alternative-cost">
                {formatEstimatedCost(alternative.estimatedCost)} • Exp.{" "}
                {alternative.experienceScore}
              </p>
              <p className="voy-route-alternative-delta">
                {formatTradeoffDelta(alternative.tradeoffDelta)}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StopList({ dayRoute, highlightedStopId, onHighlightStop }) {
  const orderedStops = Array.isArray(dayRoute?.orderedStops) ? dayRoute.orderedStops : [];

  return (
    <div className="voy-route-card">
      <div className="voy-route-card-header">
        <div>
          <p className="voy-route-eyebrow">Pinned stops</p>
          <h3 className="voy-route-card-title">
            {dayRoute?.status === "ready" ? "Optimized stop order" : "Recognized places"}
          </h3>
        </div>
      </div>

      <div className="voy-route-list">
        {orderedStops.length === 0 ? (
          <div className="voy-route-empty-block">
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
                className={`voy-route-list-item ${isHighlighted ? "is-highlighted" : ""}`}
                onMouseEnter={() => onHighlightStop(stopId)}
                onMouseLeave={() => onHighlightStop(null)}
                onClick={() => onHighlightStop(stopId)}
              >
                <span className="voy-route-stop-order">{index + 1}</span>
                <div className="voy-route-list-content">
                  <div className="voy-route-list-top">
                    <p className="voy-route-list-title">{stop.name}</p>
                    <span className="voy-route-chip voy-route-chip-soft">
                      {formatStopSourceLabel(stop.source)}
                    </span>
                  </div>
                  <p className="voy-route-list-copy">
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

function SegmentTimeline({ dayRoute, onHighlightStop }) {
  const segments = Array.isArray(dayRoute?.segmentsDetailed)
    ? dayRoute.segmentsDetailed
    : [];

  return (
    <div className="voy-route-card">
      <div className="voy-route-card-header">
        <div>
          <p className="voy-route-eyebrow">Travel path</p>
          <h3 className="voy-route-card-title">Segment timeline</h3>
        </div>
        <span className="voy-route-chip voy-route-chip-soft">
          {formatAlgorithmLabel(dayRoute?.algorithm)}
        </span>
      </div>

      {segments.length === 0 ? (
        <div className="voy-route-empty-block">
          Route segments will appear once this day has enough mapped stops.
        </div>
      ) : (
        <div className="voy-route-segment-list">
          {segments.map((segment) => (
            <button
              key={`${segment.fromId}-${segment.toId}-${segment.segmentNumber}`}
              type="button"
              className="voy-route-segment-item"
              onMouseEnter={() => onHighlightStop(segment.toId ?? segment.fromId ?? null)}
              onMouseLeave={() => onHighlightStop(null)}
              onClick={() => onHighlightStop(segment.toId ?? segment.fromId ?? null)}
            >
              <span className="voy-route-segment-step">{segment.segmentNumber}</span>
              <div className="voy-route-segment-main">
                <div className="voy-route-segment-head">
                  <p className="voy-route-segment-title">
                    {segment.fromName} → {segment.toName}
                  </p>
                  <p className="voy-route-segment-metric">
                    {formatDuration(segment.durationSeconds)} •{" "}
                    {formatDistance(segment.distanceMeters)}
                  </p>
                </div>
                <div className="voy-route-segment-foot">
                  <span>
                    Cum. {formatDuration(segment.cumulativeDurationSeconds)}
                  </span>
                  <span>
                    Dijkstra from start:{" "}
                    {formatDuration(segment.shortestPathFromStartSeconds)}
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ActiveDayDetails({
  dayRoute,
  destination,
  objective,
  onObjectiveChange,
  highlightedStopId,
  onHighlightStop,
}) {
  if (!dayRoute) {
    return (
      <div className="voy-route-card voy-route-empty-state">
        <h3 className="voy-route-empty-title">Route optimization is not available yet</h3>
        <p className="voy-route-empty-copy">Add at least two locations to generate a route.</p>
      </div>
    );
  }

  const activeObjective = resolveObjectiveMeta(objective);
  const localityLabel = dayRoute.localityLabel || destination || "the selected destination";
  const mapStopCount = Array.isArray(dayRoute.markers) ? dayRoute.markers.length : 0;
  const hasRoute = dayRoute.routeReady !== false;

  return (
    <div className="voy-route-main-stack">
      <article className="voy-route-card">
        <div className="voy-route-card-header voy-route-card-header-wide">
          <div>
            <p className="voy-route-eyebrow">Day {dayRoute.dayNumber}</p>
            <h3 className="voy-route-day-heading">{dayRoute.title}</h3>
            <p className="voy-route-card-copy">
              {hasRoute ? (
                <>
                  This day is centered on <strong>{localityLabel}</strong>. The active map stays
                  confined to that local cluster and plots {mapStopCount} pinned stops with the{" "}
                  <strong>{activeObjective.shortLabel}</strong> route.
                </>
              ) : (
                <>
                  This day is centered on <strong>{localityLabel}</strong>. The city map stays
                  focused on that local area and will show route metrics as soon as at least two
                  locations are mapped.
                </>
              )}
            </p>
          </div>

          <div className="voy-route-badge-group">
            <span className="voy-route-chip voy-route-chip-gold">
              {dayRoute.objective === "fastest"
                ? "Fastest (Dijkstra)"
                : dayRoute.objectiveLabel}
            </span>
            <span className="voy-route-chip voy-route-chip-soft">
              {formatRouteProvider(dayRoute.routeProvider)}
            </span>
            <span className="voy-route-chip voy-route-chip-soft">
              {formatViewportSourceLabel(dayRoute.viewportSource)}
            </span>
            {dayRoute.inferredStopCount > 0 ? (
              <span className="voy-route-chip voy-route-chip-soft">
                {dayRoute.inferredStopCount} inferred stop
                {dayRoute.inferredStopCount > 1 ? "s" : ""}
              </span>
            ) : null}
          </div>
        </div>

        <SummaryCards dayRoute={dayRoute} />

        {!hasRoute && dayRoute.statusMessage ? (
          <div className="voy-route-note-block">
            <div className="voy-route-note-head">
              <FaMapPin className="text-[var(--voy-gold)]" />
              <span>Map status</span>
            </div>
            <p>{dayRoute.statusMessage}</p>
          </div>
        ) : null}

        {dayRoute?.explanation?.whySelected ? (
          <div className="voy-route-note-block">
            <div className="voy-route-note-head">
              <FaCompass className="text-[var(--voy-gold)]" />
              <span>Why this route was selected</span>
            </div>
            <p>{dayRoute.explanation.whySelected}</p>
          </div>
        ) : null}

        {dayRoute.warning ? (
          <div className="voy-route-inline-warning">{dayRoute.warning}</div>
        ) : null}

        <div className="voy-route-actions">
          {dayRoute.directionsUrl ? (
            <a href={dayRoute.directionsUrl} target="_blank" rel="noopener noreferrer">
              <Button className="voy-create-primary inline-flex items-center gap-2">
                <FaMapMarkedAlt />
                <span>Open route in Google Maps</span>
              </Button>
            </a>
          ) : null}
        </div>
      </article>

      <AlternativeCards
        alternatives={dayRoute.alternatives}
        objective={objective}
        onObjectiveChange={onObjectiveChange}
      />

      <div className="voy-route-detail-grid">
        <StopList
          dayRoute={dayRoute}
          highlightedStopId={highlightedStopId}
          onHighlightStop={onHighlightStop}
        />
        <SegmentTimeline dayRoute={dayRoute} onHighlightStop={onHighlightStop} />
      </div>
    </div>
  );
}

function OptimizedRouteSection({
  routes,
  objective = "fastest",
  onObjectiveChange,
  alternativesCount = 3,
  onAlternativesCountChange,
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
  }, [activeDayNumber, objective]);

  const activeDayRoute =
    dayRoutes.find((dayRoute) => dayRoute.dayNumber === activeDayNumber) ??
    dayRoutes[0] ??
    null;
  const pendingRouteDays = dayRoutes.filter((dayRoute) => dayRoute.routeReady === false);
  const resolvedObjective =
    objective || routes?.objective || routes?.defaultObjective || "fastest";
  const activeObjectiveMeta = resolveObjectiveMeta(resolvedObjective);

  const handleSelectDay = (dayNumber) => {
    console.info("[optimized-routes] Day selected for localized map", {
      dayNumber,
    });
    setActiveDayNumber(dayNumber);
  };

  return (
    <section className="voy-route-section">
      <div className="voy-route-shell mx-auto max-w-[1440px]">
        <div className="voy-route-header">
          <p className="voy-route-heading-eyebrow">Localized routing</p>
          <h2 className="voy-route-heading">Optimized daily city routes</h2>
          <p className="voy-route-subtitle">
            Each itinerary day now renders against a city-level map viewport, not the full
            destination region. Switch days to see localized pins, route tradeoffs, and the{" "}
            <strong>{activeObjectiveMeta.shortLabel}</strong> path in sync.
          </p>
        </div>

        <ObjectiveToolbar
          objective={resolvedObjective}
          onObjectiveChange={onObjectiveChange}
          alternativesCount={alternativesCount}
          onAlternativesCountChange={onAlternativesCountChange}
          defaultObjective={routes?.defaultObjective ?? "fastest"}
        />

        {isLoading ? <LoadingLayout /> : null}

        {!isLoading && errorMessage ? (
          <div className="voy-route-card voy-route-empty-state">
            <h3 className="voy-route-empty-title">Unable to load optimized routes</h3>
            <p className="voy-route-empty-copy">{errorMessage}</p>
            {onRetry ? (
              <div className="voy-route-actions">
                <Button className="voy-create-primary" onClick={onRetry}>
                  Try again
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        {!isLoading && !errorMessage && dayRoutes.length > 0 ? (
          <div className="voy-route-layout grid items-start gap-6 xl:grid-cols-[minmax(360px,420px)_minmax(0,1fr)]">
            <aside className="voy-route-rail xl:max-w-[420px]">
              <DaySelector
                dayRoutes={dayRoutes}
                activeDayNumber={activeDayNumber}
                onSelectDay={handleSelectDay}
              />

              {pendingRouteDays.length > 0 ? (
                <div className="voy-route-card voy-route-compact-note">
                  <div className="voy-route-note-head">
                    <FaBolt className="text-[var(--voy-gold)]" />
                    <span>Days still locating stops</span>
                  </div>
                  <p>
                    {pendingRouteDays
                      .map((dayRoute) => `Day ${dayRoute.dayNumber}`)
                      .join(", ")}{" "}
                    already show the city map, but they still need at least two mapped
                    locations before route metrics and segment details can appear.
                  </p>
                </div>
              ) : null}
            </aside>

            <div className="voy-route-main min-w-0">
              <ActiveDayDetails
                dayRoute={activeDayRoute}
                destination={routes?.destination ?? ""}
                objective={resolvedObjective}
                onObjectiveChange={onObjectiveChange}
                highlightedStopId={highlightedStopId}
                onHighlightStop={setHighlightedStopId}
              />

              <div className="voy-route-card voy-route-map-card overflow-hidden">
                <div className="voy-route-card-header">
                  <div>
                    <p className="voy-route-eyebrow">City map</p>
                    <h3 className="voy-route-card-title">
                      {activeDayRoute?.localityLabel ||
                        routes?.destination ||
                        "Selected destination"}
                    </h3>
                  </div>
                  <div className="voy-route-badge-group">
                    <span className="voy-route-chip voy-route-chip-soft">
                      Day {activeDayRoute?.dayNumber ?? "—"} only
                    </span>
                    <span className="voy-route-chip voy-route-chip-soft">
                      {Array.isArray(activeDayRoute?.markers)
                        ? `${activeDayRoute.markers.length} pins`
                        : "0 pins"}
                    </span>
                  </div>
                </div>

                <p className="voy-route-card-copy">
                  The map is fitted from the active day’s stop cluster and kept inside the
                  local viewport for cleaner city-level navigation.
                </p>

                <TripDayMap
                  dayRoute={activeDayRoute}
                  destination={activeDayRoute?.localityLabel || routes?.destination || ""}
                  highlightedStopId={highlightedStopId}
                  onHighlightStop={setHighlightedStopId}
                />
              </div>
            </div>
          </div>
        ) : null}

        {!isLoading && !errorMessage && dayRoutes.length === 0 ? (
          <div className="voy-route-card voy-route-empty-state">
            <h3 className="voy-route-empty-title">Route optimization is not available yet</h3>
            <p className="voy-route-empty-copy">Add at least two locations to generate a route.</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export default OptimizedRouteSection;
