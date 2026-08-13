"use client";

import {
  AlertTriangle,
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  CircleStop,
  Clock3,
  FlaskConical,
  Languages,
  LoaderCircle,
  MessageSquareText,
  PauseCircle,
  Play,
  RotateCcw,
  ShieldCheck,
  UserRoundCheck,
  Users,
  Workflow,
} from "lucide-react";
import { useState } from "react";
import { StatusPill } from "@/components/ui/status-pill";

type Scenario = {
  id: string;
  name: string;
  summary: string;
  language: string;
  sample: string;
  route: string;
  icon: typeof Bot;
  steps: readonly string[];
  assertion: string;
};

const scenarios: readonly Scenario[] = [
  {
    id: "ta-appointment",
    name: "Tamil appointment enquiry",
    summary: "Detect Tamil, route to appointments, and offer a mock booking Flow.",
    language: "தமிழ்",
    sample: "எனக்கு ஒரு மருத்துவர் சந்திப்பு பதிவு செய்ய வேண்டும்.",
    route: "Appointments · Wattala demo queue",
    icon: MessageSquareText,
    steps: [
      "Create synthetic inbound event",
      "Detect Tamil with high confidence",
      "Classify appointment-booking intent",
      "Check service window and consent purpose",
      "Offer local appointment Flow simulation",
      "Prepare human handoff context",
    ],
    assertion: "No real slot or appointment is created.",
  },
  {
    id: "si-lab",
    name: "Sinhala laboratory enquiry",
    summary: "Route a lab question without accepting or interpreting a medical report.",
    language: "සිංහල",
    sample: "මගේ පරීක්ෂණ වාර්තාව සූදානම්ද කියලා බලන්න පුළුවන්ද?",
    route: "Laboratory services · synthetic network",
    icon: FlaskConical,
    steps: [
      "Create synthetic inbound event",
      "Detect Sinhala with high confidence",
      "Classify report-status intent",
      "Block result interpretation",
      "Look up mock report-ready metadata",
      "Offer secure-portal handoff simulation",
    ],
    assertion: "No report value or diagnosis enters the chat.",
  },
  {
    id: "mixed-handoff",
    name: "Mixed-language low confidence",
    summary: "Demonstrate that the assistant hands off instead of guessing.",
    language: "Mixed",
    sample: "Doctor booking venum, but location eka sure naha.",
    route: "General patient services · human review",
    icon: UserRoundCheck,
    steps: [
      "Create synthetic inbound event",
      "Detect mixed language and low confidence",
      "Avoid autonomous intent commitment",
      "Generate a bounded handoff summary",
      "Assign to human queue",
      "Pause assistant mode",
    ],
    assertion: "Low confidence cannot trigger an external action.",
  },
  {
    id: "urgent",
    name: "Urgent-language escalation",
    summary: "Trigger deterministic urgent copy and immediate human escalation.",
    language: "English",
    sample: "This is urgent and I need immediate medical help.",
    route: "Urgent escalation · supervisor queue",
    icon: AlertTriangle,
    steps: [
      "Create synthetic inbound event",
      "Run urgent-language rule before AI",
      "Show approved emergency-direction copy",
      "Block routine automation",
      "Escalate to supervisor queue",
      "Record redacted safety audit event",
    ],
    assertion: "The prototype never presents itself as emergency care.",
  },
  {
    id: "stop",
    name: "STOP and suppression",
    summary: "Apply a marketing suppression before any queued campaign work.",
    language: "Trilingual",
    sample: "STOP",
    route: "Consent & preference workflow",
    icon: CircleStop,
    steps: [
      "Create synthetic inbound STOP event",
      "Match configured withdrawal variants",
      "Append consent and suppression evidence",
      "Re-evaluate queued campaign recipients",
      "Suppress pending marketing work",
      "Prepare confirmation simulation",
    ],
    assertion: "Utility-care eligibility and marketing consent remain separate.",
  },
  {
    id: "campaign-50k",
    name: "50K campaign simulation",
    summary: "Evaluate and dispatch a deterministic 50,000-record audience locally.",
    language: "EN · SI · TA",
    sample: "Synthetic cohort seed 20,260,807",
    route: "Governed campaign simulation lane",
    icon: Users,
    steps: [
      "Evaluate 50,000 deterministic records",
      "Exclude 11,557 by consent and policy",
      "Freeze 38,443 eligible recipients",
      "Verify independent simulator approval",
      "Run canary and batch simulation",
      "Reconcile with zero provider calls",
    ],
    assertion: "Exactly zero network or Meta send calls are made.",
  },
  {
    id: "provider-failure",
    name: "Provider unavailable",
    summary: "Prove the platform fails closed when an external adapter is unavailable.",
    language: "System",
    sample: "Synthetic adapter error: provider_not_configured",
    route: "Connection diagnostics · operator alert",
    icon: PauseCircle,
    steps: [
      "Request a synthetic provider operation",
      "Observe external adapter disabled state",
      "Reject the operation before any network call",
      "Keep interactive queues isolated",
      "Open a sanitized operational alert",
      "Offer retry or human fallback",
    ],
    assertion: "No credential, endpoint, or patient content appears in the alert.",
  },
  {
    id: "care-red-flag",
    name: "Post-discharge red flag",
    summary: "Use clinician-authored questions and escalate a synthetic red flag.",
    language: "English",
    sample: "Synthetic check-in response requiring human review.",
    route: "Clinical safety escalation · simulator",
    icon: Workflow,
    steps: [
      "Load approved synthetic pathway version",
      "Ask the clinician-authored check-in question",
      "Receive structured synthetic response",
      "Match deterministic escalation rule",
      "Pause the care automation",
      "Create a human work item",
    ],
    assertion: "AI does not generate treatment or clinical instructions.",
  },
];

