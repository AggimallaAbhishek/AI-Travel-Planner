import React from "react";
import { Link } from "react-router-dom";
import { getTripImage } from "@/lib/destinationImages";
import AppImage from "@/components/ui/AppImage";
import { IMAGE_FALLBACKS } from "@/lib/imageManifest";

function UserTripCardItem({ trip }) {
  const imageSrc = getTripImage(trip?.userSelection?.location?.label);

  return (
    <Link to={`/trips/${trip?.id}`} className="block">
      <article className="overflow-hidden rounded-2xl border border-[var(--voy-border)] bg-[var(--voy-surface)] shadow-sm transition hover:-translate-y-1 hover:shadow-lg">
        <AppImage
          src={imageSrc}
          fallbackSrc={IMAGE_FALLBACKS.scenic}
          alt={`${trip?.userSelection?.location?.label || "Trip"} destination`}
          sizes="(max-width: 560px) 100vw, (max-width: 980px) 50vw, 33vw"
          className="h-[220px] w-full"
          imgClassName="h-full w-full object-cover"
        />
        <div className="p-5">
          <h2 className="font-bold text-lg text-[var(--voy-text)] truncate">
            {trip?.userSelection?.location?.label || "Unknown Location"}
          </h2>
          <p className="mt-2 text-sm text-[var(--voy-text-muted)]">
            {trip?.userSelection?.days || "N/A"} Days • {trip?.userSelection?.budget || "N/A"} Budget
          </p>
          {trip?.createdAt ? (
            <p className="mt-2 text-xs text-[var(--voy-text-faint)]">
              Created: {new Date(trip.createdAt).toLocaleDateString()}
            </p>
          ) : null}
        </div>
      </article>
    </Link>
  );
}

export default UserTripCardItem;
