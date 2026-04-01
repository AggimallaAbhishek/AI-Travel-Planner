import React, { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { loadGoogleMapsApi } from "@/lib/googleMaps";
import { decodeGooglePolyline, escapeHtmlText } from "@/lib/maps";

function normalizeMarkerPosition(marker = {}) {
  const latitude = Number.parseFloat(marker.latitude);
  const longitude = Number.parseFloat(marker.longitude);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return {
    lat: latitude,
    lng: longitude,
  };
}

function normalizeCenterPosition(center = {}) {
  const latitude = Number.parseFloat(center?.latitude);
  const longitude = Number.parseFloat(center?.longitude);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return {
    lat: latitude,
    lng: longitude,
  };
}

function buildRoutePath(dayRoute = {}) {
  const decodedPolyline = decodeGooglePolyline(dayRoute?.polyline);

  if (decodedPolyline.length >= 2) {
    return decodedPolyline.map((point) => ({
      lat: point.latitude,
      lng: point.longitude,
    }));
  }

  return (Array.isArray(dayRoute?.markers) ? dayRoute.markers : [])
    .map(normalizeMarkerPosition)
    .filter(Boolean);
}

function buildMapRestriction(viewport = null) {
  if (
    !viewport ||
    !Number.isFinite(viewport.north) ||
    !Number.isFinite(viewport.south) ||
    !Number.isFinite(viewport.east) ||
    !Number.isFinite(viewport.west)
  ) {
    return null;
  }

  return {
    north: viewport.north,
    south: viewport.south,
    east: viewport.east,
    west: viewport.west,
  };
}

function createMarkerIcon(googleMaps, isHighlighted) {
  return {
    path: googleMaps.SymbolPath.CIRCLE,
    fillColor: isHighlighted ? "#c9a45c" : "#23344d",
    fillOpacity: 1,
    strokeColor: "#ffffff",
    strokeWeight: isHighlighted ? 2.5 : 2,
    scale: isHighlighted ? 13 : 11,
    labelOrigin: new googleMaps.Point(0, 1),
  };
}

function buildInfoWindowMarkup(marker = {}, destination = "") {
  const safeName = escapeHtmlText(marker.name ?? "Stop");
  const safeLocation = escapeHtmlText(marker.location ?? destination ?? "");

  return `
    <div style="min-width: 180px; font-family: 'DM Sans', ui-sans-serif, system-ui, sans-serif;">
      <div style="font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.08em;">
        Stop ${marker.visitOrder ?? ""}
      </div>
      <div style="margin-top: 4px; font-size: 16px; font-weight: 700; color: #111827;">
        ${safeName}
      </div>
      ${
        safeLocation
          ? `<div style="margin-top: 6px; font-size: 13px; color: #6b7280;">${safeLocation}</div>`
          : ""
      }
    </div>
  `;
}

function MapOverlayMessage({ title, body }) {
  return (
    <div className="pointer-events-none absolute left-4 top-4 z-20 max-w-sm rounded-[1.4rem] border border-[var(--voy-border)] bg-[rgba(252,250,245,0.88)] px-4 py-3 text-left shadow-lg backdrop-blur-md">
      <div>
        <p className="text-sm font-semibold text-[var(--voy-text)]">{title}</p>
        <p className="mt-1 text-sm leading-6 text-[var(--voy-text-muted)]">{body}</p>
      </div>
    </div>
  );
}

function StaticMapFallback({ dayRoute, destination, title, body }) {
  const markers = Array.isArray(dayRoute?.markers) ? dayRoute.markers.slice(0, 4) : [];

  return (
    <div className="voy-route-map-fallback">
      <div className="voy-route-map-fallback-copy">
        <p className="voy-route-map-fallback-title">{title}</p>
        <p className="voy-route-map-fallback-body">{body}</p>
      </div>

      <div className="voy-route-map-fallback-meta">
        <div className="voy-route-map-fallback-stat">
          <span className="voy-route-map-fallback-label">Focused area</span>
          <strong>{dayRoute?.localityLabel || destination || "Selected destination"}</strong>
        </div>
        <div className="voy-route-map-fallback-stat">
          <span className="voy-route-map-fallback-label">Mapped pins</span>
          <strong>{markers.length}</strong>
        </div>
      </div>

      {markers.length > 0 ? (
        <div className="voy-route-map-fallback-list">
          {markers.map((marker) => (
            <div key={marker.id} className="voy-route-map-fallback-item">
              <span>{marker.visitOrder}.</span>
              <span>{marker.name}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className="voy-route-actions">
        {dayRoute?.directionsUrl ? (
          <a href={dayRoute.directionsUrl} target="_blank" rel="noopener noreferrer">
            <Button className="voy-create-primary">Open route in Google Maps</Button>
          </a>
        ) : null}
      </div>
    </div>
  );
}

function TripDayMap({
  dayRoute,
  destination = "",
  highlightedStopId = null,
  onHighlightStop,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const polylineRef = useRef(null);
  const activeSegmentRef = useRef(null);
  const markersRef = useRef([]);
  const infoWindowRef = useRef(null);
  const fitListenerRef = useRef(null);
  const [mapState, setMapState] = useState({
    isLoading: false,
    errorMessage: "",
  });

  const mapMarkers = useMemo(
    () => (Array.isArray(dayRoute?.markers) ? dayRoute.markers : []),
    [dayRoute?.markers]
  );
  const routePath = useMemo(() => buildRoutePath(dayRoute), [dayRoute]);
  const localizedViewport = useMemo(
    () => dayRoute?.mapViewport ?? dayRoute?.cityBounds ?? null,
    [dayRoute?.cityBounds, dayRoute?.mapViewport]
  );
  const restriction = useMemo(
    () => buildMapRestriction(localizedViewport),
    [localizedViewport]
  );
  const mapCenter = useMemo(
    () => normalizeCenterPosition(dayRoute?.mapCenter),
    [dayRoute?.mapCenter]
  );
  const hasMapContext = Boolean(restriction || mapCenter);
  const needsInteractiveMap =
    hasMapContext || mapMarkers.length > 0 || routePath.length >= 2;

  useEffect(() => {
    let isCancelled = false;

    if (!needsInteractiveMap) {
      setMapState({
        isLoading: false,
        errorMessage: "",
      });
      return () => {
        isCancelled = true;
      };
    }

    async function ensureMapReady() {
      setMapState({
        isLoading: true,
        errorMessage: "",
      });

      try {
        const googleMaps = await loadGoogleMapsApi();

        if (isCancelled) {
          return;
        }

        if (!googleMaps) {
          setMapState({
            isLoading: false,
            errorMessage:
              "Set VITE_GOOGLE_MAPS_BROWSER_KEY to render the interactive city map.",
          });
          return;
        }

        if (!containerRef.current) {
          setMapState({
            isLoading: false,
            errorMessage: "The city map container is unavailable.",
          });
          return;
        }

        if (!mapRef.current) {
          mapRef.current = new googleMaps.Map(containerRef.current, {
            center: mapCenter ?? { lat: 35.6762, lng: 139.6503 },
            zoom: 12,
            disableDefaultUI: false,
            mapTypeControl: false,
            fullscreenControl: false,
            streetViewControl: false,
            clickableIcons: false,
            gestureHandling: "greedy",
          });
          infoWindowRef.current = new googleMaps.InfoWindow();
        }

        setMapState({
          isLoading: false,
          errorMessage: "",
        });
      } catch (error) {
        if (isCancelled) {
          return;
        }

        console.error("[route-map] Failed to initialize Google Map", error);
        setMapState({
          isLoading: false,
          errorMessage:
            error?.message ?? "The interactive route map could not be initialized.",
        });
      }
    }

    ensureMapReady();

    return () => {
      isCancelled = true;
    };
  }, [mapCenter, needsInteractiveMap]);

  useEffect(() => {
    const googleMaps = globalThis?.google?.maps;
    const map = mapRef.current;

    if (!googleMaps || !map || !needsInteractiveMap || mapState.errorMessage) {
      return undefined;
    }

    console.info("[route-map] Syncing localized day route map", {
      dayNumber: dayRoute?.dayNumber ?? null,
      localityLabel: dayRoute?.localityLabel ?? destination,
      markerCount: mapMarkers.length,
      hasPolyline: routePath.length >= 2,
      viewportSource: dayRoute?.viewportSource ?? null,
    });

    infoWindowRef.current?.close();

    if (fitListenerRef.current) {
      googleMaps.event.removeListener(fitListenerRef.current);
      fitListenerRef.current = null;
    }

    for (const markerEntry of markersRef.current) {
      googleMaps.event.clearInstanceListeners(markerEntry.marker);
      markerEntry.marker.setMap(null);
    }
    markersRef.current = [];

    if (polylineRef.current) {
      polylineRef.current.setMap(null);
      polylineRef.current = null;
    }

    if (activeSegmentRef.current) {
      activeSegmentRef.current.setMap(null);
      activeSegmentRef.current = null;
    }

    const nextMapOptions = {
      maxZoom: 16,
    };

    if (restriction) {
      nextMapOptions.restriction = {
        latLngBounds: restriction,
        strictBounds: dayRoute?.viewportSource === "day_cluster",
      };
      nextMapOptions.minZoom = 10;
    } else {
      nextMapOptions.restriction = undefined;
      nextMapOptions.minZoom = undefined;
    }

    map.setOptions(nextMapOptions);

    const bounds = new googleMaps.LatLngBounds();

    if (restriction) {
      bounds.extend({ lat: restriction.north, lng: restriction.east });
      bounds.extend({ lat: restriction.south, lng: restriction.west });
    }

    if (routePath.length >= 2) {
      polylineRef.current = new googleMaps.Polyline({
        map,
        path: routePath,
        strokeColor: "#c9a45c",
        strokeOpacity: 0.92,
        strokeWeight: 5,
      });

      for (const point of routePath) {
        bounds.extend(point);
      }
    }

    for (const markerData of mapMarkers) {
      const position = normalizeMarkerPosition(markerData);
      if (!position) {
        continue;
      }

      bounds.extend(position);

      const marker = new googleMaps.Marker({
        map,
        position,
        title: markerData.name,
        zIndex: markerData.visitOrder ?? 1,
        label: {
          text: String(markerData.visitOrder ?? ""),
          color: "#ffffff",
          fontSize: "12px",
          fontWeight: "700",
        },
        icon: createMarkerIcon(googleMaps, false),
      });

      marker.addListener("mouseover", () => {
        onHighlightStop?.(markerData.id);
      });
      marker.addListener("mouseout", () => {
        onHighlightStop?.(null);
      });
      marker.addListener("click", () => {
        console.info("[route-map] Marker selected", {
          dayNumber: dayRoute?.dayNumber ?? null,
          stopId: markerData.id,
          stopName: markerData.name,
        });
        onHighlightStop?.(markerData.id);
        infoWindowRef.current?.setContent(
          buildInfoWindowMarkup(markerData, destination)
        );
        infoWindowRef.current?.open({
          anchor: marker,
          map,
        });
      });

      markersRef.current.push({
        data: markerData,
        marker,
      });
    }

    if (!bounds.isEmpty()) {
      map.fitBounds(bounds, 48);
      fitListenerRef.current = googleMaps.event.addListenerOnce(map, "idle", () => {
        const currentZoom = map.getZoom();
        if (currentZoom && currentZoom > 15) {
          map.setZoom(15);
        }
      });
    } else if (mapCenter) {
      map.setCenter(mapCenter);
      map.setZoom(restriction ? 13 : 11);
    }

    return () => {
      if (fitListenerRef.current) {
        googleMaps.event.removeListener(fitListenerRef.current);
        fitListenerRef.current = null;
      }
    };
  }, [
    dayRoute?.dayNumber,
    dayRoute?.localityLabel,
    dayRoute?.viewportSource,
    destination,
    mapCenter,
    mapMarkers,
    mapState.errorMessage,
    needsInteractiveMap,
    onHighlightStop,
    restriction,
    routePath,
  ]);

  useEffect(() => {
    const googleMaps = globalThis?.google?.maps;
    const map = mapRef.current;

    if (!googleMaps || !map || !needsInteractiveMap || mapState.errorMessage) {
      return;
    }

    for (const markerEntry of markersRef.current) {
      const isHighlighted = highlightedStopId === markerEntry.data.id;
      markerEntry.marker.setIcon(createMarkerIcon(googleMaps, isHighlighted));
      markerEntry.marker.setZIndex(
        isHighlighted ? 200 : markerEntry.data.visitOrder ?? 1
      );
    }

    if (activeSegmentRef.current) {
      activeSegmentRef.current.setMap(null);
      activeSegmentRef.current = null;
    }

    if (!highlightedStopId) {
      return;
    }

    const activeIndex = mapMarkers.findIndex((marker) => marker.id === highlightedStopId);
    if (activeIndex === -1) {
      return;
    }

    const fromMarker = mapMarkers[activeIndex];
    const toMarker = mapMarkers[activeIndex + 1] ?? mapMarkers[activeIndex - 1] ?? null;
    const fromPosition = normalizeMarkerPosition(fromMarker);
    const toPosition = normalizeMarkerPosition(toMarker);

    if (!fromPosition || !toPosition) {
      return;
    }

    activeSegmentRef.current = new googleMaps.Polyline({
      map,
      path: [fromPosition, toPosition],
      strokeColor: "#23344d",
      strokeOpacity: 0.95,
      strokeWeight: 6,
      zIndex: 300,
    });
  }, [
    highlightedStopId,
    mapMarkers,
    mapState.errorMessage,
    needsInteractiveMap,
  ]);

  const showStaticUnavailableState = !mapState.isLoading && Boolean(mapState.errorMessage);
  const showStaticEmptyState = !mapState.isLoading && !needsInteractiveMap;
  const showNoPinsNotice =
    !mapState.isLoading &&
    !mapState.errorMessage &&
    needsInteractiveMap &&
    mapMarkers.length === 0 &&
    routePath.length < 2;

  return (
    <div className="voy-route-map-frame relative overflow-hidden rounded-[2rem] border border-[var(--voy-border)] bg-[linear-gradient(180deg,rgba(253,250,244,0.92),rgba(246,239,227,0.96))] shadow-md">
      {needsInteractiveMap ? (
        <div
          ref={containerRef}
          className={`voy-route-map-canvas h-[320px] w-full sm:h-[360px] lg:h-[420px] xl:h-[460px] 2xl:h-[500px] ${
            showStaticUnavailableState ? "voy-route-map-canvas-hidden" : ""
          }`}
        />
      ) : null}

      {mapState.isLoading ? (
        <MapOverlayMessage
          title="Loading localized city map"
          body="Preparing the active day’s pins, city viewport, and route overlay."
        />
      ) : null}

      {showStaticUnavailableState ? (
        <StaticMapFallback
          dayRoute={dayRoute}
          destination={destination}
          title="Interactive map unavailable"
          body={mapState.errorMessage}
        />
      ) : null}

      {showNoPinsNotice ? (
        <MapOverlayMessage
          title="Map ready, waiting for pinned stops"
          body="The map is centered on this day’s local area, but no itinerary places have been geocoded yet. As soon as recognizable stops resolve, pins will appear here."
        />
      ) : null}

      {showStaticEmptyState ? (
        <StaticMapFallback
          dayRoute={dayRoute}
          destination={destination}
          title="Localized map pending"
          body="This day does not have enough mapped places yet to render pins and a route on the city map."
        />
      ) : null}
    </div>
  );
}

export default TripDayMap;
