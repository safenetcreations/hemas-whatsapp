"use client";

import {
  Ban,
  Database,
  LockKeyhole,
  MessageCircleMore,
  Network,
  RefreshCw,
  ServerCog,
  ShieldCheck,
} from "lucide-react";

import { useWorkspaceSession } from "@/components/auth/workspace-session";
import { StatusPill } from "@/components/ui/status-pill";
import type {
  DemoEvidenceSignalV1,
  StaffSafeIntegrationV1,
  StaffSafeWhatsAppConnectionV1,
} from "@/lib/domain/connections";
import type { VerifiedWorkspaceSession } from "@/lib/firebase/workspace-session-model";
import {
  NEVER_VERIFIED_LABEL,
  connectionCentreAccess,
  connectionCentreAuthorityKey,
  connectionSignalLabels,
  deriveConnectionCentreSummary,
  orderedConnectionSignalKeys,
} from "./connection-centre-data";
import { useConnectionCentre } from "./use-connection-centre";

function Literal({ children }: { readonly children: string }) {
  return (
    <code className="break-words rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-700">
      {children}
    </code>
  );
}

function ExactTimestamp({ value }: { readonly value: string }) {
  return (
    <time dateTime={value} className="break-all font-mono text-[10px] text-slate-700">
      {value}
    </time>
  );
}

function BooleanGate({
  label,
  value,
}: {
  readonly label: string;
  readonly value: boolean;
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5">
      <span className="min-w-0 text-xs font-semibold text-emerald-950">
        {label}
      </span>
      <Literal>{String(value)}</Literal>
    </div>
  );
}

function EvidenceDetails({
  evidence,
}: {
  readonly evidence: DemoEvidenceSignalV1;
}) {
  return (
    <dl className="mt-3 grid gap-2 text-[11px] sm:grid-cols-2">
      <div>
        <dt className="font-semibold text-slate-500">State</dt>
        <dd className="mt-1"><Literal>{evidence.state}</Literal></dd>
      </div>
      <div>
        <dt className="font-semibold text-slate-500">Source</dt>
        <dd className="mt-1"><Literal>{evidence.source}</Literal></dd>
      </div>
      <div className="sm:col-span-2">
        <dt className="font-semibold text-slate-500">Observed timestamp</dt>
        <dd className="mt-1"><ExactTimestamp value={evidence.observedAt} /></dd>
      </div>
      <div className="sm:col-span-2">
        <dt className="font-semibold text-slate-500">Last successful verification</dt>
        <dd className="mt-1 font-semibold text-slate-700">
          {evidence.lastSuccessfulVerificationAt === null
            ? NEVER_VERIFIED_LABEL
            : evidence.lastSuccessfulVerificationAt}
        </dd>
      </div>
    </dl>
  );
}

function EntityChronology({
  createdAt,
  updatedAt,
}: {
  readonly createdAt: string;
  readonly updatedAt: string;
}) {
  return (
    <dl className="mt-4 grid gap-3 border-t border-slate-200 pt-4 sm:grid-cols-2">
      <div className="min-w-0">
        <dt className="text-[10px] font-bold uppercase tracking-[0.06em] text-slate-500">
          Created timestamp
        </dt>
        <dd className="mt-1"><ExactTimestamp value={createdAt} /></dd>
      </div>
      <div className="min-w-0">
        <dt className="text-[10px] font-bold uppercase tracking-[0.06em] text-slate-500">
          Updated timestamp
        </dt>
        <dd className="mt-1"><ExactTimestamp value={updatedAt} /></dd>
      </div>
    </dl>
  );
}

