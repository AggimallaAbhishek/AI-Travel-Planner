import React, { useEffect, useId, useMemo, useState } from "react";
import { MapPin, Navigation } from "lucide-react";
import {
  buildCityMapDistanceMatrix,
  buildCityMapFeaturePath,
  buildCityMapOutlinePath,
  CITY_ITINERARY_MAP_CANVAS,
  createCityMapMarkerLayout,
  formatCityMapDistance,
  isProjectedPointInsidePolygons,
  projectCityMapOutline,
  resolveCityMapBounds,
} from "@/lib/cityItineraryMap";
import { normalizeGeoCoordinates, resolveGoogleMapsUrl } from "@/lib/maps";
import { fetchTripCityMap } from "@/lib/tripCityMap";

const DAY_ACCENTS = [
  { fill: "#D9B54D", stroke: "#8A6E17", soft: "rgba(217, 181, 77, 0.18)" },
  { fill: "#7FB3D5", stroke: "#356C8C", soft: "rgba(127, 179, 213, 0.18)" },
  { fill: "#86B98F", stroke: "#3F7351", soft: "rgba(134, 185, 143, 0.18)" },
  { fill: "#D59B7F", stroke: "#8C5335", soft: "rgba(213, 155, 127, 0.18)" },
  { fill: "#A892C8", stroke: "#6A5489", soft: "rgba(168, 146, 200, 0.18)" },
  { fill: "#E2A9A1", stroke: "#9C5E58", soft: "rgba(226, 169, 161, 0.18)" },
];

const INITIAL_CITY_MAP_STATE = {
  cityMap: null,
  loading: false,
  errorMessage: "",
};

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

function buildPinPath(size = 9) {
  const topY = -size * 1.02;
  const shoulderY = -size * 0.14;
  const halfWidth = size * 0.5;
  const tipY = size * 0.92;

  return [
    `M 0 ${tipY}`,
    `C ${size * 0.68} ${size * 0.38}, ${halfWidth} ${shoulderY}, 0 ${topY}`,
    `C ${-halfWidth} ${shoulderY}, ${-size * 0.68} ${size * 0.38}, 0 ${tipY}`,
    "Z",
  ].join(" ");
}

