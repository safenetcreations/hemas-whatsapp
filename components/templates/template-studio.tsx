"use client";

import {
  Check,
  ChevronRight,
  CircleAlert,
  ClipboardCheck,
  Copy,
  FileCheck2,
  FileText,
  Filter,
  GitBranch,
  Languages,
  LockKeyhole,
  MessageSquareText,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  ShieldOff,
  Smartphone,
  Workflow,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useWorkspaceSession } from "@/components/auth/workspace-session";
import { StatusPill } from "@/components/ui/status-pill";
import type { VerifiedWorkspaceSession } from "@/lib/firebase/workspace-session-model";
import {
  type TemplateAssetKind,
  type TemplateStudioAsset,
  type TemplateStudioFlowAsset,
  type TemplateStudioTemplateAsset,
  type TemplateVariable,
  type TemplateWorkspaceResult,
  selectVisibleTemplateAsset,
} from "./template-workspace-data";
import { useTemplateWorkspace } from "./use-template-workspace";

type FilterState = "all" | TemplateStudioAsset["localState"];
type LanguageFilter = "all" | TemplateStudioAsset["language"];

const stateLabels: Record<TemplateStudioAsset["localState"], string> = {
  draft: "Internal draft",
  submitted: "Internal submitted",
  approved: "Internal approved",
  paused: "Internal paused",
  disabled: "Internal disabled",
  rejected: "Internal rejected",
};

const stateTone: Record<
  TemplateStudioAsset["localState"],
  "neutral" | "warning" | "success" | "danger" | "info"
> = {
  draft: "neutral",
  submitted: "info",
  approved: "success",
  paused: "warning",
  disabled: "neutral",
  rejected: "danger",
};

const languageLabels: Record<TemplateStudioAsset["language"], string> = {
  en: "English",
  si: "Sinhala",
  ta: "Tamil",
};

function applyVariables(body: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (rendered, [key, value]) =>
      rendered.replaceAll(`{{${key}}}`, value || `{{${key}}}`),
    body,
  );
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("en-LK", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Colombo",
  }).format(new Date(value));
}

function providerEvidenceLabel(asset: TemplateStudioAsset): string {
  const submission = asset.providerEvidence.submissionState.replaceAll("_", " ");
  const approval = asset.providerEvidence.approvalState.replaceAll("_", " ");
  return `${submission} · ${approval}`;
}

function defaultVariableValues(
  asset: TemplateStudioAsset,
): Record<string, string> {
  return Object.fromEntries(
    asset.variables.map((variable) => [variable.key, variable.example]),
  );
}

function variableIsValid(variable: TemplateVariable, value: string): boolean {
  if (!value.trim()) return !variable.required;
  if (value.length > variable.maxLength) return false;
  return variable.patternSource === null
    ? true
    : new RegExp(variable.patternSource).test(value);
}

function AssetIcon({ kind }: { kind: TemplateAssetKind }) {
  return kind === "flow" ? (
    <Workflow size={17} aria-hidden="true" />
  ) : (
    <MessageSquareText size={17} aria-hidden="true" />
  );
}

function StudioHeading() {
  return (
    <section className="flex items-start gap-3">
      <span className="mt-0.5 grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">
        <FileCheck2 size={21} aria-hidden="true" />
      </span>
      <div>
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--brand)]">
          Authenticated local catalogue
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-[-0.035em] text-slate-950 sm:text-3xl">
          Templates &amp; WhatsApp Flows
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">
          Inspect singular-language persisted versions and walk through inert local
          previews without saving, provider submission or external actions.
        </p>
      </div>
    </section>
  );
}

