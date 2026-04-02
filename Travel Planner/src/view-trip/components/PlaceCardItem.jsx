import React from "react";
import {
  FaMapMarkerAlt,
  FaClock,
  FaExternalLinkAlt,
  FaRoute,
} from "react-icons/fa";
import { resolveGoogleMapsUrl } from "../../../shared/maps.js";

function formatTransportMode(mode = "") {
  const normalized = String(mode ?? "").trim().toLowerCase();
  if (!normalized) {
    return "Drive";
  }

  if (normalized === "transit") {
    return "Transit";
  }

  if (normalized === "walk" || normalized === "walking") {
    return "Walk";
  }

  if (normalized === "flight") {
    return "Flight";
  }

  if (normalized === "train") {
    return "Train";
  }

  if (normalized === "road" || normalized === "bus") {
    return "Road";
  }

  if (normalized === "start") {
    return "Start";
  }

  return "Drive";
}

function PlaceCardItem({ place }) {
  const placeSummary = place.placeSummary || place.placeDetails;
  const travelDistance = place.travelDistance || "Distance not available";
  const transportMode = formatTransportMode(place.transportMode);
  const mapsUrl = resolveGoogleMapsUrl({
    mapsUrl: place?.mapsUrl,
    externalPlaceId: place?.externalPlaceId,
    coordinates: place?.geoCoordinates,
    name: place?.placeName,
    address: place?.placeDetails ?? place?.placeSummary,
  });

  return (
    <div className="group cursor-pointer transform transition-all duration-300 hover:-translate-y-1">
      <a
        href={mapsUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="no-underline text-inherit"
      >
        <div className="bg-[var(--voy-surface)] rounded-2xl overflow-hidden shadow-md hover:shadow-xl transition-all duration-300 border border-[var(--voy-border)] group-hover:border-[var(--voy-gold)]">
          <div className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <h2 className="font-bold text-lg text-[var(--voy-text)] mb-1">
                  {place.placeName}
                </h2>

                {placeSummary ? (
                  <p className="text-sm text-[var(--voy-text-muted)] mb-3">
                    {placeSummary}
                  </p>
                ) : null}
              </div>
              <div className="hidden sm:inline-flex items-center gap-1 rounded-full bg-[var(--voy-gold-dim)] px-2 py-1 text-[10px] font-medium text-[var(--voy-gold)]">
                <FaExternalLinkAlt size={10} />
                <span>Maps</span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-2">
              <div className="flex items-center gap-2 text-sm text-[var(--voy-text-muted)]">
                <FaRoute className="text-[var(--voy-gold)]" />
                <span>{transportMode}</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-[var(--voy-text-muted)]">
                <FaClock className="text-[var(--voy-gold)]" />
                <span>{place.travelTime || "Not specified"}</span>
              </div>
              <div className="flex items-center gap-1 text-xs text-[var(--voy-text-faint)]">
                <FaMapMarkerAlt className="text-[var(--voy-gold)]" />
                <span>{travelDistance}</span>
              </div>
            </div>

            {place.category ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {place.category.split(",").map((cat, index) => (
                  <span
                    key={index}
                    className="px-2 py-1 bg-[var(--voy-gold-dim)] text-[var(--voy-gold)] text-xs rounded-full font-medium"
                  >
                    {cat.trim()}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </a>
    </div>
  );
}

export default PlaceCardItem;