function flattenPlacesFromDays(days = [], destination = "") {
  return (Array.isArray(days) ? days : []).flatMap((day, dayIndex) => {
    const dayNumber = Number.parseInt(day?.dayNumber ?? day?.day, 10) || dayIndex + 1;
    const dayTitle = normalizeText(day?.title, `Day ${dayNumber}`);
    const accent = getDayAccent(dayNumber);
    const places = Array.isArray(day?.places) ? day.places : [];

    return places.map((place, placeIndex) => {
      const coordinates = normalizeGeoCoordinates(place?.geoCoordinates);
      const isResolved =
        coordinates.latitude !== null && coordinates.longitude !== null;
      const isPinned =
        typeof place?.isPinned === "boolean" ? place.isPinned : isResolved;

      return {
        id: normalizeText(
          place?.id,
          `${dayNumber}-${placeIndex}-${normalizeText(place?.placeName ?? place?.name, "stop")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")}`
        ),
        dayNumber,
        dayTitle,
        accent,
        placeName: normalizeText(place?.placeName ?? place?.name, "Recommended stop"),
        location: normalizeText(place?.location, destination),
        coordinates,
        isResolved,
        isPinned,
        mapsUrl: resolveGoogleMapsUrl({
          mapsUrl: place?.mapsUrl,
          name: place?.placeName ?? place?.name,
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
    const group = grouped.get(place.dayNumber) ?? {
      dayNumber: place.dayNumber,
      dayTitle: place.dayTitle,
      accent: place.accent,
      totalPlaces: 0,
      mappedPlaces: 0,
    };

    group.totalPlaces += 1;
    if (place.isPinned) {
      group.mappedPlaces += 1;
    }

    grouped.set(place.dayNumber, group);
  }

  return [...grouped.values()].sort((left, right) => left.dayNumber - right.dayNumber);
}

function openGoogleMaps(url = "") {
  if (!url || typeof window === "undefined") {
    return;
  }

  window.open(url, "_blank", "noopener,noreferrer");
}

function getRoadStrokeWidth(kind = "") {
  const normalizedKind = normalizeText(kind).toLowerCase();

  if (normalizedKind === "motorway" || normalizedKind === "trunk") {
    return 4.2;
  }

  if (normalizedKind === "primary" || normalizedKind === "secondary") {
    return 2.8;
  }

  return 1.6;
}

function getRoadStrokeOpacity(kind = "") {
  const normalizedKind = normalizeText(kind).toLowerCase();

  if (normalizedKind === "motorway" || normalizedKind === "trunk") {
    return 0.4;
  }

  if (normalizedKind === "primary" || normalizedKind === "secondary") {
    return 0.28;
  }

  return 0.16;
}

function useProjectedBasemapFeatures(basemap, bounds) {
  return useMemo(() => {
    if (!basemap || !bounds) {
      return {
        roadPaths: [],
        waterPaths: [],
        parkPaths: [],
      };
    }

    const buildPaths = (features = []) =>
      features
        .map((feature) => ({
          ...feature,
          path: buildCityMapFeaturePath(feature, bounds, CITY_ITINERARY_MAP_CANVAS),
        }))
        .filter((feature) => feature.path);

    return {
      roadPaths: buildPaths(basemap.roads),
      waterPaths: buildPaths(basemap.water),
      parkPaths: buildPaths(basemap.parks),
    };
  }, [basemap, bounds]);
}

export default function CityItineraryMapSection({ trip, reloadToken = 0 }) {
  const [cityMapState, setCityMapState] = useState(INITIAL_CITY_MAP_STATE);
  const outlineClipId = useId().replace(/:/g, "");

  useEffect(() => {
    const controller = new AbortController();

    if (!trip?.id) {
      setCityMapState(INITIAL_CITY_MAP_STATE);
      return () => controller.abort();
    }

    async function loadCityMap() {
      setCityMapState((previous) => ({
        cityMap: previous.cityMap,
        loading: true,
        errorMessage: "",
      }));

      try {
        const cityMap = await fetchTripCityMap(trip.id, {
          signal: controller.signal,
        });

        setCityMapState({
          cityMap,
          loading: false,
          errorMessage: "",
        });
      } catch (error) {
        if (error?.name === "AbortError") {
          return;
        }

        console.error("[city-itinerary-map] Failed to load mini city map", {
          tripId: trip.id,
          message: error?.message,
        });

        setCityMapState({
          cityMap: null,
          loading: false,
          errorMessage:
            error?.message ?? "Unable to load the destination map right now.",
        });
      }
    }

    loadCityMap();

    return () => controller.abort();
  }, [reloadToken, trip?.id]);

  const destination =
    cityMapState.cityMap?.destination ?? getDestinationLabel(trip);
  const rawDays = useMemo(
    () =>
      cityMapState.cityMap?.days ??
      trip?.mapEnrichment?.markerDays ??
      trip?.itinerary?.days ??
      [],
    [cityMapState.cityMap?.days, trip?.itinerary?.days, trip?.mapEnrichment?.markerDays]
  );
  const basemap = cityMapState.cityMap?.basemap ?? null;
  const outline = cityMapState.cityMap?.outline ?? basemap?.outline ?? null;
  const places = useMemo(
    () => flattenPlacesFromDays(rawDays, destination),
    [destination, rawDays]
  );
  const pinnedPlaces = useMemo(
    () => places.filter((place) => place.isPinned),
    [places]
  );
  const unresolvedPlaces = useMemo(
    () => places.filter((place) => !place.isPinned),
    [places]
  );
  const groupedPlaces = useMemo(() => groupPlacesByDay(places), [places]);
  const bounds = useMemo(
    () =>
      resolveCityMapBounds({
        cityBounds:
          cityMapState.cityMap?.cityBounds ??
          basemap?.cityBounds ??
          trip?.mapEnrichment?.cityBounds,
        places: pinnedPlaces,
      }),
    [basemap?.cityBounds, cityMapState.cityMap?.cityBounds, pinnedPlaces, trip?.mapEnrichment?.cityBounds]
  );
  const projectedOutline = useMemo(
    () => projectCityMapOutline(outline, bounds, CITY_ITINERARY_MAP_CANVAS),
    [outline, bounds]
  );
  const outlinePath = useMemo(
    () => buildCityMapOutlinePath(outline, bounds, CITY_ITINERARY_MAP_CANVAS),
    [outline, bounds]
  );
  const markers = useMemo(
    () =>
      createCityMapMarkerLayout(pinnedPlaces, {
        bounds,
        canvas: CITY_ITINERARY_MAP_CANVAS,
        minDistance: 16,
        step: 6,
        containsPoint: (point) =>
          isProjectedPointInsidePolygons(point, projectedOutline.polygons),
      }),
    [bounds, pinnedPlaces, projectedOutline.polygons]
  );
  const { roadPaths, waterPaths, parkPaths } = useProjectedBasemapFeatures(
    basemap,
    bounds
  );
  const distanceMatrix = useMemo(
    () => buildCityMapDistanceMatrix(pinnedPlaces),
    [pinnedPlaces]
  );
  const approximateSpanMeters = useMemo(() => {
    if (distanceMatrix.length === 0) {
      return null;
    }

    return distanceMatrix.reduce((largestDistance, row) => {
      return row.reduce((currentLargest, cell) => {
        return Number.isFinite(cell.meters) && cell.meters > currentLargest
          ? cell.meters
          : currentLargest;
      }, largestDistance);
    }, 0);
  }, [distanceMatrix]);

  const hasMapFrame = Boolean(bounds) || markers.length > 0 || destination;
  const hasOutline = projectedOutline.polygons.length > 0;
  const hasBasemapFeatures =
    roadPaths.length + waterPaths.length + parkPaths.length > 0;
  const showOverlay = markers.length === 0;
  const overlayHeading = cityMapState.loading
    ? "Loading mini map"
    : "Mini map is getting ready";
  const overlayMessage = cityMapState.errorMessage
    ? cityMapState.errorMessage
    : hasBasemapFeatures
      ? `The destination basemap for ${destination} is ready. Pins will appear as recognized stops are mapped.`
      : `The destination shell for ${destination} is ready. Pins will appear as itinerary stops are recognized.`;

  return (
    <section className="mt-10 rounded-[2rem] border border-[var(--voy-border)] bg-[var(--voy-surface)] p-6 shadow-md md:p-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.24em] text-[var(--voy-accent)]">
            Static Mini Map
          </p>
          <h2 className="mt-2 text-3xl font-semibold text-[var(--voy-text)]">
            {destination}
          </h2>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-[var(--voy-text-muted)]">
            A compact static map keeps the destination visible at a glance. The full
            day-by-day plan and algorithm-based distance estimates continue below.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--voy-text-muted)]">
          <span className="rounded-full border border-[var(--voy-border)] bg-white/80 px-4 py-2">
            {markers.length} mapped pin{markers.length === 1 ? "" : "s"}
          </span>
          <span className="rounded-full border border-[var(--voy-border)] bg-white/80 px-4 py-2">
            {groupedPlaces.length} day{groupedPlaces.length === 1 ? "" : "s"}
          </span>
          <span className="rounded-full border border-[var(--voy-border)] bg-white/80 px-4 py-2">
            {formatCityMapDistance(approximateSpanMeters)} max span
          </span>
        </div>
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1.15fr)_320px]">
        <div className="rounded-[1.6rem] border border-[rgba(24,39,75,0.08)] bg-[linear-gradient(180deg,rgba(246,248,252,0.98)_0%,rgba(239,244,250,0.98)_100%)] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]">
          <div className="mb-3 flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-[var(--voy-text-faint)]">
                Destination snapshot
              </p>
              <p className="mt-1 text-base font-semibold text-[var(--voy-text)]">
                {destination}
              </p>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-[rgba(24,39,75,0.08)] bg-white/80 px-3 py-2 text-xs font-medium text-[var(--voy-text-muted)]">
              <Navigation className="h-4 w-4" />
              Click pins to open Google Maps
            </div>
          </div>

          <div
            className="relative overflow-hidden rounded-[1.4rem] border border-[rgba(24,39,75,0.08)] bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.98),rgba(239,244,250,0.9)_58%,rgba(226,234,245,0.94)_100%)]"
            style={{
              aspectRatio: "16 / 9",
              minHeight: "220px",
            }}
          >
            {hasMapFrame ? (
              <svg
                viewBox={`0 0 ${CITY_ITINERARY_MAP_CANVAS.width} ${CITY_ITINERARY_MAP_CANVAS.height}`}
                className="block h-full w-full"
                role="img"
                aria-label={`${destination} mini itinerary map`}
              >
                <defs>
                  <pattern
                    id="city-itinerary-mini-grid"
                    width="72"
                    height="72"
                    patternUnits="userSpaceOnUse"
                  >
                    <path
                      d="M 72 0 L 0 0 0 72"
                      fill="none"
                      stroke="rgba(72, 99, 137, 0.08)"
                      strokeWidth="1"
                    />
                  </pattern>
                  {hasOutline ? (
                    <clipPath id={outlineClipId}>
                      {projectedOutline.polygons.map((polygon, index) => (
                        <path key={`clip-${index}`} d={polygon.path} />
                      ))}
                    </clipPath>
                  ) : null}
                </defs>

                <rect
                  x="0"
                  y="0"
                  width={CITY_ITINERARY_MAP_CANVAS.width}
                  height={CITY_ITINERARY_MAP_CANVAS.height}
                  fill="rgba(255,255,255,0.82)"
                />
                <rect
                  x="0"
                  y="0"
                  width={CITY_ITINERARY_MAP_CANVAS.width}
                  height={CITY_ITINERARY_MAP_CANVAS.height}
                  fill="url(#city-itinerary-mini-grid)"
                />

                <g clipPath={hasOutline ? `url(#${outlineClipId})` : undefined}>
                  {outlinePath ? (
                    <path
                      d={outlinePath}
                      fill="rgba(255,255,255,0.58)"
                      stroke="rgba(72, 99, 137, 0.08)"
                      strokeWidth="1.2"
                    />
                  ) : null}

                  {parkPaths.map((feature) => (
                    <path
                      key={feature.id}
                      d={feature.path}
                      fill="rgba(154, 198, 160, 0.28)"
                      stroke="rgba(107, 153, 113, 0.2)"
                      strokeWidth="1"
                    />
                  ))}

                  {waterPaths.map((feature) => (
                    <path
                      key={feature.id}
                      d={feature.path}
                      fill={feature.closed ? "rgba(148, 190, 223, 0.3)" : "none"}
                      stroke="rgba(90, 136, 176, 0.36)"
                      strokeWidth={feature.closed ? 1.1 : 1.6}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ))}

                  {roadPaths.map((feature) => (
                    <path
                      key={feature.id}
                      d={feature.path}
                      fill="none"
                      stroke="rgba(86, 104, 135, 1)"
                      strokeOpacity={getRoadStrokeOpacity(feature.kind)}
                      strokeWidth={getRoadStrokeWidth(feature.kind)}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ))}
                </g>

                {projectedOutline.polygons.map((polygon, index) => (
                  <path
                    key={`outline-${index}`}
                    d={polygon.path}
                    fill="none"
                    stroke="rgba(72, 99, 137, 0.3)"
                    strokeWidth="2.4"
                    strokeLinejoin="round"
                  />
                ))}

                {markers.map((marker) => (
                  <g
                    key={marker.id}
                    role="button"
                    tabIndex={0}
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

                    <g transform={`translate(${marker.markerPoint.x} ${marker.markerPoint.y})`}>
                      <path
                        d={buildPinPath(9)}
                        fill="rgba(255,255,255,0.96)"
                        stroke={marker.accent.stroke}
                        strokeWidth="1.4"
                        strokeLinejoin="round"
                      />
                      <path
                        d={buildPinPath(6.6)}
                        fill={marker.accent.fill}
                        opacity="0.98"
                        transform="translate(0 0.4)"
                      />
                      <circle
                        cx="0"
                        cy="-3.6"
                        r="1.9"
                        fill="#F8FAFC"
                        opacity="0.98"
                      />
                    </g>
                  </g>
                ))}
              </svg>
            ) : null}

            {showOverlay ? (
              <div className="absolute inset-0 flex items-center justify-center bg-[linear-gradient(180deg,rgba(250,250,248,0.72)_0%,rgba(246,243,237,0.84)_100%)] p-6 text-center">
                <div className="max-w-xl">
                  <p className="text-xl font-semibold text-[var(--voy-text)]">
                    {overlayHeading}
                  </p>
                  <p className="mt-3 text-sm leading-7 text-[var(--voy-text-muted)]">
                    {overlayMessage}
                  </p>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="rounded-[1.6rem] border border-[var(--voy-border)] bg-[rgba(251,250,247,0.9)] p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]">
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--voy-text-faint)]">
            Day snapshot
          </p>
          <h3 className="mt-2 text-lg font-semibold text-[var(--voy-text)]">
            Day-by-day overview
          </h3>
          <p className="mt-2 text-sm leading-7 text-[var(--voy-text-muted)]">
            The detailed plan is listed below. Use this compact snapshot to see how
            many places are mapped for each day before opening the itinerary cards.
          </p>

          <div className="mt-5 grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
            <div className="rounded-[1.1rem] border border-[var(--voy-border)] bg-white/80 px-4 py-4">
              <p className="text-xs uppercase tracking-[0.18em] text-[var(--voy-text-faint)]">
                Mapped pins
              </p>
              <p className="mt-2 text-lg font-semibold text-[var(--voy-text)]">
                {markers.length}
              </p>
            </div>
            <div className="rounded-[1.1rem] border border-[var(--voy-border)] bg-white/80 px-4 py-4">
              <p className="text-xs uppercase tracking-[0.18em] text-[var(--voy-text-faint)]">
                Pending places
              </p>
              <p className="mt-2 text-lg font-semibold text-[var(--voy-text)]">
                {unresolvedPlaces.length}
              </p>
            </div>
            <div className="rounded-[1.1rem] border border-[var(--voy-border)] bg-white/80 px-4 py-4">
              <p className="text-xs uppercase tracking-[0.18em] text-[var(--voy-text-faint)]">
                Max span
              </p>
              <p className="mt-2 text-lg font-semibold text-[var(--voy-text)]">
                {formatCityMapDistance(approximateSpanMeters)}
              </p>
            </div>
          </div>

          <div className="mt-5 space-y-3">
            {groupedPlaces.length > 0 ? (
              groupedPlaces.map((group) => (
                <div
                  key={group.dayNumber}
                  className="rounded-[1rem] border border-[var(--voy-border)] bg-white/80 px-4 py-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--voy-text-faint)]">
                        Day {group.dayNumber}
                      </p>
                      <p className="mt-1 font-semibold text-[var(--voy-text)]">
                        {group.dayTitle}
                      </p>
                    </div>
                    <span
                      className="rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.12em]"
                      style={{
                        color: group.accent.stroke,
                        backgroundColor: group.accent.soft,
                      }}
                    >
                      {group.mappedPlaces}/{group.totalPlaces} mapped
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-[1rem] border border-[var(--voy-border)] bg-white/80 px-4 py-4 text-sm text-[var(--voy-text-muted)]">
                Day cards will appear here once itinerary stops are saved.
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
