import React from "react";
import PlaceCardItem from "../components/PlaceCardItem";
import { FaMapMarkerAlt, FaClock, FaUmbrellaBeach } from "react-icons/fa";
import { GiStoneBridge } from "react-icons/gi";

function PlacesToVisit({ trip }) {
  const structuredPlanDays = Array.isArray(trip?.aiPlan?.days) ? trip.aiPlan.days : [];
  const travelTips = Array.isArray(trip?.aiPlan?.travelTips) ? trip.aiPlan.travelTips : [];
  const hasStructuredPlan = structuredPlanDays.length > 0;
  const safeItinerary = trip?.itinerary?.days ?? [];

  const totalPlaces = safeItinerary.reduce((total, day) => {
    return total + (Array.isArray(day.places) ? day.places.length : 0);
  }, 0);
  const totalActivities = structuredPlanDays.reduce((total, day) => {
    return total + (Array.isArray(day.activities) ? day.activities.length : 0);
  }, 0);

  const getPlaceIcon = (placeName) => {
    if (placeName?.toLowerCase().includes("beach"))
      return <FaUmbrellaBeach className="text-amber-500" />;
    if (placeName?.toLowerCase().includes("stone"))
      return <GiStoneBridge className="text-[var(--voy-text-muted)]" />;
    return <FaMapMarkerAlt className="text-[var(--voy-gold)]" />;
  };

  if (hasStructuredPlan) {
    return (
      <section className="w-full px-0 md:px-2 py-10">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-semibold text-[var(--voy-text)] mb-3">
              Your Journey Itinerary
            </h2>
            <p className="text-md text-[var(--voy-text-muted)] max-w-2xl mx-auto">
              Expand each day to view planned activities, costs, and guidance.
            </p>

            <div className="flex justify-center gap-4 mt-6 flex-wrap">
              <div className="bg-[var(--voy-surface2)] border border-[var(--voy-border)] rounded-full px-4 py-2 flex items-center">
                <FaMapMarkerAlt className="text-[var(--voy-gold)] mr-2" />
                <div className="text-[var(--voy-text)] font-medium">
                  {totalActivities} Activities
                </div>
              </div>
              <div className="bg-[var(--voy-surface2)] border border-[var(--voy-border)] rounded-full px-4 py-2 flex items-center">
                <FaClock className="text-[var(--voy-gold)] mr-2" />
                <div className="text-[var(--voy-text)] font-medium">
                  {structuredPlanDays.length} Days
                </div>
              </div>
              {trip?.aiPlan?.totalEstimatedCost ? (
                <div className="bg-[var(--voy-surface2)] border border-[var(--voy-border)] rounded-full px-4 py-2">
                  <div className="text-[var(--voy-text)] font-medium">
                    {trip.aiPlan.totalEstimatedCost}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="space-y-4">
            {structuredPlanDays.map((day, index) => (
              <details
                key={`${day.day}-${index}`}
                className="group bg-[var(--voy-surface)] rounded-2xl border border-[var(--voy-border)] overflow-hidden"
              >
                <summary className="list-none cursor-pointer p-5 sm:p-6 flex flex-wrap gap-3 justify-between items-center">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-[var(--voy-text-faint)]">
                      Day {day.day}
                    </p>
                    <h3 className="text-xl font-semibold text-[var(--voy-text)]">{day.title}</h3>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <span className="px-3 py-1 rounded-full bg-[var(--voy-bg2)] border border-[var(--voy-border)] text-[var(--voy-text-muted)]">
                      {Array.isArray(day.activities) ? day.activities.length : 0} activities
                    </span>
                    <span className="px-3 py-1 rounded-full bg-[var(--voy-gold-dim)] text-[var(--voy-gold)]">
                      {day.estimatedCost || "Not specified"}
                    </span>
                  </div>
                </summary>
                <div className="px-5 sm:px-6 pb-6 border-t border-[var(--voy-border)]">
                  <ul className="grid gap-3 pt-5">
                    {(Array.isArray(day.activities) ? day.activities : []).map((activity, activityIndex) => (
                      <li
                        key={`${day.day}-activity-${activityIndex}`}
                        className="rounded-xl border border-[var(--voy-border)] bg-[var(--voy-surface2)] px-4 py-3 text-[var(--voy-text)]"
                      >
                        {activity}
                      </li>
                    ))}
                  </ul>
                  {day.tips ? (
                    <p className="mt-4 text-sm text-[var(--voy-text-muted)]">
                      <span className="font-medium text-[var(--voy-text)]">Tip:</span> {day.tips}
                    </p>
                  ) : null}
                </div>
              </details>
            ))}
          </div>

          {travelTips.length > 0 ? (
            <div className="mt-8 rounded-2xl border border-[var(--voy-border)] bg-[var(--voy-surface)] p-6">
              <h3 className="text-lg font-semibold text-[var(--voy-text)]">Travel Tips</h3>
              <ul className="mt-3 grid gap-2">
                {travelTips.map((tip, index) => (
                  <li
                    key={`tip-${index}`}
                    className="rounded-lg bg-[var(--voy-surface2)] border border-[var(--voy-border)] px-4 py-3 text-sm text-[var(--voy-text-muted)]"
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

  return (
    <section className="w-full px-0 md:px-2 py-10">
      <div className="max-w-5xl mx-auto">
        {/* Section Header */}
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-semibold text-[var(--voy-text)] mb-3">
            Your Journey Itinerary
          </h2>
          <p className="text-md text-[var(--voy-text-muted)] max-w-2xl mx-auto">
            Discover the amazing places you'll visit on your {safeItinerary.length}-day adventure
          </p>

          <div className="flex justify-center gap-4 mt-6">
            <div className="bg-[var(--voy-surface2)] border border-[var(--voy-border)] rounded-full px-4 py-2 flex items-center">
              <FaMapMarkerAlt className="text-[var(--voy-gold)] mr-2" />
              <div className="text-[var(--voy-text)] font-medium">
                {totalPlaces} Places
              </div>
            </div>
            <div className="bg-[var(--voy-surface2)] border border-[var(--voy-border)] rounded-full px-4 py-2 flex items-center">
              <FaClock className="text-[var(--voy-gold)] mr-2" />
              <div className="text-[var(--voy-text)] font-medium">
                {safeItinerary.length} Days
              </div>
            </div>
          </div>
        </div>

        {/* Itinerary List */}
        {safeItinerary.length > 0 ? (
          <div className="space-y-8">
            {safeItinerary.map((item, index) => {
              const dayPlaces = Array.isArray(item.places) ? item.places : [];
              return (
                <div key={index} className="bg-[var(--voy-surface)] rounded-2xl shadow border border-[var(--voy-border)] overflow-hidden">
                  <div className="p-6 border-b border-[var(--voy-border)]">
                    <h3 className="text-xl font-semibold text-[var(--voy-text)] mb-2">
                      Day {index + 1} - {dayPlaces.length} {dayPlaces.length === 1 ? "place" : "places"}
                    </h3>
                  </div>

                  <div className="p-6">
                    {dayPlaces.length > 0 ? (
                      <div className="grid gap-6 md:grid-cols-1 lg:grid-cols-2">
                        {dayPlaces.map((place, placeIndex) => (
                          <div key={placeIndex} className="bg-[var(--voy-surface2)] rounded-xl p-5 shadow border border-[var(--voy-border)] flex items-start">
                            <div className="w-10 h-10 rounded-full bg-[var(--voy-bg2)] flex items-center justify-center mr-3 mt-1">
                              {getPlaceIcon(place.placeName)}
                            </div>
                            <PlaceCardItem place={place} />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-12 bg-[var(--voy-surface2)] rounded-xl border border-[var(--voy-border)]">
                        <p className="text-[var(--voy-text-faint)] italic">
                          No places planned for this day yet.
                        </p>
                      </div>
                    )}
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
      </div>
    </section>
  );
}

export default PlacesToVisit;
