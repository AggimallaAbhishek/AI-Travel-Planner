import React, { useMemo, useState } from "react";
import { MapPin, Navigation } from "lucide-react";
import {
  CITY_ITINERARY_MAP_CANVAS,
  createCityMapMarkerLayout,
  resolveCityMapBounds,
} from "@/lib/cityItineraryMap";
import { normalizeGeoCoordinates, resolveGoogleMapsUrl } from "@/lib/maps";

const DAY_ACCENTS = [
  { fill: "#D9B54D", stroke: "#8A6E17", soft: "rgba(217, 181, 77, 0.18)" },
  { fill: "#7FB3D5", stroke: "#356C8C", soft: "rgba(127, 179, 213, 0.18)" },
  { fill: "#86B98F", stroke: "#3F7351", soft: "rgba(134, 185, 143, 0.18)" },
  { fill: "#D59B7F", stroke: "#8C5335", soft: "rgba(213, 155, 127, 0.18)" },
  { fill: "#A892C8", stroke: "#6A5489", soft: "rgba(168, 146, 200, 0.18)" },
  { fill: "#E2A9A1", stroke: "#9C5E58", soft: "rgba(226, 169, 161, 0.18)" },
];

function normalizeText(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed || fallback;
}

function getDestinationLabel(trip = {}) {
  return normalizeText(
    trip?.userSelection?.location?.label ?? trip?.aiPlan?.destination,
    "Selected destination"
  );
}

function getDayAccent(dayNumber = 1) {
  const index = Math.max(0, Number.parseInt(dayNumber, 10) - 1);
  return DAY_ACCENTS[index % DAY_ACCENTS.length];
}

function clampLabelX(value, labelWidth) {
  const min = CITY_ITINERARY_MAP_CANVAS.inset;
  const max =
    CITY_ITINERARY_MAP_CANVAS.width -
    CITY_ITINERARY_MAP_CANVAS.inset -
    labelWidth;

  return Math.min(Math.max(value, min), Math.max(min, max));
}

function flattenTripPlaces(trip = {}) {
  const destination = getDestinationLabel(trip);
  const days = Array.isArray(trip?.itinerary?.days) ? trip.itinerary.days : [];

  return days.flatMap((day, dayIndex) => {
    const dayNumber = Number.parseInt(day?.dayNumber, 10) || dayIndex + 1;
    const dayTitle = normalizeText(day?.title, `Day ${dayNumber}`);
    const accent = getDayAccent(dayNumber);
    const places = Array.isArray(day?.places) ? day.places : [];

    return places.map((place, placeIndex) => {
      const coordinates = normalizeGeoCoordinates(place?.geoCoordinates);
      const isResolved =
        coordinates.latitude !== null && coordinates.longitude !== null;

      return {
        id: `${dayNumber}-${placeIndex}-${normalizeText(place?.placeName, "stop")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")}`,
        dayNumber,
        dayTitle,
        accent,
        indexWithinDay: placeIndex + 1,
        placeName: normalizeText(place?.placeName, "Recommended stop"),
        placeDetails: normalizeText(place?.placeDetails),
        location: normalizeText(place?.location, destination),
        geocodeStatus: normalizeText(place?.geocodeStatus, isResolved ? "resolved" : "unresolved"),
        coordinates,
        isResolved,
        mapsUrl: resolveGoogleMapsUrl({
          mapsUrl: place?.mapsUrl,
          name: place?.placeName,
          location: place?.location,
          destination,
          coordinates,
        }),
      };
    });
  });
}

function groupPlacesByDay(places = []) {
  const grouped = new Map();

  for (const place of places) {
    const existingGroup = grouped.get(place.dayNumber) ?? {
      dayNumber: place.dayNumber,
      dayTitle: place.dayTitle,
      accent: place.accent,
      places: [],
    };

    existingGroup.places.push(place);
    grouped.set(place.dayNumber, existingGroup);
  }

  return [...grouped.values()].sort((left, right) => left.dayNumber - right.dayNumber);
}

function openGoogleMaps(url = "") {
  if (!url || typeof window === "undefined") {
    return;
  }

  window.open(url, "_blank", "noopener,noreferrer");
}

