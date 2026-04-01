import React, { useEffect, useMemo, useRef, useState } from "react";
import { loadGoogleMapsApi } from "@/lib/googleMaps";
import { decodeGooglePolyline } from "@/lib/maps";

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

function buildMapRestriction(cityBounds = null) {
  if (
    !cityBounds ||
    !Number.isFinite(cityBounds.north) ||
    !Number.isFinite(cityBounds.south) ||
    !Number.isFinite(cityBounds.east) ||
    !Number.isFinite(cityBounds.west)
  ) {
    return null;
  }

  return {
    north: cityBounds.north,
    south: cityBounds.south,
    east: cityBounds.east,
    west: cityBounds.west,
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
  const safeName = String(marker.name ?? "Stop");
  const safeDestination = String(destination ?? "");

  return `
    <div style="min-width: 180px; font-family: ui-sans-serif, system-ui, sans-serif;">
      <div style="font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.08em;">
        Stop ${marker.visitOrder ?? ""}
      </div>
      <div style="margin-top: 4px; font-size: 16px; font-weight: 600; color: #111827;">
        ${safeName}
      </div>
      ${
        safeDestination
          ? `<div style="margin-top: 6px; font-size: 13px; color: #6b7280;">${safeDestination}</div>`
          : ""
      }
    </div>
  `;
}

function MapOverlayMessage({ title, body }) {
  return (
    <div className="absolute inset-4 z-10 flex items-center justify-center rounded-[1.75rem] border border-[var(--voy-border)] bg-[rgba(252,250,245,0.94)] px-6 py-8 text-center shadow-sm backdrop-blur-sm">
      <div>
        <p className="text-lg font-semibold text-[var(--voy-text)]">{title}</p>
        <p className="mt-2 max-w-sm text-sm text-[var(--voy-text-muted)]">{body}</p>
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
    isLoading: true,
    errorMessage: "",
  });

  const mapMarkers = useMemo(
    () => (Array.isArray(dayRoute?.markers) ? dayRoute.markers : []),
    [dayRoute?.markers]
  );
  const routePath = useMemo(() => buildRoutePath(dayRoute), [dayRoute]);
  const restriction = useMemo(
    () => buildMapRestriction(dayRoute?.cityBounds),
    [dayRoute?.cityBounds]
  );

  useEffect(() => {
    let isCancelled = false;

    async function ensureMapReady() {
      setMapState((current) => ({
        ...current,
        isLoading: true,
        errorMessage: "",
      }));

      try {
        const googleMaps = await loadGoogleMapsApi();

        if (isCancelled) {
          return;
        }

        if (!googleMaps) {
          setMapState({
            isLoading: false,
            errorMessage:
              "Set VITE_GOOGLE_MAPS_BROWSER_KEY to render the interactive map.",
          });
          return;
        }

        if (!containerRef.current) {
          setMapState({
            isLoading: false,
            errorMessage: "The route map container is unavailable.",
          });
          return;
        }

        if (!mapRef.current) {
          mapRef.current = new googleMaps.Map(containerRef.current, {
            center: { lat: 35.6762, lng: 139.6503 },
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
  }, []);

  useEffect(() => {
    const googleMaps = globalThis?.google?.maps;
    const map = mapRef.current;

    if (!googleMaps || !map) {
      return undefined;
    }

    console.info("[route-map] Syncing day route map", {
      dayNumber: dayRoute?.dayNumber ?? null,
      markerCount: mapMarkers.length,
      hasPolyline: routePath.length >= 2,
    });

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
        strictBounds: false,
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
      map.fitBounds(bounds, 56);
      fitListenerRef.current = googleMaps.event.addListenerOnce(map, "idle", () => {
        const currentZoom = map.getZoom();
        if (currentZoom && currentZoom > 15) {
          map.setZoom(15);
        }
      });
    }

    return () => {
      if (fitListenerRef.current) {
        googleMaps.event.removeListener(fitListenerRef.current);
        fitListenerRef.current = null;
      }
    };
  }, [
    dayRoute?.dayNumber,
    destination,
    mapMarkers,
    onHighlightStop,
    restriction,
    routePath,
  ]);

  useEffect(() => {
    const googleMaps = globalThis?.google?.maps;
    const map = mapRef.current;

    if (!googleMaps || !map) {
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
  }, [highlightedStopId, mapMarkers]);

  return (
    <div className="relative overflow-hidden rounded-[2rem] border border-[var(--voy-border)] bg-[linear-gradient(180deg,rgba(253,250,244,0.9),rgba(246,239,227,0.96))] shadow-md">
      <div ref={containerRef} className="h-[420px] w-full lg:h-[620px]" />

      {mapState.isLoading ? (
        <MapOverlayMessage
          title="Loading city map"
          body="Fetching the Google Maps canvas for the selected itinerary day."
        />
      ) : null}

      {!mapState.isLoading && mapState.errorMessage ? (
        <MapOverlayMessage
          title="Interactive map unavailable"
          body={mapState.errorMessage}
        />
      ) : null}

      {!mapState.isLoading &&
      !mapState.errorMessage &&
      mapMarkers.length === 0 &&
      routePath.length < 2 ? (
        <MapOverlayMessage
          title="No plotted stops yet"
          body="This day does not have enough geocoded places to display markers and a route on the city map."
        />
      ) : null}
    </div>
  );
}

export default TripDayMap;
