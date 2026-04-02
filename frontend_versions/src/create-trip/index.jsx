import React, { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { SelectTravelsList } from "../constants/options";
import { toast } from "react-toastify";
import { AiOutlineLoading3Quarters } from "react-icons/ai";
import {
  CalendarRange,
  ChevronDown,
  ChevronUp,
  Compass,
  DollarSign,
  Info,
  MapPinned,
  ShieldCheck,
  Sparkles,
  Users2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
} from "@/components/ui/dialog";
import { FcGoogle } from "react-icons/fc";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { apiFetch } from "@/lib/api";
import { getDestinationSuggestions } from "@/lib/destinationAutocomplete";
import { fetchPlacesAutocomplete } from "@/lib/placesAutocomplete";
import { readCreateTripPrefill } from "@/lib/tripPrefill";
import {
  formatBudgetAmount,
  formatBudgetSummary,
  getUserSelectionErrors,
  normalizeUserSelection,
} from "../../shared/trips.js";
import {
  buildAiSuggestionChips,
  buildSelectionTags,
  buildSmartValidationWarnings,
  BUDGET_MAX,
  BUDGET_MIN,
  BUDGET_STEP,
  getBriefCompletionStatus,
  getBudgetBreakdownDetails,
  getRecommendedBudgetRange,
  getRecommendedPlanType,
} from "./intelligence.js";
import {
  FOOD_PREFERENCE_OPTIONS,
  PACE_OPTIONS,
  PLAN_TYPE_OPTIONS,
  TRAVEL_STYLE_OPTIONS,
} from "./config.js";

const INITIAL_FORM_STATE = {
  location: {
    label: "",
    placeId: "",
    source: "",
    primaryText: "",
    secondaryText: "",
  },
  days: "",
  travelers: "",
  planType: "",
  budgetAmount: 2400,
  foodPreferences: [],
  travelStyle: "",
  pace: "Balanced",
  accommodation: "",
  logistics: "",
};

const INITIAL_STATE = {
  form: INITIAL_FORM_STATE,
  fieldErrors: {},
  manualPlanType: false,
};

const DESTINATION_DEBOUNCE_MS = 300;

function createManualLocation(label) {
  return {
    label,
    placeId: "",
    source: "manual",
    primaryText: label,
    secondaryText: "",
  };
}

function mapErrorsToFields(errors) {
  const next = {};

  for (const error of errors) {
    if (error.includes("Destination")) {
      next.location = error;
    } else if (error.includes("duration")) {
      next.days = error;
    } else if (error.includes("Budget")) {
      next.budgetAmount = error;
    } else if (error.includes("Traveler")) {
      next.travelers = error;
    } else if (error.includes("Plan type")) {
      next.planType = error;
    } else if (error.includes("Travel style")) {
      next.travelStyle = error;
    } else if (error.includes("Time preference")) {
      next.pace = error;
    } else if (error.includes("food")) {
      next.foodPreferences = error;
    }
  }

  return next;
}

function createHydratedForm(prefill = {}) {
  return {
    ...INITIAL_FORM_STATE,
    ...(prefill.location ? { location: prefill.location } : {}),
    ...(prefill.days ? { days: String(prefill.days) } : {}),
    ...(prefill.travelers ? { travelers: prefill.travelers } : {}),
    ...(prefill.planType ? { planType: prefill.planType } : {}),
    ...(prefill.budgetAmount ? { budgetAmount: prefill.budgetAmount } : {}),
    ...(prefill.travelStyle ? { travelStyle: prefill.travelStyle } : {}),
    ...(prefill.pace ? { pace: prefill.pace } : {}),
    ...(prefill.accommodation ? { accommodation: prefill.accommodation } : {}),
    ...(prefill.logistics ? { logistics: prefill.logistics } : {}),
    ...(Array.isArray(prefill.foodPreferences)
      ? { foodPreferences: prefill.foodPreferences }
      : {}),
  };
}

function formReducer(state, action) {
  switch (action.type) {
    case "hydrate_from_query":
      return {
        ...state,
        form: createHydratedForm(action.value),
        manualPlanType: Boolean(action.value?.planType),
      };
    case "set_destination_input":
      return {
        ...state,
        form: {
          ...state.form,
          location: createManualLocation(action.value),
        },
        fieldErrors: {
          ...state.fieldErrors,
          location: "",
        },
      };
    case "apply_destination_suggestion":
      return {
        ...state,
        form: {
          ...state.form,
          location: {
            label: action.value.label,
            placeId: action.value.placeId ?? "",
            source: action.value.source ?? "manual",
            primaryText: action.value.primaryText ?? action.value.label,
            secondaryText: action.value.secondaryText ?? "",
          },
        },
        fieldErrors: {
          ...state.fieldErrors,
          location: "",
        },
      };
    case "set_days":
      return {
        ...state,
        form: {
          ...state.form,
          days: action.value,
        },
        fieldErrors: {
          ...state.fieldErrors,
          days: "",
        },
      };
    case "set_travelers":
      return {
        ...state,
        form: {
          ...state.form,
          travelers: action.value,
        },
        fieldErrors: {
          ...state.fieldErrors,
          travelers: "",
        },
      };
    case "set_plan_type":
      return {
        ...state,
        manualPlanType: true,
        form: {
          ...state.form,
          planType: action.value,
        },
        fieldErrors: {
          ...state.fieldErrors,
          planType: "",
        },
      };
    case "set_budget":
      return {
        ...state,
        form: {
          ...state.form,
          budgetAmount: action.value,
        },
        fieldErrors: {
          ...state.fieldErrors,
          budgetAmount: "",
        },
      };
    case "toggle_food_preference": {
      const nextFoodPreferences = state.form.foodPreferences.includes(action.value)
        ? state.form.foodPreferences.filter((item) => item !== action.value)
        : action.value === "Mixed"
          ? ["Mixed"]
          : [
              ...state.form.foodPreferences.filter((item) => item !== "Mixed"),
              action.value,
            ];

      return {
        ...state,
        form: {
          ...state.form,
          foodPreferences: nextFoodPreferences,
        },
        fieldErrors: {
          ...state.fieldErrors,
          foodPreferences: "",
        },
      };
    }
    case "set_travel_style":
      return {
        ...state,
        form: {
          ...state.form,
          travelStyle: action.value,
        },
        fieldErrors: {
          ...state.fieldErrors,
          travelStyle: "",
        },
      };
    case "set_pace":
      return {
        ...state,
        form: {
          ...state.form,
          pace: action.value,
        },
        fieldErrors: {
          ...state.fieldErrors,
          pace: "",
        },
      };
    case "set_manual_override":
      return {
        ...state,
        manualPlanType: Boolean(action.value),
      };
    case "set_accommodation":
      return {
        ...state,
        form: {
          ...state.form,
          accommodation: action.value,
        },
        fieldErrors: {
          ...state.fieldErrors,
          accommodation: "",
        },
      };
    case "set_logistics":
      return {
        ...state,
        form: {
          ...state.form,
          logistics: action.value,
        },
        fieldErrors: {
          ...state.fieldErrors,
          logistics: "",
        },
      };
    case "set_field_errors":
      return {
        ...state,
        fieldErrors: action.value ?? {},
      };
    default:
      return state;
  }
}

function ChoiceCard({ item, active, onClick, meta, compact = false }) {
  return (
    <button
      type="button"
      className={`voy-create-choice voy-create-smart-choice ${
        compact ? "voy-create-smart-choice-compact" : ""
      } ${active ? "active" : ""}`}
      onClick={onClick}
      aria-pressed={active}
    >
      <span className="voy-create-choice-icon" aria-hidden="true">
        {item.icon}
      </span>
      <div className="voy-create-choice-copy">
        <b>{item.title}</b>
        <small>{item.description ?? item.desc}</small>
      </div>
      {meta ? <span className="voy-create-choice-meta">{meta}</span> : null}
      <span className="voy-create-choice-accent" aria-hidden="true" />
    </button>
  );
}

function FoodTag({ item, active, onClick }) {
  return (
    <button
      type="button"
      className={`voy-create-tag ${active ? "active" : ""}`}
      onClick={onClick}
      aria-pressed={active}
      title={item.description}
    >
      <span aria-hidden="true">{item.icon}</span>
      <span>{item.title}</span>
    </button>
  );
}

function PaceButton({ item, active, onClick }) {
  return (
    <button
      type="button"
      className={`voy-create-segment ${active ? "active" : ""}`}
      onClick={onClick}
      aria-pressed={active}
      title={item.description}
    >
      <span aria-hidden="true">{item.icon}</span>
      <div>
        <strong>{item.title}</strong>
        <small>{item.description}</small>
      </div>
    </button>
  );
}

function CompactOptionButton({ item, active, onClick, meta = "", className = "" }) {
  return (
    <button
      type="button"
      className={`voy-create-compact-option ${active ? "active" : ""} ${className}`}
      onClick={onClick}
      aria-pressed={active}
      title={item.description}
    >
      <span className="voy-create-compact-option-icon" aria-hidden="true">
        {item.icon}
      </span>
      <span className="voy-create-compact-option-label">{item.title}</span>
      {meta ? <span className="voy-create-compact-option-meta">{meta}</span> : null}
      <span
        className="voy-create-compact-option-hint"
        aria-hidden="true"
        title={item.description}
      >
        <Info size={12} />
      </span>
    </button>
  );
}

function CreateTrip() {
  const [state, dispatch] = useReducer(formReducer, INITIAL_STATE);
  const [openDialog, setOpenDialog] = useState(false);
  const [loading, setLoading] = useState(false);
  const [autocompleteLoading, setAutocompleteLoading] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(max-width: 767px)").matches
      : false
  );
  const [collapsedSidebarBlocks, setCollapsedSidebarBlocks] = useState(() => {
    const startsCollapsed =
      typeof window !== "undefined"
        ? window.matchMedia("(max-width: 767px)").matches
        : false;

    return {
      validation: startsCollapsed,
      suggestions: startsCollapsed,
    };
  });
  const [showDestinationSuggestions, setShowDestinationSuggestions] = useState(false);
  const [destinationSuggestions, setDestinationSuggestions] = useState([]);
  const [activeDestinationSuggestionIndex, setActiveDestinationSuggestionIndex] =
    useState(-1);
  const hasAppliedPrefillRef = useRef(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { user, role, isAdmin, capabilities, signInWithGoogle } = useAuth();

  const destinationInputValue = state.form.location?.label ?? "";
  const safeIntelligenceInput = useMemo(
    () => ({
      ...state.form,
      days: state.form.days || 4,
    }),
    [state.form]
  );
  const recommendedPlanType = useMemo(
    () => getRecommendedPlanType(safeIntelligenceInput),
    [safeIntelligenceInput]
  );
  const selectedPlanType = state.manualPlanType
    ? state.form.planType || recommendedPlanType
    : recommendedPlanType;
  const submissionPreview = useMemo(
    () =>
      normalizeUserSelection({
        ...state.form,
        planType: selectedPlanType,
      }),
    [selectedPlanType, state.form]
  );
  const budgetBreakdown = useMemo(
    () => getBudgetBreakdownDetails(submissionPreview),
    [submissionPreview]
  );
  const briefCompletionStatus = useMemo(
    () =>
      getBriefCompletionStatus({
        ...submissionPreview,
        planType: selectedPlanType,
      }),
    [selectedPlanType, submissionPreview]
  );
  const recommendedBudgetRange = useMemo(
    () => getRecommendedBudgetRange(safeIntelligenceInput),
    [safeIntelligenceInput]
  );
  const smartWarnings = useMemo(
    () => buildSmartValidationWarnings({ ...state.form, planType: selectedPlanType }),
    [selectedPlanType, state.form]
  );
  const aiSuggestionChips = useMemo(
    () => buildAiSuggestionChips({ ...state.form, planType: selectedPlanType }),
    [selectedPlanType, state.form]
  );
  const selectionTags = useMemo(
    () => buildSelectionTags({ ...state.form, planType: selectedPlanType }),
    [selectedPlanType, state.form]
  );
  const visibleDestinationSuggestions = useMemo(
    () => destinationSuggestions,
    [destinationSuggestions]
  );
  const destinationListId = "voy-create-destination-listbox";

  useEffect(() => {
    if (typeof window === "undefined") {
      return undefined;
    }

    const mediaQuery = window.matchMedia("(max-width: 767px)");

    const applyViewportState = (matches) => {
      setIsMobileViewport((previousValue) => {
        if (previousValue === matches) {
          return previousValue;
        }

        setCollapsedSidebarBlocks({
          validation: matches,
          suggestions: matches,
        });
        return matches;
      });
    };

    applyViewportState(mediaQuery.matches);

    const onChange = (event) => {
      applyViewportState(event.matches);
    };

    mediaQuery.addEventListener("change", onChange);
    return () => mediaQuery.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (hasAppliedPrefillRef.current) {
      return;
    }

    const prefill = readCreateTripPrefill(location.search);
    if (!prefill) {
      hasAppliedPrefillRef.current = true;
      return;
    }

    dispatch({ type: "hydrate_from_query", value: prefill });
    hasAppliedPrefillRef.current = true;

    console.info("[create-trip] Applied URL prefill values", {
      destination: prefill.location?.label ?? "",
      days: prefill.days ?? null,
      budgetAmount: prefill.budgetAmount ?? null,
      planType: prefill.planType ?? "",
      travelers: prefill.travelers ?? "",
      travelStyle: prefill.travelStyle ?? "",
      pace: prefill.pace ?? "",
    });
  }, [location.search]);

  useEffect(() => {
    const query = destinationInputValue.trim();

    if (!query) {
      setDestinationSuggestions([]);
      setAutocompleteLoading(false);
      return undefined;
    }

    if (query.length < 2) {
      setDestinationSuggestions(getDestinationSuggestions(query, { limit: 8 }));
      setAutocompleteLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setAutocompleteLoading(true);

      try {
        const suggestions = await fetchPlacesAutocomplete(query, {
          signal: controller.signal,
        });
        setDestinationSuggestions(suggestions);
      } catch (error) {
        if (error?.name !== "AbortError") {
          console.error("[create-trip] Destination autocomplete failed", {
            query,
            message: error?.message ?? String(error),
          });
        }
      } finally {
        setAutocompleteLoading(false);
      }
    }, DESTINATION_DEBOUNCE_MS);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [destinationInputValue]);

  const handleBudgetChange = (value) => {
    const numericValue = Number.parseInt(value, 10);
    if (!Number.isFinite(numericValue)) {
      return;
    }

    dispatch({ type: "set_budget", value: numericValue });
    if (!state.manualPlanType) {
      console.info("[create-trip] Auto-suggesting plan type from budget", {
        budgetAmount: numericValue,
        days: state.form.days || 4,
      });
    }
  };

  const applyDestinationSuggestion = (suggestion) => {
    dispatch({ type: "apply_destination_suggestion", value: suggestion });
    setShowDestinationSuggestions(false);
    setActiveDestinationSuggestionIndex(-1);
    console.info("[create-trip] Destination suggestion selected", {
      destination: suggestion.label,
      source: suggestion.source,
    });
  };

  const handleDestinationKeyDown = (event) => {
    if (!visibleDestinationSuggestions.length) {
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setShowDestinationSuggestions(true);
      setActiveDestinationSuggestionIndex((previousIndex) =>
        previousIndex >= visibleDestinationSuggestions.length - 1 ? 0 : previousIndex + 1
      );
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setShowDestinationSuggestions(true);
      setActiveDestinationSuggestionIndex((previousIndex) =>
        previousIndex <= 0
          ? visibleDestinationSuggestions.length - 1
          : previousIndex - 1
      );
      return;
    }

    if (event.key === "Enter" && activeDestinationSuggestionIndex >= 0) {
      event.preventDefault();
      applyDestinationSuggestion(
        visibleDestinationSuggestions[activeDestinationSuggestionIndex]
      );
      return;
    }

    if (event.key === "Escape") {
      setShowDestinationSuggestions(false);
      setActiveDestinationSuggestionIndex(-1);
    }
  };

  const toggleSidebarBlock = (key) => {
    setCollapsedSidebarBlocks((previousState) => ({
      ...previousState,
      [key]: !previousState[key],
    }));
  };

  const buildSubmissionPayload = () => {
    const normalizedSelection = normalizeUserSelection({
      ...state.form,
      planType: selectedPlanType,
    });
    const errors = getUserSelectionErrors(normalizedSelection);

    if (errors.length > 0) {
      const fieldErrors = mapErrorsToFields(errors);
      dispatch({ type: "set_field_errors", value: fieldErrors });
      toast.error(errors[0]);
      return null;
    }

    dispatch({ type: "set_field_errors", value: {} });

    const payload = {
      ...normalizedSelection,
      destination: normalizedSelection.location.label,
      plan_type: normalizedSelection.planType,
      travel_style: normalizedSelection.travelStyle,
      food_preference: normalizedSelection.foodPreferences,
      pace: normalizedSelection.pace,
      budget: normalizedSelection.budgetAmount,
      accommodation: normalizedSelection.accommodation,
      logistics: normalizedSelection.logistics,
    };

    console.info("[create-trip] Final normalized submit payload", payload);
    return payload;
  };

  const submitTrip = async (selection, token) => {
    setLoading(true);

    try {
      console.info("[create-trip] Sending trip generation request", {
        destination: selection.location.label,
        days: selection.days,
        planType: selection.planType,
        budgetAmount: selection.budgetAmount,
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

      if (error?.status === 401 && error?.details?.requiresReauth !== false) {
        // Redundant modal trigger and error toast removed.
        // The api client now globally signals the SessionExpiredModal.
        return;
      }

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
    const payload = buildSubmissionPayload();
    if (!payload) {
      return;
    }

    if (!user) {
      setOpenDialog(true);
      return;
    }

    await submitTrip(payload);
  };

  const handleGoogleSignIn = async () => {
    try {
      const payload = buildSubmissionPayload();
      if (!payload) {
        return;
      }

      const authenticatedUser = await signInWithGoogle();
      const token = await authenticatedUser.getIdToken();
      setOpenDialog(false);
      await submitTrip(payload, token);
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
              Smart itinerary brief
            </span>
            <h1 className="voy-page-title">Tell Us Your Travel Preferences</h1>
            <p className="voy-page-subtitle">
              Shape the itinerary with destination precision, budget intent, food needs,
              and travel style before Gemini builds the route.
            </p>
            <div className="voy-create-highlights" aria-label="Trip builder highlights">
              <span>
                <Compass size={14} />
                Smart route optimization
              </span>
              <span>
                <ShieldCheck size={14} />
                Account-linked itineraries
              </span>
              <span>
                <Sparkles size={14} />
                AI suggestions before submit
              </span>
            </div>
          </header>

          {isAdmin ? (
            <section className="voy-admin-panel" aria-live="polite">
              <div className="voy-admin-panel-head">
                <h3>Admin diagnostics</h3>
                <span className="voy-admin-panel-badge">Unrestricted mode</span>
              </div>
              <p>
                Signed in as <strong>{user?.email ?? "unknown"}</strong> with role{" "}
                <strong>{role}</strong>. Rate-limit bypass and cross-user trip access are
                active for authenticated admin requests.
              </p>
              <div className="voy-admin-capabilities">
                <span>
                  unrestrictedRateLimits:{" "}
                  <strong>{capabilities?.unrestrictedRateLimits ? "enabled" : "disabled"}</strong>
                </span>
                <span>
                  crossUserTripAccess:{" "}
                  <strong>{capabilities?.crossUserTripAccess ? "enabled" : "disabled"}</strong>
                </span>
                <span>
                  debugTools: <strong>{capabilities?.debugTools ? "enabled" : "disabled"}</strong>
                </span>
              </div>
            </section>
          ) : null}

          <div className="voy-create-layout">
            <div className="voy-create-main-stack">
              <section className="voy-create-section">
                <div className="voy-create-section-head">
                  <div className="voy-create-section-icon">
                    <MapPinned size={18} />
                  </div>
                  <div>
                    <h3>Destination</h3>
                    <p>Use Google-backed suggestions when available, or keep your typed destination.</p>
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
                      value={destinationInputValue}
                      placeholder="Enter a city, country, or landmark"
                      className="voy-create-field"
                      aria-autocomplete="list"
                      aria-controls={destinationListId}
                      aria-expanded={
                        showDestinationSuggestions && visibleDestinationSuggestions.length > 0
                      }
                      aria-activedescendant={
                        activeDestinationSuggestionIndex >= 0
                          ? `${destinationListId}-${activeDestinationSuggestionIndex}`
                          : undefined
                      }
                      aria-invalid={Boolean(state.fieldErrors.location)}
                      autoComplete="off"
                      onFocus={() => {
                        if (visibleDestinationSuggestions.length > 0) {
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
                      onChange={(event) => {
                        dispatch({ type: "set_destination_input", value: event.target.value });
                        setShowDestinationSuggestions(Boolean(event.target.value.trim()));
                        setActiveDestinationSuggestionIndex(-1);
                      }}
                    />
                    {autocompleteLoading ? (
                      <AiOutlineLoading3Quarters className="voy-create-inline-spinner animate-spin" />
                    ) : null}
                  </div>
                  {showDestinationSuggestions && (
                    <ul
                      id={destinationListId}
                      role="listbox"
                      className="voy-create-suggestion-list"
                      aria-label="Destination suggestions"
                    >
                      {visibleDestinationSuggestions.length === 0 ? (
                        <li className="voy-create-suggestion-empty">No suggestions yet.</li>
                      ) : (
                        visibleDestinationSuggestions.map((suggestion, index) => {
                          const isActive = index === activeDestinationSuggestionIndex;
                          return (
                            <li
                              id={`${destinationListId}-${index}`}
                              key={`${suggestion.label}-${suggestion.source}-${index}`}
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
                                  applyDestinationSuggestion(suggestion);
                                }}
                                onMouseEnter={() => setActiveDestinationSuggestionIndex(index)}
                              >
                                <div>
                                  <span className="voy-create-suggestion-primary">
                                    {suggestion.primaryText || suggestion.label}
                                  </span>
                                  {suggestion.secondaryText ? (
                                    <span className="voy-create-suggestion-secondary">
                                      {suggestion.secondaryText}
                                    </span>
                                  ) : null}
                                </div>
                                <span className="voy-create-suggestion-badge">
                                  {suggestion.source === "google_places" ? "Live" : "Use"}
                                </span>
                              </button>
                            </li>
                          );
                        })
                      )}
                    </ul>
                  )}
                </div>
                {state.fieldErrors.location ? (
                  <p className="voy-inline-error">{state.fieldErrors.location}</p>
                ) : (
                  <p className="voy-create-helper-copy">
                    {submissionPreview.location.placeId
                      ? "Google Places match selected for higher-precision routing."
                      : "Typed destinations still work even if a live suggestion is unavailable."}
                  </p>
                )}
              </section>

              <div className="voy-create-grid voy-create-grid-basics">
                <section className="voy-create-section voy-create-section-compact">
                  <div className="voy-create-section-head">
                    <div className="voy-create-section-icon">
                      <CalendarRange size={18} />
                    </div>
                    <div>
                      <h3>Trip basics</h3>
                      <p>Keep the duration realistic so Gemini can balance the route.</p>
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
                      value={state.form.days}
                      aria-invalid={Boolean(state.fieldErrors.days)}
                      onChange={(event) =>
                        dispatch({ type: "set_days", value: event.target.value })
                      }
                    />
                  </div>
                  {state.fieldErrors.days ? (
                    <p className="voy-inline-error">{state.fieldErrors.days}</p>
                  ) : (
                    <p className="voy-create-helper-copy">1 to 30 days supported.</p>
                  )}
                </section>

                <section className="voy-create-section">
                  <div className="voy-create-section-head">
                    <div className="voy-create-section-icon">
                      <Users2 size={18} />
                    </div>
                    <div>
                      <h3>Who are you traveling with?</h3>
                      <p>Traveler type changes pacing, activities, and accommodation mix.</p>
                    </div>
                  </div>
                  <div className="voy-create-choice-grid voy-create-choice-grid-compact">
                    {SelectTravelsList.map((item) => (
                      <ChoiceCard
                        key={item.id}
                        item={{
                          ...item,
                          description: item.desc,
                        }}
                        active={state.form.travelers === item.title}
                        onClick={() => dispatch({ type: "set_travelers", value: item.title })}
                        meta={item.people}
                        compact
                      />
                    ))}
                  </div>
                  {state.fieldErrors.travelers ? (
                    <p className="voy-inline-error">{state.fieldErrors.travelers}</p>
                  ) : null}
                </section>
              </div>

              <section className="voy-create-section">
                <div className="voy-create-section-head">
                  <div className="voy-create-section-icon">
                    <DollarSign size={18} />
                  </div>
                  <div>
                    <h3>Budget + Plan Type</h3>
                    <p>Set your budget and intent together so the route strategy stays aligned.</p>
                  </div>
                </div>

                <div className="voy-create-budget-plan-grid">
                  <div className="voy-create-subsection">
                    <div className="voy-create-subsection-head">
                      <h4>Plan Type</h4>
                      <p>Compact intent selection with quick detail tooltips.</p>
                    </div>
                    <div className="voy-create-compact-option-grid voy-create-compact-option-grid-plan">
                      {PLAN_TYPE_OPTIONS.map((item) => (
                        <CompactOptionButton
                          key={item.id}
                          item={item}
                          active={selectedPlanType === item.id}
                          onClick={() => dispatch({ type: "set_plan_type", value: item.id })}
                          meta={recommendedPlanType === item.id ? "Recommended" : item.accent}
                        />
                      ))}
                    </div>
                    <p className="voy-create-helper-copy">
                      Budget currently maps to <strong>{recommendedPlanType}</strong>. Manual selections stay locked until you change them.
                    </p>
                    {state.fieldErrors.planType ? (
                      <p className="voy-inline-error">{state.fieldErrors.planType}</p>
                    ) : null}
                  </div>

                  <div className="voy-create-subsection">
                    <div className="voy-create-subsection-head">
                      <h4>Estimated Budget</h4>
                      <p>Use input + slider. Breakdown updates live for stay, food, and travel.</p>
                    </div>
                    <div className="voy-create-budget-grid">
                      <label className="voy-create-budget-input-wrap">
                        <span>Total budget (USD)</span>
                        <div className="voy-create-field-shell">
                          <DollarSign size={16} className="voy-create-field-icon" />
                          <input
                            type="number"
                            min={BUDGET_MIN}
                            max={BUDGET_MAX}
                            step={BUDGET_STEP}
                            className="voy-create-field"
                            value={state.form.budgetAmount}
                            aria-invalid={Boolean(state.fieldErrors.budgetAmount)}
                            onChange={(event) => handleBudgetChange(event.target.value)}
                          />
                        </div>
                      </label>
                      <div className="voy-create-budget-meta">
                        <strong>{formatBudgetAmount(state.form.budgetAmount)}</strong>
                        <span>
                          Recommended range: {formatBudgetAmount(recommendedBudgetRange.min)} - {formatBudgetAmount(recommendedBudgetRange.max)}
                        </span>
                      </div>
                    </div>
                    <input
                      className="voy-create-slider"
                      type="range"
                      min={BUDGET_MIN}
                      max={BUDGET_MAX}
                      step={BUDGET_STEP}
                      value={state.form.budgetAmount}
                      onChange={(event) => handleBudgetChange(event.target.value)}
                      aria-label="Total budget"
                    />
                    {state.fieldErrors.budgetAmount ? (
                      <p className="voy-inline-error">{state.fieldErrors.budgetAmount}</p>
                    ) : (
                      <p className="voy-create-helper-copy">
                        Breakdown preview is based on {selectedPlanType} and a {(state.form.pace || "Balanced").toLowerCase()} pace.
                      </p>
                    )}
                  </div>
                </div>
              </section>

              <section className="voy-create-section">
                <div className="voy-create-section-head">
                  <div className="voy-create-section-icon">
                    <Compass size={18} />
                  </div>
                  <div>
                    <h3>Preferences Bundle</h3>
                    <p>Compact controls for food, style, and day pacing.</p>
                  </div>
                </div>

                <div className="voy-create-preferences-grid">
                  <div className="voy-create-subsection">
                    <div className="voy-create-subsection-head">
                      <h4>Food Preferences</h4>
                      <p>Mixed clears the other tags to keep dining logic realistic.</p>
                    </div>
                    <div className="voy-create-tag-grid">
                      {FOOD_PREFERENCE_OPTIONS.map((item) => (
                        <FoodTag
                          key={item.id}
                          item={item}
                          active={state.form.foodPreferences.includes(item.id)}
                          onClick={() =>
                            dispatch({ type: "toggle_food_preference", value: item.id })
                          }
                        />
                      ))}
                    </div>
                    {state.fieldErrors.foodPreferences ? (
                      <p className="voy-inline-error">{state.fieldErrors.foodPreferences}</p>
                    ) : (
                      <p className="voy-create-helper-copy">
                        Selected dining tags bias restaurant and meal recommendations.
                      </p>
                    )}
                  </div>

                  <div className="voy-create-subsection">
                    <div className="voy-create-subsection-head">
                      <h4>Travel Style</h4>
                      <p>Pick the dominant travel mode; details are available via tooltips.</p>
                    </div>
                    <div className="voy-create-compact-option-grid voy-create-compact-option-grid-style">
                      {TRAVEL_STYLE_OPTIONS.map((item) => (
                        <CompactOptionButton
                          key={item.id}
                          item={item}
                          active={state.form.travelStyle === item.id}
                          onClick={() =>
                            dispatch({ type: "set_travel_style", value: item.id })
                          }
                        />
                      ))}
                    </div>
                    {state.fieldErrors.travelStyle ? (
                      <p className="voy-inline-error">{state.fieldErrors.travelStyle}</p>
                    ) : null}
                  </div>

                  <div className="voy-create-subsection voy-create-subsection-full">
                    <div className="voy-create-subsection-head voy-create-subsection-head-tight">
                      <h4>Time Preference</h4>
                      <p>Controls how dense each itinerary day should feel.</p>
                    </div>
                    <div className="voy-create-segmented-control">
                      {PACE_OPTIONS.map((item) => (
                        <PaceButton
                          key={item.id}
                          item={item}
                          active={state.form.pace === item.id}
                          onClick={() => dispatch({ type: "set_pace", value: item.id })}
                        />
                      ))}
                    </div>
                    {state.fieldErrors.pace ? (
                      <p className="voy-inline-error">{state.fieldErrors.pace}</p>
                    ) : null}
                  </div>
                </div>
              </section>

              <div className="voy-create-actions voy-create-actions-start">
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
            </div>

            <aside className="voy-create-sidebar">
              <div className="voy-create-summary-panel">
                <div className="voy-create-summary-head">
                  <span className="voy-create-summary-kicker">Itinerary brief</span>
                  <h3>{selectedPlanType}</h3>
                  <p>{formatBudgetSummary(submissionPreview)}</p>
                </div>

                <div className="voy-create-summary-status">
                  <div className="voy-create-summary-status-item">
                    <span>Signals</span>
                    <strong>
                      {briefCompletionStatus.completed}/{briefCompletionStatus.total}
                    </strong>
                  </div>
                  <div
                    className={`voy-create-summary-status-item ${
                      briefCompletionStatus.isReady ? "ready" : ""
                    }`}
                  >
                    <span>Status</span>
                    <strong>
                      {briefCompletionStatus.isReady ? "Ready to generate" : "In progress"}
                    </strong>
                  </div>
                </div>

                <div className="voy-create-summary-block">
                  <div className="voy-create-summary-title">Budget breakdown</div>
                  <div className="voy-create-summary-bars">
                    {budgetBreakdown.map((item) => (
                      <div key={item.id} className="voy-create-budget-card">
                        <div className="voy-create-budget-row">
                          <span>{item.label}</span>
                          <strong>{item.formattedAmount}</strong>
                        </div>
                        <div className="voy-create-budget-track" aria-hidden="true">
                          <span style={{ width: `${item.percent}%` }} />
                        </div>
                        <small>{item.description}</small>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="voy-create-summary-block">
                  <div className="voy-create-summary-title">Selected signals</div>
                  <div className="voy-create-summary-tags">
                    {selectionTags.length > 0 ? (
                      selectionTags.map((tag) => (
                        <span key={tag} className="voy-create-summary-tag">
                          {tag}
                        </span>
                      ))
                    ) : (
                      <span className="voy-create-summary-empty">
                        Add preferences to sharpen the itinerary brief.
                      </span>
                    )}
                  </div>
                </div>

                <div className="voy-create-summary-block compact">
                  <div className="voy-create-summary-title-row">
                    <div className="voy-create-summary-title">Smart validation</div>
                    {isMobileViewport ? (
                      <button
                        type="button"
                        className="voy-create-summary-toggle"
                        aria-expanded={!collapsedSidebarBlocks.validation}
                        onClick={() => toggleSidebarBlock("validation")}
                      >
                        {collapsedSidebarBlocks.validation ? (
                          <>
                            Show <ChevronDown size={14} />
                          </>
                        ) : (
                          <>
                            Hide <ChevronUp size={14} />
                          </>
                        )}
                      </button>
                    ) : null}
                  </div>

                  {!isMobileViewport || !collapsedSidebarBlocks.validation ? (
                    <div className="voy-create-warning-list" aria-live="polite">
                      {smartWarnings.length > 0 ? (
                        smartWarnings.map((warning) => (
                          <div key={warning} className="voy-create-warning-item">
                            <span>Heads-up</span>
                            <p>{warning}</p>
                          </div>
                        ))
                      ) : (
                        <div className="voy-create-warning-item success">
                          <span>Ready</span>
                          <p>Your current combination looks realistic for itinerary generation.</p>
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>

                <div className="voy-create-summary-block compact">
                  <div className="voy-create-summary-title-row">
                    <div className="voy-create-summary-title">AI suggestions</div>
                    {isMobileViewport ? (
                      <button
                        type="button"
                        className="voy-create-summary-toggle"
                        aria-expanded={!collapsedSidebarBlocks.suggestions}
                        onClick={() => toggleSidebarBlock("suggestions")}
                      >
                        {collapsedSidebarBlocks.suggestions ? (
                          <>
                            Show <ChevronDown size={14} />
                          </>
                        ) : (
                          <>
                            Hide <ChevronUp size={14} />
                          </>
                        )}
                      </button>
                    ) : null}
                  </div>

                  {!isMobileViewport || !collapsedSidebarBlocks.suggestions ? (
                    <div className="voy-create-ai-chip-list">
                      {aiSuggestionChips.map((chip) => (
                        <button
                          key={chip.id}
                          type="button"
                          className={`voy-create-ai-chip ${chip.kind}`}
                          onClick={() => {
                            if (chip.kind === "destination") {
                              applyDestinationSuggestion({
                                label: chip.value,
                                primaryText: chip.value,
                                secondaryText: "Popular match",
                                source: "ai_suggestion",
                              });
                              return;
                            }

                            if (chip.kind === "plan") {
                              dispatch({ type: "set_plan_type", value: chip.value });
                              return;
                            }

                            if (chip.kind === "budget") {
                              const midpoint = Math.round(
                                (recommendedBudgetRange.min + recommendedBudgetRange.max) / 2
                              );
                              handleBudgetChange(String(midpoint));
                            }
                          }}
                        >
                          {chip.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </aside>
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
                Payload tuned for Gemini
              </span>
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
