import {
  CheckCircle2,
  FilterX,
  Languages,
  Search,
  ShieldOff,
} from "lucide-react";
import {
  normalizedMarketingStatus,
  preferenceDraftChanged,
} from "./contact-workspace-model";
import type {
  ContactDirectoryRecord,
  ContactLanguageFilter,
  ContactPreferenceDrafts,
  LocalSuppressionPreviews,
  MarketingConsentFilter,
} from "./types";

const LANGUAGE_LABELS = {
  en: "English",
  si: "සිංහල",
  ta: "தமிழ்",
} as const;

const CONSENT_STYLES = {
  granted: "bg-emerald-50 text-emerald-700",
  withdrawn: "bg-red-50 text-red-700",
  unknown: "bg-amber-50 text-amber-700",
} as const;

export function ContactDirectory({
  records,
  selectedId,
  drafts,
  suppressionPreviews,
  search,
  language,
  marketing,
  suppressionOnly,
  onSearchChange,
  onLanguageChange,
  onMarketingChange,
  onSuppressionOnlyChange,
  onResetFilters,
  onSelect,
}: {
  records: readonly ContactDirectoryRecord[];
  selectedId: string | null;
  drafts: ContactPreferenceDrafts;
  suppressionPreviews: LocalSuppressionPreviews;
  search: string;
  language: ContactLanguageFilter;
  marketing: MarketingConsentFilter;
  suppressionOnly: boolean;
  onSearchChange: (value: string) => void;
  onLanguageChange: (value: ContactLanguageFilter) => void;
  onMarketingChange: (value: MarketingConsentFilter) => void;
  onSuppressionOnlyChange: (value: boolean) => void;
  onResetFilters: () => void;
  onSelect: (record: ContactDirectoryRecord) => void;
}) {
  const filtersActive = Boolean(search) || language !== "all" || marketing !== "all" || suppressionOnly;

  return (
    <section
      aria-label="Synthetic contact directory"
      className="flex min-h-[68dvh] min-w-0 flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-white shadow-[0_1px_2px_rgba(23,34,31,0.04)] md:h-full md:min-h-0"
    >
      <div className="border-b border-[var(--line)] p-3.5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-[15px] font-bold text-slate-950">Directory</h2>
            <p className="mt-0.5 text-[11px] text-slate-500">
              {records.length} synthetic {records.length === 1 ? "contact" : "contacts"}
            </p>
          </div>
          {filtersActive ? (
            <button
              type="button"
              onClick={onResetFilters}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-[11px] font-semibold text-slate-600 hover:bg-slate-100"
            >
              <FilterX size={14} aria-hidden="true" /> Reset
            </button>
          ) : null}
        </div>

        <label className="relative mt-3 block">
          <span className="sr-only">Search synthetic contacts</span>
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search label, masked number or tag"
            className="h-10 w-full rounded-xl border border-[var(--line)] bg-slate-50 pl-9 pr-3 text-xs text-slate-900 outline-none placeholder:text-slate-400 focus:border-[var(--brand)] focus:bg-white"
          />
        </label>

        <div className="mt-2 grid grid-cols-2 gap-2">
          <label>
            <span className="sr-only">Filter contacts by preferred language</span>
            <select
              value={language}
              onChange={(event) => onLanguageChange(event.target.value as ContactLanguageFilter)}
              className="h-9 w-full rounded-lg border border-[var(--line)] bg-white px-2 text-[11px] font-medium text-slate-700 outline-none focus:border-[var(--brand)]"
            >
              <option value="all">All languages</option>
              <option value="en">English</option>
              <option value="si">සිංහල</option>
              <option value="ta">தமிழ்</option>
            </select>
          </label>
          <label>
            <span className="sr-only">Filter contacts by marketing consent</span>
            <select
              value={marketing}
              onChange={(event) => onMarketingChange(event.target.value as MarketingConsentFilter)}
              className="h-9 w-full rounded-lg border border-[var(--line)] bg-white px-2 text-[11px] font-medium text-slate-700 outline-none focus:border-[var(--brand)]"
            >
              <option value="all">All consent</option>
              <option value="granted">Marketing granted</option>
              <option value="withdrawn">Withdrawn</option>
              <option value="unknown">Unknown</option>
            </select>
          </label>
        </div>

        <label className="mt-2 flex min-h-9 cursor-pointer items-center gap-2 rounded-lg px-2 text-[11px] font-semibold text-slate-600 hover:bg-slate-50">
          <input
            type="checkbox"
            checked={suppressionOnly}
            onChange={(event) => onSuppressionOnlyChange(event.target.checked)}
            className="h-4 w-4 rounded border-slate-300 accent-red-600"
          />
          <ShieldOff size={14} className="text-red-600" aria-hidden="true" />
          Marketing-suppressed only
        </label>
      </div>

      <div className="scrollbar-subtle min-h-0 flex-1 overflow-y-auto" aria-live="polite">
        {records.length === 0 ? (
          <div className="grid min-h-72 place-items-center p-6 text-center">
            <div>
              <span className="mx-auto grid h-11 w-11 place-items-center rounded-full bg-slate-100 text-slate-500">
                <Search size={19} aria-hidden="true" />
              </span>
              <h3 className="mt-3 text-sm font-bold text-slate-900">No synthetic contacts</h3>
              <p className="mt-1 max-w-[230px] text-xs leading-5 text-slate-500">
                No fixture matches these filters. Reset them to restore the seeded directory.
              </p>
              <button
                type="button"
                onClick={onResetFilters}
                className="mt-4 h-9 rounded-lg border border-[var(--line)] px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Reset filters
              </button>
            </div>
          </div>
        ) : (
          <ul className="divide-y divide-[var(--line)]">
            {records.map((record) => {
              const { contact } = record;
              const selected = selectedId === contact.id;
              const draft = drafts[contact.id];
              const preferredLanguage = draft?.preferredLanguage ?? contact.preferredLanguage;
              const tags = draft?.tags ?? contact.tags;
              const suppressed =
                suppressionPreviews[contact.id] ?? contact.suppression.suppressMarketing;
              const consent = normalizedMarketingStatus(record.consentRecords);
              const hasUnsavedPreferences = preferenceDraftChanged(contact, draft);

              return (
                <li key={contact.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(record)}
                    aria-pressed={selected}
                    className={`relative w-full px-3.5 py-3 text-left transition ${selected ? "bg-[var(--brand-soft)]" : "hover:bg-slate-50"}`}
                  >
                    {suppressed ? <span className="absolute inset-y-0 left-0 w-1 bg-red-500" aria-hidden="true" /> : null}
                    <span className="flex items-start gap-3">
                      <span
                        className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-xs font-bold ${
                          suppressed ? "bg-red-100 text-red-700" : "bg-slate-100 text-slate-700"
                        }`}
                        aria-hidden="true"
                      >
                        {contact.displayLabel.slice(-1)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-start justify-between gap-2">
                          <span className="truncate text-[13px] font-bold text-slate-900">{contact.displayLabel}</span>
                          {hasUnsavedPreferences ? (
                            <span className="shrink-0 rounded-full bg-violet-50 px-2 py-0.5 text-[8px] font-bold uppercase tracking-[0.04em] text-violet-700">
                              Unsaved
                            </span>
                          ) : null}
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] text-slate-500">{contact.maskedPhone}</span>
                        <span className="mt-2 flex flex-wrap items-center gap-1.5">
                          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-bold text-slate-600">
                            <Languages size={10} aria-hidden="true" /> {LANGUAGE_LABELS[preferredLanguage]}
                          </span>
                          <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold capitalize ${CONSENT_STYLES[consent]}`}>
                            {consent === "granted" ? <CheckCircle2 size={10} aria-hidden="true" /> : null}
                            Marketing {consent}
                          </span>
                          {suppressed ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[9px] font-bold text-red-700">
                              <ShieldOff size={10} aria-hidden="true" /> Suppressed
                            </span>
                          ) : null}
                        </span>
                        <span className="mt-2 block truncate text-[9px] font-medium text-slate-400">
                          {tags.length > 0 ? tags.join(" · ") : "No operational tags"}
                        </span>
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
