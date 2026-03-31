import React, { useMemo, useState } from "react";
import { MAP_DESTINATIONS } from "./data";
import SectionHeader from "./SectionHeader";
import WorldMap from "./map/WorldMap";
import AppImage from "@/components/ui/AppImage";
import { IMAGE_FALLBACKS } from "@/lib/imageManifest";

export default function MapSection({ onUseDestination }) {
  const [activeDestinationName, setActiveDestinationName] = useState(null);
  const featuredSpots = useMemo(() => {
    const indiaSpots = MAP_DESTINATIONS.filter(
      (destination) => destination.country === "India"
    ).slice(0, 3);
    const baseSpots = MAP_DESTINATIONS.filter(
      (destination) => destination.country !== "India"
    ).slice(0, Math.max(0, 10 - indiaSpots.length));

    return [...baseSpots, ...indiaSpots];
  }, []);
  const regionCount = useMemo(
    () => new Set(MAP_DESTINATIONS.map((destination) => destination.region)).size,
    []
  );
  const regionBreakdown = useMemo(() => {
    const counts = MAP_DESTINATIONS.reduce((accumulator, destination) => {
      accumulator[destination.region] = (accumulator[destination.region] || 0) + 1;
      return accumulator;
    }, {});

    return Object.entries(counts)
      .sort((left, right) => right[1] - left[1])
      .slice(0, 6);
  }, []);

  const handlePlanFromMap = (destinationName) => {
    setActiveDestinationName(destinationName);
    console.info("[voyagr-map] Destination selected from map", {
      destination: destinationName,
    });
    onUseDestination(destinationName);
  };

  const handleMapFocus = (destinationName) => {
    setActiveDestinationName(destinationName);
  };

  const handleMapBlur = () => {
    setActiveDestinationName(null);
  };

  return (
    <section id="map-section" className="voy-map-page">
      <div className="voy-map-stage voy-reveal">
        <SectionHeader
          eyebrow="Atlas"
          title="Explore The"
          highlight="World Map"
          subtitle="A full-width global view with cleaner geography, clearer continents, and direct trip handoff from every destination marker."
        />

        <div className="voy-map-shell">
          <div className="voy-map-hero-panel">
            <span className="voy-map-kicker">Global Explorer</span>
            <h2>See the world clearly before you plan it.</h2>
            <p>
              Browse the map without cards covering the geography, inspect tourist
              hotspots in context, and jump into a trip flow once a destination feels
              right.
            </p>
            <div className="voy-map-status" role="status" aria-live="polite">
              {activeDestinationName ? (
                <span>
                  Focused on <strong>{activeDestinationName}</strong>. Open the marker
                  or use the cards below to continue planning.
                </span>
              ) : (
                <span>
                  Hover or tap any marker to preview a destination. The world map stays
                  fully visible while you explore.
                </span>
              )}
            </div>

            <div className="voy-map-region-strip" aria-label="Map coverage by region">
              {regionBreakdown.map(([region, count]) => (
                <span key={region} className="voy-map-region-pill">
                  {region} · {count}
                </span>
              ))}
            </div>
          </div>

          <div className="voy-map-metrics">
            <article className="voy-map-metric">
              <strong>{MAP_DESTINATIONS.length}</strong>
              <span>Tourist hotspots</span>
            </article>
            <article className="voy-map-metric">
              <strong>{regionCount}</strong>
              <span>Regions covered</span>
            </article>
            <article className="voy-map-metric">
              <strong>Live</strong>
              <span>Preview interactions</span>
            </article>
          </div>
        </div>

        <WorldMap
          destinations={MAP_DESTINATIONS}
          onPlanTrip={handlePlanFromMap}
          onDestinationFocus={handleMapFocus}
          onDestinationBlur={handleMapBlur}
        />

        <div className="voy-map-spot-strip" aria-label="Featured map destinations">
          {featuredSpots.map((destination) => (
            <button
              key={destination.id}
              type="button"
              className={`voy-map-spot-card ${
                activeDestinationName === destination.name ? "active" : ""
              }`}
              onMouseEnter={() => handleMapFocus(destination.name)}
              onFocus={() => handleMapFocus(destination.name)}
              onMouseLeave={handleMapBlur}
              onBlur={handleMapBlur}
              onClick={() => handlePlanFromMap(destination.name)}
              aria-pressed={activeDestinationName === destination.name}
            >
              <AppImage
                src={destination.image}
                fallbackSrc={IMAGE_FALLBACKS.destination}
                alt={destination.name}
                sizes="(max-width: 760px) 82vw, 280px"
                className="h-full w-full"
                imgClassName="h-full w-full object-cover"
              />
              <div className="voy-map-spot-copy">
                <p>{destination.region}</p>
                <h3>{destination.name}</h3>
                <span>{destination.tagline}</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
