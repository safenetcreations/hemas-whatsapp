const NUMBER_FORMATTER = new Intl.NumberFormat("en-US");
const CURRENCY_FORMATTER = new Intl.NumberFormat("en-LK", {
  style: "currency",
  currency: "LKR",
  maximumFractionDigits: 0,
});

export function formatNumber(value: number): string {
  return NUMBER_FORMATTER.format(value);
}

export function formatPercent(value: number, total: number): string {
  if (total === 0) return "0.0%";
  return `${((value / total) * 100).toFixed(1)}%`;
}

export function formatDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${minutes}m ${String(remainder).padStart(2, "0")}s`;
}

export function formatLkrRange(low: number, high: number): string {
  return `${CURRENCY_FORMATTER.format(low)}–${CURRENCY_FORMATTER.format(high)}`;
}
