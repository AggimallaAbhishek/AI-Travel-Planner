import React from "react";
import RecommendationGridSection from "./RecommendationGridSection";

function Hotels({
  trip,
  hotels = [],
  isLoading = false,
  errorMessage = "",
  note = "",
  onRetry,
}) {
  const destination = trip?.userSelection?.location?.label || "this destination";

  return (
    <RecommendationGridSection
      title="Hotel Recommendations"
      subtitle={`Discover accommodations recommended for your ${destination} itinerary.`}
      items={hotels}
      isLoading={isLoading}
      errorMessage={errorMessage}
      type="hotel"
      destination={destination}
      note={note}
      emptyTitle="No hotels found yet"
      emptyDescription={`We could not find hotel recommendations for ${destination} right now.`}
      onRetry={onRetry}
    />
  );
}

export default Hotels;
