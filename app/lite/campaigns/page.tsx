"use client";

import { Check, ChevronDown, Megaphone, Send, ShieldCheck, UsersRound } from "lucide-react";
import { useMemo, useState } from "react";
import { createLiteCampaignOperationId } from "@/components/lite/campaign-operation";
import { useLiteAuth } from "@/components/lite/lite-auth";
import {
  liteLaunchCampaign,
  useLiteCampaignSends,
  useLiteCampaigns,
  useLiteContacts,
} from "@/components/lite/lite-data";
import {
  LITE_BUTTON_PRIMARY,
  LITE_BUTTON_SECONDARY,
  LITE_FIELD,
  LITE_PANEL,
  LiteEmptyState,
  LiteNotice,
  LitePageHeader,
  LiteSectionHeader,
  LiteStatus,
  liteCx,
} from "@/components/lite/lite-ui";

/**
 * Approved template catalogue offered by the portal. `value` is what the
 * operator picks; `templateName` + `languageCode` are sent verbatim to the
 * governed callable, which re-validates them against its own catalogue.
 */
const TEMPLATES = [
  {
    value: "hemas_canary_hello:en_US",
    templateName: "hemas_canary_hello",
    languageCode: "en_US",
    label: "hemas_canary_hello · text (en_US)",
  },
  {
    value: "hemas_welcome_visual:en_US",
    templateName: "hemas_welcome_visual",
    languageCode: "en_US",
    label: "hemas_welcome_visual · IMAGE header (en_US)",
  },
  {
    value: "hemas_health_check_invite:en",
    templateName: "hemas_health_check_invite",
    languageCode: "en",
    label: "hemas_health_check_invite · Health check invitation · English",
  },
  {
    value: "hemas_health_check_invite:si",
    templateName: "hemas_health_check_invite",
    languageCode: "si",
    label: "hemas_health_check_invite · සෞඛ්‍ය පරීක්ෂණ ආරාධනය · Sinhala",
  },
  {
    value: "hemas_health_check_invite:ta",
    templateName: "hemas_health_check_invite",
    languageCode: "ta",
    label: "hemas_health_check_invite · உடல்நலப் பரிசோதனை அழைப்பு · Tamil",
  },
  {
    value: "hemas_homecare_visit:en",
    templateName: "hemas_homecare_visit",
    languageCode: "en",
    label: "hemas_homecare_visit · IMAGE header · Homecare home-visit · English",
  },
  {
    value: "hemas_homecare_visit:si",
    templateName: "hemas_homecare_visit",
    languageCode: "si",
    label: "hemas_homecare_visit · IMAGE header · නිවසේ සත්කාර සේවාව · Sinhala",
  },
  {
    value: "hemas_homecare_visit:ta",
    templateName: "hemas_homecare_visit",
    languageCode: "ta",
    label: "hemas_homecare_visit · IMAGE header · வீட்டுப் பராமரிப்பு சேவை · Tamil",
  },
] as const;

type TemplateOption = (typeof TEMPLATES)[number];

function templateOption(value: string): TemplateOption {
  return TEMPLATES.find((option) => option.value === value) ?? TEMPLATES[0];
}

const STATUS_STYLE: Record<string, string> = {
  sending: "bg-slate-100 text-slate-600",
  sent: "bg-blue-100 text-blue-800",
  partial: "bg-amber-100 text-amber-800",
  failed: "bg-rose-100 text-rose-700",
};

const SEND_STATUS_STYLE: Record<string, string> = {
  queued: "bg-slate-100 text-slate-500",
  sent: "bg-sky-100 text-sky-700",
  delivered: "bg-blue-100 text-blue-800",
  read: "bg-[#1863DC] text-white",
  failed: "bg-rose-100 text-rose-700",
};