function WhatsAppInventory({
  connection,
}: {
  readonly connection: StaffSafeWhatsAppConnectionV1;
}) {
  return (
    <article
      className="rounded-2xl border border-[var(--line)] bg-white p-4 shadow-[0_1px_2px_rgba(23,34,31,0.03)] sm:p-5"
      data-connection-kind="whatsapp-simulator"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
            <MessageCircleMore size={19} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-emerald-700">
              Persisted WhatsApp simulator
            </p>
            <h2 className="mt-1 text-base font-bold text-slate-950">
              {connection.displayName}
            </h2>
          </div>
        </div>
        <StatusPill tone="neutral">{connection.status}</StatusPill>
      </div>

      <dl className="mt-4 grid gap-3 rounded-xl bg-slate-50 p-3 text-xs sm:grid-cols-3">
        <div>
          <dt className="font-semibold text-slate-500">Environment</dt>
          <dd className="mt-1"><Literal>{connection.environment}</Literal></dd>
        </div>
        <div>
          <dt className="font-semibold text-slate-500">External number</dt>
          <dd className="mt-1 font-semibold text-slate-800">{connection.maskedNumber}</dd>
        </div>
        <div>
          <dt className="font-semibold text-slate-500">Credential state</dt>
          <dd className="mt-1"><Literal>{connection.credentialState}</Literal></dd>
        </div>
      </dl>

      <section className="mt-5" aria-labelledby="whatsapp-safety-gates-title">
        <h3 id="whatsapp-safety-gates-title" className="text-xs font-bold text-slate-950">
          Frozen browser safety gates
        </h3>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <BooleanGate
            label="External messaging enabled"
            value={connection.externalMessagingEnabled}
          />
          <BooleanGate
            label="Network calls enabled"
            value={connection.networkCallsEnabled}
          />
        </div>
      </section>

      <section className="mt-5" aria-labelledby="whatsapp-evidence-title">
        <div>
          <h3 id="whatsapp-evidence-title" className="text-xs font-bold text-slate-950">
            Exact synthetic evidence matrix
          </h3>
          <p className="mt-1 text-[11px] leading-5 text-slate-500">
            Eleven persisted v1 signals. Sources and timestamps are shown literally.
          </p>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {orderedConnectionSignalKeys.map((key) => (
            <article key={key} className="min-w-0 rounded-xl border border-slate-200 p-3">
              <h4 className="text-xs font-bold text-slate-900">
                {connectionSignalLabels[key]}
              </h4>
              <EvidenceDetails evidence={connection.signals[key]} />
            </article>
          ))}
        </div>
      </section>

      <EntityChronology
        createdAt={connection.createdAt}
        updatedAt={connection.updatedAt}
      />
    </article>
  );
}

function IntegrationInventory({
  integration,
}: {
  readonly integration: StaffSafeIntegrationV1;
}) {
  return (
    <article
      className="rounded-2xl border border-[var(--line)] bg-white p-4 shadow-[0_1px_2px_rgba(23,34,31,0.03)] sm:p-5"
      data-connection-kind="system-simulator"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-cyan-50 text-cyan-700">
            <ServerCog size={19} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-cyan-700">
              Persisted system simulator
            </p>
            <h2 className="mt-1 text-base font-bold text-slate-950">
              {integration.displayName}
            </h2>
          </div>
        </div>
        <StatusPill tone="neutral">{integration.status}</StatusPill>
      </div>

      <dl className="mt-4 grid gap-3 rounded-xl bg-slate-50 p-3 text-xs sm:grid-cols-3">
        <div>
          <dt className="font-semibold text-slate-500">Environment</dt>
          <dd className="mt-1"><Literal>{integration.environment}</Literal></dd>
        </div>
        <div>
          <dt className="font-semibold text-slate-500">Adapter mode</dt>
          <dd className="mt-1"><Literal>{integration.adapterMode}</Literal></dd>
        </div>
        <div>
          <dt className="font-semibold text-slate-500">Credential state</dt>
          <dd className="mt-1"><Literal>{integration.credentialState}</Literal></dd>
        </div>
      </dl>

      <section className="mt-4" aria-label={`${integration.displayName} safety gates`}>
        <div className="grid gap-2 sm:grid-cols-2">
          <BooleanGate
            label="External network enabled"
            value={integration.externalNetworkEnabled}
          />
          <BooleanGate
            label="Authoritative system write enabled"
            value={integration.authoritativeSystemWriteEnabled}
          />
        </div>
      </section>

      <section className="mt-4 rounded-xl border border-slate-200 p-3">
        <h3 className="text-xs font-bold text-slate-950">Synthetic evidence</h3>
        <EvidenceDetails evidence={integration.evidence} />
        <dl className="mt-3 border-t border-slate-200 pt-3 text-[11px]">
          <dt className="font-semibold text-slate-500">Last synchronization</dt>
          <dd className="mt-1 font-semibold text-slate-700">
            {integration.lastSyncAt === null ? "Never" : integration.lastSyncAt}
          </dd>
        </dl>
      </section>

      <EntityChronology
        createdAt={integration.createdAt}
        updatedAt={integration.updatedAt}
      />
    </article>
  );
}

