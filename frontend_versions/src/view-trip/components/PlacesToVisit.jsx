import React, { useMemo } from "react";
import {
  FaCalendarAlt,
  FaClock,
  FaExternalLinkAlt,
  FaMapMarkerAlt,
} from "react-icons/fa";
import { formatCityMapDistance } from "@/lib/cityItineraryMap";
import { buildTripDayPlans, summarizeTripDayPlans } from "@/lib/tripDayPlan";

function PlacesToVisit({ trip }) {
  const dayPlans = useMemo(() => buildTripDayPlans(trip), [trip]);
  const planSummary = useMemo(() => summarizeTripDayPlans(dayPlans), [dayPlans]);
  const travelTips = Array.isArray(trip?.aiPlan?.travelTips) ? trip.aiPlan.travelTips : [];

  if (dayPlans.length === 0) {
    return (
      <section className="w-full px-0 md:px-2 py-10">
        <div className="max-w-5xl mx-auto text-center py-20 bg-[var(--voy-surface)] rounded-2xl shadow border border-[var(--voy-border)]">
          <h3 className="text-2xl font-semibold text-[var(--voy-text)] mb-4">
            Your itinerary is being prepared
          </h3>
          <p className="text-[var(--voy-text-muted)] max-w-2xl mx-auto">
            Our travel planner is still assembling the day-by-day plan. Check back
            soon to see your activities, stops, and distance estimates.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="w-full px-0 md:px-2 py-10">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-semibold text-[var(--voy-text)] mb-3">
            Your Journey Itinerary
          </h2>
          <p className="text-md text-[var(--voy-text-muted)] max-w-2xl mx-auto">
            Follow the plan day by day, review each stop, and use the algorithm-based
            distance estimates to understand how the places fit together.
          </p>

          <div className="flex justify-center gap-4 mt-6 flex-wrap">
            <div className="bg-[var(--voy-surface2)] border border-[var(--voy-border)] rounded-full px-4 py-2 flex items-center">
              <FaCalendarAlt className="text-[var(--voy-gold)] mr-2" />
              <div className="text-[var(--voy-text)] font-medium">
                {planSummary.totalDays} Days
              </div>
            </div>
            <div className="bg-[var(--voy-surface2)] border border-[var(--voy-border)] rounded-full px-4 py-2 flex items-center">
              <FaClock className="text-[var(--voy-gold)] mr-2" />
              <div className="text-[var(--voy-text)] font-medium">
                {planSummary.totalActivities} Activities
              </div>
            </div>
            <div className="bg-[var(--voy-surface2)] border border-[var(--voy-border)] rounded-full px-4 py-2 flex items-center">
              <FaMapMarkerAlt className="text-[var(--voy-gold)] mr-2" />
              <div className="text-[var(--voy-text)] font-medium">
                {planSummary.totalPlaces} Places
              </div>
            </div>
            <div className="bg-[var(--voy-surface2)] border border-[var(--voy-border)] rounded-full px-4 py-2 flex items-center">
              <div className="text-[var(--voy-text)] font-medium">
                Approx. {formatCityMapDistance(planSummary.totalDistanceMeters)}
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-5">
          {dayPlans.map((dayPlan) => {
            const mappedPlaceCount = dayPlan.places.filter((place) => place.isResolved).length;

            return (
              <details
                key={`day-plan-${dayPlan.dayNumber}`}
                className="group bg-[var(--voy-surface)] rounded-2xl border border-[var(--voy-border)] overflow-hidden"
                open={dayPlan.dayNumber === 1}
              >
                <summary className="list-none cursor-pointer p-5 sm:p-6 flex flex-wrap gap-3 justify-between items-center">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-[var(--voy-text-faint)]">
                      Day {dayPlan.dayNumber}
                    </p>
                    <h3 className="text-xl font-semibold text-[var(--voy-text)]">
                      {dayPlan.title}
                    </h3>
                  </div>
                  <div className="flex items-center gap-3 text-sm flex-wrap justify-end">
                    <span className="px-3 py-1 rounded-full bg-[var(--voy-bg2)] border border-[var(--voy-border)] text-[var(--voy-text-muted)]">
                      {dayPlan.activities.length} activities
                    </span>
                    <span className="px-3 py-1 rounded-full bg-[var(--voy-bg2)] border border-[var(--voy-border)] text-[var(--voy-text-muted)]">
                      {dayPlan.places.length} places
                    </span>
                    <span className="px-3 py-1 rounded-full bg-[var(--voy-bg2)] border border-[var(--voy-border)] text-[var(--voy-text-muted)]">
                      {mappedPlaceCount} mapped
                    </span>
                    <span className="px-3 py-1 rounded-full bg-[var(--voy-gold-dim)] text-[var(--voy-gold)]">
                      {dayPlan.totalDistanceMeters > 0
                        ? `Approx. ${formatCityMapDistance(dayPlan.totalDistanceMeters)}`
                        : dayPlan.estimatedCost || "Day plan"}
                    </span>
                  </div>
                </summary>

                <div className="px-5 sm:px-6 pb-6 border-t border-[var(--voy-border)]">
                  <div className="grid gap-6 pt-5 lg:grid-cols-[1.05fr_0.95fr]">
                    <div>
                      <div className="flex items-center justify-between gap-3">
                        <h4 className="text-sm font-semibold uppercase tracking-[0.16em] text-[var(--voy-text-faint)]">
                          Activities
                        </h4>
                        {dayPlan.estimatedCost ? (
                          <span className="rounded-full bg-[var(--voy-gold-dim)] px-3 py-1 text-xs font-semibold text-[var(--voy-gold)]">
                            {dayPlan.estimatedCost}
                          </span>
                        ) : null}
                      </div>

                      {dayPlan.activities.length > 0 ? (
                        <ol className="mt-4 space-y-3">
                          {dayPlan.activities.map((activity, activityIndex) => (
                            <li
                              key={`${dayPlan.dayNumber}-activity-${activityIndex}`}
                              className="rounded-xl border border-[var(--voy-border)] bg-[var(--voy-surface2)] px-4 py-3 text-[var(--voy-text)]"
                            >
                              <span className="mr-2 font-semibold text-[var(--voy-gold)]">
                                {activityIndex + 1}.
                              </span>
                              {activity}
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <div className="mt-4 rounded-xl border border-[var(--voy-border)] bg-[var(--voy-surface2)] px-4 py-4 text-sm text-[var(--voy-text-muted)]">
                          No structured activities were saved for this day yet.
                        </div>
                      )}

                      {dayPlan.tips ? (
                        <div className="mt-4 rounded-xl border border-[var(--voy-border)] bg-[var(--voy-surface2)] px-4 py-4 text-sm leading-7 text-[var(--voy-text-muted)]">
                          <span className="font-semibold text-[var(--voy-text)]">Tip:</span>{" "}
                          {dayPlan.tips}
                        </div>
                      ) : null}
                    </div>

                    <div>
                      <h4 className="text-sm font-semibold uppercase tracking-[0.16em] text-[var(--voy-text-faint)]">
                        Places to visit
                      </h4>

                      {dayPlan.places.length > 0 ? (
                        <div className="mt-4 space-y-3">
                          {dayPlan.places.map((place) => (
                            <a
                              key={place.id}
                              href={place.mapsUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="block rounded-xl border border-[var(--voy-border)] bg-[var(--voy-surface2)] px-4 py-4 transition hover:-translate-y-0.5 hover:shadow-sm"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <div className="flex items-center gap-3">
                                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--voy-gold-dim)] text-xs font-bold text-[var(--voy-gold)]">
                                      {place.index}
                                    </span>
                                    <div>
                                      <p className="font-semibold text-[var(--voy-text)]">
                                        {place.placeName}
                                      </p>
                                      <p className="text-sm text-[var(--voy-text-muted)]">
                                        {place.location}
                                      </p>
                                    </div>
                                  </div>
                                  {place.placeDetails ? (
                                    <p className="mt-3 text-sm leading-6 text-[var(--voy-text-muted)]">
                                      {place.placeDetails}
                                    </p>
                                  ) : null}
                                </div>

                                <span className="inline-flex items-center gap-2 text-xs font-medium text-[var(--voy-text-muted)]">
                                  Open
                                  <FaExternalLinkAlt size={11} />
                                </span>
                              </div>
                            </a>
                          ))}
                        </div>
                      ) : (
                        <div className="mt-4 rounded-xl border border-[var(--voy-border)] bg-[var(--voy-surface2)] px-4 py-4 text-sm text-[var(--voy-text-muted)]">
                          No itinerary places were saved for this day yet.
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="mt-6 rounded-2xl border border-[var(--voy-border)] bg-[rgba(251,250,247,0.85)] p-4">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <h4 className="text-sm font-semibold uppercase tracking-[0.16em] text-[var(--voy-text-faint)]">
                        Approximate route legs
                      </h4>
                      <span className="rounded-full border border-[var(--voy-border)] bg-white/80 px-3 py-1 text-xs font-medium text-[var(--voy-text-muted)]">
                        {dayPlan.legDistances.length} segment{dayPlan.legDistances.length === 1 ? "" : "s"}
                      </span>
                    </div>

                    {dayPlan.legDistances.length > 0 ? (
                      <div className="mt-4 grid gap-3">
                        {dayPlan.legDistances.map((leg, legIndex) => (
                          <div
                            key={leg.id}
                            className="rounded-xl border border-[var(--voy-border)] bg-white/80 px-4 py-3"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold text-[var(--voy-text)]">
                                  {leg.fromPlace.placeName} to {leg.toPlace.placeName}
                                </p>
                                <p className="mt-1 text-sm text-[var(--voy-text-muted)]">
                                  Segment {legIndex + 1} • straight-line estimate from saved coordinates
                                </p>
                              </div>
                              <span className="rounded-full bg-[var(--voy-gold-dim)] px-3 py-1 text-xs font-semibold text-[var(--voy-gold)]">
                                {leg.distanceLabel}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="mt-4 rounded-xl border border-[var(--voy-border)] bg-white/80 px-4 py-4 text-sm text-[var(--voy-text-muted)]">
                        Add at least two geocoded places to this day to show algorithm-based distance estimates.
                      </div>
                    )}
                  </div>
                </div>
              </details>
            );
          })}
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

export default PlacesToVisit;