export default function CityItineraryMapSection({ trip }) {
  const [activePlaceId, setActivePlaceId] = useState("");
  const destination = getDestinationLabel(trip);
  const places = useMemo(() => flattenTripPlaces(trip), [trip]);
  const resolvedPlaces = useMemo(
    () => places.filter((place) => place.isResolved),
    [places]
  );
  const unresolvedPlaces = useMemo(
    () => places.filter((place) => !place.isResolved),
    [places]
  );
  const groupedPlaces = useMemo(() => groupPlacesByDay(places), [places]);
  const bounds = useMemo(
    () =>
      resolveCityMapBounds({
        cityBounds: trip?.mapEnrichment?.cityBounds,
        places: resolvedPlaces,
      }),
    [resolvedPlaces, trip?.mapEnrichment?.cityBounds]
  );
  const markers = useMemo(
    () =>
      createCityMapMarkerLayout(resolvedPlaces, {
        bounds,
        canvas: CITY_ITINERARY_MAP_CANVAS,
      }),
    [bounds, resolvedPlaces]
  );

  const mappedPinsLabel = `${markers.length} pin${markers.length === 1 ? "" : "s"}`;
  const unresolvedLabel =
    unresolvedPlaces.length > 0
      ? `${unresolvedPlaces.length} unresolved`
      : "All visible stops mapped";
  const hasMapFrame = Boolean(bounds) || markers.length > 0 || destination;
  const showOverlay = markers.length === 0;

  return (
    <section className="mt-10 rounded-[2rem] border border-[var(--voy-border)] bg-[var(--voy-surface)] p-6 shadow-md md:p-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-[var(--voy-accent)]">
            City Itinerary Map
          </p>
          <h2 className="mt-2 text-3xl font-semibold text-[var(--voy-text)]">
            {destination}
          </h2>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-[var(--voy-text-muted)]">
            All recognized stops across this itinerary are pinned inside the destination
            city viewport. Click a pin or place name to open that stop directly in Google
            Maps.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--voy-text-muted)]">
          <span className="rounded-full border border-[var(--voy-border)] bg-[rgba(255,255,255,0.72)] px-4 py-2">
            {mappedPinsLabel}
          </span>
          <span className="rounded-full border border-[var(--voy-border)] bg-[rgba(255,255,255,0.72)] px-4 py-2">
            {unresolvedLabel}
          </span>
        </div>
      </div>

      <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.9fr)]">
        <div className="rounded-[1.75rem] border border-[rgba(24,39,75,0.08)] bg-[linear-gradient(180deg,rgba(246,248,252,0.98)_0%,rgba(239,244,250,0.98)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] md:p-5">
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.22em] text-[var(--voy-text-faint)]">
                  Destination viewport
                </p>
                <p className="mt-1 text-lg font-semibold text-[var(--voy-text)]">
                  {destination}
                </p>
              </div>

              <div className="flex items-center gap-2 rounded-full border border-[rgba(24,39,75,0.08)] bg-white/80 px-3 py-2 text-xs font-medium text-[var(--voy-text-muted)]">
                <Navigation className="h-4 w-4" />
                Click pins to open Google Maps
              </div>
            </div>

            <div className="relative min-h-[420px] overflow-hidden rounded-[1.5rem] border border-[rgba(24,39,75,0.08)] bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.96),rgba(239,244,250,0.9)_58%,rgba(226,234,245,0.95)_100%)]">
              {hasMapFrame ? (
                <svg
                  viewBox={`0 0 ${CITY_ITINERARY_MAP_CANVAS.width} ${CITY_ITINERARY_MAP_CANVAS.height}`}
                  className="h-full min-h-[420px] w-full"
                  role="img"
                  aria-label={`${destination} itinerary map`}
                >
                  <defs>
                    <pattern
                      id="city-itinerary-grid"
                      width="64"
                      height="64"
                      patternUnits="userSpaceOnUse"
                    >
                      <path
                        d="M 64 0 L 0 0 0 64"
                        fill="none"
                        stroke="rgba(72, 99, 137, 0.08)"
                        strokeWidth="1"
                      />
                    </pattern>
                    <radialGradient id="city-itinerary-glow" cx="15%" cy="12%" r="75%">
                      <stop offset="0%" stopColor="rgba(255,255,255,0.98)" />
                      <stop offset="100%" stopColor="rgba(221,231,244,0.2)" />
                    </radialGradient>
                  </defs>

                  <rect
                    x="0"
                    y="0"
                    width={CITY_ITINERARY_MAP_CANVAS.width}
                    height={CITY_ITINERARY_MAP_CANVAS.height}
                    fill="url(#city-itinerary-glow)"
                  />
                  <rect
                    x="0"
                    y="0"
                    width={CITY_ITINERARY_MAP_CANVAS.width}
                    height={CITY_ITINERARY_MAP_CANVAS.height}
                    fill="url(#city-itinerary-grid)"
                  />
                  <circle cx="170" cy="140" r="110" fill="rgba(217,181,77,0.08)" />
                  <circle cx="955" cy="562" r="160" fill="rgba(94,134,182,0.08)" />
                  <circle cx="780" cy="165" r="88" fill="rgba(122,168,138,0.08)" />

                  <rect
                    x={CITY_ITINERARY_MAP_CANVAS.inset}
                    y={CITY_ITINERARY_MAP_CANVAS.inset}
                    width={CITY_ITINERARY_MAP_CANVAS.width - CITY_ITINERARY_MAP_CANVAS.inset * 2}
                    height={CITY_ITINERARY_MAP_CANVAS.height - CITY_ITINERARY_MAP_CANVAS.inset * 2}
                    rx="28"
                    fill="rgba(255,255,255,0.38)"
                    stroke="rgba(72, 99, 137, 0.1)"
                    strokeWidth="1.5"
                  />

                  {markers.map((marker) => {
                    const isActive = activePlaceId === marker.id;
                    const labelWidth = Math.max(132, Math.min(220, marker.placeName.length * 7.2 + 24));
                    const labelX = clampLabelX(
                      marker.markerPoint.x - labelWidth / 2,
                      labelWidth
                    );

                    return (
                      <g
                        key={marker.id}
                        role="button"
                        tabIndex={0}
                        onMouseEnter={() => setActivePlaceId(marker.id)}
                        onMouseLeave={() => setActivePlaceId("")}
                        onFocus={() => setActivePlaceId(marker.id)}
                        onBlur={() => setActivePlaceId("")}
                        onClick={() => openGoogleMaps(marker.mapsUrl)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            openGoogleMaps(marker.mapsUrl);
                          }
                        }}
                        className="cursor-pointer outline-none"
                        >
                        <title>{`${marker.placeName} • Day ${marker.dayNumber}`}</title>

                        {marker.isShifted ? (
                          <line
                            x1={marker.point.x}
                            y1={marker.point.y}
                            x2={marker.markerPoint.x}
                            y2={marker.markerPoint.y}
                            stroke={marker.accent.stroke}
                            strokeDasharray="5 6"
                            strokeOpacity={isActive ? 0.9 : 0.45}
                            strokeWidth="1.8"
                          />
                        ) : null}

                        {isActive ? (
                          <>
                            <rect
                              x={labelX}
                              y={Math.max(CITY_ITINERARY_MAP_CANVAS.inset, marker.markerPoint.y - 58)}
                              width={labelWidth}
                              height="38"
                              rx="19"
                              fill="rgba(17,24,39,0.92)"
                              stroke={marker.accent.fill}
                              strokeWidth="1.5"
                            />
                            <text
                              x={labelX + 18}
                              y={marker.markerPoint.y - 34}
                              fontSize="14"
                              fontWeight="600"
                              fill="#F8FAFC"
                            >
                              {marker.placeName.length > 28
                                ? `${marker.placeName.slice(0, 27)}…`
                                : marker.placeName}
                            </text>
                          </>
                        ) : null}

                        <circle
                          cx={marker.markerPoint.x}
                          cy={marker.markerPoint.y}
                          r={isActive ? 28 : 22}
                          fill={marker.accent.soft}
                          opacity={isActive ? 0.9 : 0.55}
                        />

                        <circle
                          cx={marker.markerPoint.x}
                          cy={marker.markerPoint.y}
                          r={isActive ? 15 : 13}
                          fill="rgba(255,255,255,0.96)"
                          stroke={marker.accent.stroke}
                          strokeWidth="2.4"
                        />
                        <circle
                          cx={marker.markerPoint.x}
                          cy={marker.markerPoint.y}
                          r={isActive ? 10 : 8.5}
                          fill={marker.accent.fill}
                          opacity={0.96}
                        />
                        <text
                          x={marker.markerPoint.x}
                          y={marker.markerPoint.y + 4.2}
                          textAnchor="middle"
                          fontSize="11"
                          fontWeight="700"
                          fill="#0F172A"
                        >
                          {marker.dayNumber}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              ) : null}

              {showOverlay ? (
                <div className="absolute inset-0 flex items-center justify-center bg-[linear-gradient(180deg,rgba(250,250,248,0.86)_0%,rgba(246,243,237,0.92)_100%)] p-8 text-center">
                  <div className="max-w-xl">
                    <p className="text-2xl font-semibold text-[var(--voy-text)]">
                      We&apos;re still locating itinerary stops
                    </p>
                    <p className="mt-3 text-base leading-7 text-[var(--voy-text-muted)]">
                      The city map is ready for {destination}. Pins will appear here as
                      enough itinerary places are recognized and geocoded.
                    </p>
                    <div className="mt-6 grid gap-3 sm:grid-cols-2">
                      <div className="rounded-[1.25rem] border border-[var(--voy-border)] bg-white/75 px-5 py-4 text-left">
                        <p className="text-xs uppercase tracking-[0.2em] text-[var(--voy-text-faint)]">
                          Focused area
                        </p>
                        <p className="mt-2 text-lg font-semibold text-[var(--voy-text)]">
                          {destination}
                        </p>
                      </div>
                      <div className="rounded-[1.25rem] border border-[var(--voy-border)] bg-white/75 px-5 py-4 text-left">
                        <p className="text-xs uppercase tracking-[0.2em] text-[var(--voy-text-faint)]">
                          Mapped pins
                        </p>
                        <p className="mt-2 text-lg font-semibold text-[var(--voy-text)]">
                          {markers.length}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div className="rounded-[1.75rem] border border-[var(--voy-border)] bg-[rgba(251,250,247,0.9)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.22em] text-[var(--voy-text-faint)]">
                Itinerary places
              </p>
              <h3 className="mt-2 text-xl font-semibold text-[var(--voy-text)]">
                All trip stops
              </h3>
            </div>
            <span className="rounded-full border border-[var(--voy-border)] bg-white/80 px-3 py-1.5 text-xs font-medium text-[var(--voy-text-muted)]">
              {places.length} total
            </span>
          </div>

          <div className="mt-5 space-y-4">
            {groupedPlaces.length > 0 ? (
              groupedPlaces.map((group) => (
                <div
                  key={group.dayNumber}
                  className="rounded-[1.3rem] border border-[var(--voy-border)] bg-white/80 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--voy-text-faint)]">
                        Day {group.dayNumber}
                      </p>
                      <h4 className="mt-1 text-base font-semibold text-[var(--voy-text)]">
                        {group.dayTitle}
                      </h4>
                    </div>
                    <span
                      className="rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em]"
                      style={{
                        color: group.accent.stroke,
                        backgroundColor: group.accent.soft,
                      }}
                    >
                      {group.places.filter((place) => place.isResolved).length} mapped
                    </span>
                  </div>

                  <div className="mt-4 space-y-2.5">
                    {group.places.map((place) => {
                      const isActive = activePlaceId === place.id;

                      return (
                        <button
                          key={place.id}
                          type="button"
                          className="flex w-full items-start gap-3 rounded-[1rem] border px-3.5 py-3 text-left transition hover:-translate-y-0.5 hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-[var(--voy-accent)]"
                          style={{
                            borderColor: isActive ? place.accent.stroke : "rgba(24,39,75,0.08)",
                            backgroundColor: isActive ? place.accent.soft : "rgba(255,255,255,0.78)",
                          }}
                          onMouseEnter={() => setActivePlaceId(place.id)}
                          onMouseLeave={() => setActivePlaceId("")}
                          onFocus={() => setActivePlaceId(place.id)}
                          onBlur={() => setActivePlaceId("")}
                          onClick={() => openGoogleMaps(place.mapsUrl)}
                        >
                          <span
                            className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold"
                            style={{
                              backgroundColor: place.accent.fill,
                              color: "#0F172A",
                            }}
                          >
                            {place.dayNumber}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-start justify-between gap-3">
                              <span className="font-semibold text-[var(--voy-text)]">
                                {place.placeName}
                              </span>
                              <span className="text-xs font-medium text-[var(--voy-text-muted)]">
                                {place.isResolved ? "Mapped" : "Pending"}
                              </span>
                            </span>
                            <span className="mt-1 flex items-center gap-2 text-sm text-[var(--voy-text-muted)]">
                              <MapPin className="h-4 w-4" />
                              {place.location || destination}
                            </span>
                            {place.placeDetails ? (
                              <span className="mt-2 block text-sm leading-6 text-[var(--voy-text-muted)]">
                                {place.placeDetails}
                              </span>
                            ) : null}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-[1.3rem] border border-[var(--voy-border)] bg-white/75 px-4 py-6 text-sm leading-7 text-[var(--voy-text-muted)]">
                This itinerary does not have recognizable places yet. The city map shell is
                ready and will populate as soon as stops are saved with usable location data.
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
