"use client";

import { useState } from "react";
import { useLiteAuth } from "@/components/lite/lite-auth";
import { DEMO_KNOWN_VISITORS } from "@/components/lite/lite-config";
import {
  liteLaunchCampaign,
  useLiteCampaignSends,
  useLiteCampaigns,
} from "@/components/lite/lite-data";

const AUDIENCE = Object.values(DEMO_KNOWN_VISITORS).map((label) => ({
  label,
  digits: (label.split("\u00b7")[0] ?? "").replace(/\D/g, ""),
}));

const TEMPLATES = [
  { value: "hemas_canary_hello", label: "hemas_canary_hello · text (en_US)" },
  { value: "hemas_welcome_visual", label: "hemas_welcome_visual · IMAGE header (en_US)" },
] as const;

const STATUS_STYLE: Record<string, string> = {
  sending: "bg-slate-100 text-slate-600",
  sent: "bg-emerald-100 text-emerald-800",
  partial: "bg-amber-100 text-amber-800",
  failed: "bg-rose-100 text-rose-700",
};

const SEND_STATUS_STYLE: Record<string, string> = {
  queued: "bg-slate-100 text-slate-500",
  sent: "bg-sky-100 text-sky-700",
  delivered: "bg-emerald-100 text-emerald-800",
  read: "bg-emerald-600 text-white",
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const sends = useLiteCampaignSends(selectedId);

  const [name, setName] = useState("");
  const [template, setTemplate] = useState<string>(TEMPLATES[0].value);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set(AUDIENCE.map((a) => a.digits)));
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const canLaunch = member?.role === "supervisor" || member?.role === "tenant_admin";

  const launch = async () => {
    setPending(true);
    setNotice(null);
    try {
      const result = await liteLaunchCampaign(name.trim(), template, [...picked]);
      setNotice(
        `Campaign dispatched ✓ — ${result.sent} sent, ${result.failed} failed, audience ${result.audience} (governed allowlist).`,
      );
      setName("");
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
          Real WhatsApp template broadcasts — audience locked to the governed test allowlist,
          delivery tracked live (sent → delivered → read).
        </p>
      </section>

      <section className="rounded-2xl border border-emerald-900/5 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-900">New campaign</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
            placeholder="Campaign name — e.g. OPD reminder (Aug)"
            className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-emerald-500"
          />
          <select
            value={template}
            onChange={(event) => setTemplate(event.target.value)}
            className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-emerald-500"
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
            onClick={() => void launch()}
            className="rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
          >
            {pending ? "Sending…" : "Send campaign"}
          </button>
        </div>
        <div className="mt-3">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            Audience — pick contacts ({picked.size} selected)
          </p>
          <div className="flex flex-wrap gap-2">
            {AUDIENCE.map((a) => {
              const on = picked.has(a.digits);
              return (
                <button
                  key={a.digits}
                  type="button"
                  onClick={() => {
                    const next = new Set(picked);
                    if (on) next.delete(a.digits); else next.add(a.digits);
                    setPicked(next);
                  }}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                    on
                      ? "bg-emerald-600 text-white"
                      : "border border-slate-200 text-slate-500 hover:bg-emerald-50"
                  }`}
                >
                  {on ? "\u2713 " : ""}{a.label}
                </button>
              );
            })}
          </div>
        </div>
        <p className="mt-2 text-[11px] text-slate-400">
          Contacts come from the governed test allowlist (max 5) — in the pilot this becomes
          segments (language, tags, visit history). Approved templates only — that
          is Meta&apos;s rule for business-initiated messages.{" "}
          {!canLaunch ? "Broadcasts need the Supervisor seat — agents handle chats." : ""}
        </p>
        {notice ? (
          <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
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
              selectedId === campaign.id ? "border-emerald-300" : "border-emerald-900/5"
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
