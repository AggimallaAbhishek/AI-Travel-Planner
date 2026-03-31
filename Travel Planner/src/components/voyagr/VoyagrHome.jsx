import React, { Suspense, lazy, useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { buildCreateTripQuery } from "@/lib/tripPrefill";
import HeroSection from "./HeroSection";
import DestinationsSection from "./DestinationsSection";
import RecommendationsSection from "./RecommendationsSection";

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