function WorkspaceStateCard({
  kind,
  message,
  onRetry,
}: {
  kind: "loading" | "error" | "denied" | "empty";
  message: string;
  onRetry?: () => void;
}) {
  const loading = kind === "loading";
  const denied = kind === "denied";
  return (
    <section
      className={`rounded-2xl border bg-white p-6 shadow-[0_1px_2px_rgba(23,34,31,0.03)] sm:p-8 ${
        denied ? "border-amber-200" : "border-[var(--line)]"
      }`}
      aria-busy={loading}
      role={kind === "error" || denied ? "alert" : "status"}
    >
      <div className="flex items-start gap-3">
        <span
          className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${
            kind === "error"
              ? "bg-red-50 text-red-700"
              : denied
                ? "bg-amber-50 text-amber-800"
                : "bg-slate-100 text-slate-600"
          }`}
        >
          {loading ? (
            <RefreshCw className="animate-spin" size={18} aria-hidden="true" />
          ) : kind === "empty" ? (
            <FileText size={18} aria-hidden="true" />
          ) : (
            <ShieldOff size={18} aria-hidden="true" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold text-slate-950">
            {loading
              ? "Loading persisted catalogue"
              : kind === "empty"
                ? "Catalogue is empty"
                : denied
                  ? "Catalogue access denied"
                  : "Catalogue unavailable"}
          </h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">{message}</p>
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="mt-4 inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50"
            >
              <RefreshCw size={13} aria-hidden="true" /> Retry local read
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function AssetList({
  assets,
  selectedId,
  onSelect,
}: {
  assets: readonly TemplateStudioAsset[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  if (assets.length === 0) {
    return (
      <div className="grid min-h-52 place-items-center px-6 py-10 text-center">
        <div>
          <FileText className="mx-auto text-slate-300" size={28} aria-hidden="true" />
          <p className="mt-3 text-sm font-semibold text-slate-800">No matching assets</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Adjust the search, language or internal-governance filter.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="divide-y divide-[var(--line)]"
      role="list"
      aria-label="Persisted synthetic content assets"
    >
      {assets.map((asset) => (
        <button
          key={asset.id}
          type="button"
          onClick={() => onSelect(asset.id)}
          className={`flex w-full items-start gap-3 px-4 py-4 text-left transition sm:px-5 ${
            selectedId === asset.id
              ? "bg-[var(--brand-soft)]"
              : "hover:bg-slate-50"
          }`}
          aria-current={selectedId === asset.id ? "true" : undefined}
        >
          <span
            className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl ${
              selectedId === asset.id
                ? "bg-white text-[var(--brand)]"
                : "bg-slate-100 text-slate-600"
            }`}
          >
            <AssetIcon kind={asset.kind} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-bold text-slate-900">
              {asset.displayName}
            </span>
            <span className="mt-1 block truncate text-[11px] text-slate-500">
              {asset.name} · {asset.language} · v{asset.version}
            </span>
            <span className="mt-2 flex flex-wrap items-center gap-1.5">
              <StatusPill tone={stateTone[asset.localState]}>
                {stateLabels[asset.localState]}
              </StatusPill>
              <span className="text-[10px] font-semibold text-slate-500">
                {languageLabels[asset.language]}
              </span>
            </span>
          </span>
          <ChevronRight
            className="mt-2 shrink-0 text-slate-400"
            size={15}
            aria-hidden="true"
          />
        </button>
      ))}
    </div>
  );
}

function MessagePreview({
  asset,
  values,
}: {
  asset: TemplateStudioTemplateAsset;
  values: Record<string, string>;
}) {
  return (
    <div className="mx-auto w-full max-w-sm rounded-[2rem] border-[6px] border-slate-900 bg-[#e8e3db] p-3 shadow-xl">
      <div className="mb-3 flex items-center justify-between px-2 text-[9px] font-bold text-slate-700">
        <span>09:41</span>
        <span className="flex items-center gap-1">
          <LockKeyhole size={9} aria-hidden="true" /> Page-local preview
        </span>
      </div>
      <div className="rounded-2xl rounded-tl-sm bg-white p-3 shadow-sm">
        {asset.header ? (
          <p className="text-xs font-bold text-slate-900">{asset.header}</p>
        ) : null}
        <p className="mt-1 whitespace-pre-wrap break-words text-[12px] leading-5 text-slate-700">
          {applyVariables(asset.body, values)}
        </p>
        {asset.footer ? (
          <p className="mt-2 text-[10px] leading-4 text-slate-400">{asset.footer}</p>
        ) : null}
        <p className="mt-2 text-right text-[9px] text-slate-400">09:41</p>
      </div>
      <p className="mt-3 text-center text-[10px] font-semibold leading-4 text-slate-600">
        No message, button or provider action is available.
      </p>
    </div>
  );
}

