import { Filter, RotateCcw } from "lucide-react";

import {
  DEFAULT_DIMENSION_FILTERS,
  JOURNEY_LABELS,
  LANGUAGE_LABELS,
  LOCATION_LABELS,
  type DimensionFilters,
  type SampleDateRange,
  type SampleJourney,
  type SampleLanguage,
  type SampleLocation,
} from "./sample-data";

export function DimensionFilterBar({
  filters,
  onChange,
  resultCount,
  resultLabel = "aggregate slices",
}: {
  filters: DimensionFilters;
  onChange: (filters: DimensionFilters) => void;
  resultCount: number;
  resultLabel?: string;
}) {
  const hasActiveDimensions =
    filters.dateRange !== DEFAULT_DIMENSION_FILTERS.dateRange ||
    filters.journey !== "all" ||
    filters.location !== "all" ||
    filters.language !== "all";

  return (
    <section
      className="rounded-2xl border border-[var(--line)] bg-white p-4 shadow-[0_1px_2px_rgba(23,34,31,0.03)] sm:p-5"
      aria-labelledby="dimension-filter-title"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Filter size={16} className="text-[var(--brand)]" aria-hidden="true" />
            <h2 id="dimension-filter-title" className="text-sm font-bold text-slate-950">
              Sample dimensions
            </h2>
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Filters recalculate local aggregate fixtures only.
          </p>
        </div>
        <p className="text-xs font-semibold text-slate-600" aria-live="polite">
          {resultCount} {resultLabel}
        </p>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <label className="grid gap-1.5 text-xs font-semibold text-slate-700">
          Date window
          <select
            value={filters.dateRange}
            onChange={(event) =>
              onChange({
                ...filters,
                dateRange: event.target.value as SampleDateRange,
              })
            }
            className="h-10 rounded-xl border border-[var(--line)] bg-slate-50 px-3 text-sm font-medium text-slate-800 outline-none focus:border-[var(--brand)] focus:bg-white"
          >
            <option value="7d">Last 7 sample days</option>
            <option value="14d">Last 14 sample days</option>
            <option value="30d">Last 30 sample days</option>
          </select>
        </label>

        <label className="grid gap-1.5 text-xs font-semibold text-slate-700">
          Journey
          <select
            value={filters.journey}
            onChange={(event) =>
              onChange({
                ...filters,
                journey: event.target.value as "all" | SampleJourney,
              })
            }
            className="h-10 rounded-xl border border-[var(--line)] bg-slate-50 px-3 text-sm font-medium text-slate-800 outline-none focus:border-[var(--brand)] focus:bg-white"
          >
            <option value="all">All journeys</option>
            {Object.entries(JOURNEY_LABELS).map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1.5 text-xs font-semibold text-slate-700">
          Location
          <select
            value={filters.location}
            onChange={(event) =>
              onChange({
                ...filters,
                location: event.target.value as "all" | SampleLocation,
              })
            }
            className="h-10 rounded-xl border border-[var(--line)] bg-slate-50 px-3 text-sm font-medium text-slate-800 outline-none focus:border-[var(--brand)] focus:bg-white"
          >
            <option value="all">All sample locations</option>
            {Object.entries(LOCATION_LABELS).map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1.5 text-xs font-semibold text-slate-700">
          Language
          <select
            value={filters.language}
            onChange={(event) =>
              onChange({
                ...filters,
                language: event.target.value as "all" | SampleLanguage,
              })
            }
            className="h-10 rounded-xl border border-[var(--line)] bg-slate-50 px-3 text-sm font-medium text-slate-800 outline-none focus:border-[var(--brand)] focus:bg-white"
          >
            <option value="all">All languages</option>
            {Object.entries(LANGUAGE_LABELS).map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          disabled={!hasActiveDimensions}
          onClick={() => onChange(DEFAULT_DIMENSION_FILTERS)}
          className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-[var(--line)] px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
        >
          <RotateCcw size={14} aria-hidden="true" /> Reset dimensions
        </button>
      </div>
    </section>
  );
}