function LoadingInventory() {
  return (
    <section
      className="rounded-2xl border border-[var(--line)] bg-white p-6"
      role="status"
      aria-live="polite"
      data-connections-load-state="loading"
    >
      <div className="flex items-center gap-3">
        <RefreshCw className="animate-spin text-[var(--brand)]" size={18} aria-hidden="true" />
        <div>
          <h2 className="text-sm font-bold text-slate-950">Loading persisted inventory</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            Three fixed authoritative server reads are in progress. No cache or fixture is displayed.
          </p>
        </div>
      </div>
    </section>
  );
}

function UnavailableInventory({
  message,
  retry,
}: {
  readonly message: string;
  readonly retry: () => void;
}) {
  return (
    <section
      className="rounded-2xl border border-red-200 bg-red-50 p-5"
      role="alert"
      data-connections-load-state="error"
    >
      <div className="flex items-start gap-3">
        <Ban className="mt-0.5 shrink-0 text-red-700" size={19} aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold text-red-950">Inventory unavailable</h2>
          <p className="mt-1 text-xs leading-5 text-red-900">{message}</p>
          <button
            type="button"
            onClick={retry}
            className="mt-4 inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-red-900 px-4 text-sm font-semibold text-white hover:bg-red-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-900"
          >
            <RefreshCw size={15} aria-hidden="true" />
            Retry authoritative read
          </button>
        </div>
      </div>
    </section>
  );
}

function EmptyInventory({ message }: { readonly message: string }) {
  return (
    <section
      className="rounded-2xl border border-slate-200 bg-white p-6 text-center"
      role="status"
      data-connections-load-state="empty"
    >
      <Database className="mx-auto text-slate-400" size={24} aria-hidden="true" />
      <h2 className="mt-3 text-sm font-bold text-slate-950">
        No governed synthetic v1 inventory
      </h2>
      <p className="mx-auto mt-2 max-w-2xl text-xs leading-5 text-slate-600">
        {message}
      </p>
    </section>
  );
}

