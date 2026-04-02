import React, { useEffect, useRef, useState } from "react";
import { IoMdInformationCircleOutline } from "react-icons/io";
import {
  FaMapMarkerAlt,
  FaCalendarAlt,
  FaMoneyBillWave,
  FaUsers,
  FaShare,
  FaFilePdf,
  FaPrint,
} from "react-icons/fa";
import { toast } from "react-toastify";
import { getTripImage } from "@/lib/destinationImages";
import AppImage from "@/components/ui/AppImage";
import { IMAGE_FALLBACKS } from "@/lib/imageManifest";
import {
  formatBudgetSummary,
  normalizeUserSelection,
} from "../../../shared/trips.js";

function InfoSection({
  trip,
  pdfAction = "",
  onDownloadPdf,
  onPrintPdf,
}) {
    const selection = normalizeUserSelection(trip?.userSelection ?? {});
    const destinationLabel = selection.location.label || "Unknown Location";
    const photoUrl = getTripImage(destinationLabel);
    const budgetSummary = formatBudgetSummary(selection);
    const [showShareOptions, setShowShareOptions] = useState(false);
    const shareMenuRef = useRef(null);
    const isPdfBusy = Boolean(pdfAction);
    const isDownloadBusy = pdfAction === "download";
    const isPrintBusy = pdfAction === "print";

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
                    alt={destinationLabel || "Travel destination"}
                    loading="eager"
                    sizes="(max-width: 980px) 100vw, 1200px"
                />

                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent"></div>

                <div className="absolute top-4 left-4 bg-black/45 backdrop-blur-sm px-4 py-2 rounded-full flex items-center gap-2 shadow-md">
                    <FaMapMarkerAlt className="text-[var(--voy-gold-light)]" />
                    <span className="font-medium text-white">
                        {destinationLabel}
                    </span>
                </div>
            </div>

            <div className="p-6">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                    <div className="flex-1">
                        <h2 className="font-bold text-3xl text-[var(--voy-text)] mb-4">
                            {destinationLabel}
                        </h2>

                        <div className="flex flex-wrap gap-3">
                            <div className="bg-[var(--voy-surface2)] text-[var(--voy-text)] px-4 py-2 rounded-full flex items-center gap-2 shadow-sm border border-[var(--voy-border)]">
                                <FaCalendarAlt className="text-[var(--voy-gold)]" />
                                <span className="text-sm font-medium">
                                    {selection.days || 1} Day{selection.days > 1 ? "s" : ""}
                                </span>
                            </div>
                            
                            <div className="bg-[var(--voy-surface2)] text-[var(--voy-text)] px-4 py-2 rounded-full flex items-center gap-2 shadow-sm border border-[var(--voy-border)]">
                                <FaMoneyBillWave className="text-[var(--voy-gold)]" />
                                <span className="text-sm font-medium">
                                    {budgetSummary}
                                </span>
                            </div>
                            
                            <div className="bg-[var(--voy-surface2)] text-[var(--voy-text)] px-4 py-2 rounded-full flex items-center gap-2 shadow-sm border border-[var(--voy-border)]">
                                <FaUsers className="text-[var(--voy-gold)]" />
                                <span className="text-sm font-medium">
                                    {selection.travelers || "Traveler"}
                                </span>
                            </div>

                            {selection.planType ? (
                                <div className="bg-[var(--voy-surface2)] text-[var(--voy-text)] px-4 py-2 rounded-full flex items-center gap-2 shadow-sm border border-[var(--voy-border)]">
                                    <span className="text-sm font-medium">{selection.planType}</span>
                                </div>
                            ) : null}

                            {selection.travelStyle ? (
                                <div className="bg-[var(--voy-surface2)] text-[var(--voy-text)] px-4 py-2 rounded-full flex items-center gap-2 shadow-sm border border-[var(--voy-border)]">
                                    <span className="text-sm font-medium">{selection.travelStyle}</span>
                                </div>
                            ) : null}

                            {selection.pace ? (
                                <div className="bg-[var(--voy-surface2)] text-[var(--voy-text)] px-4 py-2 rounded-full flex items-center gap-2 shadow-sm border border-[var(--voy-border)]">
                                    <span className="text-sm font-medium">{selection.pace} pace</span>
                                </div>
                            ) : null}

                            {selection.foodPreferences.map((foodPreference) => (
                                <div
                                    key={foodPreference}
                                    className="bg-[var(--voy-surface2)] text-[var(--voy-text)] px-4 py-2 rounded-full flex items-center gap-2 shadow-sm border border-[var(--voy-border)]"
                                >
                                    <span className="text-sm font-medium">{foodPreference}</span>
                                </div>
                            ))}
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
                            onClick={onDownloadPdf}
                            disabled={isPdfBusy}
                            className="bg-[var(--voy-gold)] text-[#0a0e1a] px-4 py-3 rounded-xl flex items-center gap-2 shadow-sm hover:shadow-md transition-all duration-300 disabled:cursor-not-allowed disabled:opacity-70"
                            aria-busy={isDownloadBusy}
                            title="Download brochure PDF"
                        >
                            {isDownloadBusy ? (
                                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[#0a0e1a]/25 border-t-[#0a0e1a]" />
                            ) : (
                                <FaFilePdf />
                            )}
                            <span className="text-sm font-semibold">
                                {isDownloadBusy ? "Generating..." : "Download PDF"}
                            </span>
                        </button>

                        <button
                            type="button"
                            onClick={onPrintPdf}
                            disabled={isPdfBusy}
                            className="bg-[var(--voy-surface2)] text-[var(--voy-text)] px-4 py-3 rounded-xl flex items-center gap-2 shadow-sm hover:shadow-md transition-all duration-300 border border-[var(--voy-border)] disabled:cursor-not-allowed disabled:opacity-70"
                            aria-busy={isPrintBusy}
                            title="Print brochure PDF"
                        >
                            {isPrintBusy ? (
                                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--voy-text)]/25 border-t-[var(--voy-text)]" />
                            ) : (
                                <FaPrint />
                            )}
                            <span className="text-sm font-semibold">
                                {isPrintBusy ? "Preparing..." : "Print"}
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

                            {showShareOptions && (
                                <div id="voy-share-menu" className="voy-info-share-menu absolute top-full right-0 mt-2 rounded-xl p-3 z-10 min-w-[180px]">
                                    <div className="text-sm font-medium text-[var(--voy-text)] mb-2">Share this trip</div>
                                    <button 
                                        onClick={copyTripLink}
                                        className="w-full text-left py-2 px-3 rounded-lg hover:bg-[var(--voy-surface2)] text-[var(--voy-text-muted)] transition-colors"
                                    >
                                        Copy link
                                    </button>
                                </div>
                            )}
                        </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default InfoSection;
