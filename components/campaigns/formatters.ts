const NUMBER_FORMATTER = new Intl.NumberFormat("en-US");
const DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Colombo",
});

export function formatNumber(value: number): string {
  return NUMBER_FORMATTER.format(value);
}

export function formatPercent(value: number, total: number): string {
  if (total === 0) return "0.0%";
  return `${((value / total) * 100).toFixed(1)}%`;
}

export function formatDate(value: string | null): string {
  return value ? DATE_FORMATTER.format(new Date(value)) : "Not recorded";
}
