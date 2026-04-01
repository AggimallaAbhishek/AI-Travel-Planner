import React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import AppImage from "@/components/ui/AppImage";
import { IMAGE_FALLBACKS } from "@/lib/imageManifest";

export default function DestinationModal({ destination, onOpenChange, onPlanTrip }) {
  const open = Boolean(destination);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="voy-map-modal">
        {destination ? (
          <>
            <DialogHeader>
              <p>{destination.country}</p>
              <DialogTitle>{destination.name}</DialogTitle>
            </DialogHeader>
            <DialogDescription className="voy-map-modal-subtitle">
              {destination.tagline}
            </DialogDescription>
            <AppImage
              src={destination.image}
              fallbackSrc={IMAGE_FALLBACKS.destination}
              alt={destination.name}
              sizes="(max-width: 580px) 92vw, 540px"
              className="w-full"
              imgClassName="w-full max-h-[260px] object-cover rounded-[12px] border border-[var(--voy-border)]"
            />
            <p className="voy-map-modal-description">{destination.description}</p>
            <div className="voy-map-modal-actions">
              <button type="button" onClick={() => onPlanTrip(destination)}>
                Plan Trip
              </button>
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
