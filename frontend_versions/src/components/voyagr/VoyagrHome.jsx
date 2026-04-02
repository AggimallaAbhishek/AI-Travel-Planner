import React, { Suspense, lazy, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { buildCreateTripQuery } from "@/lib/tripPrefill";
import HeroSection from "./HeroSection";
import DestinationsSection from "./DestinationsSection";
import RecommendationsSection from "./RecommendationsSection";
import { resolveGoogleMapsUrl } from "../../../shared/maps.js";

const MapSection = lazy(() => import("./MapSection"));

function jumpToHash(hash) {
  if (!hash) {
    return;
  }

  const element = document.querySelector(hash);
  if (element) {
    element.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

export default function VoyagrHome() {
  const navigate = useNavigate();
  const location = useLocation();
  const [activeFilter, setActiveFilter] = useState("all");

  useEffect(() => {
    if (!location.hash) {
      return;
    }

    window.setTimeout(() => jumpToHash(location.hash), 0);
  }, [location.hash]);

  const openTripCreator = (prefillInput = {}) => {
    const query = buildCreateTripQuery(prefillInput);
    const targetPath = query ? `/create-trip?${query}` : "/create-trip";
    console.info("[voyagr-home] navigating to trip creator", { targetPath, prefillInput });
    navigate(targetPath);
  };

  const openDestinationInGoogleMaps = (destination = "") => {
    const destinationLabel =
      typeof destination === "string"
        ? String(destination ?? "").trim()
        : [destination?.name, destination?.state ?? destination?.country]
            .filter(Boolean)
            .join(", ");
    if (!destinationLabel) {
      return;
    }

    const coordinates = {
      latitude: destination?.latitude,
      longitude: destination?.longitude,
    };
    const mapsUrl = resolveGoogleMapsUrl({
      coordinates,
      name: destination?.name ?? destinationLabel,
      address: [destination?.state, destination?.country].filter(Boolean).join(", "),
      destination: destinationLabel,
    });
    console.info("[voyagr-home] opening destination in google maps", {
      destination: destinationLabel,
      mapsUrl,
    });

    const popupWindow = window.open(mapsUrl, "_blank", "noopener,noreferrer");
    if (!popupWindow) {
      window.location.assign(mapsUrl);
    }
  };

  const applyHeroFilter = (filterId) => {
    setActiveFilter(filterId);
    jumpToHash("#destinations");
  };

  return (
    <div className="voyagr-page">
      <HeroSection
        activeFilter={activeFilter}
        onFilterSelect={applyHeroFilter}
        onStartPlanning={openTripCreator}
      />

      <DestinationsSection
        activeFilter={activeFilter}
        onFilterChange={setActiveFilter}
        onExploreDestination={openDestinationInGoogleMaps}
      />

      <Suspense
        fallback={
          <section id="map-section" className="voy-section voy-map">
            <div className="voy-map-wrap voy-reveal">
              <p className="text-center text-sm text-[var(--voy-text-muted)]">
                Loading world map experience...
              </p>
            </div>
          </section>
        }
      >
        <MapSection
          onUseDestination={(destination) => openTripCreator({ destination, days: 5 })}
        />
      </Suspense>

      <RecommendationsSection
        onPlanFromRecommendation={(destinationLabel) =>
          openTripCreator({ destination: destinationLabel, days: 4 })
        }
      />
    </div>
  );
}
