"use client";

import { useMemo, useState } from "react";
import { createLiteCampaignOperationId } from "@/components/lite/campaign-operation";
import { useLiteAuth } from "@/components/lite/lite-auth";
import {
  liteLaunchCampaign,
  useLiteCampaignSends,
  useLiteCampaigns,
  useLiteContacts,
} from "@/components/lite/lite-data";

const TEMPLATES = [
  { value: "hemas_canary_hello", label: "hemas_canary_hello · text (en_US)" },
  { value: "hemas_welcome_visual", label: "hemas_welcome_visual · IMAGE header (en_US)" },
] as const;

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
      const result = await liteLaunchCampaign(
        operationId,
        name.trim(),
        template,
        [...picked],
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
    <div className="space-y-5">
      <section>
        <h1 className="text-xl font-semibold text-slate-900">Campaigns</h1>
        <p className="mt-1 text-sm text-slate-500">
          Governed WhatsApp canary templates — audience is limited to captured allowlisted
          test contacts, with content-free delivery status tracking.
        </p>
      </section>

      <section className="rounded-2xl border border-blue-900/5 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">New campaign</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
          <input
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              invalidateDraftOperation();
            }}
            maxLength={80}
            placeholder="Campaign name — e.g. OPD reminder (Aug)"
            className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
          />
          <select
            value={template}
            onChange={(event) => {
              setTemplate(event.target.value);
              invalidateDraftOperation();
            }}
            className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-blue-500"
          >
            {TEMPLATES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={pending || !canLaunch || name.trim().length < 3 || picked.size === 0}
            onClick={review}
            className="rounded-xl bg-[#1863DC] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#0F56C4] disabled:opacity-40"
          >
            Review campaign
          </button>
        </div>
        <div className="mt-3">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Audience — pick contacts ({picked.size} selected)
          </p>
          <div className="flex flex-wrap gap-2">
            {audience.map((contact) => {
              const on = picked.has(contact.id);
              return (
                <button
                  key={contact.id}
                  type="button"
                  onClick={() => {
                    const next = new Set(picked);
                    if (on) next.delete(contact.id); else next.add(contact.id);
                    setPicked(next);
                    invalidateDraftOperation();
                  }}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                    on
                      ? "bg-[#1863DC] text-white"
                      : "border border-slate-200 text-slate-500 hover:bg-blue-50"
                  }`}
                >
                  {on ? "\u2713 " : ""}{contact.label}
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
        <p className="mt-2 text-[11px] text-slate-400">
          The browser sends pseudonymous contact references, never phone numbers. The server resolves
          those references against the governed allowlist (max 5). Approved templates only.{" "}
          {!canLaunch ? "Broadcasts need the Supervisor seat — agents handle chats." : ""}
        </p>
        {reviewing ? (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3" role="alertdialog" aria-labelledby="campaign-review-title">
            <p id="campaign-review-title" className="text-sm font-semibold text-amber-950">Confirm external WhatsApp send</p>
            <p className="mt-1 text-xs leading-5 text-amber-900">
              Send <strong>{template}</strong> to <strong>{picked.size}</strong> selected allowlisted test contact{picked.size === 1 ? "" : "s"}. Delivery cannot be undone.
            </p>
            <p className="mt-1 text-[11px] leading-5 text-amber-800">
              This review has one server idempotency key. A timeout retry reuses it; changing the draft creates a new operation.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => void launch()}
                className="rounded-lg bg-amber-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
              >
                {pending ? "Sending…" : "Confirm and send"}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => setReviewing(false)}
                className="rounded-lg border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-amber-900"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}
        {notice ? (
          <p className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-800">
            {notice}
          </p>
        ) : null}
      </section>

      {campaigns.error ? (
        <p className="rounded-xl bg-rose-50 px-4 py-3 text-xs text-rose-700">{campaigns.error}</p>
      ) : null}

      <section className="grid gap-3">
        {campaigns.rows.map((campaign) => (
          <article
            key={campaign.id}
            className={`rounded-2xl border bg-white p-4 shadow-sm transition ${
              selectedId === campaign.id ? "border-blue-300" : "border-blue-900/5"
            }`}
          >
            <button
              type="button"
              onClick={() => setSelectedId(selectedId === campaign.id ? null : campaign.id)}
              className="flex w-full flex-wrap items-center gap-2 text-left"
            >
              <span className="text-sm font-semibold text-slate-800">{campaign.name}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                  STATUS_STYLE[campaign.status] ?? "bg-slate-100 text-slate-600"
                }`}
              >
                {campaign.status}
              </span>
              <span className="text-[11px] text-slate-400">
                {campaign.templateName} · {campaign.sentCount}/{campaign.audienceCount} sent
                {campaign.failedCount > 0 ? ` · ${campaign.failedCount} failed` : ""}
              </span>
              <span className="ml-auto text-[11px] text-slate-400">{when(campaign.createdAtMs)}</span>
            </button>

            {selectedId === campaign.id ? (
              <div className="mt-3 border-t border-slate-100 pt-3">
                {sends.loading ? (
                  <p className="text-xs text-slate-400">Loading recipients…</p>
                ) : null}
                <ul className="grid gap-1.5 sm:grid-cols-2">
                  {sends.rows.map((send) => (
                    <li
                      key={send.id}
                      className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2"
                    >
                      <span className="text-xs font-medium text-slate-700">···{send.toNumberLast4}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                          SEND_STATUS_STYLE[send.status] ?? "bg-slate-100 text-slate-500"
                        }`}
                      >
                        {send.status}
                      </span>
                      {send.errorCode ? (
                        <span className="truncate text-[10px] text-rose-500">{send.errorCode}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-[10px] text-slate-400">
                  Statuses update live from Meta delivery receipts. Records are content-free —
                  masked number, status and template name only.
                </p>
              </div>
            ) : null}
          </article>
        ))}
      </section>

      {!campaigns.loading && campaigns.rows.length === 0 && !campaigns.error ? (
        <p className="text-xs text-slate-400">No campaigns yet — send the first one above.</p>
      ) : null}
    </div>
  );
}