function when(ms: number): string {
  if (!ms) return "";
  return new Date(ms).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function LiteCampaignsPage() {
  const { status, member } = useLiteAuth();
  const campaigns = useLiteCampaigns(status === "ready");
  const contacts = useLiteContacts(status === "ready", true);
  const audience = useMemo(
    () => contacts.rows.map((contact) => ({ id: contact.id, label: contact.displayLabel })),
    [contacts.rows],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const sends = useLiteCampaignSends(selectedId);

  const [name, setName] = useState("");
  const [template, setTemplate] = useState<string>(TEMPLATES[0].value);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [reviewing, setReviewing] = useState(false);
  const [operationId, setOperationId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const canLaunch = member?.role === "supervisor" || member?.role === "tenant_admin";

  const invalidateDraftOperation = () => {
    setOperationId(null);
    setReviewing(false);
  };

  const review = () => {
    setOperationId((current) => current ?? createLiteCampaignOperationId());
    setReviewing(true);
  };

  const launch = async () => {
    if (!operationId) {
      setNotice("Review the campaign again before sending.");
      return;
    }
    setPending(true);
    setNotice(null);
    try {
      const chosen = templateOption(template);
      const result = await liteLaunchCampaign(
        operationId,
        name.trim(),
        chosen.templateName,
        [...picked],
        chosen.languageCode,
      );
      setNotice(
        result.idempotent
          ? `Completed result restored safely — ${result.sent} sent, ${result.failed} failed, audience ${result.audience}. No recipient was sent twice.`
          : `Campaign dispatched ✓ — ${result.sent} sent, ${result.failed} failed, audience ${result.audience} (governed allowlist).`,
      );
      setName("");
      setPicked(new Set());
      setReviewing(false);
      setOperationId(null);
      setSelectedId(result.campaignId);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Campaign failed.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-6">
      <LitePageHeader
        eyebrow="Outbound engagement"
        title="Campaigns"
        description="Prepare approved WhatsApp templates for captured allowlisted contacts and follow their content-free delivery status."
        actions={
          <LiteStatus tone={campaigns.error ? "danger" : campaigns.loading ? "neutral" : "brand"}>
            {campaigns.error
              ? "Unavailable"
              : campaigns.loading
                ? "Loading"
                : `${campaigns.rows.length} campaigns`}
          </LiteStatus>
        }
      />

      <section className={liteCx(LITE_PANEL, "p-5 sm:p-6")}>
        <LiteSectionHeader
          title="New campaign"
          description="Build, review, and confirm one governed canary send."
          icon={Megaphone}
        />
        <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(240px,0.9fr)_minmax(320px,1.25fr)_auto]">
          <label className="text-sm font-semibold text-[var(--lite-ink-secondary)]">
            Campaign name
            <input
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                invalidateDraftOperation();
              }}
              maxLength={80}
              placeholder="Campaign name — e.g. OPD reminder (Aug)"
              className={`${LITE_FIELD} mt-2`}
            />
          </label>
          <label className="text-sm font-semibold text-[var(--lite-ink-secondary)]">
            Approved template
            <select
              value={template}
              onChange={(event) => {
                setTemplate(event.target.value);
                invalidateDraftOperation();
              }}
              className={`${LITE_FIELD} mt-2`}
            >
              {TEMPLATES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={pending || !canLaunch || name.trim().length < 3 || picked.size === 0}
            onClick={review}
            className={`${LITE_BUTTON_PRIMARY} self-end`}
          >
            <ShieldCheck size={17} aria-hidden="true" />
            Review campaign
          </button>
        </div>
        <div className="mt-5 border-t border-[var(--lite-line)] pt-5">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <UsersRound size={17} className="text-[var(--lite-brand)]" aria-hidden="true" />
            <p className="text-sm font-bold text-[var(--lite-ink-secondary)]">
              Audience
            </p>
            <LiteStatus tone={picked.size > 0 ? "brand" : "neutral"}>{picked.size} selected</LiteStatus>
          </div>
          <div className="flex flex-wrap gap-2">
            {audience.map((contact) => {
              const on = picked.has(contact.id);
              return (
                <button
                  key={contact.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    const next = new Set(picked);
                    if (on) next.delete(contact.id); else next.add(contact.id);
                    setPicked(next);
                    invalidateDraftOperation();
                  }}
                  className={`min-h-11 rounded-xl border px-3 py-2 text-xs font-bold transition ${
                    on
                      ? "border-[var(--lite-brand)] bg-[var(--lite-brand)] text-white"
                      : "border-[var(--lite-line)] bg-white text-[var(--lite-muted)] hover:border-[var(--lite-brand)]/35 hover:bg-[var(--lite-brand-soft)]"
                  }`}
                >
                  {on ? <Check size={14} className="mr-1 inline" aria-hidden="true" /> : null}
                  {contact.label}
                </button>
              );
            })}
            {!contacts.loading && audience.length === 0 ? (
              <span className="text-xs text-amber-700">
                No captured canary leads are available. Receive an allowlisted test message first.
              </span>
            ) : null}
          </div>
        </div>
        <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-[var(--lite-muted)]">
          <ShieldCheck size={15} className="mt-0.5 shrink-0 text-[var(--lite-brand)]" aria-hidden="true" />
          <span>
          The browser sends pseudonymous contact references, never phone numbers. The server resolves
          those references against the governed allowlist (max 5). Approved templates only.{" "}
          {!canLaunch ? "Broadcasts need the Supervisor seat — agents handle chats." : ""}
          </span>
        </p>
        {reviewing ? (
          <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:p-5" role="region" aria-labelledby="campaign-review-title">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-100 text-amber-800"><ShieldCheck size={19} aria-hidden="true" /></span>
              <div>
                <p id="campaign-review-title" className="font-display text-base font-bold text-amber-950">Confirm external WhatsApp send</p>
                <p className="mt-0.5 text-xs text-amber-800">This action cannot be undone after dispatch.</p>
              </div>
            </div>
            <p className="mt-4 text-sm leading-6 text-amber-950">
              Send <strong>{templateOption(template).templateName}</strong> ({templateOption(template).languageCode}) to <strong>{picked.size}</strong> selected allowlisted test contact{picked.size === 1 ? "" : "s"}. Delivery cannot be undone.
            </p>
            <p className="mt-1 text-xs leading-5 text-amber-800">
              This review has one server idempotency key. A timeout retry reuses it; changing the draft creates a new operation.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => void launch()}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-amber-900 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-amber-950 disabled:opacity-50"
              >
                <Send size={16} aria-hidden="true" />
                {pending ? "Sending…" : "Confirm and send"}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => setReviewing(false)}
                className={`${LITE_BUTTON_SECONDARY} border-amber-300 text-amber-900`}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}
        {notice ? (
          <div className="mt-4"><LiteNotice tone="info">{notice}</LiteNotice></div>
        ) : null}
      </section>

      {campaigns.error ? (
        <LiteNotice tone="danger">Campaign history is temporarily unavailable.</LiteNotice>
      ) : null}

      {campaigns.loading ? (
        <section className="grid gap-4" aria-busy="true">
          {[0, 1].map((row) => <div key={row} className="h-24 animate-pulse rounded-2xl bg-white" />)}
        </section>
      ) : null}

      {campaigns.rows.length > 0 ? (
        <LiteSectionHeader title="Campaign history" description="Open a campaign to review recipient delivery evidence." icon={Megaphone} />
      ) : null}
      <section className="grid gap-4">
        {campaigns.rows.map((campaign) => (
          <article
            key={campaign.id}
            className={liteCx(LITE_PANEL, "overflow-hidden transition", selectedId === campaign.id && "border-[var(--lite-brand)] ring-4 ring-[var(--lite-brand)]/8")}
          >
            <button
              type="button"
              onClick={() => setSelectedId(selectedId === campaign.id ? null : campaign.id)}
              aria-expanded={selectedId === campaign.id}
              className="flex min-h-20 w-full flex-wrap items-center gap-3 px-5 py-4 text-left transition hover:bg-[var(--lite-brand-soft)]/40"
            >
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--lite-brand-soft)] text-[var(--lite-brand)]"><Megaphone size={18} aria-hidden="true" /></span>
              <span className="min-w-0 flex-1">
                <span className="font-display block truncate text-[15px] font-bold text-[var(--lite-ink)]">{campaign.name}</span>
                <span className="mt-1 block text-xs text-[var(--lite-muted)]">{campaign.templateName} · {campaign.sentCount}/{campaign.audienceCount} sent{campaign.failedCount > 0 ? ` · ${campaign.failedCount} failed` : ""}</span>
              </span>
              <span
                className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase ${
                  STATUS_STYLE[campaign.status] ?? "bg-slate-100 text-slate-600"
                }`}
              >
                {campaign.status}
              </span>
              <span className="text-xs text-[var(--lite-muted)]">{when(campaign.createdAtMs)}</span>
              <ChevronDown size={17} className={liteCx("text-[var(--lite-muted)] transition", selectedId === campaign.id && "rotate-180")} aria-hidden="true" />
            </button>

            {selectedId === campaign.id ? (
              <div className="border-t border-[var(--lite-line)] bg-[#fbfdfd] p-5">
                {sends.loading ? (
                  <p className="text-sm text-[var(--lite-muted)]">Loading recipient evidence…</p>
                ) : null}
                <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {sends.rows.map((send) => (
                    <li
                      key={send.id}
                      className="flex min-h-11 items-center gap-2 rounded-xl border border-[var(--lite-line)] bg-white px-3.5 py-2.5"
                    >
                      <span className="text-xs font-bold text-[var(--lite-ink-secondary)]">···{send.toNumberLast4}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                          SEND_STATUS_STYLE[send.status] ?? "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {send.status}
                      </span>
                      {send.errorCode ? (
                        <span className="truncate text-[11px] text-rose-600">{send.errorCode}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
                {!sends.loading && sends.rows.length === 0 ? <p className="text-sm text-[var(--lite-muted)]">No recipient evidence has been recorded.</p> : null}
                <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-[var(--lite-muted)]">
                  <ShieldCheck size={15} className="mt-0.5 shrink-0 text-[var(--lite-brand)]" aria-hidden="true" />
                  Statuses update live from Meta delivery receipts. Records are content-free —
                  masked number, status and template name only.
                </p>
              </div>
            ) : null}
          </article>
        ))}
      </section>

      {!campaigns.loading && campaigns.rows.length === 0 && !campaigns.error ? (
        <div className={LITE_PANEL}><LiteEmptyState icon={Megaphone} title="No campaigns yet" description="Prepare and review the first governed canary campaign above." /></div>
      ) : null}
    </div>
  );
}
