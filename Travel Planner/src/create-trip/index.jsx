import React, { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { SelectBudgetOptions, SelectTravelsList } from "../constants/options";
import { toast } from "react-toastify";
import { AiOutlineLoading3Quarters } from "react-icons/ai";
import {
  CalendarRange,
  Compass,
  MapPinned,
  Route,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Timer,
  UtensilsCrossed,
  Users2,
  WalletCards,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader
} from "@/components/ui/dialog";
import { FcGoogle } from "react-icons/fc";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { apiFetch } from "@/lib/api";
import { readCreateTripPrefill } from "@/lib/tripPrefill";
import {
  getUserSelectionErrors,
  normalizeUserSelection,
} from "../../shared/trips.js";
import { getDestinationSuggestions } from "@/lib/destinationAutocomplete";

const INITIAL_FORM_STATE = {
  location: { label: "" },
  days: "",
  budget: "",
  travelers: "",
  objective: "best_experience",
  alternativesCount: 3,
  constraints: {
    dailyTimeLimitHours: 10,
    budgetCap: "",
    mobilityPref: "balanced",
    mealPrefs: "",
  },
};

const OBJECTIVE_OPTIONS = [
  {
    value: "fastest",
    label: "Fastest",
    description: "Minimize travel time between stops.",
    icon: <Timer size={14} />,
  },
  {
    value: "cheapest",
    label: "Cheapest",
    description: "Reduce transport and movement costs.",
    icon: <WalletCards size={14} />,
  },
  {
    value: "best_experience",
    label: "Best Experience",
    description: "Balance quality, pace, and route efficiency.",
    icon: <Sparkles size={14} />,
  },
];

function mapErrorsToFields(errors) {
  const next = {};

  for (const error of errors) {
    if (error.includes("Destination")) {
      next.location = error;
    } else if (error.includes("duration")) {
      next.days = error;
    } else if (error.includes("Budget")) {
      next.budget = error;
    } else if (error.includes("Traveler")) {
      next.travelers = error;
    } else if (error.includes("Objective")) {
      next.objective = error;
    } else if (error.includes("Daily time")) {
      next.dailyTimeLimitHours = error;
    } else if (error.includes("Budget cap")) {
      next.budgetCap = error;
    } else if (error.includes("Mobility")) {
      next.mobilityPref = error;
    } else if (error.includes("Meal")) {
      next.mealPrefs = error;
    } else if (error.includes("Alternatives")) {
      next.alternativesCount = error;
    }
  }

  return next;
}

function CreateTrip() {
  const [formData, setFormData] = useState(INITIAL_FORM_STATE);
  const [fieldErrors, setFieldErrors] = useState({});
  const [openDialog, setOpenDialog] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showDestinationSuggestions, setShowDestinationSuggestions] = useState(false);
  const [activeDestinationSuggestionIndex, setActiveDestinationSuggestionIndex] =
    useState(-1);
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signInWithGoogle } = useAuth();
  const destinationInputValue = formData.location?.label ?? "";
  const destinationSuggestions = useMemo(
    () => getDestinationSuggestions(destinationInputValue, { limit: 8 }),
    [destinationInputValue]
  );
  const destinationListId = "voy-create-destination-listbox";

  useEffect(() => {
    const prefill = readCreateTripPrefill(new URLSearchParams(location.search));
    if (!prefill) {
      return;
    }

    setFormData((previousData) => ({
      ...previousData,
      ...(prefill.location ? { location: prefill.location } : {}),
      ...(prefill.days ? { days: prefill.days } : {}),
      ...(prefill.budget ? { budget: prefill.budget } : {}),
      ...(prefill.travelers ? { travelers: prefill.travelers } : {}),
    }));
    setFieldErrors({});
    console.info("[create-trip] Applied query prefill", {
      destination: prefill.location?.label ?? "",
      days: prefill.days ?? null,
      budget: prefill.budget ?? "",
      travelers: prefill.travelers ?? "",
    });
  }, [location.search]);

  const handleInputChange = (name, value) => {
    setFormData((previousData) => ({
      ...previousData,
      [name]: value,
    }));
    setFieldErrors((previousErrors) => ({
      ...previousErrors,
      [name]: "",
    }));
  };

  const handleConstraintChange = (name, value) => {
    setFormData((previousData) => ({
      ...previousData,
      constraints: {
        ...(previousData.constraints ?? {}),
        [name]: value,
      },
    }));
    setFieldErrors((previousErrors) => ({
      ...previousErrors,
      [name]: "",
    }));
  };

  const validateSelection = () => {
    const normalizedSelection = normalizeUserSelection(formData);
    const errors = getUserSelectionErrors(normalizedSelection);

    if (errors.length > 0) {
      setFieldErrors(mapErrorsToFields(errors));
      toast.error(errors[0]);
      return null;
    }

    setFieldErrors({});
    return normalizedSelection;
  };

  const handleDestinationChange = (value) => {
    handleInputChange("location", { label: value });
    setShowDestinationSuggestions(Boolean(String(value).trim()));
    setActiveDestinationSuggestionIndex(-1);
  };

  const applyDestinationSuggestion = (suggestionLabel) => {
    handleInputChange("location", { label: suggestionLabel });
    setShowDestinationSuggestions(false);
    setActiveDestinationSuggestionIndex(-1);
    console.info("[create-trip] Destination suggestion selected", {
      destination: suggestionLabel,
    });
  };

  const handleDestinationKeyDown = (event) => {
    if (!destinationSuggestions.length) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setShowDestinationSuggestions(true);
      setActiveDestinationSuggestionIndex((previousIndex) =>
        previousIndex >= destinationSuggestions.length - 1 ? 0 : previousIndex + 1
      );
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setShowDestinationSuggestions(true);
      setActiveDestinationSuggestionIndex((previousIndex) =>
        previousIndex <= 0
          ? destinationSuggestions.length - 1
          : previousIndex - 1
      );
      return;
    }

    if (event.key === "Enter" && activeDestinationSuggestionIndex >= 0) {
      event.preventDefault();
      applyDestinationSuggestion(
        destinationSuggestions[activeDestinationSuggestionIndex].label
      );
      return;
    }

    if (event.key === "Escape") {
      setShowDestinationSuggestions(false);
      setActiveDestinationSuggestionIndex(-1);
    }
  };

  const submitTrip = async (selection, token) => {
    setLoading(true);

    try {
      console.info("[create-trip] Sending trip generation request", {
        destination: selection.location.label,
        days: selection.days,
      });

      const response = await apiFetch("/api/trips/generate", {
        method: "POST",
        body: {
          userSelection: selection,
        },
        token,
      });

      console.info("[create-trip] Trip created", {
        tripId: response.trip.id,
      });
      navigate(`/trips/${response.trip.id}`);
    } catch (error) {
      console.error("[create-trip] Failed to generate trip", {
        message: error?.message,
        status: error?.status ?? null,
        details: error?.details ?? null,
      });

      const message = error?.message ?? "Unable to generate a trip right now.";
      const hint = error?.details?.hint;
      const debug = error?.details?.debug;
      const status = error?.status ? `HTTP ${error.status}.` : "";
      const detailParts = [hint, debug].filter(Boolean);
      toast.error([status, message, ...detailParts].join(" "));
    } finally {
      setLoading(false);
    }
  };

  const onGenerateTrip = async () => {
    const normalizedSelection = validateSelection();
    if (!normalizedSelection) {
      return;
    }

    if (!user) {
      setOpenDialog(true);
      return;
    }

    await submitTrip(normalizedSelection);
  };

  const handleGoogleSignIn = async () => {
    try {
      const normalizedSelection = validateSelection();
      if (!normalizedSelection) {
        return;
      }

      const authenticatedUser = await signInWithGoogle();
      const token = await authenticatedUser.getIdToken();
      setOpenDialog(false);
      await submitTrip(normalizedSelection, token);
    } catch (error) {
      console.error("[create-trip] Failed to sign in", error);
      toast.error(error.message ?? "Unable to sign in.");
    }
  };

  return (
    <section className="voy-create-page">
      <div className="voy-page-shell">
        <div className="voy-create-card voy-create-card-main">
          <header className="voy-create-hero text-center">
            <span className="voy-create-eyebrow">
              <Sparkles size={14} />
              Guided trip generator
            </span>
            <h1 className="voy-page-title">Tell Us Your Travel Preferences</h1>
            <p className="voy-page-subtitle">
              Provide your essentials and we will generate an itinerary that fits your pace and
              budget.
            </p>
            <div className="voy-create-highlights" aria-label="Trip builder highlights">
              <span>
                <Compass size={14} />
                Personalized route
              </span>
              <span>
                <ShieldCheck size={14} />
                Saved to your account
              </span>
              <span>
                <Sparkles size={14} />
                AI itinerary in minutes
              </span>
            </div>
          </header>

          <div className="voy-create-grid mt-8">
            <div className="voy-create-row">
              <div className="voy-create-section">
                <div className="voy-create-section-head">
                  <div className="voy-create-section-icon">
                    <MapPinned size={18} />
                  </div>
                  <div>
                    <h3>Destination</h3>
                    <p>Choose the city, country, or landmark that anchors the trip.</p>
                  </div>
                </div>
              <label htmlFor="voy-create-destination" className="voy-sr-only">
                Destination
              </label>
                <div className="voy-create-autocomplete">
                  <div className="voy-create-field-shell">
                    <MapPinned size={16} className="voy-create-field-icon" />
                    <input
                      id="voy-create-destination"
                      type="text"
                      value={formData.location?.label ?? ""}
                      placeholder="Enter a city, country, or landmark"
                      className="voy-create-field"
                      aria-autocomplete="list"
                      aria-controls={destinationListId}
                      aria-expanded={
                        showDestinationSuggestions && destinationSuggestions.length > 0
                      }
                      aria-activedescendant={
                        activeDestinationSuggestionIndex >= 0
                          ? `${destinationListId}-${activeDestinationSuggestionIndex}`
                          : undefined
                      }
                      aria-invalid={Boolean(fieldErrors.location)}
                      autoComplete="off"
                      onFocus={() => {
                        if (destinationSuggestions.length > 0) {
                          setShowDestinationSuggestions(true);
                        }
                      }}
                      onBlur={() => {
                        window.setTimeout(() => {
                          setShowDestinationSuggestions(false);
                          setActiveDestinationSuggestionIndex(-1);
                        }, 100);
                      }}
                      onKeyDown={handleDestinationKeyDown}
                      onChange={(event) =>
                        handleDestinationChange(event.target.value)
                      }
                    />
                  </div>
                  {showDestinationSuggestions && destinationSuggestions.length > 0 ? (
                    <ul
                      id={destinationListId}
                      role="listbox"
                      className="voy-create-suggestion-list"
                      aria-label="Destination suggestions"
                    >
                      {destinationSuggestions.map((suggestion, index) => {
                        const isActive = index === activeDestinationSuggestionIndex;
                        return (
                          <li
                            id={`${destinationListId}-${index}`}
                            key={suggestion.label}
                            role="option"
                            aria-selected={isActive}
                            className="voy-create-suggestion-item-wrap"
                          >
                            <button
                              type="button"
                              className={`voy-create-suggestion-item ${
                                isActive ? "active" : ""
                              }`}
                              onMouseDown={(mouseEvent) => {
                                mouseEvent.preventDefault();
                                applyDestinationSuggestion(suggestion.label);
                              }}
                              onMouseEnter={() =>
                                setActiveDestinationSuggestionIndex(index)
                              }
                            >
                              <span className="voy-create-suggestion-primary">
                                {suggestion.name}
                              </span>
                              {suggestion.country ? (
                                <span className="voy-create-suggestion-secondary">
                                  {suggestion.country}
                                </span>
                              ) : null}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                </div>
                {fieldErrors.location ? (
                  <p className="voy-inline-error">{fieldErrors.location}</p>
                ) : null}
              </div>

              <div className="voy-create-section voy-create-section-compact">
                <div className="voy-create-section-head">
                  <div className="voy-create-section-icon">
                    <CalendarRange size={18} />
                  </div>
                  <div>
                    <h3>Number of Days</h3>
                    <p>Keep the range realistic so the itinerary feels balanced.</p>
                  </div>
                </div>
                <label htmlFor="voy-create-days" className="voy-sr-only">
                  Number of days
                </label>
                <div className="voy-create-field-shell">
                  <CalendarRange size={16} className="voy-create-field-icon" />
                  <input
                    id="voy-create-days"
                    placeholder="Ex. 4"
                    type="number"
                    className="voy-create-field"
                    min={1}
                    max={30}
                    value={formData.days ?? ""}
                    aria-invalid={Boolean(fieldErrors.days)}
                    onChange={(event) => handleInputChange("days", event.target.value)}
                  />
                </div>
                {fieldErrors.days ? <p className="voy-inline-error">{fieldErrors.days}</p> : null}
              </div>
            </div>

            <div className="voy-create-section">
              <div className="voy-create-section-head">
                <div className="voy-create-section-icon">
                  <WalletCards size={18} />
                </div>
                <div>
                  <h3>Budget</h3>
                  <p>Pick the spending style that matches the experience you want.</p>
                </div>
              </div>
              <div className="voy-create-choice-grid">
                {SelectBudgetOptions.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`voy-create-choice ${formData?.budget === item.title ? "active" : ""}`}
                    onClick={() => handleInputChange("budget", item.title)}
                    aria-pressed={formData?.budget === item.title}
                  >
                    <span className="voy-create-choice-icon" aria-hidden="true">
                      {item.icon}
                    </span>
                    <div className="voy-create-choice-copy">
                      <b>{item.title}</b>
                      <small>{item.desc}</small>
                    </div>
                    <span className="voy-create-choice-accent" aria-hidden="true" />
                  </button>
                ))}
              </div>
              {fieldErrors.budget ? <p className="voy-inline-error">{fieldErrors.budget}</p> : null}
            </div>

            <div className="voy-create-section">
              <div className="voy-create-section-head">
                <div className="voy-create-section-icon">
                  <Users2 size={18} />
                </div>
                <div>
                  <h3>Who are you traveling with?</h3>
                  <p>Traveler type affects pacing, activities, and recommendation style.</p>
                </div>
              </div>
              <div className="voy-create-choice-grid">
                {SelectTravelsList.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`voy-create-choice ${formData?.travelers === item.title ? "active" : ""}`}
                    onClick={() => handleInputChange("travelers", item.title)}
                    aria-pressed={formData?.travelers === item.title}
                  >
                    <span className="voy-create-choice-icon" aria-hidden="true">
                      {item.icon}
                    </span>
                    <div className="voy-create-choice-copy">
                      <b>{item.title}</b>
                      <small>{item.desc}</small>
                    </div>
                    <span className="voy-create-choice-meta">{item.people}</span>
                    <span className="voy-create-choice-accent" aria-hidden="true" />
                  </button>
                ))}
              </div>
              {fieldErrors.travelers ? (
                <p className="voy-inline-error">{fieldErrors.travelers}</p>
              ) : null}
            </div>

            <div className="voy-create-section">
              <div className="voy-create-section-head">
                <div className="voy-create-section-icon">
                  <Route size={18} />
                </div>
                <div>
                  <h3>Optimization Objective</h3>
                  <p>Choose how the itinerary should prioritize routing tradeoffs.</p>
                </div>
              </div>
              <div className="voy-create-choice-grid">
                {OBJECTIVE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={`voy-create-choice ${
                      formData?.objective === option.value ? "active" : ""
                    }`}
                    onClick={() => handleInputChange("objective", option.value)}
                    aria-pressed={formData?.objective === option.value}
                  >
                    <span className="voy-create-choice-icon" aria-hidden="true">
                      {option.icon}
                    </span>
                    <div className="voy-create-choice-copy">
                      <b>{option.label}</b>
                      <small>{option.description}</small>
                    </div>
                    <span className="voy-create-choice-accent" aria-hidden="true" />
                  </button>
                ))}
              </div>
              {fieldErrors.objective ? (
                <p className="voy-inline-error">{fieldErrors.objective}</p>
              ) : null}
            </div>

            <div className="voy-create-section">
              <div className="voy-create-section-head">
                <div className="voy-create-section-icon">
                  <SlidersHorizontal size={18} />
                </div>
                <div>
                  <h3>Constraint Controls</h3>
                  <p>Set hard limits for daily time, budget cap, and mobility preferences.</p>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label htmlFor="voy-create-daily-limit" className="block text-sm text-[var(--voy-text-muted)]">
                    Daily time limit (hours)
                  </label>
                  <div className="voy-create-field-shell mt-2">
                    <Timer size={16} className="voy-create-field-icon" />
                    <input
                      id="voy-create-daily-limit"
                      type="number"
                      min={4}
                      max={16}
                      className="voy-create-field"
                      value={formData?.constraints?.dailyTimeLimitHours ?? 10}
                      onChange={(event) =>
                        handleConstraintChange("dailyTimeLimitHours", event.target.value)
                      }
                    />
                  </div>
                  {fieldErrors.dailyTimeLimitHours ? (
                    <p className="voy-inline-error">{fieldErrors.dailyTimeLimitHours}</p>
                  ) : null}
                </div>

                <div>
                  <label htmlFor="voy-create-budget-cap" className="block text-sm text-[var(--voy-text-muted)]">
                    Budget cap (optional)
                  </label>
                  <div className="voy-create-field-shell mt-2">
                    <WalletCards size={16} className="voy-create-field-icon" />
                    <input
                      id="voy-create-budget-cap"
                      type="number"
                      min={50}
                      step={10}
                      className="voy-create-field"
                      placeholder="Ex. 1800"
                      value={formData?.constraints?.budgetCap ?? ""}
                      onChange={(event) =>
                        handleConstraintChange("budgetCap", event.target.value)
                      }
                    />
                  </div>
                  {fieldErrors.budgetCap ? (
                    <p className="voy-inline-error">{fieldErrors.budgetCap}</p>
                  ) : null}
                </div>

                <div>
                  <label htmlFor="voy-create-mobility-pref" className="block text-sm text-[var(--voy-text-muted)]">
                    Mobility preference
                  </label>
                  <select
                    id="voy-create-mobility-pref"
                    className="voy-create-field mt-2 w-full"
                    value={formData?.constraints?.mobilityPref ?? "balanced"}
                    onChange={(event) =>
                      handleConstraintChange("mobilityPref", event.target.value)
                    }
                  >
                    <option value="balanced">Balanced</option>
                    <option value="walk-heavy">Walk-heavy</option>
                    <option value="minimal-walking">Minimal walking</option>
                    <option value="transit-first">Transit-first</option>
                  </select>
                  {fieldErrors.mobilityPref ? (
                    <p className="voy-inline-error">{fieldErrors.mobilityPref}</p>
                  ) : null}
                </div>

                <div>
                  <label htmlFor="voy-create-alternative-count" className="block text-sm text-[var(--voy-text-muted)]">
                    Route alternatives (1-5)
                  </label>
                  <div className="voy-create-field-shell mt-2">
                    <Compass size={16} className="voy-create-field-icon" />
                    <input
                      id="voy-create-alternative-count"
                      type="number"
                      min={1}
                      max={5}
                      className="voy-create-field"
                      value={formData?.alternativesCount ?? 3}
                      onChange={(event) =>
                        handleInputChange("alternativesCount", event.target.value)
                      }
                    />
                  </div>
                  {fieldErrors.alternativesCount ? (
                    <p className="voy-inline-error">{fieldErrors.alternativesCount}</p>
                  ) : null}
                </div>
              </div>

              <div className="mt-4">
                <label htmlFor="voy-create-meal-prefs" className="block text-sm text-[var(--voy-text-muted)]">
                  Meal preferences (comma separated)
                </label>
                <div className="voy-create-field-shell mt-2">
                  <UtensilsCrossed size={16} className="voy-create-field-icon" />
                  <input
                    id="voy-create-meal-prefs"
                    className="voy-create-field"
                    placeholder="Ex. Vegetarian, Seafood"
                    value={formData?.constraints?.mealPrefs ?? ""}
                    onChange={(event) =>
                      handleConstraintChange("mealPrefs", event.target.value)
                    }
                  />
                </div>
                {fieldErrors.mealPrefs ? (
                  <p className="voy-inline-error">{fieldErrors.mealPrefs}</p>
                ) : null}
              </div>
            </div>

            <div className="voy-create-actions">
              <Button
                disabled={loading}
                onClick={onGenerateTrip}
                className="voy-create-primary"
                aria-busy={loading}
              >
                {loading ? (
                  <AiOutlineLoading3Quarters className="h-6 w-6 animate-spin" />
                ) : (
                  "Generate My Trip"
                )}
              </Button>
            </div>
            <div className="voy-create-footnote text-center">
              <p className="voy-create-note">
                We protect your generated itineraries and keep them tied to your account.
              </p>
              <div className="voy-create-trust">
                <span>
                  <ShieldCheck size={14} />
                  Secure trip ownership
                </span>
                <span>
                  <Sparkles size={14} />
                  Tailored itinerary response
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Dialog open={openDialog} onOpenChange={setOpenDialog}>
        <DialogContent className="voy-create-card max-w-sm w-full text-center">
          <DialogHeader>
            <h2 className="voy-page-title text-[1.5rem]">Sign In With Google</h2>
          </DialogHeader>
          <DialogDescription className="voy-page-subtitle">
            Sign in to securely generate and save your trip itinerary.
          </DialogDescription>
          <Button
            onClick={handleGoogleSignIn}
            variant="outline"
            disabled={loading}
            className="voy-create-primary w-full mt-2"
          >
            <FcGoogle className="h-6 w-6" /> Continue with Google
          </Button>
        </DialogContent>
      </Dialog>
    </section>
  );
}

export default CreateTrip;
