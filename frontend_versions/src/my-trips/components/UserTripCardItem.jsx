import React from "react";
import { Link } from "react-router-dom";
import { getTripImage } from "@/lib/destinationImages";
import AppImage from "@/components/ui/AppImage";
import { IMAGE_FALLBACKS } from "@/lib/imageManifest";
import {
  formatBudgetSummary,
  normalizeUserSelection,
} from "../../../shared/trips.js";

function UserTripCardItem({ trip }) {
  const selection = normalizeUserSelection(trip?.userSelection ?? {});
  const destinationLabel = selection.location.label || "Unknown Location";
  const imageSrc = getTripImage(destinationLabel);
  const summaryParts = [
    `${selection.days || "N/A"} Day${selection.days === 1 ? "" : "s"}`,
    selection.planType || formatBudgetSummary(selection),
  ].filter(Boolean);
  const metaParts = [
    selection.travelStyle,
    selection.pace ? `${selection.pace} pace` : "",
  ].filter(Boolean);

  return (
    <Link to={`/trips/${trip?.id}`} className="block">
      <article className="overflow-hidden rounded-2xl border border-[var(--voy-border)] bg-[var(--voy-surface)] shadow-sm transition hover:-translate-y-1 hover:shadow-lg">
        <AppImage
          src={imageSrc}
          fallbackSrc={IMAGE_FALLBACKS.scenic}
          alt={`${destinationLabel || "Trip"} destination`}
          sizes="(max-width: 560px) 100vw, (max-width: 980px) 50vw, 33vw"
          className="h-[220px] w-full"
          imgClassName="h-full w-full object-cover"
        />
        <div className="p-5">
          <h2 className="font-bold text-lg text-[var(--voy-text)] truncate">
            {destinationLabel}
          </h2>
          <p className="mt-2 text-sm text-[var(--voy-text-muted)]">
            {summaryParts.join(" • ")}
          </p>
          {metaParts.length > 0 ? (
            <p className="mt-1 text-xs text-[var(--voy-text-muted)]">
              {metaParts.join(" • ")}
            </p>
          ) : null}
          {selection.foodPreferences.length > 0 ? (
            <p className="mt-2 text-xs text-[var(--voy-text-faint)] line-clamp-1">
              Food: {selection.foodPreferences.join(", ")}
            </p>
          ) : null}
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
