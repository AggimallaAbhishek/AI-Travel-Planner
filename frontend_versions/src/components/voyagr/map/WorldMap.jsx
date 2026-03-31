import React, { useEffect, useMemo, useRef, useState } from "react";
import { geoGraticule10, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import worldAtlas from "world-atlas/countries-110m.json";
import {
  createDestinationMarkerLayout,
  createWorldMapProjection,
  normalizeMapDestinations,
  WORLD_MAP_CANVAS,
} from "@/lib/worldMap";
import DestinationMarker from "./DestinationMarker";
import DestinationHoverCard from "./DestinationHoverCard";
import DestinationModal from "./DestinationModal";

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export default function WorldMap({
  destinations,
  onPlanTrip,
  onDestinationFocus,
  onDestinationBlur,
}) {
  const containerRef = useRef(null);
  const hoverLeaveTimeoutRef = useRef(null);
  const [activeDestination, setActiveDestination] = useState(null);
  const [selectedDestination, setSelectedDestination] = useState(null);
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const [supportsHover, setSupportsHover] = useState(true);
  const projection = useMemo(() => createWorldMapProjection(), []);
  const pathGenerator = useMemo(() => geoPath(projection), [projection]);

  const normalizedDestinations = useMemo(
    () => {
      const mappedDestinations = normalizeMapDestinations(destinations, projection);
      const markerLayout = createDestinationMarkerLayout(mappedDestinations, {
        padding: 12,
        minDistance: 18,
        step: 7,
        maxRings: 2,
      });
      const shiftedCount = markerLayout.filter((destination) => destination.isShifted).length;

      console.debug("[voyagr-map] Marker layout generated", {
        totalMarkers: markerLayout.length,
        shiftedMarkers: shiftedCount,
      });

      return markerLayout;
    },
    [destinations, projection]
  );
  const worldGeographies = useMemo(() => {
    const countries = feature(worldAtlas, worldAtlas.objects.countries);
    return countries.features;
  }, []);

  const clearHoverLeaveTimeout = () => {
    if (!hoverLeaveTimeoutRef.current) {
      return;
    }

    window.clearTimeout(hoverLeaveTimeoutRef.current);
    hoverLeaveTimeoutRef.current = null;
  };

  useEffect(
    () => () => {
      if (hoverLeaveTimeoutRef.current) {
        window.clearTimeout(hoverLeaveTimeoutRef.current);
        hoverLeaveTimeoutRef.current = null;
      }
    },
    []
  );
  const spherePath = useMemo(() => pathGenerator({ type: "Sphere" }), [pathGenerator]);
  const graticulePath = useMemo(() => pathGenerator(geoGraticule10()), [pathGenerator]);

  const hoverCardPosition = useMemo(() => {
    if (!containerRef.current) {
      return pointer;
    }

    const rect = containerRef.current.getBoundingClientRect();
    const cardWidth = Math.min(280, rect.width - 32);
    const cardHeight = 210;
    const minBottomEdge = cardHeight + 16;
    const maxBottomEdge = Math.max(minBottomEdge, rect.height - 16);

    return {
      x: clamp(pointer.x + 18, 16, Math.max(16, rect.width - cardWidth - 16)),
      y: clamp(pointer.y - 12, minBottomEdge, maxBottomEdge),
    };
  }, [pointer]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      setSupportsHover(true);
      return undefined;
    }

    const mediaQuery = window.matchMedia("(hover: hover) and (pointer: fine)");
    setSupportsHover(mediaQuery.matches);

    const onChange = (event) => {
      setSupportsHover(event.matches);
      console.info("[voyagr-map] Pointer mode changed", {
        supportsHover: event.matches,
      });
    };

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", onChange);
      return () => mediaQuery.removeEventListener("change", onChange);
    }

    mediaQuery.addListener(onChange);
    return () => mediaQuery.removeListener(onChange);
  }, []);

  const getRelativePointer = (event) => {
    if (!containerRef.current) {
      return { x: 0, y: 0 };
    }

    const rect = containerRef.current.getBoundingClientRect();
    const hasClientPoint =
      typeof event.clientX === "number" && typeof event.clientY === "number";

    if (hasClientPoint) {
      return {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
    }

    if (event.currentTarget?.getBoundingClientRect) {
      const targetRect = event.currentTarget.getBoundingClientRect();

      return {
        x: targetRect.left - rect.left + targetRect.width / 2,
        y: targetRect.top - rect.top + targetRect.height / 2,
      };
    }

    return {
      x: rect.width / 2,
      y: rect.height / 2,
    };
  };

  const handleHoverStart = (destination, event) => {
    if (!supportsHover) {
      return;
    }

    clearHoverLeaveTimeout();
    const nextPointer = getRelativePointer(event);
    setPointer(nextPointer);
    setActiveDestination(destination);
    onDestinationFocus?.(destination.name);

    console.debug("[voyagr-map] Destination hover started", {
      destination: destination.name,
    });
  };

  const handleHoverMove = (event) => {
    if (!supportsHover || !activeDestination) {
      return;
    }

    clearHoverLeaveTimeout();
    setPointer(getRelativePointer(event));
  };

  const handleHoverEnd = () => {
    if (!supportsHover) {
      return;
    }

    clearHoverLeaveTimeout();
    hoverLeaveTimeoutRef.current = window.setTimeout(() => {
      setActiveDestination(null);
      onDestinationBlur?.();
      hoverLeaveTimeoutRef.current = null;
    }, 70);
  };

  const handleMarkerClick = (destination) => {
    clearHoverLeaveTimeout();

    if (!supportsHover) {
      setActiveDestination((currentDestination) => {
        const isAlreadyActive = currentDestination?.id === destination.id;

        if (isAlreadyActive) {
          onDestinationBlur?.();
          console.info("[voyagr-map] Mobile destination preview dismissed", {
            destination: destination.name,
          });
          return null;
        }

        onDestinationFocus?.(destination.name);
        console.info("[voyagr-map] Mobile destination preview opened", {
          destination: destination.name,
        });
        return destination;
      });
      return;
    }

    setActiveDestination(null);
    setSelectedDestination(destination);
    onDestinationFocus?.(destination.name);
    console.info("[voyagr-map] Destination modal opened", {
      destination: destination.name,
    });
  };

  const handleViewDetails = (destination) => {
    clearHoverLeaveTimeout();
    setActiveDestination(null);
    setSelectedDestination(destination);
    onDestinationFocus?.(destination.name);
    console.info("[voyagr-map] Destination details opened", {
      destination: destination.name,
    });
  };

  const handlePlanTrip = (destination) => {
    clearHoverLeaveTimeout();
    console.info("[voyagr-map] Plan trip triggered from map", {
      destination: destination.name,
    });
    setActiveDestination(null);
    setSelectedDestination(null);
    onDestinationBlur?.();
    onPlanTrip(destination.name);
  };

  return (
    <>
      <div className="voy-map-experience" ref={containerRef}>
        <svg
          className="voy-map-world-svg"
          viewBox={`0 0 ${WORLD_MAP_CANVAS.width} ${WORLD_MAP_CANVAS.height}`}
          preserveAspectRatio="xMidYMid meet"
          aria-label="Interactive world map"
        >
          <path className="voy-map-sphere" d={spherePath} />
          <path className="voy-map-graticule" d={graticulePath} />
          <g className="voy-map-countries" aria-hidden="true">
            {worldGeographies.map((geography) => (
              <path
                key={geography.id ?? geography.properties?.name}
                className="voy-map-country"
                d={pathGenerator(geography)}
              />
            ))}
          </g>
          {normalizedDestinations.map((destination) => (
            <DestinationMarker
              key={destination.id}
              destination={destination}
              isActive={activeDestination?.id === destination.id}
              onHover={handleHoverStart}
              onMove={handleHoverMove}
              onLeave={handleHoverEnd}
              onClick={handleMarkerClick}
            />
          ))}
        </svg>

        {activeDestination ? (
          <DestinationHoverCard
            destination={activeDestination}
            position={hoverCardPosition}
            anchored={!supportsHover}
            onViewDetails={handleViewDetails}
          />
        ) : null}
      </div>

      <DestinationModal
        destination={selectedDestination}
        onOpenChange={(open) => {
          if (!open) {
            clearHoverLeaveTimeout();
            setSelectedDestination(null);
            setActiveDestination(null);
            onDestinationBlur?.();
          }
        }}
        onPlanTrip={handlePlanTrip}
      />
    </>
  );
}
