import React from "react";
import { Link } from "react-router-dom";
import { FaExternalLinkAlt, FaMapMarkerAlt, FaStar, FaTag } from "react-icons/fa";
import { getHotelImage } from "@/lib/destinationImages";
import AppImage from "@/components/ui/AppImage";
import { IMAGE_FALLBACKS } from "@/lib/imageManifest";

function HotelCardItem({ hotel }) {
  const photoUrl = getHotelImage(hotel);

  return (
    <Link
      to={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        hotel.hotelName + ", " + (hotel.hotelAddress || "")
      )}`}
      target="_blank"
      rel="noopener noreferrer"
      className="no-underline block"
    >
      <div className="relative bg-[var(--voy-surface2)] rounded-2xl overflow-hidden shadow-lg hover:shadow-2xl hover:scale-[1.02] transition-all duration-300 cursor-pointer border border-[var(--voy-border)]">
        <div className="relative h-[200px] w-full">
          <AppImage
            src={photoUrl}
            fallbackSrc={IMAGE_FALLBACKS.hotel}
            alt={hotel.hotelName || "Hotel"}
            sizes="(max-width: 560px) 100vw, (max-width: 980px) 50vw, 33vw"
            className="h-full w-full"
            imgClassName="h-full w-full object-cover"
          />

          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent"></div>

          {hotel.rating && (
            <div className="absolute top-3 right-3 bg-[var(--voy-gold)] text-black text-xs font-bold px-3 py-1 rounded-full flex items-center gap-1 shadow-md">
              <FaStar className="text-sm" />
              {hotel.rating}
            </div>
          )}
        </div>

        <div className="p-4">
          <h2 className="text-lg font-semibold text-[var(--voy-text)] truncate">
            {hotel.hotelName || "Unknown Hotel"}
          </h2>
          
          {hotel.hotelAddress && (
            <p className="text-sm text-[var(--voy-text-muted)] flex items-center gap-1 mt-1">
              <FaMapMarkerAlt className="text-[var(--voy-gold)]" /> 
              {hotel.hotelAddress.length > 40 
                ? `${hotel.hotelAddress.substring(0, 40)}...` 
                : hotel.hotelAddress
              }
            </p>
          )}

          <div className="flex justify-between items-center mt-3">
            {hotel.price && (
              <p className="flex items-center gap-1 text-sm font-medium text-[var(--voy-gold)]">
                <FaTag /> {hotel.price}
              </p>
            )}
            
            <span className="inline-flex items-center gap-1 px-3 py-1 text-xs rounded-lg bg-[var(--voy-gold)] text-black">
              View on Maps <FaExternalLinkAlt />
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}

export default HotelCardItem;
