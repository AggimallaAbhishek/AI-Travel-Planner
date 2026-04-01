import React, { useEffect, useMemo, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import "../../styles/unified-trip-map.css";
import { toast } from "react-toastify";
import { fetchTripMap } from "@/lib/tripMap";
import {
  formatUnifiedMapDistanceLabel,
  resolveUnifiedMapFilterCategory,
} from "../../../shared/unifiedMap.js";

const INITIAL_MAP_STATE = {
  tripMap: null,
  loading: false,
  errorMessage: "",
};

const FILTER_OPTIONS = [
  { key: "tourist_spots", label: "Tourist Spots" },
  { key: "hotels", label: "Hotels" },
  { key: "restaurants", label: "Restaurants" },
  { key: "airports", label: "Airports" },
  { key: "rail_metro", label: "Rail / Metro" },
  { key: "bus_terminals", label: "Bus Terminals" },
];

const DAY_ROUTE_COLORS = [
  { line: "#f0c040", glow: "#f0c04026", marker: "#f0c040", accent: "#e8853a" },
  { line: "#61d4ff", glow: "#61d4ff24", marker: "#61d4ff", accent: "#1f8cab" },
  { line: "#81d98f", glow: "#81d98f24", marker: "#81d98f", accent: "#3b8b4b" },
  { line: "#ff8f70", glow: "#ff8f7024", marker: "#ff8f70", accent: "#bf5a39" },
  { line: "#b08cff", glow: "#b08cff24", marker: "#b08cff", accent: "#7855bb" },
  { line: "#ffd166", glow: "#ffd16622", marker: "#ffd166", accent: "#bf9a2f" },
];

function normalizeText(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed || fallback;
}

function escapeHtml(value = "") {
  return normalizeText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDistance(distanceMeters) {
  return formatUnifiedMapDistanceLabel(distanceMeters) || "—";
}

function formatDuration(durationSeconds) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return "—";
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

function createInitialFilters() {
  return FILTER_OPTIONS.reduce((state, option) => {
    state[option.key] = true;
    return state;
  }, {});
}

function getDayColor(dayNumber = 1) {
  const index = Math.max(0, Number.parseInt(dayNumber, 10) - 1);
  return DAY_ROUTE_COLORS[index % DAY_ROUTE_COLORS.length];
}

function buildMarkerPopup(node = {}, extra = {}) {
  const title = escapeHtml(node.name || "Mapped stop");
  const subtitleParts = [
    extra.dayLabel ? `Day ${extra.dayLabel}` : "",
    normalizeText(extra.subtitle ?? node.address),
  ].filter(Boolean);

  return `
    <div class="voy-unified-map-popup">
      <div class="voy-unified-map-popup__title">${title}</div>
      <div class="voy-unified-map-popup__sub">${escapeHtml(subtitleParts.join(" · "))}</div>
      <div class="voy-unified-map-popup__row">${escapeHtml(normalizeText(node.category).replace(/_/g, " "))}</div>
    </div>
  `;
}

function buildRouteStopIconHtml({ stop, color, isStart, isActive }) {
  const bubbleStyle = [
    `background:${isStart ? color.accent : color.marker}`,
    "color:#0a0c0f",
    `box-shadow:0 4px 20px ${isStart ? `${color.accent}66` : `${color.marker}66`}`,
    isActive ? "transform:scale(1.04)" : "",
  ]
    .filter(Boolean)
    .join(";");
  const dotStyle = [
    `background:${isStart ? color.accent : color.marker}`,
    `box-shadow:0 0 10px ${isStart ? color.accent : color.marker}`,
  ].join(";");

  return `
      <div class="voy-unified-map-pin">
        <div class="voy-unified-map-pin__bubble" style="${bubbleStyle}">
        ${stop.visitOrder ?? "•"}. ${escapeHtml(stop.name)}
        </div>
        <div class="voy-unified-map-pin__dot" style="${dotStyle}"></div>
      </div>
  `;
}

function buildOverlayIconHtml({ tint, shortLabel }) {
  return `
    <div class="voy-unified-map-overlay-pin" style="border-color:${tint};color:${tint};box-shadow:0 0 16px ${tint}33">
      <span>${escapeHtml(shortLabel)}</span>
    </div>
  `;
}

function createOverlayStyle(node = {}) {
  const category = resolveUnifiedMapFilterCategory(node.category);

  if (category === "hotels") {
    return { tint: "#69d2a5", shortLabel: "H" };
  }

  if (category === "restaurants") {
    return { tint: "#ff8f70", shortLabel: "R" };
  }

  if (category === "airports") {
    return { tint: "#7db8ff", shortLabel: "A" };
  }

  if (category === "rail_metro") {
    return { tint: "#c89bff", shortLabel: "M" };
  }

  if (category === "bus_terminals") {
    return { tint: "#ffd166", shortLabel: "B" };
  }

  return { tint: "#f0c040", shortLabel: "P" };
}

function collectVisibleCoordinates(routeStops = [], overlayNodes = []) {
  return [...routeStops, ...overlayNodes]
    .map((node) => node?.coordinates)
    .filter(
      (coordinates) =>
        Number.isFinite(coordinates?.latitude) &&
        Number.isFinite(coordinates?.longitude)
    )
    .map((coordinates) => [coordinates.latitude, coordinates.longitude]);
}

export default function UnifiedTripRouteMapSection({
  trip,
  reloadToken = 0,
  tripMapOverride = null,
}) {
  const [mapState, setMapState] = useState(INITIAL_MAP_STATE);
  const [selectedDay, setSelectedDay] = useState("all");
  const [activeStopId, setActiveStopId] = useState("");
  const [filters, setFilters] = useState(createInitialFilters);
  const [leafletLib, setLeafletLib] = useState(null);
  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const tileLayerRef = useRef(null);
  const layerGroupRef = useRef(null);
  const labelGroupRef = useRef(null);
  const markerRegistryRef = useRef(new Map());

  useEffect(() => {
    let cancelled = false;

    import("leaflet")
      .then((module) => {
        if (cancelled) {
          return;
        }

        setLeafletLib(module.default ?? module);
      })
      .catch((error) => {
        console.error("[unified-trip-map] Failed to load Leaflet", {
          message: error instanceof Error ? error.message : String(error),
        });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!tripMapOverride) {
      return undefined;
    }

    console.info("[unified-trip-map] Using preview payload override", {
      destination: tripMapOverride?.destination ?? null,
      dayCount: Array.isArray(tripMapOverride?.days) ? tripMapOverride.days.length : 0,
    });

    setMapState({
      tripMap: tripMapOverride,
      loading: false,
      errorMessage: "",
    });
    setSelectedDay(
      tripMapOverride?.activeDayDefault
        ? String(tripMapOverride.activeDayDefault)
        : "all"
    );

    return undefined;
  }, [tripMapOverride]);

  useEffect(() => {
    const controller = new AbortController();

    if (tripMapOverride) {
      return () => controller.abort();
    }

    if (!trip?.id) {
      setMapState(INITIAL_MAP_STATE);
      return () => controller.abort();
    }

    async function loadTripMap() {
      setMapState((previous) => ({
        tripMap: previous.tripMap,
        loading: true,
        errorMessage: "",
      }));

      try {
        const tripMap = await fetchTripMap(trip.id, {
          signal: controller.signal,
          force: reloadToken > 0,
        });

        setMapState({
          tripMap,
          loading: false,
          errorMessage: "",
        });
        setSelectedDay(
          tripMap?.activeDayDefault ? String(tripMap.activeDayDefault) : "all"
        );
      } catch (error) {
        if (error?.name === "AbortError") {
          return;
        }

        console.error("[unified-trip-map] Failed to load trip map", {
          tripId: trip.id,
          message: error?.message,
        });
        setMapState({
          tripMap: null,
          loading: false,
          errorMessage: error?.message ?? "Unable to load the trip map right now.",
        });
        toast.error(error?.message ?? "Unable to load the trip map right now.");
      }
    }

    loadTripMap();

    return () => controller.abort();
  }, [reloadToken, trip?.id, tripMapOverride]);

  const tripMap = tripMapOverride ?? mapState.tripMap;
  const dayOptions = useMemo(
    () => (Array.isArray(tripMap?.days) ? tripMap.days : []),
    [tripMap?.days]
  );
  const selectedDays = useMemo(() => {
    if (selectedDay === "all") {
      return dayOptions;
    }

    return dayOptions.filter(
      (day) => String(day.dayNumber) === String(selectedDay)
    );
  }, [dayOptions, selectedDay]);
  const routeStops = useMemo(
    () =>
      selectedDays.flatMap((day) =>
        (Array.isArray(day.stops) ? day.stops : []).map((stop) => ({
          ...stop,
          dayNumber: day.dayNumber,
          dayTitle: day.title,
        }))
      ),
    [selectedDays]
  );
  const routeSegments = useMemo(
    () =>
      selectedDays.flatMap((day) =>
        (Array.isArray(day.segments) ? day.segments : []).map((segment) => ({
          ...segment,
          dayNumber: day.dayNumber,
          dayTitle: day.title,
        }))
      ),
    [selectedDays]
  );
  const unresolvedStops = useMemo(
    () =>
      selectedDays.flatMap((day) =>
        (Array.isArray(day.unresolvedStops) ? day.unresolvedStops : []).map((stop) => ({
          ...stop,
          dayNumber: day.dayNumber,
        }))
      ),
    [selectedDays]
  );
  const overlayNodes = useMemo(() => {
    if (!tripMap?.layers) {
      return [];
    }

    const nodes = [];

    if (filters.hotels) {
      nodes.push(...(tripMap.layers.hotels ?? []));
    }
    if (filters.restaurants) {
      nodes.push(...(tripMap.layers.restaurants ?? []));
    }
    if (filters.airports) {
      nodes.push(...(tripMap.layers.airports ?? []));
    }
    if (filters.rail_metro) {
      nodes.push(...(tripMap.layers.railMetroStations ?? []));
    }
    if (filters.bus_terminals) {
      nodes.push(...(tripMap.layers.busTerminals ?? []));
    }

    return nodes;
  }, [filters, tripMap?.layers]);
  const visibleRouteStops = useMemo(
    () => (filters.tourist_spots ? routeStops : []),
    [filters.tourist_spots, routeStops]
  );
  const visibleRouteSegments = useMemo(
    () => (filters.tourist_spots ? routeSegments : []),
    [filters.tourist_spots, routeSegments]
  );

  useEffect(() => {
    if (!routeStops.some((stop) => stop.id === activeStopId)) {
      setActiveStopId(routeStops[0]?.id ?? "");
    }
  }, [activeStopId, routeStops]);

  const selectedDistanceMeters = selectedDays.reduce(
    (total, day) => total + (day.routeSummary?.totalDistanceMeters ?? 0),
    0
  );
  const selectedSegmentCount = routeSegments.length;
  const selectedAverageLegMeters =
    selectedSegmentCount > 0 ? selectedDistanceMeters / selectedSegmentCount : 0;
  const selectedDurationSeconds = selectedDays.reduce(
    (total, day) => total + (day.routeSummary?.totalDurationSeconds ?? 0),
    0
  );
  const selectedAlgorithm =
    selectedDays[0]?.routeSummary?.algorithm ??
    tripMap?.stats?.algorithmLabel ??
    "not-applicable";

  useEffect(() => {
    if (!leafletLib || !mapContainerRef.current || mapRef.current) {
      return;
    }

    const map = leafletLib.map(mapContainerRef.current, {
      center: [20, 0],
      zoom: 12,
      zoomControl: true,
      attributionControl: true,
    });

    tileLayerRef.current = leafletLib
      .tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
        subdomains: "abcd",
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors &copy; CARTO",
      })
      .addTo(map);

    layerGroupRef.current = leafletLib.layerGroup().addTo(map);
    labelGroupRef.current = leafletLib.layerGroup().addTo(map);
    mapRef.current = map;
    const markerRegistry = markerRegistryRef.current;

    return () => {
      markerRegistry.clear();
      map.remove();
      mapRef.current = null;
      tileLayerRef.current = null;
      layerGroupRef.current = null;
      labelGroupRef.current = null;
    };
  }, [leafletLib]);

  useEffect(() => {
    if (!leafletLib || !mapRef.current || !layerGroupRef.current || !labelGroupRef.current) {
      return;
    }

    const map = mapRef.current;
    const mainLayer = layerGroupRef.current;
    const labelLayer = labelGroupRef.current;
    mainLayer.clearLayers();
    labelLayer.clearLayers();
    markerRegistryRef.current.clear();

    visibleRouteSegments.forEach((segment) => {
      if (!Array.isArray(segment.polyline) || segment.polyline.length < 2) {
        return;
      }

      const color = getDayColor(segment.dayNumber);
      const latLngs = segment.polyline
        .map((point) => [point.latitude, point.longitude])
        .filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]));

      if (latLngs.length < 2) {
        return;
      }

      leafletLib
        .polyline(latLngs, {
          color: color.glow,
          weight: 8,
          opacity: 1,
        })
        .addTo(mainLayer);

      leafletLib
        .polyline(latLngs, {
          color: color.line,
          weight: 2.5,
          opacity: 0.82,
          dashArray: "8 6",
          lineJoin: "round",
        })
        .addTo(mainLayer);

      const midpoint = latLngs[Math.floor(latLngs.length / 2)];
      const label = normalizeText(segment.label, formatDistance(segment.distanceMeters));

      if (midpoint && label) {
        leafletLib
          .marker(midpoint, {
            icon: leafletLib.divIcon({
              className: "voy-unified-map-label-icon",
              html: `<div class="voy-unified-map-route-label">${label}</div>`,
              iconSize: [72, 24],
              iconAnchor: [36, 12],
            }),
            interactive: false,
          })
          .addTo(labelLayer);
      }
    });

    visibleRouteStops.forEach((stop) => {
      const coordinates = stop?.coordinates;
      if (!Number.isFinite(coordinates?.latitude) || !Number.isFinite(coordinates?.longitude)) {
        return;
      }

      const color = getDayColor(stop.dayNumber);
      const marker = leafletLib
        .marker([coordinates.latitude, coordinates.longitude], {
          icon: leafletLib.divIcon({
            className: "voy-unified-map-marker-icon",
            html: buildRouteStopIconHtml({
              stop,
              color,
              isStart: Number(stop.visitOrder) === 1,
              isActive: stop.id === activeStopId,
            }),
            iconAnchor: [0, 36],
          }),
        })
        .addTo(mainLayer);

      marker.bindPopup(
        buildMarkerPopup(stop, {
          dayLabel: stop.dayNumber,
          subtitle: stop.address,
        })
      );
      marker.on("click", () => {
        setActiveStopId(stop.id);
      });
      markerRegistryRef.current.set(stop.id, marker);
    });

    overlayNodes.forEach((node) => {
      const coordinates = node?.coordinates;
      if (!Number.isFinite(coordinates?.latitude) || !Number.isFinite(coordinates?.longitude)) {
        return;
      }

      const overlayStyle = createOverlayStyle(node);
      const marker = leafletLib
        .marker([coordinates.latitude, coordinates.longitude], {
          icon: leafletLib.divIcon({
            className: "voy-unified-map-marker-icon",
            html: buildOverlayIconHtml({
              tint: overlayStyle.tint,
              shortLabel: overlayStyle.shortLabel,
            }),
            iconAnchor: [14, 14],
          }),
        })
        .addTo(mainLayer);

      marker.bindPopup(
        buildMarkerPopup(node, {
          subtitle: node.address,
        })
      );
    });

    const visibleCoordinates = collectVisibleCoordinates(visibleRouteStops, overlayNodes);
    if (visibleCoordinates.length > 0) {
      map.fitBounds(visibleCoordinates, {
        padding: [44, 44],
      });
    } else if (tripMap?.viewport?.bounds) {
      map.fitBounds(
        [
          [tripMap.viewport.bounds.south, tripMap.viewport.bounds.west],
          [tripMap.viewport.bounds.north, tripMap.viewport.bounds.east],
        ],
        { padding: [44, 44] }
      );
    }

    window.requestAnimationFrame(() => {
      map.invalidateSize();
    });
  }, [activeStopId, leafletLib, overlayNodes, tripMap?.viewport?.bounds, visibleRouteSegments, visibleRouteStops]);

  const handleSelectStop = (stopId) => {
    setActiveStopId(stopId);

    const marker = markerRegistryRef.current.get(stopId);
    if (!marker || !mapRef.current) {
      return;
    }

    const latLng = marker.getLatLng();
    mapRef.current.flyTo(latLng, Math.max(mapRef.current.getZoom(), 13), {
      animate: true,
      duration: 0.8,
    });
    marker.openPopup();
  };

  if (mapState.loading && !tripMap) {
    return (
      <section className="voy-unified-map">
        <div className="voy-unified-map__shell voy-unified-map__shell--loading">
          <div className="voy-unified-map__loading">Loading optimized trip map…</div>
        </div>
      </section>
    );
  }

  if (mapState.errorMessage && !tripMap) {
    return (
      <section className="voy-unified-map">
        <div className="voy-unified-map__shell voy-unified-map__shell--error">
          <h3>Unable to load the route map</h3>
          <p>{mapState.errorMessage}</p>
        </div>
      </section>
    );
  }

  if (!tripMap) {
    return null;
  }

  return (
    <section className="voy-unified-map">
      <div className="voy-unified-map__shell">
        <header className="voy-unified-map__topbar">
          <div className="voy-unified-map__logo">CITY<span>ROUTE</span></div>
          <div className="voy-unified-map__badge">{tripMap.destination}</div>
          <div className="voy-unified-map__badge">{selectedAlgorithm}</div>
          <div className="voy-unified-map__stats">
            <div>
              STOPS <b>{visibleRouteStops.length}</b>
            </div>
            <div>
              TOTAL <b>{formatDistance(selectedDistanceMeters)}</b>
            </div>
            <div>
              AVG LEG <b>{formatDistance(selectedAverageLegMeters)}</b>
            </div>
            <div>
              TIME <b>{formatDuration(selectedDurationSeconds)}</b>
            </div>
          </div>
        </header>

        <div className="voy-unified-map__content">
          <aside className="voy-unified-map__sidebar">
            <div className="voy-unified-map__sidebar-header">
              <h2>Optimized Route</h2>
              <p>
                <em>{visibleRouteStops.length}</em> mapped travel stops
              </p>
            </div>

            <div className="voy-unified-map__summary-grid">
              <div className="voy-unified-map__metric">
                <label>Total Distance</label>
                <span>{formatDistance(selectedDistanceMeters)}</span>
                <small>across selected view</small>
              </div>
              <div className="voy-unified-map__metric">
                <label>Stops</label>
                <span>{visibleRouteStops.length}</span>
                <small>tourist spots</small>
              </div>
              <div className="voy-unified-map__metric">
                <label>Avg Leg</label>
                <span>{formatDistance(selectedAverageLegMeters)}</span>
                <small>per route segment</small>
              </div>
              <div className="voy-unified-map__metric">
                <label>Algorithm</label>
                <span className="voy-unified-map__metric-small">
                  {selectedAlgorithm.replace(/-/g, " ")}
                </span>
                <small>server optimized</small>
              </div>
            </div>

            <div className="voy-unified-map__algo-tag">
              Deterministic route graph · nearest-neighbor seed · 2-opt refinement
            </div>

            <div className="voy-unified-map__control-section">
              <label htmlFor="voy-unified-map-day" className="voy-unified-map__section-label">
                Day View
              </label>
              <select
                id="voy-unified-map-day"
                className="voy-unified-map__select"
                value={selectedDay}
                onChange={(event) => setSelectedDay(event.target.value)}
              >
                <option value="all">All Days</option>
                {dayOptions.map((day) => (
                  <option key={day.dayNumber} value={day.dayNumber}>
                    Day {day.dayNumber} · {day.title}
                  </option>
                ))}
              </select>
            </div>

            <div className="voy-unified-map__control-section">
              <div className="voy-unified-map__section-label">Visible Layers</div>
              <div className="voy-unified-map__filter-row">
                {FILTER_OPTIONS.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    className={`voy-unified-map__filter-btn${
                      filters[option.key] ? " is-active" : ""
                    }`}
                    onClick={() =>
                      setFilters((previous) => ({
                        ...previous,
                        [option.key]: !previous[option.key],
                      }))
                    }
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="voy-unified-map__layer-chips">
              <span>{tripMap.stats?.categoryCounts?.hotels ?? 0} hotels</span>
              <span>{tripMap.stats?.categoryCounts?.restaurants ?? 0} restaurants</span>
              <span>{tripMap.stats?.categoryCounts?.airports ?? 0} airports</span>
              <span>{tripMap.stats?.categoryCounts?.railMetroStations ?? 0} rail/metro</span>
              <span>{tripMap.stats?.categoryCounts?.busTerminals ?? 0} bus terminals</span>
            </div>

            <div className="voy-unified-map__stops-label">Route Stops</div>
            <div className="voy-unified-map__stop-list">
              {visibleRouteStops.length === 0 ? (
                <div className="voy-unified-map__empty-note">
                  Enable tourist spots or select a day with enough mapped places to display the optimized route.
                </div>
              ) : (
                visibleRouteStops.map((stop, index) => {
                  const matchingSegment = visibleRouteSegments.find(
                    (segment) => segment.fromStopId === stop.id
                  );

                  return (
                    <React.Fragment key={`${stop.id}-${stop.dayNumber}-${index}`}>
                      <button
                        type="button"
                        className={`voy-unified-map__stop-item${
                          stop.id === activeStopId ? " is-active" : ""
                        }`}
                        onClick={() => handleSelectStop(stop.id)}
                      >
                        <div className="voy-unified-map__stop-num">
                          {stop.visitOrder ?? index + 1}
                        </div>
                        <div className="voy-unified-map__stop-info">
                          <div className="voy-unified-map__stop-name">{stop.name}</div>
                          <div className="voy-unified-map__stop-district">
                            Day {stop.dayNumber} · {stop.address || stop.dayTitle}
                          </div>
                        </div>
                        <div className="voy-unified-map__stop-dist">
                          {matchingSegment
                            ? matchingSegment.label || formatDistance(matchingSegment.distanceMeters)
                            : "END"}
                        </div>
                      </button>
                      {index < visibleRouteStops.length - 1 ? (
                        <div className="voy-unified-map__connector" />
                      ) : null}
                    </React.Fragment>
                  );
                })
              )}
            </div>

            {unresolvedStops.length > 0 ? (
              <div className="voy-unified-map__unresolved">
                Unresolved stops:{" "}
                {unresolvedStops
                  .map((stop) => `Day ${stop.dayNumber} ${stop.name}`)
                  .join(", ")}
              </div>
            ) : null}
          </aside>

          <div className="voy-unified-map__map-panel">
            <div className="voy-unified-map__map-header">
              <div>
                <div className="voy-unified-map__map-eyebrow">Destination viewport</div>
                <h3>{tripMap.destination}</h3>
                <p>
                  The route map is now powered by a reusable Leaflet template, local-first
                  POI resolution, and server-side route optimization.
                </p>
              </div>
              <div className="voy-unified-map__map-status">
                <span>{mapState.loading ? "Refreshing map data" : "Live route view"}</span>
                <span>{tripMap.stats?.unresolvedCount ?? 0} unresolved</span>
              </div>
            </div>

            <div ref={mapContainerRef} className="voy-unified-map__map-canvas" />
          </div>
        </div>
      </div>
    </section>
  );
}
