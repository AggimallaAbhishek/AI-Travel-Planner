import React, { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "react-toastify";
import SectionHeader from "./SectionHeader";
import {
  formatVoyagrCurrency,
  persistVoyagrCurrencyPreference,
  readVoyagrCurrencyPreference,
  VOYAGR_CURRENCY_OPTIONS,
} from "@/lib/voyagrCurrency";

const INTERESTS = [
  { id: "adventure", label: "🧗 Adventure" },
  { id: "culture", label: "🏛️ Culture & History" },
  { id: "food", label: "🍜 Food & Dining" },
  { id: "nature", label: "🌿 Nature & Wildlife" },
  { id: "beach", label: "🏖️ Beaches & Water" },
  { id: "nightlife", label: "🎶 Nightlife" },
  { id: "shopping", label: "🛍️ Shopping" },
  { id: "wellness", label: "🧘 Wellness & Spa" },
  { id: "photography", label: "📷 Photography" },
];

const ITINERARY_ACTIVITY_LIBRARY = {
  adventure: ["Mountain trail trek", "Cliff viewpoint walk", "Kayak session"],
  culture: ["Historic district tour", "Museum visit", "Local heritage walk"],
  food: ["Street food crawl", "Local tasting menu", "Cafe hopping"],
  nature: ["National park loop", "Sunrise nature trail", "Scenic valley visit"],
  beach: ["Beach sunrise", "Coastal relaxation", "Boat ride"],
  nightlife: ["Live music venue", "Evening rooftop stop", "Night market"],
  shopping: ["Local artisan market", "Main shopping boulevard", "Souvenir walk"],
  wellness: ["Morning yoga class", "Spa recovery", "Wellness session"],
  photography: ["Golden-hour photo walk", "City skyline spot", "Portrait session"],
};

function formatCurrency(amount, currencyCode) {
  return formatVoyagrCurrency(amount, currencyCode);
}

function buildPreviewDays(formState) {
  const dayCount = Math.min(Math.max(Number.parseInt(formState.tripDays, 10) || 3, 1), 14);
  const selected = formState.interests.length > 0 ? formState.interests : ["culture", "food"];

  return Array.from({ length: dayCount }, (_, index) => {
    const interest = selected[index % selected.length];
    const library = ITINERARY_ACTIVITY_LIBRARY[interest] ?? ITINERARY_ACTIVITY_LIBRARY.culture;

    return {
      id: `day-${index + 1}`,
      title: `Day ${index + 1}`,
      items: [
        { time: "08:30", text: `${library[0]} in ${formState.destination}` },
        { time: "12:30", text: library[1] },
        { time: "17:30", text: library[2] },
      ],
    };
  });
}

function budgetLabel(amount) {
  if (amount <= 1500) {
    return "Cheap";
  }

  if (amount <= 5000) {
    return "Moderate";
  }

  return "Luxury";
}

export default function PlannerSection({ onOpenTripCreator }) {
  const [currentStep, setCurrentStep] = useState(1);
  const [isGenerating, setIsGenerating] = useState(false);
  const [previewDays, setPreviewDays] = useState([]);
  const itineraryTimerRef = useRef(null);
  const [formState, setFormState] = useState(() => ({
    destination: "",
    tripType: "Solo Adventure",
    travelers: "2",
    fromDate: "",
    toDate: "",
    tripDays: 5,
    budgetAmount: 2500,
    accommodation: "Mid-range (3★ Hotel)",
    currency: readVoyagrCurrencyPreference(),
    interests: [],
    pace: "Moderate (4-5 activities/day)",
    notes: "",
  }));

  useEffect(() => {
    return () => {
      if (itineraryTimerRef.current) {
        window.clearTimeout(itineraryTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (currentStep !== 4) {
      return;
    }

    setIsGenerating(true);
    itineraryTimerRef.current = window.setTimeout(() => {
      const generated = buildPreviewDays({
        ...formState,
        destination: formState.destination || "your destination",
      });
      setPreviewDays(generated);
      setIsGenerating(false);
      console.info("[voyagr-planner] Generated itinerary preview", {
        days: generated.length,
        destination: formState.destination,
      });
    }, 700);

    return () => {
      if (itineraryTimerRef.current) {
        window.clearTimeout(itineraryTimerRef.current);
      }
    };
  }, [currentStep, formState]);

  const stepLabel = useMemo(
    () => `Step ${currentStep} of 4`,
    [currentStep]
  );
  const progressPercent = useMemo(() => (currentStep / 4) * 100, [currentStep]);

  const toggleInterest = (interestId) => {
    setFormState((previous) => {
      const exists = previous.interests.includes(interestId);
      const interests = exists
        ? previous.interests.filter((interest) => interest !== interestId)
        : [...previous.interests, interestId];

      return {
        ...previous,
        interests,
      };
    });
  };

  const handleCurrencyChange = (event) => {
    const normalizedCurrencyCode = persistVoyagrCurrencyPreference(event.target.value);
    console.info("[voyagr-planner] currency changed", {
      currencyCode: normalizedCurrencyCode,
    });
    setFormState((previous) => ({
      ...previous,
      currency: normalizedCurrencyCode,
    }));
  };

  const goNext = () => {
    if (currentStep === 1 && !formState.destination.trim()) {
      toast.error("Please add a destination to continue.");
      return;
    }

    if (currentStep === 4) {
      handleOpenTripCreator();
      return;
    }

    setCurrentStep((previous) => Math.min(previous + 1, 4));
  };

  const goPrevious = () => {
    setCurrentStep((previous) => Math.max(previous - 1, 1));
  };

  const handleOpenTripCreator = () => {
    const payload = {
      destination: formState.destination,
      days: formState.tripDays,
      budget: budgetLabel(formState.budgetAmount),
      travelers: formState.travelers,
      fromDate: formState.fromDate,
      toDate: formState.toDate,
    };

    console.info("[voyagr-planner] Opening create-trip with prefill", payload);
    onOpenTripCreator(payload);
  };

  return (
    <section id="planner" className="voy-section voy-planner">
      <SectionHeader
        eyebrow="Plan"
        title="Build Your"
        highlight="Dream Trip"
        subtitle="Capture preferences in a guided flow, then continue in the full trip generator."
      />

      <div className="voy-planner-wrap voy-reveal">
        <div className="voy-planner-progress">
          {[1, 2, 3, 4].map((step) => (
            <button
              key={step}
              type="button"
              className={`voy-planner-step ${
                currentStep === step ? "active" : currentStep > step ? "done" : ""
              }`}
              onClick={() => setCurrentStep((previous) => (step <= previous + 1 ? step : previous))}
              aria-current={currentStep === step ? "step" : undefined}
              aria-label={`Go to step ${step}`}
            >
              <span className="voy-step-number">{step}</span>
              <span className="voy-step-label">
                {step === 1 && "Destination"}
                {step === 2 && "Dates & Budget"}
                {step === 3 && "Preferences"}
                {step === 4 && "Itinerary"}
              </span>
            </button>
          ))}
        </div>
        <div className="voy-planner-progress-bar" aria-hidden="true">
          <span style={{ width: `${progressPercent}%` }} />
        </div>

        <div className="voy-planner-panels">
          <div className={`voy-planner-panel ${currentStep === 1 ? "active" : ""}`}>
            <h3>Where are you headed?</h3>
            <p>Define destination and party size to scope recommendations.</p>
            <div className="voy-form-grid">
              <label className="voy-form-field full">
                <span>Destination</span>
                <input
                  value={formState.destination}
                  onChange={(event) =>
                    setFormState((previous) => ({
                      ...previous,
                      destination: event.target.value,
                    }))
                  }
                  placeholder="e.g. Kyoto, Japan"
                />
              </label>
              <label className="voy-form-field">
                <span>Trip Type</span>
                <select
                  value={formState.tripType}
                  onChange={(event) =>
                    setFormState((previous) => ({
                      ...previous,
                      tripType: event.target.value,
                    }))
                  }
                >
                  <option>Solo Adventure</option>
                  <option>Romantic Getaway</option>
                  <option>Family Vacation</option>
                  <option>Friends Trip</option>
                  <option>Business + Leisure</option>
                </select>
              </label>
              <label className="voy-form-field">
                <span>Travelers</span>
                <select
                  value={formState.travelers}
                  onChange={(event) =>
                    setFormState((previous) => ({
                      ...previous,
                      travelers: event.target.value,
                    }))
                  }
                >
                  <option value="1">1</option>
                  <option value="2">2</option>
                  <option value="3-5">3-5</option>
                  <option value="6+">6+</option>
                </select>
              </label>
            </div>
          </div>

          <div className={`voy-planner-panel ${currentStep === 2 ? "active" : ""}`}>
            <h3>When and how much?</h3>
            <p>Set your dates, duration and budget target.</p>
            <div className="voy-form-grid">
              <label className="voy-form-field">
                <span>Departure</span>
                <input
                  type="date"
                  value={formState.fromDate}
                  onChange={(event) =>
                    setFormState((previous) => ({
                      ...previous,
                      fromDate: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="voy-form-field">
                <span>Return</span>
                <input
                  type="date"
                  value={formState.toDate}
                  onChange={(event) =>
                    setFormState((previous) => ({
                      ...previous,
                      toDate: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="voy-form-field">
                <span>Trip Days</span>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={formState.tripDays}
                  onChange={(event) =>
                    setFormState((previous) => ({
                      ...previous,
                      tripDays: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="voy-form-field">
                <span>Accommodation</span>
                <select
                  value={formState.accommodation}
                  onChange={(event) =>
                    setFormState((previous) => ({
                      ...previous,
                      accommodation: event.target.value,
                    }))
                  }
                >
                  <option>Budget (Hostel / Guesthouse)</option>
                  <option>Mid-range (3★ Hotel)</option>
                  <option>Comfort (4★ Hotel)</option>
                  <option>Luxury (5★ / Resort)</option>
                </select>
              </label>
              <label className="voy-form-field full">
                <span>
                  Budget per Person ({budgetLabel(formState.budgetAmount)})
                </span>
                <input
                  type="range"
                  min={500}
                  max={15000}
                  step={250}
                  value={formState.budgetAmount}
                  onChange={(event) =>
                    setFormState((previous) => ({
                      ...previous,
                      budgetAmount: Number(event.target.value),
                    }))
                  }
                />
                <strong>{formatCurrency(formState.budgetAmount, formState.currency)}</strong>
              </label>
            </div>
          </div>

          <div className={`voy-planner-panel ${currentStep === 3 ? "active" : ""}`}>
            <h3>What is your travel vibe?</h3>
            <p>
              Select one or more interests for itinerary balancing.
              {` `}
              <strong>{formState.interests.length}</strong> selected.
            </p>
            <div className="voy-pref-chips">
              {INTERESTS.map((interest) => (
                <button
                  key={interest.id}
                  type="button"
                  className={`voy-pref-chip ${
                    formState.interests.includes(interest.id) ? "selected" : ""
                  }`}
                  onClick={() => toggleInterest(interest.id)}
                  aria-pressed={formState.interests.includes(interest.id)}
                >
                  {interest.label}
                </button>
              ))}
            </div>
            <div className="voy-form-grid">
              <label className="voy-form-field">
                <span>Pace</span>
                <select
                  value={formState.pace}
                  onChange={(event) =>
                    setFormState((previous) => ({
                      ...previous,
                      pace: event.target.value,
                    }))
                  }
                >
                  <option>Leisurely (2-3 activities/day)</option>
                  <option>Moderate (4-5 activities/day)</option>
                  <option>Packed (6+ activities/day)</option>
                </select>
              </label>
              <label className="voy-form-field">
                <span>Currency</span>
                <select
                  value={formState.currency}
                  onChange={handleCurrencyChange}
                >
                  {VOYAGR_CURRENCY_OPTIONS.map((currency) => (
                    <option key={currency.value} value={currency.value}>
                      {currency.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="voy-form-field full">
                <span>Special Notes</span>
                <textarea
                  value={formState.notes}
                  onChange={(event) =>
                    setFormState((previous) => ({
                      ...previous,
                      notes: event.target.value,
                    }))
                  }
                  placeholder="e.g. vegetarian meals, accessible transit"
                  rows={3}
                />
              </label>
            </div>
          </div>

          <div className={`voy-planner-panel ${currentStep === 4 ? "active" : ""}`}>
            <h3>Your itinerary preview</h3>
            <p>
              This is a draft preview. Continue to the full planner to generate and
              save the final itinerary.
            </p>
            <div className="voy-itinerary-output" aria-live="polite">
              {isGenerating ? (
                <div className="voy-itinerary-loading">
                  <span className="voy-dot-loader" />
                  <span>Crafting itinerary...</span>
                </div>
              ) : (
                previewDays.map((day) => (
                  <article key={day.id} className="voy-itinerary-day">
                    <h4>{day.title}</h4>
                    {day.items.map((item, index) => (
                      <div key={`${day.id}-${item.time}-${index}`} className="voy-itinerary-item">
                        <span>{item.time}</span>
                        <p>{item.text}</p>
                      </div>
                    ))}
                  </article>
                ))
              )}
            </div>
            <div className="voy-itinerary-actions">
              <button type="button" className="primary" onClick={handleOpenTripCreator}>
                Open Full Trip Planner
              </button>
              <button type="button" onClick={() => setCurrentStep(3)}>
                Edit Preferences
              </button>
            </div>
          </div>
        </div>

        <div className="voy-planner-nav">
          <button
            type="button"
            className="voy-btn-prev"
            onClick={goPrevious}
            style={{ visibility: currentStep === 1 ? "hidden" : "visible" }}
          >
            Back
          </button>
          <span>{stepLabel}</span>
          <button type="button" className="voy-btn-next" onClick={goNext}>
            {currentStep === 4 ? "Open Planner" : "Continue"}
          </button>
        </div>
      </div>
    </section>
  );
}