function ConnectionCentreContent({
  session,
}: {
  readonly session: VerifiedWorkspaceSession;
}) {
  const state = useConnectionCentre(session);

  return (
    <div className="space-y-6 lg:space-y-8" data-connections-access="allowed">
      <section className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[var(--brand-soft)] text-[var(--brand)]">
            <Network size={21} aria-hidden="true" />
          </span>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--brand)]">
              Authoritative local catalogue
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-[-0.035em] text-slate-950 sm:text-3xl">
              Connections
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--muted)]">
              Read the strict staff-safe v1 simulator inventory from local Firestore. This surface has no mutations, provider controls, credential fields, cache, or fixture fallback.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2" aria-label="Connection-centre boundaries">
          <StatusPill tone="info" dot>Read only</StatusPill>
          <StatusPill tone="danger" dot>External sending off</StatusPill>
        </div>
      </section>

      {state.status === "loading" ? <LoadingInventory /> : null}
      {state.status === "empty" ? <EmptyInventory message={state.message} /> : null}
      {state.status === "denied" ||
      state.status === "invalid_response" ||
      state.status === "error" ? (
        <UnavailableInventory message={state.message} retry={state.retry} />
      ) : null}

      {state.status === "ready" ? (() => {
        const summary = deriveConnectionCentreSummary(state.inventory);
        return (
          <div className="space-y-6" data-connections-load-state="ready">
            <section
              className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
              aria-label="Persisted connection inventory summary"
            >
              {[
                ["Mock WhatsApp", String(summary.mockWhatsAppSimulators), "Persisted simulator record"],
                ["Mock HIS / LIMS", String(summary.mockSystemSimulators), "Persisted synthetic adapters"],
                ["External providers", String(summary.externalProviderConnections), "Derived from every network and write gate"],
                ["External sending", summary.externalSendingEnabled ? "On" : "Off", "Derived from the persisted WhatsApp gate"],
              ].map(([label, value, detail]) => (
                <article key={label} className="rounded-2xl border border-[var(--line)] bg-white p-4 sm:p-5">
                  <p className="text-xs font-semibold text-[var(--muted)]">{label}</p>
                  <p className="mt-2 text-2xl font-bold tracking-[-0.03em] text-slate-950">{value}</p>
                  <p className="mt-2 text-[11px] leading-5 text-slate-500">{detail}</p>
                </article>
              ))}
            </section>

            <section className="rounded-2xl border border-cyan-200 bg-cyan-50 p-4 sm:p-5">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 shrink-0 text-cyan-800" size={18} aria-hidden="true" />
                <div>
                  <h2 className="text-sm font-bold text-cyan-950">Persisted boundary, not external proof</h2>
                  <p className="mt-1 text-xs leading-5 text-cyan-900">
                    These rows prove only the governed zero-network local simulator catalogue. They do not evidence a cloud deployment, Meta account, Hemas system connection, real-device delivery, or external acceptance.
                  </p>
                </div>
              </div>
            </section>

            <section className="space-y-4" aria-label="Persisted simulator records">
              {state.inventory.whatsappConnections.map((connection) => (
                <WhatsAppInventory key={connection.id} connection={connection} />
              ))}
              <div className="grid gap-4 xl:grid-cols-2">
                {state.inventory.integrations.map((integration) => (
                  <IntegrationInventory key={integration.id} integration={integration} />
                ))}
              </div>
            </section>

            <section className="rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:p-5">
              <div className="flex items-start gap-3">
                <LockKeyhole className="mt-0.5 shrink-0 text-amber-800" size={18} aria-hidden="true" />
                <div>
                  <h2 className="text-sm font-bold text-amber-950">Every outbound boundary remains false</h2>
                  <p className="mt-1 text-xs leading-5 text-amber-900">
                    Network enabled: {String(summary.externalNetworkEnabled)} · authoritative writes enabled: {String(summary.authoritativeWritesEnabled)} · external messaging enabled: {String(summary.externalSendingEnabled)}.
                  </p>
                </div>
              </div>
            </section>
          </div>
        );
      })() : null}
    </div>
  );
}

function ConnectionCentreAccessDenied() {
  return (
    <section
      className="grid min-h-[52vh] place-items-center py-8"
      role="alert"
      data-connections-access="denied"
    >
      <div className="w-full max-w-xl rounded-3xl border border-amber-200 bg-white p-6 text-center sm:p-8">
        <LockKeyhole className="mx-auto text-amber-700" size={24} aria-hidden="true" />
        <h1 className="mt-3 text-xl font-bold text-slate-950">Connections access unavailable</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Only an active tenant administrator in the frozen synthetic workspace can read this catalogue. No inventory read was attempted.
        </p>
      </div>
    </section>
  );
}

export function ConnectionCentre() {
  const workspace = useWorkspaceSession();
  if (workspace.status !== "verified" || !workspace.session) return null;
  if (connectionCentreAccess(workspace.session) !== "allowed") {
    return <ConnectionCentreAccessDenied />;
  }

  return (
    <ConnectionCentreContent
      key={connectionCentreAuthorityKey(workspace.session)}
      session={workspace.session}
    />
  );
}
