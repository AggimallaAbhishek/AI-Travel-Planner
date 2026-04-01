import React from "react";
import UnifiedTripRouteMapSection from "@/view-trip/components/UnifiedTripRouteMapSection.jsx";
import {
  UNIFIED_TRIP_MAP_PREVIEW_PAYLOAD,
  UNIFIED_TRIP_MAP_PREVIEW_TRIP,
} from "@/dev/unifiedTripMapPreviewData.js";

export default function UnifiedTripMapPreview() {
  return (
    <section className="voy-static-page">
      <div className="voy-page-shell" style={{ paddingTop: "2rem", paddingBottom: "3rem" }}>
        <div className="voy-static-copy" style={{ maxWidth: "920px", marginBottom: "1.5rem" }}>
          <span className="voy-static-eyebrow">Developer Preview</span>
          <h1 className="voy-page-title">
            Unified <em>Trip Route Map</em>
          </h1>
          <p className="voy-page-subtitle mt-3">
            This preview uses the same reusable Leaflet route component and payload shape as the
            authenticated trip page, but with a local fixture so the algorithmic map UI can be
            reviewed without Firebase sign-in.
          </p>
        </div>

        <UnifiedTripRouteMapSection
          trip={UNIFIED_TRIP_MAP_PREVIEW_TRIP}
          tripMapOverride={UNIFIED_TRIP_MAP_PREVIEW_PAYLOAD}
        />
      </div>
    </section>
  );
}