const wait = (duration: number) => new Promise((resolve) => window.setTimeout(resolve, duration));

export function ScenarioRunner() {
  const [selectedId, setSelectedId] = useState(scenarios[0].id);
  const [completedSteps, setCompletedSteps] = useState(0);
  const [running, setRunning] = useState(false);
  const selected = scenarios.find((scenario) => scenario.id === selectedId) ?? scenarios[0];
  const complete = completedSteps === selected.steps.length;

  function chooseScenario(id: string) {
    if (running) return;
    setSelectedId(id);
    setCompletedSteps(0);
  }

  async function runScenario() {
    if (running) return;
    setRunning(true);
    setCompletedSteps(0);
    for (let step = 1; step <= selected.steps.length; step += 1) {
      await wait(selected.id === "campaign-50k" ? 180 : 260);
      setCompletedSteps(step);
    }
    setRunning(false);
  }

  const ScenarioIcon = selected.icon;

  return (
    <div className="space-y-6 lg:space-y-8">
      <section className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
        <div>
          <div className="mb-2 flex flex-wrap gap-2">
            <StatusPill tone="success" dot>Simulator ready</StatusPill>
            <StatusPill tone="warning" dot>Zero external effects</StatusPill>
          </div>
          <h1 className="text-2xl font-bold tracking-[-0.035em] text-slate-950 sm:text-3xl">Demo Lab</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">
            Run deterministic multilingual, safety, consent, integration-failure, and scale scenarios. Every record is synthetic and every provider remains disabled.
          </p>
        </div>
        <button type="button" onClick={runScenario} disabled={running} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[var(--brand)] px-4 text-sm font-semibold text-white shadow-sm hover:bg-[var(--brand-strong)] disabled:cursor-wait disabled:opacity-70">
          {running ? <LoaderCircle size={16} className="animate-spin" aria-hidden="true" /> : <Play size={16} fill="currentColor" aria-hidden="true" />}
          {running ? "Running safely…" : complete ? "Run again" : "Run selected scenario"}
        </button>
      </section>

      <section className="grid gap-6 xl:grid-cols-[310px_minmax(0,1fr)_320px]">
        <aside className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white shadow-[0_1px_2px_rgba(23,34,31,0.03)]">
          <div className="border-b border-[var(--line)] px-4 py-4">
            <h2 className="text-sm font-bold text-slate-950">Scenario catalogue</h2>
            <p className="mt-1 text-[11px] text-slate-500">{scenarios.length} launch-scope acceptance journeys</p>
          </div>
          <div className="scrollbar-subtle max-h-[620px] space-y-1 overflow-y-auto p-2">
            {scenarios.map((scenario) => {
              const Icon = scenario.icon;
              const active = scenario.id === selected.id;
              return (
                <button type="button" key={scenario.id} onClick={() => chooseScenario(scenario.id)} disabled={running} className={`flex w-full items-start gap-3 rounded-xl p-3 text-left transition disabled:cursor-not-allowed ${active ? "bg-[var(--brand-soft)] text-[var(--brand-strong)]" : "text-slate-700 hover:bg-slate-50"}`} aria-pressed={active}>
                  <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg ${active ? "bg-white text-[var(--brand)]" : "bg-slate-100 text-slate-500"}`}><Icon size={16} aria-hidden="true" /></span>
                  <span className="min-w-0">
                    <span className="block text-xs font-bold">{scenario.name}</span>
                    <span className="mt-1 line-clamp-2 block text-[10px] leading-4 opacity-70">{scenario.summary}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        <article className="rounded-2xl border border-[var(--line)] bg-white p-4 shadow-[0_1px_2px_rgba(23,34,31,0.03)] sm:p-6">
          <div className="flex items-start gap-3 border-b border-[var(--line)] pb-5">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]"><ScenarioIcon size={21} aria-hidden="true" /></span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-bold tracking-[-0.02em] text-slate-950">{selected.name}</h2>
                <StatusPill tone={complete ? "success" : running ? "info" : "neutral"}>{complete ? "Passed" : running ? "Running" : "Ready"}</StatusPill>
              </div>
              <p className="mt-1 text-sm leading-6 text-[var(--muted)]">{selected.summary}</p>
            </div>
          </div>

          <div className="mt-5 rounded-2xl bg-slate-50 p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-500"><Languages size={14} aria-hidden="true" /> Synthetic input</span>
              <span className="rounded-full bg-white px-2 py-1 text-[10px] font-semibold text-slate-600">{selected.language}</span>
            </div>
            <p className="mt-3 text-sm font-medium leading-6 text-slate-800">“{selected.sample}”</p>
          </div>

          <div className="mt-6">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-slate-900">Execution trace</span>
              <span className="tabular-nums text-slate-500">{completedSteps} / {selected.steps.length}</span>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100" aria-label={`Scenario progress: ${completedSteps} of ${selected.steps.length} steps`}>
              <div className="h-full rounded-full bg-[var(--brand)] transition-[width] duration-300" style={{ width: `${(completedSteps / selected.steps.length) * 100}%` }} />
            </div>
            <ol className="mt-5 space-y-3">
              {selected.steps.map((step, index) => {
                const done = index < completedSteps;
                const current = running && index === completedSteps;
                return (
                  <li key={step} className={`flex items-center gap-3 rounded-xl border px-3 py-3 transition ${done ? "border-emerald-100 bg-emerald-50/60" : current ? "border-cyan-200 bg-cyan-50/60" : "border-[var(--line)] bg-white"}`}>
                    <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[11px] font-bold ${done ? "bg-emerald-600 text-white" : current ? "bg-cyan-100 text-cyan-700" : "bg-slate-100 text-slate-500"}`}>
                      {done ? <Check size={14} strokeWidth={3} aria-hidden="true" /> : current ? <LoaderCircle size={14} className="animate-spin" aria-hidden="true" /> : index + 1}
                    </span>
                    <span className={`text-xs font-medium ${done ? "text-emerald-900" : "text-slate-700"}`}>{step}</span>
                  </li>
                );
              })}
            </ol>
          </div>

          {complete ? (
            <div className="mt-6 flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4" role="status">
              <CheckCircle2 size={19} className="mt-0.5 shrink-0 text-emerald-700" aria-hidden="true" />
              <div><p className="text-sm font-bold text-emerald-900">Walkthrough completed locally</p><p className="mt-1 text-xs leading-5 text-emerald-800">{selected.assertion}</p></div>
            </div>
          ) : null}
        </article>

        <aside className="space-y-4">
          <article className="rounded-2xl border border-[var(--line)] bg-[#073f3a] p-5 text-white shadow-sm">
            <div className="flex items-center gap-2"><ShieldCheck size={19} className="text-emerald-200" aria-hidden="true" /><h2 className="text-sm font-bold">Non-negotiable boundaries</h2></div>
            <div className="mt-4 space-y-3">
              {["No external message calls", "No real patient identifiers", "No diagnosis or treatment", "No invented provider state", "No production activation"].map((boundary) => (
                <div key={boundary} className="flex items-center gap-2 text-xs text-emerald-50/85"><Check size={14} className="shrink-0 text-emerald-300" aria-hidden="true" />{boundary}</div>
              ))}
            </div>
          </article>

          <article className="rounded-2xl border border-[var(--line)] bg-white p-5 shadow-[0_1px_2px_rgba(23,34,31,0.03)]">
            <h2 className="text-sm font-bold text-slate-950">Expected handoff</h2>
            <div className="mt-4 flex items-start gap-3 rounded-xl bg-slate-50 p-3">
              <ArrowRight size={16} className="mt-0.5 shrink-0 text-[var(--brand)]" aria-hidden="true" />
              <div><p className="text-xs font-bold text-slate-800">{selected.route}</p><p className="mt-1 text-[11px] leading-5 text-slate-500">Routing is local UI state and does not create a hospital task.</p></div>
            </div>
            <div className="mt-3 flex items-start gap-3 rounded-xl bg-amber-50 p-3">
              <Clock3 size={16} className="mt-0.5 shrink-0 text-amber-700" aria-hidden="true" />
              <p className="text-[11px] leading-5 text-amber-800">Timestamps and counts are fixed by the synthetic seed for repeatable demos and tests.</p>
            </div>
            <button type="button" onClick={() => setCompletedSteps(0)} disabled={running || completedSteps === 0} className="mt-4 inline-flex h-9 w-full items-center justify-center gap-2 rounded-xl border border-[var(--line)] text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45">
              <RotateCcw size={14} aria-hidden="true" /> Reset scenario
            </button>
          </article>
        </aside>
      </section>
    </div>
  );
}
