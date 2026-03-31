import React, { useEffect, useRef, useState } from "react";
import { IoMdInformationCircleOutline } from "react-icons/io";
import {
  FaCalendarAlt,
  FaFilePdf,
  FaMapMarkerAlt,
  FaMoneyBillWave,
  FaShare,
  FaUsers,
} from "react-icons/fa";
import { toast } from "react-toastify";
import { getTripImage } from "@/lib/destinationImages";
import AppImage from "@/components/ui/AppImage";
import { IMAGE_FALLBACKS } from "@/lib/imageManifest";
import { downloadTripPlanPdf } from "@/lib/tripPdf";

function InfoSection({ trip }) {
    const photoUrl = getTripImage(trip?.userSelection?.location?.label);
    const [showShareOptions, setShowShareOptions] = useState(false);
    const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
    const shareMenuRef = useRef(null);

    useEffect(() => {
      if (!showShareOptions) {
        return undefined;
      }

      const onPointerDown = (event) => {
        if (shareMenuRef.current && !shareMenuRef.current.contains(event.target)) {
          setShowShareOptions(false);
        }
      };
      const onKeyDown = (event) => {
        if (event.key === "Escape") {
          setShowShareOptions(false);
        }
      };

      window.addEventListener("pointerdown", onPointerDown);
      window.addEventListener("keydown", onKeyDown);
      return () => {
        window.removeEventListener("pointerdown", onPointerDown);
        window.removeEventListener("keydown", onKeyDown);
      };
    }, [showShareOptions]);

    const handleShareClick = () => {
        setShowShareOptions(!showShareOptions);
    };

    const handleDownloadPdf = async () => {
        if (isGeneratingPdf) {
            return;
        }

        setIsGeneratingPdf(true);
        console.info("[view-trip] Starting trip PDF download", {
            tripId: trip?.id ?? null,
            destination: trip?.aiPlan?.destination ?? trip?.userSelection?.location?.label ?? "",
        });

        try {
            const result = await downloadTripPlanPdf(trip);
            toast.success(`Trip plan downloaded as ${result.fileName}`);
        } catch (error) {
            console.error("[view-trip] Failed to generate trip PDF", {
                tripId: trip?.id ?? null,
                destination: trip?.aiPlan?.destination ?? trip?.userSelection?.location?.label ?? "",
                error,
            });
            toast.error("Unable to generate the trip PDF right now.");
        } finally {
            setIsGeneratingPdf(false);
        }
    };

    const copyTripLink = async () => {
        try {
            if (!navigator?.clipboard) {
                toast.error("Clipboard access is not available in this browser.");
                return;
            }

            await navigator.clipboard.writeText(window.location.href);
            setShowShareOptions(false);
            toast.success('Trip link copied to clipboard.');
        } catch (error) {
            console.error("[view-trip] Failed to copy share URL", error);
            toast.error("Unable to copy trip link right now.");
        }
    };

    return (
        <div className="relative overflow-hidden rounded-2xl bg-[var(--voy-surface)] border border-[var(--voy-border)] shadow-lg">
            <div className="relative h-80 w-full overflow-hidden">
                <AppImage
                    src={photoUrl}
                    fallbackSrc={IMAGE_FALLBACKS.scenic}
                    className="h-full w-full"
                    imgClassName="h-full w-full object-cover transition-transform duration-700"
                    alt={trip?.userSelection?.location?.label || "Travel destination"}
                    loading="eager"
                    sizes="(max-width: 980px) 100vw, 1200px"
                />

                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent"></div>

                <div className="absolute top-4 left-4 bg-black/45 backdrop-blur-sm px-4 py-2 rounded-full flex items-center gap-2 shadow-md">
                    <FaMapMarkerAlt className="text-[var(--voy-gold-light)]" />
                    <span className="font-medium text-white">
                        {trip?.userSelection?.location?.label || "Unknown Location"}
                    </span>
                </div>
            </div>

            <div className="p-6">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                    <div className="flex-1">
                        <h2 className="font-bold text-3xl text-[var(--voy-text)] mb-4">
                            {trip?.userSelection?.location?.label || "Unknown Location"}
                        </h2>

                        <div className="flex flex-wrap gap-3">
                            <div className="bg-[var(--voy-surface2)] text-[var(--voy-text)] px-4 py-2 rounded-full flex items-center gap-2 shadow-sm border border-[var(--voy-border)]">
                                <FaCalendarAlt className="text-[var(--voy-gold)]" />
                                <span className="text-sm font-medium">
                                    {trip?.userSelection?.days || 1} Day{trip?.userSelection?.days > 1 ? 's' : ''}
                                </span>
                            </div>
                            
                            <div className="bg-[var(--voy-surface2)] text-[var(--voy-text)] px-4 py-2 rounded-full flex items-center gap-2 shadow-sm border border-[var(--voy-border)]">
                                <FaMoneyBillWave className="text-[var(--voy-gold)]" />
                                <span className="text-sm font-medium">
                                    {trip?.userSelection?.budget || "N/A"} Budget
                                </span>
                            </div>
                            
                            <div className="bg-[var(--voy-surface2)] text-[var(--voy-text)] px-4 py-2 rounded-full flex items-center gap-2 shadow-sm border border-[var(--voy-border)]">
                                <FaUsers className="text-[var(--voy-gold)]" />
                                <span className="text-sm font-medium">
                                    {trip?.userSelection?.travelers || "Traveler"}
                                </span>
                            </div>
                        </div>

                        {trip?.createdAt && (
                            <div className="mt-4 flex items-center gap-2 text-[var(--voy-text-muted)]">
                                <IoMdInformationCircleOutline className="text-[var(--voy-gold)]" />
                                <span className="text-sm">
                                    Created on {new Date(trip.createdAt).toLocaleString()}
                                </span>
                            </div>
                        )}
                    </div>

                    <div className="flex flex-wrap gap-3 items-center">
                        <button
                            type="button"
                            onClick={handleDownloadPdf}
                            disabled={isGeneratingPdf}
                            className="bg-[var(--voy-gold)] text-[#0a0e1a] px-4 py-3 rounded-xl flex items-center gap-2 shadow-sm hover:shadow-md transition-all duration-300 disabled:cursor-not-allowed disabled:opacity-70"
                            aria-busy={isGeneratingPdf}
                        >
                            {isGeneratingPdf ? (
                                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[#0a0e1a]/25 border-t-[#0a0e1a]" />
                            ) : (
                                <FaFilePdf />
                            )}
                            <span className="text-sm font-semibold">
                                {isGeneratingPdf ? "Generating PDF..." : "Download Trip Plan"}
                            </span>
                        </button>

                        <div className="relative" ref={shareMenuRef}>
                            <button
                                type="button"
                                onClick={handleShareClick}
                                className="bg-[var(--voy-surface2)] text-[var(--voy-text-muted)] p-3 rounded-xl flex items-center gap-2 shadow-sm hover:shadow-md transition-all duration-300 hover:text-[var(--voy-gold)] relative border border-[var(--voy-border)]"
                                aria-expanded={showShareOptions}
                                aria-controls="voy-share-menu"
                                aria-label="Share trip options"
                            >
                                <FaShare />
                            </button>

                            {showShareOptions && (
                                <div id="voy-share-menu" className="voy-info-share-menu absolute top-full right-0 mt-2 rounded-xl p-3 z-10 min-w-[180px]">
                                    <div className="text-sm font-medium text-[var(--voy-text)] mb-2">Share this trip</div>
                                    <button
                                        type="button"
                                        onClick={copyTripLink}
                                        className="w-full text-left py-2 px-3 rounded-lg hover:bg-[var(--voy-surface2)] text-[var(--voy-text-muted)] transition-colors"
                                    >
                                        Copy link
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default InfoSection;
