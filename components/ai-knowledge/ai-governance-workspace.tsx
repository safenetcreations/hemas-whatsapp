"use client";

import {
  AlertTriangle,
  Ban,
  Bot,
  BrainCircuit,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  FileClock,
  FileText,
  Hand,
  Languages,
  LockKeyhole,
  Play,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  UserRoundCheck,
} from "lucide-react";
import { useMemo, useState } from "react";
import { StatusPill } from "@/components/ui/status-pill";
import {
  knowledgeSources,
  safetyScenarios,
  type KnowledgeSource,
  type KnowledgeStatus,
  type SafetyScenario,
} from "./ai-governance-data";

const sourceTone: Record<KnowledgeStatus, "success" | "warning" | "neutral"> = {
  approved: "success",
  review: "warning",
  expired: "neutral",
};

const sourceLabel: Record<KnowledgeStatus, string> = {
  approved: "Approved",
  review: "Review",
  expired: "Expired",
};

function SourceList({
  sources,
  selectedId,
  onSelect,
}: {
  sources: KnowledgeSource[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  if (sources.length === 0) {
    return (
      <div className="grid min-h-44 place-items-center px-5 py-8 text-center">
        <div><FileText className="mx-auto text-slate-300" size={26} aria-hidden="true" /><p className="mt-2 text-sm font-bold text-slate-800">No matching sources</p><p className="mt-1 text-xs text-slate-500">Try another title, owner, or status.</p></div>
      </div>
    );
  }

  return (
    <div className="divide-y divide-[var(--line)]" role="list" aria-label="Synthetic knowledge sources">
      {sources.map((source) => (
        <button key={source.id} type="button" onClick={() => onSelect(source.id)} className={`flex w-full items-start gap-3 px-4 py-3.5 text-left transition ${selectedId === source.id ? "bg-[var(--brand-soft)]" : "hover:bg-slate-50"}`} aria-current={selectedId === source.id ? "true" : undefined}>
          <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg ${source.status === "approved" ? "bg-white text-[var(--brand)]" : "bg-slate-100 text-slate-500"}`}>
            {source.status === "expired" ? <FileClock size={15} aria-hidden="true" /> : <FileText size={15} aria-hidden="true" />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-xs font-bold text-slate-900">{source.title}</span>
            <span className="mt-1 block truncate text-[10px] text-slate-500">{source.owner} · v{source.version}</span>
            <span className="mt-2 flex items-center gap-2"><StatusPill tone={sourceTone[source.status]}>{sourceLabel[source.status]}</StatusPill><span className="text-[10px] font-semibold text-slate-500">{source.language}</span></span>
          </span>
          <ChevronRight size={14} className="mt-2 shrink-0 text-slate-400" aria-hidden="true" />
        </button>
      ))}
    </div>
  );
}

function SourceDetail({ source }: { source: KnowledgeSource }) {
  return (
    <article className="rounded-2xl border border-[var(--line)] bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--brand)]">Selected source</p><h3 className="mt-1 text-base font-bold text-slate-950">{source.title}</h3></div>
        <StatusPill tone={sourceTone[source.status]}>{sourceLabel[source.status]}</StatusPill>
      </div>
      <dl className="mt-4 grid gap-2 text-[11px] sm:grid-cols-2">
        <div className="rounded-xl bg-slate-50 p-3"><dt className="text-slate-500">Owner</dt><dd className="mt-1 font-bold text-slate-800">{source.owner}</dd></div>
        <div className="rounded-xl bg-slate-50 p-3"><dt className="text-slate-500">Effective window</dt><dd className="mt-1 font-bold text-slate-800">{source.effectiveWindow}</dd></div>
      </dl>
      <p className="mt-4 text-xs leading-5 text-slate-600">{source.summary}</p>
      <div className="mt-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.06em] text-slate-500">Versioned approved facts</p>
        <ul className="mt-2 space-y-2">
          {source.facts.map((fact) => <li key={fact} className="flex gap-2 text-[11px] leading-5 text-slate-600"><Check size={13} className="mt-0.5 shrink-0 text-emerald-600" aria-hidden="true" />{fact}</li>)}
        </ul>
      </div>
      {source.status !== "approved" ? (
        <div className="mt-4 flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] leading-5 text-amber-800"><Ban className="mt-0.5 shrink-0" size={14} aria-hidden="true" />This source is excluded from retrieval because it is not currently approved and effective.</div>
      ) : null}
    </article>
  );
}

function Pipeline({ scenario }: { scenario: SafetyScenario }) {
  const steps = [
    { label: "Tenant & consent guard", detail: "SafeNet synthetic workspace · no live patient", state: "pass" },
    { label: "Language detector", detail: `${scenario.language.toUpperCase()} · ${Math.round(scenario.languageConfidence * 100)}% confidence`, state: scenario.languageConfidence >= 0.7 ? "pass" : "hold" },
    { label: "Intent & deterministic safety", detail: `${scenario.intent} · urgency ${scenario.urgency}`, state: scenario.urgency === "urgent" ? "blocked" : "pass" },
    { label: "Approved knowledge retrieval", detail: scenario.sourceIds.length ? `${scenario.sourceIds.length} approved source${scenario.sourceIds.length === 1 ? "" : "s"}` : "No eligible fact selected", state: scenario.sourceIds.length ? "pass" : "hold" },
    { label: "Content draft", detail: scenario.draft ? "Constrained local draft created" : "Draft suppressed", state: scenario.draft ? "pass" : "blocked" },
    { label: "Strict reviewer", detail: scenario.pass ? "Machine-readable pass" : "Failed closed", state: scenario.pass ? "pass" : "blocked" },
    { label: "Sender / handoff controller", detail: scenario.pass ? "Preview only — external send disabled" : scenario.nextAction, state: scenario.pass ? "hold" : "blocked" },
  ];

  return (
    <ol className="space-y-2" aria-label="AI orchestration trace">
      {steps.map((step, index) => (
        <li key={step.label} className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3">
          <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-[10px] font-bold ${step.state === "pass" ? "bg-emerald-50 text-emerald-700" : step.state === "hold" ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700"}`}>{index + 1}</span>
          <span className="min-w-0 flex-1"><span className="block text-xs font-bold text-slate-800">{step.label}</span><span className="mt-1 block text-[10px] leading-4 text-slate-500">{step.detail}</span></span>
          {step.state === "pass" ? <CheckCircle2 size={15} className="mt-1 shrink-0 text-emerald-600" aria-hidden="true" /> : step.state === "hold" ? <CircleAlert size={15} className="mt-1 shrink-0 text-amber-600" aria-hidden="true" /> : <ShieldAlert size={15} className="mt-1 shrink-0 text-red-600" aria-hidden="true" />}
        </li>
      ))}
    </ol>
  );
}

function ReviewDecision({ scenario }: { scenario: SafetyScenario }) {
  return (
    <article className={`rounded-2xl border p-4 sm:p-5 ${scenario.pass ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}`} aria-live="polite">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${scenario.pass ? "bg-white text-emerald-700" : "bg-white text-red-700"}`}>{scenario.pass ? <ShieldCheck size={18} aria-hidden="true" /> : <ShieldAlert size={18} aria-hidden="true" />}</span>
          <div><p className={`text-sm font-bold ${scenario.pass ? "text-emerald-950" : "text-red-950"}`}>Reviewer: {scenario.pass ? "PASS" : "FAIL CLOSED"}</p><p className={`mt-1 text-[11px] ${scenario.pass ? "text-emerald-800" : "text-red-800"}`}>Hidden reasoning is not stored. Only this structured decision is retained in the simulation.</p></div>
        </div>
        <StatusPill tone={scenario.handoffRequired ? "danger" : scenario.pass ? "success" : "warning"}>{scenario.handoffRequired ? "Human handoff" : scenario.pass ? "Preview allowed" : "Policy action"}</StatusPill>
      </div>
      <dl className="mt-4 grid gap-2 text-[10px] sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg bg-white/80 p-2.5"><dt className="text-slate-500">Unsupported claim</dt><dd className="mt-1 font-bold text-slate-800">{String(scenario.unsupportedClaim)}</dd></div>
        <div className="rounded-lg bg-white/80 p-2.5"><dt className="text-slate-500">Clinical safety</dt><dd className="mt-1 font-bold text-slate-800">{scenario.clinicalSafety}</dd></div>
        <div className="rounded-lg bg-white/80 p-2.5"><dt className="text-slate-500">Privacy</dt><dd className="mt-1 font-bold text-slate-800">{scenario.privacy}</dd></div>
        <div className="rounded-lg bg-white/80 p-2.5"><dt className="text-slate-500">Service window</dt><dd className="mt-1 font-bold text-slate-800">{scenario.serviceWindow}</dd></div>
      </dl>
      <div className="mt-3 flex flex-wrap gap-1.5">{scenario.reasons.map((reason) => <code key={reason} className="rounded-md bg-white/80 px-2 py-1 text-[10px] font-bold text-slate-700">{reason}</code>)}</div>
      <div className="mt-4 rounded-xl bg-white/80 p-3"><p className="text-[10px] font-bold uppercase tracking-[0.05em] text-slate-500">Required next action</p><p className="mt-1 text-xs font-semibold leading-5 text-slate-800">{scenario.nextAction}</p></div>
    </article>
  );
}

export function AIGovernanceWorkspace() {
  const [sourceQuery, setSourceQuery] = useState("");
  const [sourceStatus, setSourceStatus] = useState<"all" | KnowledgeStatus>("all");
  const [selectedSourceId, setSelectedSourceId] = useState(knowledgeSources[0].id);
  const [selectedScenarioId, setSelectedScenarioId] = useState(safetyScenarios[0].id);
  const [runId, setRunId] = useState(0);
  const [hasRun, setHasRun] = useState(false);

  const filteredSources = useMemo(() => {
    const normalized = sourceQuery.trim().toLowerCase();
    return knowledgeSources.filter((source) => (!normalized || `${source.title} ${source.owner} ${source.language}`.toLowerCase().includes(normalized)) && (sourceStatus === "all" || source.status === sourceStatus));
  }, [sourceQuery, sourceStatus]);

  const selectedSource = knowledgeSources.find((source) => source.id === selectedSourceId) ?? knowledgeSources[0];
  const selectedScenario = safetyScenarios.find((scenario) => scenario.id === selectedScenarioId) ?? safetyScenarios[0];

  const runScenario = () => {
    setHasRun(true);
    setRunId((current) => current + 1);
  };

  return (
    <div className="space-y-6 lg:space-y-8">
      <section className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]"><Bot size={21} aria-hidden="true" /></span>
          <div><p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--brand)]">Assisted service</p><h1 className="mt-1 text-2xl font-bold tracking-[-0.035em] text-slate-950 sm:text-3xl">AI &amp; Knowledge</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">Inspect approved sources and run a deterministic safety pipeline. This workspace does not call an AI provider, diagnose, interpret reports, or send messages.</p></div>
        </div>
        <button type="button" disabled title="Production AI remains locked until Hemas governance and provider terms are approved" className="inline-flex h-10 cursor-not-allowed items-center justify-center gap-2 rounded-xl bg-slate-300 px-4 text-sm font-semibold text-white"><LockKeyhole size={15} aria-hidden="true" /> Production AI locked</button>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="AI governance summary">
        {[
          ["Approved sources", "3", "Effective synthetic versions"],
          ["Provider requests", "0", "No model API configured"],
          ["Clinical outputs", "0", "Diagnosis and advice prohibited"],
          ["Kill switch", "ON", "External generation disabled"],
        ].map(([label, value, detail]) => <article key={label} className="rounded-2xl border border-[var(--line)] bg-white p-4 sm:p-5"><p className="text-xs font-semibold text-[var(--muted)]">{label}</p><p className="mt-2 text-2xl font-bold tracking-[-0.03em] text-slate-950">{value}</p><p className="mt-2 text-[11px] leading-5 text-slate-500">{detail}</p></article>)}
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(310px,0.72fr)_minmax(0,1.28fr)]">
        <article className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white">
          <div className="border-b border-[var(--line)] p-4 sm:p-5"><h2 className="text-[15px] font-bold text-slate-950">Knowledge governance</h2><p className="mt-1 text-xs text-slate-500">Only approved, effective versions are retrievable</p><label className="relative mt-4 block"><Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={14} aria-hidden="true" /><span className="sr-only">Search knowledge sources</span><input value={sourceQuery} onChange={(event) => setSourceQuery(event.target.value)} type="search" placeholder="Search source or owner" className="h-10 w-full rounded-xl border border-[var(--line)] bg-slate-50 pl-9 pr-3 text-xs outline-none focus:border-[var(--brand)] focus:bg-white" /></label><label className="mt-2 block"><span className="sr-only">Filter source approval status</span><select value={sourceStatus} onChange={(event) => setSourceStatus(event.target.value as "all" | KnowledgeStatus)} className="h-9 w-full rounded-lg border border-[var(--line)] bg-white px-3 text-xs font-semibold text-slate-700"><option value="all">All governance states</option><option value="approved">Approved only</option><option value="review">In review</option><option value="expired">Expired</option></select></label></div>
          <SourceList sources={filteredSources} selectedId={selectedSource.id} onSelect={setSelectedSourceId} />
        </article>
        <div className="space-y-4">
          <SourceDetail source={selectedSource} />
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-5"><div className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white text-slate-700"><BrainCircuit size={18} aria-hidden="true" /></span><div><h3 className="text-sm font-bold text-slate-900">Retrieval boundary</h3><p className="mt-1 text-xs leading-5 text-slate-600">Draft and expired sources remain visible for governance but are excluded from assistant context. No unrestricted EHR, report body, hidden reasoning, or patient content is available here.</p></div></div></div>
        </div>
      </section>

      <section className="rounded-2xl border border-[var(--line)] bg-white p-4 sm:p-5 lg:p-6">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div><div className="flex items-center gap-2"><Sparkles size={17} className="text-[var(--brand)]" aria-hidden="true" /><h2 className="text-[15px] font-bold text-slate-950">Deterministic safety reviewer</h2></div><p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">Choose a fixed synthetic prompt and observe the typed orchestration result. No prompt is sent across the network.</p></div>
          <button type="button" onClick={runScenario} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-4 text-sm font-bold text-white hover:bg-[var(--brand-strong)]"><Play size={14} aria-hidden="true" /> Run local review</button>
        </div>
        <div className="mt-5 flex gap-2 overflow-x-auto pb-2 scrollbar-subtle" role="tablist" aria-label="Safety test prompts">
          {safetyScenarios.map((scenario) => <button key={scenario.id} type="button" role="tab" aria-selected={selectedScenario.id === scenario.id} onClick={() => { setSelectedScenarioId(scenario.id); setHasRun(false); }} className={`shrink-0 rounded-xl border px-3 py-2 text-xs font-bold ${selectedScenario.id === scenario.id ? "border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"}`}>{scenario.label}</button>)}
        </div>
        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-4"><div className="flex items-start gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white text-slate-600"><Languages size={15} aria-hidden="true" /></span><div><p className="text-[10px] font-bold uppercase tracking-[0.05em] text-slate-500">Synthetic inbound message</p><p className="mt-1 text-sm font-semibold leading-6 text-slate-900">“{selectedScenario.message}”</p></div></div></div>

        {!hasRun ? (
          <div className="mt-5 grid min-h-52 place-items-center rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center"><div><BrainCircuit className="mx-auto text-slate-300" size={30} aria-hidden="true" /><p className="mt-3 text-sm font-bold text-slate-800">Ready for a local policy run</p><p className="mt-1 text-xs text-slate-500">The result is deterministic and creates no external side effect.</p></div></div>
        ) : (
          <div key={runId} className="mt-5 grid gap-5 xl:grid-cols-[minmax(300px,0.8fr)_minmax(0,1.2fr)]">
            <div><div className="mb-3 flex items-center justify-between gap-3"><h3 className="text-sm font-bold text-slate-900">Orchestration trace</h3><span className="text-[10px] font-bold uppercase tracking-[0.05em] text-slate-500">run SYN-AI-{String(runId).padStart(3, "0")}</span></div><Pipeline scenario={selectedScenario} /></div>
            <div className="space-y-4">
              <ReviewDecision scenario={selectedScenario} />
              {selectedScenario.draft ? <article className="rounded-2xl border border-cyan-200 bg-cyan-50 p-4"><div className="flex items-center gap-2 text-xs font-bold text-cyan-950"><Bot size={15} aria-hidden="true" /> Constrained response preview</div><p className="mt-2 text-sm leading-6 text-cyan-900">{selectedScenario.draft}</p><div className="mt-3 flex gap-2 rounded-xl bg-white/80 p-3 text-[11px] leading-5 text-cyan-900"><Hand className="mt-0.5 shrink-0" size={14} aria-hidden="true" />External send is still disabled. A passing review permits only this local preview.</div></article> : null}
              {selectedScenario.handoffRequired ? <article className="rounded-2xl border border-amber-200 bg-amber-50 p-4"><div className="flex items-center gap-2 text-xs font-bold text-amber-950"><UserRoundCheck size={15} aria-hidden="true" /> Human ownership required</div><p className="mt-2 text-[11px] leading-5 text-amber-900">Ordinary automation cannot continue. This local event is traceable, but it does not contact a real queue or claim clinical review.</p></article> : null}
              {selectedScenario.urgency === "urgent" ? <article className="rounded-2xl border-2 border-red-300 bg-red-50 p-4"><div className="flex items-center gap-2 text-xs font-bold text-red-950"><AlertTriangle size={16} aria-hidden="true" /> Urgent safety hold</div><p className="mt-2 text-[11px] leading-5 text-red-900">AI cannot reassure, downgrade, close, or resume this journey. Only an authorized human may change the escalation state.</p></article> : null}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
