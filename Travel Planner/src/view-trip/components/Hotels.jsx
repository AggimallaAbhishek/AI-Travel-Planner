import React from "react";
import HotelCardItem from "./../components/HotelCardItem";
import { FaRegSadTear } from "react-icons/fa";

function Hotels({ trip }) {
  const hotels = trip?.hotels || [];

  return (
    <section className="relative w-full mt-10 px-0 md:px-2 py-8">
      <div className="relative max-w-7xl mx-auto border border-[var(--voy-border)] rounded-2xl shadow-lg p-8 bg-[var(--voy-surface)]">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-semibold text-[var(--voy-text)] mb-4 text-center">
            Hotel Recommendations
          </h2>
          <p className="text-md text-[var(--voy-text-muted)] max-w-2xl mx-auto">
            Discover accommodations recommended for your {trip?.userSelection?.location?.label || "trip"}
          </p>
        </div>

        {hotels.length > 0 ? (
          <div className="grid gap-6 sm:grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
            {hotels.map((hotel, index) => (
              <HotelCardItem key={`${hotel.hotelName}-${index}`} hotel={hotel} />
            ))}
          </div>
        ) : (
          <div className="text-center py-12 bg-[var(--voy-surface2)] rounded-2xl shadow border border-[var(--voy-border)] mt-8">
            <div className="max-w-md mx-auto">
              <div className="w-24 h-24 bg-[var(--voy-bg2)] rounded-full mx-auto flex items-center justify-center mb-6">
                <FaRegSadTear className="text-3xl text-[var(--voy-text-faint)]" />
              </div>
              <h3 className="text-2xl font-semibold text-[var(--voy-text)] mb-4">No hotels found yet</h3>
              <p className="text-[var(--voy-text-muted)] mb-2">
                The generated itinerary did not include hotel recommendations for{" "}
                {trip?.userSelection?.location?.label || "this destination"}.
              </p>
              <p className="text-sm text-[var(--voy-text-faint)]">
                Regenerate the trip if you want a different itinerary mix.
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

export default Hotels;
