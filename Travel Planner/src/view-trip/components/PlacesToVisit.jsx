import React from "react";
import PlaceCardItem from "../components/PlaceCardItem";
import {
  FaMapMarkerAlt,
  FaClock,
  FaUmbrellaBeach,
  FaCar,
  FaTrain,
  FaPlane,
  FaBus,
  FaWalking,
  FaRoute,
} from "react-icons/fa";
import { GiStoneBridge } from "react-icons/gi";
import { getDayPlaceCountMeta } from "../transportViewModel";

function PlacesToVisit({ trip }) {
  const structuredPlanDays = Array.isArray(trip?.aiPlan?.days) ? trip.aiPlan.days : [];
  const travelTips = Array.isArray(trip?.aiPlan?.travelTips) ? trip.aiPlan.travelTips : [];
  const safeItinerary = trip?.itinerary?.days ?? [];

  const totalPlaces = safeItinerary.reduce((total, day) => {
    return total + (Array.isArray(day.places) ? day.places.length : 0);
  }, 0);

  const getPlaceIcon = (placeName) => {
    if (placeName?.toLowerCase().includes("beach"))
      return <FaUmbrellaBeach className="text-amber-500" />;
    if (placeName?.toLowerCase().includes("stone"))
      return <GiStoneBridge className="text-[var(--voy-text-muted)]" />;
    return <FaMapMarkerAlt className="text-[var(--voy-gold)]" />;
  };

  const resolveTransportLabel = (mode = "") => {
    const normalized = String(mode ?? "").trim().toLowerCase();
    if (normalized === "flight") return "Flight";
    if (normalized === "train") return "Train";
    if (normalized === "transit") return "Transit";
    if (normalized === "road" || normalized === "bus") return "Road";
    if (normalized === "walk" || normalized === "walking") return "Walk";
    if (normalized === "start") return "Start";
    return "Drive";
  };

  const renderTransportIcon = (mode = "") => {
    const normalized = String(mode ?? "").trim().toLowerCase();
    if (normalized === "flight") return <FaPlane className="text-[var(--voy-gold)]" />;
    if (normalized === "train") return <FaTrain className="text-[var(--voy-gold)]" />;
    if (normalized === "road" || normalized === "bus") return <FaBus className="text-[var(--voy-gold)]" />;
    if (normalized === "walk" || normalized === "walking") return <FaWalking className="text-[var(--voy-gold)]" />;
    return <FaCar className="text-[var(--voy-gold)]" />;
  };

  const formatDistanceLabel = (place = {}) => {
    if (Number.isFinite(place?.travelDistanceFromPreviousKm)) {
      return `${place.travelDistanceFromPreviousKm} km`;
    }
    if (typeof place?.travelDistance === "string" && place.travelDistance.trim()) {
      return place.travelDistance.trim();
    }
    return "Distance not available";
  };

  const resolvePlaceSummary = (place = {}) => {
    const summary =
      place.placeSummary ||
      place.placeDetails ||
      "Curated stop for this day, selected by the route planner.";
    return summary.length > 140 ? `${summary.slice(0, 139).trim()}…` : summary;
  };

  return (
    <section className="w-full px-0 md:px-2 py-10">
      <div className="max-w-5xl mx-auto">
        {/* Section Header */}
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-semibold text-[var(--voy-text)] mb-3">
            Your Journey Itinerary
          </h2>
          <p className="text-md text-[var(--voy-text-muted)] max-w-2xl mx-auto">
            Discover the amazing places you'll visit on your {Math.max(safeItinerary.length, structuredPlanDays.length)}-day adventure
          </p>

          <div className="flex flex-wrap justify-center gap-4 mt-6">
            <div className="bg-[var(--voy-surface2)] border border-[var(--voy-border)] rounded-full px-4 py-2 flex items-center">
              <FaMapMarkerAlt className="text-[var(--voy-gold)] mr-2" />
              <div className="text-[var(--voy-text)] font-medium">
                {totalPlaces} Places
              </div>
            </div>
            <div className="bg-[var(--voy-surface2)] border border-[var(--voy-border)] rounded-full px-4 py-2 flex items-center">
              <FaClock className="text-[var(--voy-gold)] mr-2" />
              <div className="text-[var(--voy-text)] font-medium">
                {Math.max(safeItinerary.length, structuredPlanDays.length)} Days
              </div>
            </div>
            {trip?.aiPlan?.totalEstimatedCost ? (
              <div className="bg-[var(--voy-surface2)] border border-[var(--voy-border)] rounded-full px-4 py-2 flex items-center">
                <div className="text-[var(--voy-text)] font-medium">
                  {trip.aiPlan.totalEstimatedCost}
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {/* Itinerary List */}
        {safeItinerary.length > 0 ? (
          <div className="space-y-8">
            {safeItinerary.map((item, index) => {
              const dayPlaces = Array.isArray(item.places) ? item.places : [];
              const placeCountMeta = getDayPlaceCountMeta(item);
              const narrativeForDay = structuredPlanDays.find(
                (d) => Number(d.day) === Number(item.dayNumber || index + 1)
              );

              return (
                <div key={index} className="bg-[var(--voy-surface)] rounded-2xl shadow border border-[var(--voy-border)] overflow-hidden">
                  <div className="p-6 border-b border-[var(--voy-border)] flex flex-wrap gap-4 justify-between items-start">
                    <div>
                      <h3 className="text-xl font-semibold text-[var(--voy-text)] mb-1">
                        Day {item.dayNumber || index + 1}{narrativeForDay?.title ? ` - ${narrativeForDay.title}` : ""}
                      </h3>
                      {narrativeForDay?.summary ? (
                        <p className="text-[var(--voy-text-muted)] text-sm mt-1 max-w-3xl">
                          {narrativeForDay.summary}
                        </p>
                      ) : null}
                    </div>

                    <div className="flex flex-col items-end gap-2 text-sm text-[var(--voy-text-muted)]">
                      <span className="px-3 py-1 bg-[var(--voy-surface2)] rounded-full border border-[var(--voy-border)] whitespace-nowrap">
                        {placeCountMeta.placeCount}{" "}
                        {placeCountMeta.placeCount === 1 ? "place" : "places"}
                      </span>
                      <span
                        className={`px-3 py-1 rounded-full whitespace-nowrap font-medium ${
                          placeCountMeta.placeCountTargetMet
                            ? "bg-[var(--voy-gold-dim)] text-[var(--voy-gold)]"
                            : "bg-[var(--voy-surface2)] border border-[var(--voy-border)]"
                        }`}
                      >
                        {placeCountMeta.placeCountTargetMet
                          ? "3-4 target met"
                          : "target: 3-4/day"}
                      </span>
                      {narrativeForDay?.estimatedCost ? (
                        <span className="px-3 py-1 rounded-full bg-[var(--voy-gold-dim)] text-[var(--voy-gold)] whitespace-nowrap font-medium">
                          {narrativeForDay.estimatedCost}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="p-6">
                    {dayPlaces.length > 0 ? (
                      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(300px,1fr)]">
                        <div className="space-y-6">
                          {dayPlaces.map((place, placeIndex) => (
                            <div key={placeIndex} className="bg-[var(--voy-surface2)] rounded-xl p-5 shadow border border-[var(--voy-border)] flex items-start">
                              <div className="w-10 h-10 min-w-10 min-h-10 rounded-full bg-[var(--voy-bg2)] flex items-center justify-center mr-3 mt-1">
                                {getPlaceIcon(place.placeName)}
                              </div>
                              <div className="flex-1 w-full">
                                <PlaceCardItem place={place} />
                              </div>
                            </div>
                          ))}
                        </div>

                        <aside className="h-fit rounded-xl border border-[var(--voy-border)] bg-[var(--voy-surface2)] p-5">
                          <div className="flex items-center gap-2 text-[var(--voy-text)] font-semibold">
                            <FaRoute className="text-[var(--voy-gold)]" />
                            <span>Transport & Day Brief</span>
                          </div>

                          <p className="mt-3 text-sm text-[var(--voy-text-muted)] leading-relaxed">
                            {narrativeForDay?.summary ||
                              `A practical route across ${dayPlaces.length} stops with optimized transfer order for this day.`}
                          </p>

                          <div className="mt-4 space-y-3">
                            {dayPlaces.map((place, placeIndex) => (
                              <article
                                key={`summary-${placeIndex}`}
                                className="rounded-lg border border-[var(--voy-border)] bg-[var(--voy-surface)] p-3"
                              >
                                <h4 className="text-sm font-semibold text-[var(--voy-text)]">
                                  {place.placeName}
                                </h4>
                                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                                  <span className="inline-flex items-center gap-1 rounded-full bg-[var(--voy-bg2)] px-2 py-1 text-[var(--voy-text-muted)]">
                                    {renderTransportIcon(place.transportMode)}
                                    {resolveTransportLabel(place.transportMode)}
                                  </span>
                                  <span className="inline-flex items-center gap-1 rounded-full bg-[var(--voy-bg2)] px-2 py-1 text-[var(--voy-text-muted)]">
                                    <FaClock className="text-[var(--voy-gold)]" />
                                    {place.travelTime || "Not specified"}
                                  </span>
                                  <span className="inline-flex items-center gap-1 rounded-full bg-[var(--voy-bg2)] px-2 py-1 text-[var(--voy-text-muted)]">
                                    <FaMapMarkerAlt className="text-[var(--voy-gold)]" />
                                    {formatDistanceLabel(place)}
                                  </span>
                                </div>
                                <p className="mt-2 text-xs text-[var(--voy-text-muted)] leading-relaxed">
                                  {resolvePlaceSummary(place)}
                                </p>
                              </article>
                            ))}
                          </div>
                        </aside>
                      </div>
                    ) : (
                      <div className="text-center py-12 bg-[var(--voy-surface2)] rounded-xl border border-[var(--voy-border)]">
                        <p className="text-[var(--voy-text-faint)] italic">
                          No places planned for this day yet.
                        </p>
                      </div>
                    )}
                    
                    {narrativeForDay?.tips ? (
                      <div className="mt-6 pt-4 border-t border-[var(--voy-border)]">
                        <p className="text-sm text-[var(--voy-text-muted)]">
                          <span className="font-medium text-[var(--voy-text)]">💡 Tip for the day:</span> {narrativeForDay.tips}
                        </p>
                      </div>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-20 bg-[var(--voy-surface)] rounded-2xl shadow border border-[var(--voy-border)]">
            <h3 className="text-2xl font-semibold text-[var(--voy-text)] mb-4">
              Your itinerary is being prepared
            </h3>
            <p className="text-[var(--voy-text-muted)] max-w-2xl mx-auto">
              Our AI travel experts are crafting the perfect journey for you.
              Check back soon to discover amazing places you'll visit!
            </p>
          </div>
        )}

        {/* Global Travel Tips */}
        {travelTips.length > 0 ? (
          <div className="mt-12 rounded-2xl border border-[var(--voy-border)] bg-[var(--voy-surface)] p-6">
            <h3 className="text-xl font-semibold text-[var(--voy-text)] mb-4">Essential Travel Tips</h3>
            <ul className="grid gap-3 lg:grid-cols-2">
              {travelTips.map((tip, index) => (
                <li
                  key={`tip-${index}`}
                  className="rounded-xl bg-[var(--voy-surface2)] border border-[var(--voy-border)] px-5 py-4 text-sm text-[var(--voy-text-muted)] leading-relaxed"
                >
                  {tip}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}

export default PlacesToVisit;