function FlowPreview({ asset }: { asset: TemplateStudioFlowAsset }) {
  const [screenIndex, setScreenIndex] = useState(0);
  const screen = asset.flowScreens[screenIndex];

  if (!screen) return null;

  return (
    <div className="mx-auto w-full max-w-sm rounded-[2rem] border-[6px] border-slate-900 bg-slate-50 p-3 shadow-xl">
      <div className="flex items-center justify-between border-b border-slate-200 px-1 pb-3">
        <div className="min-w-0">
          <p className="text-[9px] font-bold uppercase tracking-[0.08em] text-[var(--brand)]">
            {asset.language} metadata · shared inert renderer
          </p>
          <p className="mt-0.5 truncate text-xs font-bold text-slate-900">
            {asset.displayName}
          </p>
        </div>
        <span className="shrink-0 text-[10px] font-semibold text-slate-500">
          {screenIndex + 1}/{asset.flowScreens.length}
        </span>
      </div>
      <div className="min-h-64 py-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.06em] text-slate-400">
          {screen.id}
        </p>
        <p className="mt-1 text-base font-bold text-slate-950">{screen.title}</p>
        <p className="mt-1 text-[11px] leading-5 text-slate-500">
          {screen.description}
        </p>
        {screen.fields.length > 0 ? (
          <div className="mt-4 space-y-3">
            {screen.fields.map((field) => (
              <div
                key={field}
                className="block text-[10px] font-bold uppercase tracking-[0.04em] text-slate-600"
              >
                {field}
                <span className="mt-1.5 flex min-h-10 items-center rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-normal normal-case tracking-normal text-slate-400">
                  Page-local synthetic selection
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[11px] font-semibold leading-5 text-amber-900">
            Pending only. No provider submission or Hemas-system confirmation occurred.
          </div>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setScreenIndex((current) => Math.max(0, current - 1))}
          disabled={screenIndex === 0}
          className="h-9 rounded-lg border border-slate-200 bg-white text-xs font-bold text-slate-700 disabled:cursor-not-allowed disabled:text-slate-300"
        >
          Back
        </button>
        <button
          type="button"
          onClick={() =>
            setScreenIndex((current) =>
              Math.min(asset.flowScreens.length - 1, current + 1),
            )
          }
          disabled={screenIndex === asset.flowScreens.length - 1}
          className="h-9 rounded-lg bg-[var(--brand)] text-xs font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          Next local screen
        </button>
      </div>
    </div>
  );
}

function VariableEditor({
  asset,
  values,
  onChange,
}: {
  asset: TemplateStudioTemplateAsset;
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
}) {
  if (asset.variables.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 p-4 text-xs leading-5 text-slate-500">
        This persisted template has no variables. Its preview remains page-local.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {asset.variables.map((variable) => {
        const value = values[variable.key] ?? "";
        const valid = variableIsValid(variable, value);
        return (
          <label key={variable.key} className="block">
            <span className="flex items-center justify-between gap-3 text-xs font-bold text-slate-700">
              <span>{`{{${variable.key}}}`}</span>
              <span
                className={`inline-flex items-center gap-1 text-[10px] ${
                  valid ? "text-emerald-700" : "text-red-600"
                }`}
              >
                {valid ? (
                  <Check size={11} aria-hidden="true" />
                ) : (
                  <CircleAlert size={11} aria-hidden="true" />
                )}
                {valid ? "Valid" : "Check value"}
              </span>
            </span>
            <span className="mt-1 block text-[10px] text-slate-500">
              {variable.description} · max {variable.maxLength}
            </span>
            <input
              value={value}
              onChange={(event) => onChange(variable.key, event.target.value)}
              maxLength={variable.maxLength + 8}
              className={`mt-1.5 h-10 w-full rounded-lg border bg-white px-3 text-xs outline-none ${
                valid
                  ? "border-slate-200 focus:border-[var(--brand)]"
                  : "border-red-300 focus:border-red-500"
              }`}
              aria-invalid={!valid}
            />
          </label>
        );
      })}
    </div>
  );
}

function NoMatchingAssetDetail({ onReset }: { onReset: () => void }) {
  return (
    <div className="grid min-h-[520px] place-items-center p-6 text-center sm:p-10">
      <div className="max-w-sm">
        <span className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-slate-100 text-slate-500">
          <Search size={18} aria-hidden="true" />
        </span>
        <h2 className="mt-4 text-base font-bold text-slate-950">
          No matching persisted asset
        </h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          No unrelated detail or fixture fallback is displayed. Clear the catalogue
          filters to select an authenticated record.
        </p>
        <button
          type="button"
          onClick={onReset}
          className="mt-4 inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50"
        >
          <RotateCcw size={13} aria-hidden="true" /> Clear catalogue filters
        </button>
      </div>
    </div>
  );
}

function PersistedTemplateStudio({ result }: { result: TemplateWorkspaceResult }) {
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | TemplateAssetKind>("all");
  const [state, setState] = useState<FilterState>("all");
  const [language, setLanguage] = useState<LanguageFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [previewRevision, setPreviewRevision] = useState(0);
  const [variableValues, setVariableValues] = useState<
    Record<string, Record<string, string>>
  >({});

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return result.assets.filter((asset) => {
      const identity =
        asset.kind === "flow" ? `${asset.definitionId} ${asset.name}` : asset.name;
      const matchesQuery =
        !normalized ||
        `${asset.displayName} ${identity} ${asset.language} ${asset.category}`
          .toLowerCase()
          .includes(normalized);
      return (
        matchesQuery &&
        (kind === "all" || asset.kind === kind) &&
        (state === "all" || asset.localState === state) &&
        (language === "all" || asset.language === language)
      );
    });
  }, [kind, language, query, result.assets, state]);

  const selected = selectVisibleTemplateAsset(filtered, selectedId);
  const currentValues = selected
    ? variableValues[selected.id] ?? defaultVariableValues(selected)
    : {};
  const invalidCount = selected
    ? selected.variables.filter(
        (variable) => !variableIsValid(variable, currentValues[variable.key] ?? ""),
      ).length
    : 0;

  const selectAsset = (id: string) => {
    setSelectedId(id);
    setNotice(null);
  };

  const simulateDraft = () => {
    if (!selected) return;
    setNotice(
      `Page-local draft v${selected.version + 1} simulated. Nothing was persisted, submitted or published.`,
    );
  };

  const resetPreview = () => {
    if (!selected) return;
    setVariableValues((current) => {
      const next = { ...current };
      delete next[selected.id];
      return next;
    });
    setPreviewRevision((current) => current + 1);
    setNotice("Page-local preview reset to persisted examples and the first safe Flow screen.");
  };

  const resetFilters = () => {
    setQuery("");
    setKind("all");
    setState("all");
    setLanguage("all");
    setSelectedId(null);
    setNotice(null);
  };

  return (
    <>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Template and Flow summary">
        {[
          ["Persisted versions", String(result.assets.length), `${result.templateCount} templates · ${result.flowVariantCount} Flow variants`],
          ["Flow journeys", String(result.flowDefinitionCount), "Six exact local renderer contracts"],
          ["Languages", String(result.languageCount), "English, Sinhala and Tamil are separate records"],
          ["Provider approved", "0", "All provider evidence is not submitted and unverified"],
        ].map(([label, value, detail]) => (
          <article
            key={label}
            className="rounded-2xl border border-[var(--line)] bg-white p-4 shadow-[0_1px_2px_rgba(23,34,31,0.03)] sm:p-5"
          >
            <p className="text-xs font-semibold text-[var(--muted)]">{label}</p>
            <p className="mt-2 text-2xl font-bold tracking-[-0.03em] text-slate-950">
              {value}
            </p>
            <p className="mt-2 text-[11px] leading-5 text-slate-500">{detail}</p>
          </article>
        ))}
      </section>

      <section className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 sm:flex-row sm:items-center" role="status">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-800">
          <ShieldCheck size={17} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold text-amber-950">
            Persisted read model — SafeNet internal governance is not provider approval
          </p>
          <p className="mt-0.5 text-[11px] leading-5 text-amber-800">
            Firestore supplies catalogue identity and status. Editors, screen navigation,
            resets and draft simulation stay on this page and make no write or network action.
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-full border border-amber-300 bg-white px-3 py-1.5 text-[10px] font-bold text-amber-800 sm:self-auto">
          <LockKeyhole size={12} aria-hidden="true" /> Provider actions unavailable
        </span>
      </section>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-5 text-slate-500">
          {result.assets.length} authenticated synthetic records loaded with no fixture fallback.
        </p>
        <button
          type="button"
          onClick={simulateDraft}
          disabled={!selected}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-4 text-sm font-semibold text-white hover:bg-[var(--brand-strong)] disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          <Copy size={15} aria-hidden="true" /> Simulate page-local draft
        </button>
      </div>

      {notice ? (
        <div
          className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-800"
          role="status"
        >
          <ClipboardCheck className="mt-0.5 shrink-0" size={15} aria-hidden="true" />
          {notice}
        </div>
      ) : null}

      <section className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white shadow-[0_1px_2px_rgba(23,34,31,0.03)]">
        <div className="grid min-h-[720px] xl:grid-cols-[360px_minmax(0,1fr)]">
          <aside
            className="border-b border-[var(--line)] xl:border-b-0 xl:border-r"
            aria-label="Content catalogue"
          >
            <div className="space-y-3 border-b border-[var(--line)] p-4 sm:p-5">
              <div>
                <h2 className="text-[15px] font-bold text-slate-950">Content catalogue</h2>
                <p className="mt-1 text-xs text-slate-500">
                  SafeNet internal states · separate provider evidence
                </p>
              </div>
              <label className="relative block">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                  size={14}
                  aria-hidden="true"
                />
                <span className="sr-only">Search persisted content assets</span>
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  type="search"
                  placeholder="Search assets or definition ID"
                  className="h-10 w-full rounded-xl border border-[var(--line)] bg-slate-50 pl-9 pr-3 text-xs outline-none focus:border-[var(--brand)] focus:bg-white"
                />
              </label>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-2">
                <label className="relative">
                  <span className="sr-only">Filter by asset type</span>
                  <Filter
                    className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
                    size={12}
                    aria-hidden="true"
                  />
                  <select
                    value={kind}
                    onChange={(event) =>
                      setKind(event.target.value as "all" | TemplateAssetKind)
                    }
                    className="h-9 w-full appearance-none rounded-lg border border-[var(--line)] bg-white pl-8 pr-2 text-[11px] font-semibold text-slate-700"
                  >
                    <option value="all">All types</option>
                    <option value="template">Templates</option>
                    <option value="flow">Flows</option>
                  </select>
                </label>
                <label>
                  <span className="sr-only">Filter by language</span>
                  <select
                    value={language}
                    onChange={(event) =>
                      setLanguage(event.target.value as LanguageFilter)
                    }
                    className="h-9 w-full rounded-lg border border-[var(--line)] bg-white px-2 text-[11px] font-semibold text-slate-700"
                  >
                    <option value="all">All languages</option>
                    <option value="en">English</option>
                    <option value="si">Sinhala</option>
                    <option value="ta">Tamil</option>
                  </select>
                </label>
                <label className="col-span-2 sm:col-span-1 xl:col-span-2">
                  <span className="sr-only">Filter by SafeNet internal state</span>
                  <select
                    value={state}
                    onChange={(event) => setState(event.target.value as FilterState)}
                    className="h-9 w-full rounded-lg border border-[var(--line)] bg-white px-2 text-[11px] font-semibold text-slate-700"
                  >
                    <option value="all">All internal states</option>
                    <option value="draft">Draft</option>
                    <option value="submitted">Submitted</option>
                    <option value="approved">Approved</option>
                    <option value="paused">Paused</option>
                    <option value="disabled">Disabled</option>
                    <option value="rejected">Rejected</option>
                  </select>
                </label>
              </div>
            </div>
            <AssetList
              assets={filtered}
              selectedId={selected?.id ?? ""}
              onSelect={selectAsset}
            />
          </aside>

          {selected ? (
            <div className="min-w-0">
            <div className="border-b border-[var(--line)] p-4 sm:p-5">
              <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusPill tone={stateTone[selected.localState]}>
                      SafeNet {stateLabels[selected.localState].toLowerCase()}
                    </StatusPill>
                    <StatusPill tone="warning">
                      Provider: {providerEvidenceLabel(selected)}
                    </StatusPill>
                    {selected.immutable ? (
                      <StatusPill tone="info">Immutable v{selected.version}</StatusPill>
                    ) : (
                      <StatusPill tone="neutral">Local draft version</StatusPill>
                    )}
                  </div>
                  <h2 className="mt-3 text-xl font-bold tracking-[-0.025em] text-slate-950">
                    {selected.displayName}
                  </h2>
                  <p className="mt-1 break-all font-mono text-[11px] leading-5 text-slate-500">
                    {selected.kind === "flow" ? `${selected.definitionId} · ` : ""}
                    {selected.name} · {selected.language} · v{selected.version}
                  </p>
                </div>
                <span className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-slate-200 px-4 text-xs font-bold text-slate-600">
                  <LockKeyhole size={14} aria-hidden="true" /> Provider submission unavailable
                </span>
              </div>
              <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-3">
                <div className="rounded-xl bg-slate-50 p-3">
                  <dt className="text-slate-500">SafeNet governance</dt>
                  <dd className="mt-1 font-bold text-slate-800">
                    {stateLabels[selected.localState]}
                  </dd>
                </div>
                <div className="rounded-xl bg-slate-50 p-3">
                  <dt className="text-slate-500">Provider evidence</dt>
                  <dd className="mt-1 font-bold text-slate-800">
                    {providerEvidenceLabel(selected)}
                  </dd>
                </div>
                <div className="rounded-xl bg-slate-50 p-3">
                  <dt className="text-slate-500">Persisted metadata updated</dt>
                  <dd className="mt-1 font-bold text-slate-800">
                    {formatTimestamp(selected.updatedAt)}
                  </dd>
                </div>
              </dl>
              <p className="mt-3 text-[11px] leading-5 text-slate-500">
                {selected.ownershipNotice} Provider identifiers are intentionally not rendered.
              </p>
            </div>

            <div className="grid gap-6 p-4 sm:p-5 2xl:grid-cols-[minmax(320px,0.8fr)_minmax(360px,1fr)]">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    {selected.kind === "flow" ? (
                      <GitBranch
                        size={16}
                        className="text-[var(--brand)]"
                        aria-hidden="true"
                      />
                    ) : (
                      <Languages
                        size={16}
                        className="text-[var(--brand)]"
                        aria-hidden="true"
                      />
                    )}
                    <h3 className="text-sm font-bold text-slate-950">
                      {selected.kind === "flow"
                        ? "Matched versioned screen contract"
                        : "Persisted variable rules"}
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={resetPreview}
                    className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[11px] font-bold text-slate-700 hover:bg-slate-50"
                  >
                    <RotateCcw size={12} aria-hidden="true" /> Reset local preview
                  </button>
                </div>
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  {selected.kind === "flow"
                    ? `${selected.language} is persisted language metadata; the screen copy below is a shared inert renderer, not localized provider content. No provider-localized Flow asset has been created.`
                    : "Edits affect this browser page only. They are never persisted, provider-submitted or sent externally."}
                </p>
                <div className="mt-4">
                  {selected.kind === "flow" ? (
                    <ol className="space-y-2">
                      {selected.flowScreens.map((screen, index) => (
                        <li
                          key={screen.id}
                          className="flex gap-3 rounded-xl border border-slate-200 p-3"
                        >
                          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-[var(--brand-soft)] text-[11px] font-bold text-[var(--brand)]">
                            {index + 1}
                          </span>
                          <span className="min-w-0">
                            <span className="block text-xs font-bold text-slate-800">
                              {screen.title}
                            </span>
                            <span className="mt-0.5 block break-all font-mono text-[9px] text-slate-400">
                              {screen.id}
                            </span>
                            <span className="mt-1 block text-[11px] leading-4 text-slate-500">
                              {screen.description}
                            </span>
                          </span>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <VariableEditor
                      asset={selected}
                      values={currentValues}
                      onChange={(key, value) =>
                        setVariableValues((current) => ({
                          ...current,
                          [selected.id]: {
                            ...(current[selected.id] ?? defaultVariableValues(selected)),
                            [key]: value,
                          },
                        }))
                      }
                    />
                  )}
                </div>

                <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
                  <div className="flex items-center gap-2 text-xs font-bold text-amber-900">
                    <ShieldCheck size={15} aria-hidden="true" /> Controlled fallback
                  </div>
                  <p className="mt-2 text-[11px] leading-5 text-amber-800">
                    {selected.fallback}
                  </p>
                </div>

                <div className="mt-4 rounded-xl border border-slate-200 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-bold text-slate-800">
                      Preview validation
                    </span>
                    <StatusPill tone={invalidCount === 0 ? "success" : "danger"}>
                      {invalidCount === 0
                        ? "Preview valid"
                        : `${invalidCount} issue${invalidCount === 1 ? "" : "s"}`}
                    </StatusPill>
                  </div>
                  <ul className="mt-3 space-y-2 text-[11px] text-slate-600">
                    <li className="flex gap-2">
                      <Check
                        size={13}
                        className="shrink-0 text-emerald-600"
                        aria-hidden="true"
                      />
                      SafeNet internal approval is distinct from provider approval.
                    </li>
                    <li className="flex gap-2">
                      <Check
                        size={13}
                        className="shrink-0 text-emerald-600"
                        aria-hidden="true"
                      />
                      Persisted released versions and identity metadata remain immutable.
                    </li>
                    <li className="flex gap-2">
                      <CircleAlert
                        size={13}
                        className="shrink-0 text-amber-600"
                        aria-hidden="true"
                      />
                      Hemas-owned provider setup and approval are later external gates.
                    </li>
                  </ul>
                </div>
              </div>

              <div className="min-w-0 rounded-2xl bg-slate-100 p-4 sm:p-6">
                <div className="mb-5 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Smartphone size={16} className="text-slate-600" aria-hidden="true" />
                    <h3 className="text-sm font-bold text-slate-900">
                      Page-local patient-view simulation
                    </h3>
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-bold uppercase tracking-[0.05em] text-slate-500">
                    <Play size={10} aria-hidden="true" /> inert only
                  </span>
                </div>
                {selected.kind === "flow" ? (
                  <FlowPreview
                    key={`${selected.id}:${previewRevision}`}
                    asset={selected}
                  />
                ) : (
                  <MessagePreview asset={selected} values={currentValues} />
                )}
              </div>
            </div>
            </div>
          ) : (
            <NoMatchingAssetDetail onReset={resetFilters} />
          )}
        </div>
      </section>
    </>
  );
}

function VerifiedTemplateStudio({ session }: { session: VerifiedWorkspaceSession }) {
  const workspace = useTemplateWorkspace(session);
  return (
    <div className="space-y-6 lg:space-y-8">
      <StudioHeading />
      {workspace.status === "loading" ? (
        <WorkspaceStateCard
          kind="loading"
          message="Verifying the role and loading bounded template and Flow queries from the local Firestore emulator. No fixture fallback is used."
        />
      ) : workspace.status === "denied" ? (
        <WorkspaceStateCard
          kind="denied"
          message={workspace.message}
          onRetry={workspace.retry}
        />
      ) : workspace.status === "error" ? (
        <WorkspaceStateCard
          kind="error"
          message={workspace.message}
          onRetry={workspace.retry}
        />
      ) : workspace.result.assets.length === 0 ? (
        <WorkspaceStateCard
          kind="empty"
          message="The authenticated tenant-scoped reads succeeded, but no synthetic templates or Flows exist. No fixture content was substituted."
          onRetry={workspace.retry}
        />
      ) : (
        <PersistedTemplateStudio result={workspace.result} />
      )}
    </div>
  );
}

export function TemplateStudio() {
  const workspace = useWorkspaceSession();
  if (workspace.status === "verified" && workspace.session) {
    return <VerifiedTemplateStudio session={workspace.session} />;
  }
  return (
    <div className="space-y-6 lg:space-y-8">
      <StudioHeading />
      <WorkspaceStateCard
        kind={workspace.status === "checking" ? "loading" : "denied"}
        message={
          workspace.status === "checking"
            ? "Waiting for an active synthetic workspace and membership to be verified."
            : workspace.message ??
              "An active synthetic workspace membership is required before catalogue reads."
        }
      />
    </div>
  );
}
