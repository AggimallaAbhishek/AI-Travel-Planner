import React from "react";
import RecommendationGridSection from "./RecommendationGridSection";

function Restaurants({
  trip,
  restaurants = [],
  isLoading = false,
  errorMessage = "",
  note = "",
  onRetry,
}) {
  const destination = trip?.userSelection?.location?.label || "this destination";

  return (
    <RecommendationGridSection
      title="Restaurant Recommendations"
      subtitle={`Discover dining spots worth adding to your ${destination} itinerary.`}
      items={restaurants}
      isLoading={isLoading}
      errorMessage={errorMessage}
      type="restaurant"
      destination={destination}
      note={note}
      emptyTitle="No restaurants found yet"
      emptyDescription={`We could not find restaurant recommendations for ${destination} right now.`}
      onRetry={onRetry}
    />
  );
}

export default Restaurants;
