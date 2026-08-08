"use client";

import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  FlaskConical,
  Languages,
  MapPin,
  MessageSquareOff,
  Play,
  Route,
  ShieldAlert,
  UserRoundCheck,
  UsersRound,
} from "lucide-react";
import { useState } from "react";
import type { LocationId, SupportedLanguage } from "@/lib/domain";
import { DEMO_IDS, demoLocations, demoTeams } from "@/lib/demo";
import {
  LANGUAGE_LABELS,
  ROUTING_INTENT_LABELS,
  locationForId,
  queueOwner,
  simulateRouting,
} from "./policy-model";
import type { RoutingInput, RoutingIntent, RoutingResult } from "./types";

function displayTime(value: string): string {
  return new Intl.DateTimeFormat("en-LK", {
    timeZone: "Asia/Colombo",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

export function RoutingSimulator({ onAnnounce }: { readonly onAnnounce: (message: string) => void }) {
  const [language, setLanguage] = useState<SupportedLanguage>("en");
  const [locationId, setLocationId] = useState<LocationId>(DEMO_IDS.locations.wattala);
  const [intent, setIntent] = useState<RoutingIntent>("appointment");
  const [result, setResult] = useState<RoutingResult | null>(null);
  const [runCount, setRunCount] = useState(0);

  function runSimulation() {
    const input: RoutingInput = { language, locationId, intent };
    const next = simulateRouting(input);
    setResult(next);
    setRunCount((count) => count + 1);
    onAnnounce(
      next.outcome === "routed"
        ? `Local routing result: ${next.team.name}. No queue was changed.`
        : "Local routing result: held for supervised triage. No queue was changed.",
    );
  }

  return (
    <div className="space-y-4">
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,.75fr)]">
        <article className="rounded-2xl border border-[var(--line)] bg-white p-4 sm:p-5" aria-labelledby="routing-test-title">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-cyan-50 text-cyan-700"><Route size={19} aria-hidden="true" /></span>
              <div>
                <p className="text-[9px] font-bold uppercase tracking-[0.08em] text-cyan-700">Deterministic local test</p>
                <h2 id="routing-test-title" className="mt-1 text-base font-bold text-slate-950">Language + location + intent → queue</h2>
                <p className="mt-1 max-w-2xl text-[11px] leading-5 text-slate-500">The same inputs always return the same fixture result. Missing routes enter a supervised hold; no backend queue or patient record is touched.</p>
              </div>
            </div>
            <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[9px] font-bold text-slate-600">Runs: {runCount}</span>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <label>
              <span className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold text-slate-700"><Languages size={12} aria-hidden="true" /> Language</span>
              <select
                value={language}
                onChange={(event) => setLanguage(event.target.value as SupportedLanguage)}
                className="h-11 w-full rounded-xl border border-[var(--line)] bg-white px-3 text-xs font-semibold text-slate-800 outline-none focus:border-[var(--brand)]"
              >
                {Object.entries(LANGUAGE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label>
              <span className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold text-slate-700"><MapPin size={12} aria-hidden="true" /> Location</span>
              <select
                value={locationId}
                onChange={(event) => setLocationId(event.target.value as LocationId)}
                className="h-11 w-full rounded-xl border border-[var(--line)] bg-white px-3 text-xs font-semibold text-slate-800 outline-none focus:border-[var(--brand)]"
              >
                {demoLocations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
              </select>
            </label>
            <label>
              <span className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold text-slate-700"><UsersRound size={12} aria-hidden="true" /> Intent</span>
              <select
                value={intent}
                onChange={(event) => setIntent(event.target.value as RoutingIntent)}
                className="h-11 w-full rounded-xl border border-[var(--line)] bg-white px-3 text-xs font-semibold text-slate-800 outline-none focus:border-[var(--brand)]"
              >
                {Object.entries(ROUTING_INTENT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
          </div>

          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <button
              type="button"
              onClick={runSimulation}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-4 text-xs font-bold text-white shadow-sm hover:bg-[var(--brand-strong)]"
            >
              <Play size={14} fill="currentColor" aria-hidden="true" /> Run local routing test
            </button>
            <p className="flex items-center gap-1.5 text-[10px] leading-4 text-slate-500"><FlaskConical size={12} className="shrink-0" aria-hidden="true" /> Fixed simulation clock · {displayTime("2026-08-07T12:30:00.000Z")} Asia/Colombo</p>
          </div>

          {result ? (
            <div className={`mt-5 rounded-2xl border p-4 ${result.outcome === "routed" ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`} aria-live="polite">
              <div className="flex items-start gap-3">
                <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${result.outcome === "routed" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>
                  {result.outcome === "routed" ? <CheckCircle2 size={19} aria-hidden="true" /> : <ShieldAlert size={19} aria-hidden="true" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[9px] font-bold uppercase tracking-[0.08em] text-slate-500">Local result</p>
                  <h3 className={`mt-1 text-sm font-bold ${result.outcome === "routed" ? "text-emerald-950" : "text-amber-950"}`}>
                    {result.outcome === "routed" ? result.team.name : "Supervised holding queue"}
                  </h3>
                  <p className={`mt-1 text-[11px] leading-5 ${result.outcome === "routed" ? "text-emerald-800" : "text-amber-800"}`}>{result.reason}</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[9px] font-bold">
                <span className="rounded-full bg-white px-2.5 py-1 text-slate-700">{result.languageLane}</span>
                <ArrowRight size={12} className="text-slate-400" aria-hidden="true" />
                <span className="rounded-full bg-white px-2.5 py-1 text-slate-700">{locationForId(result.input.locationId).name}</span>
                <ArrowRight size={12} className="text-slate-400" aria-hidden="true" />
                <span className="rounded-full bg-white px-2.5 py-1 text-slate-700">{ROUTING_INTENT_LABELS[result.input.intent]}</span>
              </div>
              {result.outcome === "routed" ? (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <div className="rounded-xl bg-white px-3 py-2.5">
                    <p className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.06em] text-slate-400"><UserRoundCheck size={11} aria-hidden="true" /> SLA owner</p>
                    <p className="mt-1 text-[11px] font-bold text-slate-900">{result.owner.displayLabel}</p>
                  </div>
                  <div className="rounded-xl bg-white px-3 py-2.5">
                    <p className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.06em] text-slate-400"><Clock3 size={11} aria-hidden="true" /> First response due</p>
                    <p className="mt-1 text-[11px] font-bold text-slate-900">{displayTime(result.slaDueAt)} · {result.team.firstResponseSlaMinutes} min SLA</p>
                  </div>
                </div>
              ) : (
                <p className="mt-3 flex items-start gap-1.5 rounded-xl bg-white px-3 py-2 text-[10px] font-semibold leading-4 text-amber-800"><MessageSquareOff size={12} className="mt-0.5 shrink-0" aria-hidden="true" /> No external message, assignment, or clinical response was created.</p>
              )}
            </div>
          ) : (
            <div className="mt-5 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-5 text-center">
              <Route className="mx-auto text-slate-400" size={20} aria-hidden="true" />
              <p className="mt-2 text-xs font-bold text-slate-800">No routing result yet</p>
              <p className="mt-1 text-[10px] text-slate-500">Choose deterministic inputs and run the local test.</p>
            </div>
          )}
        </article>

        <aside className="rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:p-5" aria-labelledby="routing-safety-title">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-800"><AlertTriangle size={18} aria-hidden="true" /></span>
            <div>
              <h2 id="routing-safety-title" className="text-sm font-bold text-amber-950">Routing safety order</h2>
              <p className="mt-1 text-[11px] leading-5 text-amber-800">Safety and scope checks precede convenience routing.</p>
            </div>
          </div>
          <ol className="mt-4 space-y-2.5">
            {[
              ["1", "Urgent-language safeguard", "Clinical queue or supervised hold; never AI advice."],
              ["2", "Workspace + location scope", "No eligible queue means fail closed."],
              ["3", "Intent match", "Route only to a queue that owns the service."],
              ["4", "Language lane", "Preserve English, Sinhala, or Tamil preference."],
              ["5", "SLA owner", "Name an accountable synthetic membership."],
            ].map(([number, title, detail]) => (
              <li key={number} className="flex gap-2.5 rounded-xl border border-amber-100 bg-white/80 p-3">
                <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-amber-700 text-[9px] font-bold text-white">{number}</span>
                <span>
                  <span className="block text-[10px] font-bold text-amber-950">{title}</span>
                  <span className="mt-0.5 block text-[9px] leading-4 text-amber-800">{detail}</span>
                </span>
              </li>
            ))}
          </ol>
        </aside>
      </section>

      <section className="rounded-2xl border border-[var(--line)] bg-white p-4 sm:p-5" aria-labelledby="queue-ownership-title">
        <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
          <div>
            <p className="text-[9px] font-bold uppercase tracking-[0.08em] text-[var(--brand)]">Queue ownership</p>
            <h2 id="queue-ownership-title" className="mt-1 text-base font-bold text-slate-950">Active synthetic SLAs</h2>
            <p className="mt-1 text-[11px] text-slate-500">Read-only queue fixtures; routing and ownership changes are unavailable.</p>
          </div>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[9px] font-bold text-slate-600">{demoTeams.length} queues</span>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          {demoTeams.map((team) => {
            const owner = queueOwner(team);
            const coveredLocations = demoLocations.filter((location) => team.locationIds.includes(location.id));
            return (
              <article key={team.id} className="rounded-2xl border border-[var(--line)] bg-slate-50 p-4">
                <div className="flex items-start justify-between gap-3">
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-white text-slate-700"><UsersRound size={16} aria-hidden="true" /></span>
                  <span className="rounded-full bg-emerald-50 px-2 py-1 text-[9px] font-bold text-emerald-700">Active fixture</span>
                </div>
                <h3 className="mt-3 text-sm font-bold text-slate-950">{team.name}</h3>
                <p className="mt-1 text-[10px] leading-4 text-slate-500">{team.businessHoursLabel}</p>
                <dl className="mt-3 space-y-2 border-t border-slate-200 pt-3">
                  <div className="flex items-start justify-between gap-3">
                    <dt className="text-[9px] font-bold uppercase tracking-[0.05em] text-slate-400">First response</dt>
                    <dd className="text-[10px] font-bold text-slate-900">{team.firstResponseSlaMinutes} min</dd>
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <dt className="text-[9px] font-bold uppercase tracking-[0.05em] text-slate-400">SLA owner</dt>
                    <dd className="max-w-[60%] text-right text-[10px] font-bold text-slate-900">{owner.displayLabel}</dd>
                  </div>
                </dl>
                <div className="mt-3 flex flex-wrap gap-1">
                  {coveredLocations.map((location) => <span key={location.id} className="rounded-full bg-white px-2 py-1 text-[8px] font-semibold text-slate-600">{location.name}</span>)}
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
