import { resolveGoogleMapsUrl } from "@/lib/maps";

const CURRENCY_CONFIG = {
  INR: {
    code: "INR",
    label: "Indian Rupee",
    shortLabel: "INR (₹)",
    locale: "en-IN",
    rateFromUsd: 83,
  },
  USD: {
    code: "USD",
    label: "US Dollar",
    shortLabel: "USD ($)",
    locale: "en-US",
    rateFromUsd: 1,
  },
  EUR: {
    code: "EUR",
    label: "Euro",
    shortLabel: "EUR (€)",
    locale: "en-IE",
    rateFromUsd: 0.92,
  },
  GBP: {
    code: "GBP",
    label: "British Pound",
    shortLabel: "GBP (£)",
    locale: "en-GB",
    rateFromUsd: 0.79,
  },
  AED: {
    code: "AED",
    label: "UAE Dirham",
    shortLabel: "AED (د.إ)",
    locale: "en-AE",
    rateFromUsd: 3.67,
  },
  SGD: {
    code: "SGD",
    label: "Singapore Dollar",
    shortLabel: "SGD (S$)",
    locale: "en-SG",
    rateFromUsd: 1.35,
  },
};

export const DEFAULT_VOYAGR_CURRENCY = "INR";

export const VOYAGR_CURRENCY_OPTIONS = Object.values(CURRENCY_CONFIG).map((currency) => ({
  value: currency.code,
  label: currency.shortLabel,
  description: currency.label,
}));

export function resolveVoyagrCurrencyConfig(currencyCode = DEFAULT_VOYAGR_CURRENCY) {
  return CURRENCY_CONFIG[currencyCode] ?? CURRENCY_CONFIG[DEFAULT_VOYAGR_CURRENCY];
}

export function formatVoyagrCurrency(amountUsd, currencyCode = DEFAULT_VOYAGR_CURRENCY) {
  const normalizedAmount = Number(amountUsd);

  if (!Number.isFinite(normalizedAmount)) {
    return "";
  }

  const currency = resolveVoyagrCurrencyConfig(currencyCode);
  const convertedAmount = normalizedAmount * currency.rateFromUsd;

  return new Intl.NumberFormat(currency.locale, {
    style: "currency",
    currency: currency.code,
    maximumFractionDigits: 0,
  }).format(convertedAmount);
}

export function formatDestinationStartingPrice(
  amountUsd,
  currencyCode = DEFAULT_VOYAGR_CURRENCY
) {
  const formattedAmount = formatVoyagrCurrency(amountUsd, currencyCode);
  return formattedAmount ? `From ${formattedAmount}` : "Price unavailable";
}

export function buildDestinationMapsUrl(destination = {}) {
  const destinationLabel = [destination?.name, destination?.country]
    .filter((value) => typeof value === "string" && value.trim())
    .join(", ");

  return resolveGoogleMapsUrl({
    name: destination?.name,
    location: destination?.country,
    destination: destinationLabel,
  });
}
