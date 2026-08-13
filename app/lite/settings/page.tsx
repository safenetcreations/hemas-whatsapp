"use client";

import { useEffect, useState } from "react";
import { useLiteAuth } from "@/components/lite/lite-auth";
import {
  liteReconcileBookingEvidence,
  liteReconcileCampaignEvidence,
  liteReconcileReplyEvidence,
  liteSetupSeats,
  reconcileMetaCanaryFatalEffect,
  reconcileMetaCanaryOutbox,
  type MetaCanaryFatalEffectKind,
  type MetaCanaryFatalOutcome,
} from "@/components/lite/lite-data";
import {
  LITE_PLAN,
  LITE_SEAT_HINTS,
} from "@/components/lite/lite-config";

type OperatorAccess = {
  readonly checking: boolean;
  readonly liteAdmin: boolean;
  readonly metaAdmin: boolean;
};

export default function LiteSettingsPage() {
  const { user } = useLiteAuth();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [operatorAccess, setOperatorAccess] = useState<OperatorAccess>({
    checking: true,
    liteAdmin: false,
    metaAdmin: false,
  });
  const [metaPending, setMetaPending] = useState(false);
  const [metaConfirmed, setMetaConfirmed] = useState(false);
  const [metaNotice, setMetaNotice] = useState<string | null>(null);
  const [fatalEffectId, setFatalEffectId] = useState("");
  const [fatalEffectKind, setFatalEffectKind] =
    useState<MetaCanaryFatalEffectKind>("graph_bot_reply");
  const [fatalOutcome, setFatalOutcome] =
    useState<MetaCanaryFatalOutcome>("confirmed_not_sent");
  const [fatalProviderMessageId, setFatalProviderMessageId] = useState("");
  const [fatalEvidenceSha256, setFatalEvidenceSha256] = useState("");
  const [fatalConfirmed, setFatalConfirmed] = useState(false);
  const [fatalPending, setFatalPending] = useState(false);
  const [fatalNotice, setFatalNotice] = useState<string | null>(null);
  const [replyPending, setReplyPending] = useState(false);
  const [replyConfirmed, setReplyConfirmed] = useState(false);
  const [replyNotice, setReplyNotice] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState("");
  const [operationId, setOperationId] = useState("");
  const [outcome, setOutcome] = useState<"sent" | "not_sent">("not_sent");
  const [providerMessageId, setProviderMessageId] = useState("");
  const [providerEvidenceSha256, setProviderEvidenceSha256] = useState("");
  const [bookingOperationId, setBookingOperationId] = useState("");
  const [bookingRequestSha256, setBookingRequestSha256] = useState("");
  const [bookingOutcome, setBookingOutcome] = useState<"sent" | "not_sent">("not_sent");
  const [bookingProviderMessageId, setBookingProviderMessageId] = useState("");
  const [bookingEvidenceSha256, setBookingEvidenceSha256] = useState("");
  const [bookingConfirmed, setBookingConfirmed] = useState(false);
  const [bookingPending, setBookingPending] = useState(false);
  const [bookingNotice, setBookingNotice] = useState<string | null>(null);
  const [campaignOperationId, setCampaignOperationId] = useState("");
  const [campaignRequestSha256, setCampaignRequestSha256] = useState("");
  const [campaignRecipientOperationId, setCampaignRecipientOperationId] = useState("");
  const [campaignOutcome, setCampaignOutcome] = useState<
    "sent" | "not_sent" | "finalize_recorded" | "halt_reserved"
  >("not_sent");
  const [campaignProviderMessageId, setCampaignProviderMessageId] = useState("");
  const [campaignEvidenceSha256, setCampaignEvidenceSha256] = useState("");
  const [campaignConfirmed, setCampaignConfirmed] = useState(false);
  const [campaignPending, setCampaignPending] = useState(false);
  const [campaignNotice, setCampaignNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!user) {
      queueMicrotask(() => {
        if (active) {
          setOperatorAccess({ checking: false, liteAdmin: false, metaAdmin: false });
        }
      });
      return () => {
        active = false;
      };
    }
    void user
      .getIdTokenResult(true)
      .then((token) => {
        if (!active) return;
        const verified = user.emailVerified === true;
        setOperatorAccess({
          checking: false,
          liteAdmin: verified && token.claims.hemasLiteAdmin === true,
          metaAdmin:
            verified &&
            token.claims.hemasMetaCanary === true &&
            token.claims.hemasMetaCanaryAdmin === true,
        });
      })
      .catch(() => {
        if (active) {
          setOperatorAccess({ checking: false, liteAdmin: false, metaAdmin: false });
        }
      });
    return () => {
      active = false;
    };
  }, [user]);

  const provision = async () => {
    setPending(true);
    setNotice(null);
    try {
      await liteSetupSeats();
      setNotice("Seats provisioned ✓ — the three Lite seats can sign in now.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Provisioning failed.");
    } finally {
      setPending(false);
    }
  };

  const reconcileOutbox = async () => {
    if (!metaConfirmed) return;
    setMetaPending(true);
    setMetaNotice(null);
    try {
      const result = await reconcileMetaCanaryOutbox();
      setMetaNotice(
        `Recovery completed: ${result.attempted} attempted, ${result.terminal} terminal, ${result.suppressed} suppressed, ${result.retryable} retryable, ${result.fatal} fatal, ${result.deferred} deferred.`,
      );
      setMetaConfirmed(false);
    } catch (error) {
      setMetaNotice(error instanceof Error ? error.message : "Outbox recovery failed safely.");
    } finally {
      setMetaPending(false);
    }
  };

  const fatalEvidenceValid =
    /^fx_[0-9a-f]{8,64}$/.test(fatalEffectId.trim()) &&
    /^[0-9a-f]{64}$/.test(fatalEvidenceSha256.trim()) &&
    (fatalOutcome === "confirmed_not_sent" ||
      (fatalProviderMessageId.trim().length > 0 &&
        fatalProviderMessageId.trim().length <= 512));

  const reconcileFatalEffect = async () => {
    if (!fatalConfirmed || !fatalEvidenceValid) return;
    setFatalPending(true);
    setFatalNotice(null);
    try {
      const result = await reconcileMetaCanaryFatalEffect({
        effectId: fatalEffectId.trim(),
        effectKind: fatalEffectKind,
        outcome: fatalOutcome,
        providerMessageId:
          fatalOutcome === "confirmed_sent"
            ? fatalProviderMessageId.trim()
            : null,
        providerEvidenceSha256: fatalEvidenceSha256.trim(),
      });
      setFatalNotice(
        result.idempotent
          ? "Idempotent replay: yes. The exact evidence was already recorded; nothing was resent or changed."
          : "Idempotent replay: no. Fatal-effect evidence was recorded without sending or retrying Meta.",
      );
      setFatalConfirmed(false);
      setFatalProviderMessageId("");
      setFatalEvidenceSha256("");
    } catch (error) {
      setFatalNotice(
        error instanceof Error
          ? error.message
          : "Fatal-effect reconciliation failed safely.",
      );
    } finally {
      setFatalPending(false);
    }
  };

  const replyEvidenceValid =
    /^conversation_live_[0-9a-f]{10}$/.test(conversationId.trim()) &&
    /^reply_[A-Za-z0-9_-]{16,80}$/.test(operationId.trim()) &&
    /^[0-9a-f]{64}$/.test(providerEvidenceSha256.trim()) &&
    (outcome === "not_sent" || /^[A-Za-z0-9._:-]{8,512}$/.test(providerMessageId.trim()));

  const reconcileReply = async () => {
    if (!replyConfirmed || !replyEvidenceValid) return;
    setReplyPending(true);
    setReplyNotice(null);
    try {
      const result = await liteReconcileReplyEvidence({
        conversationId: conversationId.trim(),
        operationId: operationId.trim(),
        outcome,
        providerMessageId: outcome === "sent" ? providerMessageId.trim() : null,
        providerEvidenceSha256: providerEvidenceSha256.trim(),
      });
      setReplyNotice(
        result.idempotent
          ? "The same reconciliation evidence was already recorded; nothing changed."
          : "Reply evidence recorded. No WhatsApp message was sent by this action.",
      );
      setReplyConfirmed(false);
    } catch (error) {
      setReplyNotice(error instanceof Error ? error.message : "Reply reconciliation failed safely.");
    } finally {
      setReplyPending(false);
    }
  };

  const bookingEvidenceValid =
    /^booking_[A-Za-z0-9_-]{16,64}$/.test(bookingOperationId.trim()) &&
    /^[0-9a-f]{64}$/.test(bookingRequestSha256.trim()) &&
    /^[0-9a-f]{64}$/.test(bookingEvidenceSha256.trim()) &&
    (bookingOutcome === "not_sent" ||
      /^[A-Za-z0-9._:-]{8,512}$/.test(bookingProviderMessageId.trim()));

  const reconcileBooking = async () => {
    if (!bookingConfirmed || !bookingEvidenceValid) return;
    setBookingPending(true);
    setBookingNotice(null);
    try {
      const result = await liteReconcileBookingEvidence({
        operationId: bookingOperationId.trim(),
        requestSha256: bookingRequestSha256.trim(),
        outcome: bookingOutcome,
        providerMessageId:
          bookingOutcome === "sent" ? bookingProviderMessageId.trim() : null,
        providerEvidenceSha256: bookingEvidenceSha256.trim(),
      });
      setBookingNotice(
        result.idempotent
          ? "The same booking evidence was already recorded; nothing changed."
          : "Booking notification evidence recorded. No WhatsApp message was sent.",
      );
      setBookingConfirmed(false);
    } catch (error) {
      setBookingNotice(error instanceof Error ? error.message : "Booking reconciliation failed safely.");
    } finally {
      setBookingPending(false);
    }
  };

  const campaignEvidenceValid =
    /^campaign_[A-Za-z0-9_-]{16,64}$/.test(campaignOperationId.trim()) &&
    /^[0-9a-f]{64}$/.test(campaignRequestSha256.trim()) &&
    /^[0-9a-f]{64}$/.test(campaignEvidenceSha256.trim()) &&
    (campaignOutcome === "finalize_recorded" || campaignOutcome === "halt_reserved"
      ? campaignRecipientOperationId.trim() === "" && campaignProviderMessageId.trim() === ""
      : /^camp_recipient_[0-9a-f]{24}$/.test(campaignRecipientOperationId.trim()) &&
        (campaignOutcome === "not_sent" ||
          /^[A-Za-z0-9._:-]{8,512}$/.test(campaignProviderMessageId.trim())));

  const reconcileCampaign = async () => {
    if (!campaignConfirmed || !campaignEvidenceValid) return;
    setCampaignPending(true);
    setCampaignNotice(null);
    try {
      const result = await liteReconcileCampaignEvidence({
        operationId: campaignOperationId.trim(),
        requestSha256: campaignRequestSha256.trim(),
        recipientOperationId:
          campaignOutcome === "finalize_recorded" || campaignOutcome === "halt_reserved"
            ? null
            : campaignRecipientOperationId.trim(),
        outcome: campaignOutcome,
        providerMessageId:
          campaignOutcome === "sent" ? campaignProviderMessageId.trim() : null,
        providerEvidenceSha256: campaignEvidenceSha256.trim(),
      });
      setCampaignNotice(
        `${result.idempotent ? "Existing evidence confirmed" : "Campaign reconciled"}: ${result.sent} sent, ${result.failed} not sent. No send loop resumed.`,
      );
      setCampaignConfirmed(false);
    } catch (error) {
      setCampaignNotice(error instanceof Error ? error.message : "Campaign reconciliation failed safely.");
    } finally {
      setCampaignPending(false);
    }
  };

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-xl font-semibold text-slate-900">Plan & seats</h1>
        <p className="mt-1 text-sm text-slate-500">
          What is included in the Hemas Lite package.
        </p>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-blue-900/5 bg-white p-5 shadow-sm">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Hemas Lite — what&apos;s included</h2>
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold uppercase text-blue-700">
              Package
            </span>
          </div>
          <table className="mt-4 w-full text-sm">
            <tbody>
              {LITE_PLAN.rows.map(([feature, value]) => (
                <tr key={feature} className="border-t border-slate-100">
                  <td className="py-2 text-slate-600">{feature}</td>
                  <td className="py-2 text-right font-medium text-slate-800">{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-[11px] leading-relaxed text-slate-400">
            Need governance reviews, LiveTrack / Lab integrations, unlimited scale or custom
            journeys? That&apos;s <span className="font-medium text-slate-600">Hemas Connect Enterprise</span> —
            same engine, full programme.
          </p>
        </section>

        <section className="space-y-4">
          <div className="rounded-2xl border border-blue-900/5 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">Seats (synthetic demo)</h2>
            <table className="mt-3 w-full text-sm">
              <tbody>
                {LITE_SEAT_HINTS.map((seat) => (
                  <tr key={seat.email} className="border-t border-slate-100">
                    <td className="py-2">
                      <p className="font-medium text-slate-800">{seat.label}</p>
                      <p className="text-[11px] text-slate-400">{seat.email}</p>
                    </td>
                    <td className="py-2 text-right">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-slate-600">
                        {seat.role}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] leading-5 text-slate-500">
              Credentials are distributed privately and are never displayed or reset by this portal.
            </p>
          </div>

          <div className="rounded-2xl border border-blue-900/5 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">Provisioning</h2>
            <p className="mt-1 text-xs text-slate-500">
              Writes workspace memberships for three pre-created Auth seats. It never creates
              an account or sets a password. A verified private admin claim is required.
            </p>
            <button
              type="button"
              onClick={() => void provision()}
              disabled={pending || !operatorAccess.liteAdmin}
              className="mt-3 rounded-xl bg-[#1863DC] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0F56C4] disabled:opacity-40"
            >
              {pending ? "Provisioning…" : "Provision / repair seats"}
            </button>
            {!operatorAccess.liteAdmin ? (
              <p className="mt-2 text-[11px] text-slate-400">
                {operatorAccess.checking
                  ? "Checking private operator claims…"
                  : "This verified identity does not have the Lite admin claim."}
              </p>
            ) : null}
            {notice ? (
              <p className="mt-2 rounded-lg bg-blue-50 px-3 py-2 text-[11px] text-blue-800">
                {notice}
              </p>
            ) : null}
          </div>
        </section>
      </div>

      {operatorAccess.liteAdmin || operatorAccess.metaAdmin ? (
        <section className="rounded-2xl border border-amber-200 bg-amber-50/40 p-5 shadow-sm">
          <div className="max-w-3xl">
            <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-amber-800">
              Private operator only
            </p>
            <h2 className="mt-1 text-base font-semibold text-slate-900">
              Provider recovery controls
            </h2>
            <p className="mt-1 text-xs leading-5 text-slate-600">
              These controls are hidden without exact verified admin claims. Never use them to
              bypass an uncertain outcome: first verify provider evidence outside this portal.
            </p>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            {operatorAccess.metaAdmin ? (
              <div className="rounded-xl border border-amber-200 bg-white p-4">
                <h3 className="text-sm font-semibold text-slate-900">Recover due webhook effects</h3>
                <p className="mt-1 text-[11px] leading-5 text-slate-500">
                  Processes only due pre-dispatch effects. Post-dispatch ambiguous effects remain
                  fatal and are never resent. A pending effect may send one allowlisted message.
                </p>
                <label className="mt-3 flex items-start gap-2 text-[11px] leading-5 text-slate-700">
                  <input
                    type="checkbox"
                    checked={metaConfirmed}
                    onChange={(event) => setMetaConfirmed(event.target.checked)}
                    className="mt-1"
                  />
                  I reviewed the content-free outbox state and authorize due-effect recovery.
                </label>
                <button
                  type="button"
                  onClick={() => void reconcileOutbox()}
                  disabled={metaPending || !metaConfirmed}
                  className="mt-3 rounded-xl bg-amber-700 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-800 disabled:opacity-40"
                >
                  {metaPending ? "Recovering…" : "Run bounded recovery"}
                </button>
                {metaNotice ? (
                  <p className="mt-2 rounded-lg bg-amber-100 px-3 py-2 text-[11px] text-amber-900" role="status">
                    {metaNotice}
                  </p>
                ) : null}
              </div>
            ) : null}

            {operatorAccess.metaAdmin ? (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void reconcileFatalEffect();
                }}
                className="rounded-xl border border-amber-200 bg-white p-4"
              >
                <h3 className="text-sm font-semibold text-slate-900">
                  Resolve one fatal Meta effect
                </h3>
                <p className="mt-1 text-[11px] leading-5 text-slate-500">
                  Records independently verified provider evidence for one fatal post-dispatch
                  ambiguity. This action never sends or retries a Meta request.
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <label className="text-[11px] font-medium text-slate-700 sm:col-span-2">
                    Effect ID
                    <input
                      value={fatalEffectId}
                      onChange={(event) => {
                        setFatalEffectId(event.target.value.toLowerCase());
                        setFatalConfirmed(false);
                      }}
                      placeholder="fx_…"
                      autoComplete="off"
                      spellCheck={false}
                      className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-xs"
                    />
                  </label>
                  <label className="text-[11px] font-medium text-slate-700">
                    Effect kind
                    <select
                      value={fatalEffectKind}
                      onChange={(event) => {
                        const value = event.target.value;
                        setFatalEffectKind(
                          value === "graph_auto_reply" || value === "graph_template_send"
                            ? value
                            : "graph_bot_reply",
                        );
                        setFatalConfirmed(false);
                      }}
                      className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-xs"
                    >
                      <option value="graph_bot_reply">Bot reply</option>
                      <option value="graph_auto_reply">Automatic reply</option>
                      <option value="graph_template_send">Template send</option>
                    </select>
                  </label>
                  <label className="text-[11px] font-medium text-slate-700">
                    Verified outcome
                    <select
                      value={fatalOutcome}
                      onChange={(event) => {
                        const next =
                          event.target.value === "confirmed_sent"
                            ? "confirmed_sent"
                            : "confirmed_not_sent";
                        setFatalOutcome(next);
                        if (next === "confirmed_not_sent") {
                          setFatalProviderMessageId("");
                        }
                        setFatalConfirmed(false);
                      }}
                      className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-xs"
                    >
                      <option value="confirmed_not_sent">Confirmed not sent</option>
                      <option value="confirmed_sent">Confirmed sent</option>
                    </select>
                  </label>
                  <label className="text-[11px] font-medium text-slate-700 sm:col-span-2">
                    Provider message ID {fatalOutcome === "confirmed_sent" ? "(required)" : "(not used)"}
                    <input
                      type="password"
                      value={fatalProviderMessageId}
                      onChange={(event) => {
                        setFatalProviderMessageId(event.target.value);
                        setFatalConfirmed(false);
                      }}
                      disabled={fatalOutcome === "confirmed_not_sent"}
                      autoComplete="off"
                      spellCheck={false}
                      className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-xs disabled:bg-slate-50"
                    />
                  </label>
                  <label className="text-[11px] font-medium text-slate-700 sm:col-span-2">
                    Provider evidence SHA-256
                    <input
                      type="password"
                      value={fatalEvidenceSha256}
                      onChange={(event) => {
                        setFatalEvidenceSha256(event.target.value.toLowerCase());
                        setFatalConfirmed(false);
                      }}
                      autoComplete="off"
                      spellCheck={false}
                      className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-xs"
                    />
                  </label>
                </div>
                <p className="mt-2 text-[10px] leading-4 text-slate-400">
                  The browser derives the exact canonical request SHA-256 from these fields using
                  Web Crypto. Evidence values are never shown in the result message.
                </p>
                <label className="mt-3 flex items-start gap-2 text-[11px] leading-5 text-slate-700">
                  <input
                    type="checkbox"
                    checked={fatalConfirmed}
                    onChange={(event) => setFatalConfirmed(event.target.checked)}
                    className="mt-1"
                  />
                  I independently verified this exact provider outcome and understand that this
                  action only records evidence; it never sends or retries Meta.
                </label>
                <button
                  type="submit"
                  disabled={fatalPending || !fatalConfirmed || !fatalEvidenceValid}
                  className="mt-3 rounded-xl bg-amber-700 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-800 disabled:opacity-40"
                >
                  {fatalPending ? "Recording…" : "Record fatal-effect evidence"}
                </button>
                {fatalNotice ? (
                  <p
                    className="mt-2 rounded-lg bg-amber-100 px-3 py-2 text-[11px] text-amber-900"
                    role="status"
                  >
                    {fatalNotice}
                  </p>
                ) : null}
              </form>
            ) : null}

            {operatorAccess.liteAdmin ? (
              <div className="rounded-xl border border-amber-200 bg-white p-4">
                <h3 className="text-sm font-semibold text-slate-900">Reconcile one reply</h3>
                <p className="mt-1 text-[11px] leading-5 text-slate-500">
                  Records a separately verified sent/not-sent outcome and releases the exact lock.
                  This action cannot call WhatsApp.
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <label className="text-[11px] font-medium text-slate-700">
                    Conversation ID
                    <input
                      value={conversationId}
                      onChange={(event) => setConversationId(event.target.value)}
                      placeholder="conversation_live_…"
                      autoComplete="off"
                      className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-xs"
                    />
                  </label>
                  <label className="text-[11px] font-medium text-slate-700">
                    Operation ID
                    <input
                      value={operationId}
                      onChange={(event) => setOperationId(event.target.value)}
                      placeholder="reply_…"
                      autoComplete="off"
                      className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-xs"
                    />
                  </label>
                  <label className="text-[11px] font-medium text-slate-700">
                    Verified outcome
                    <select
                      value={outcome}
                      onChange={(event) => {
                        const next = event.target.value === "sent" ? "sent" : "not_sent";
                        setOutcome(next);
                        if (next === "not_sent") setProviderMessageId("");
                      }}
                      className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-xs"
                    >
                      <option value="not_sent">Not sent</option>
                      <option value="sent">Sent</option>
                    </select>
                  </label>
                  <label className="text-[11px] font-medium text-slate-700">
                    Provider message ID {outcome === "sent" ? "(required)" : "(not used)"}
                    <input
                      type="password"
                      value={providerMessageId}
                      onChange={(event) => setProviderMessageId(event.target.value)}
                      disabled={outcome === "not_sent"}
                      autoComplete="off"
                      className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-xs disabled:bg-slate-50"
                    />
                  </label>
                  <label className="text-[11px] font-medium text-slate-700 sm:col-span-2">
                    Provider evidence SHA-256
                    <input
                      type="password"
                      value={providerEvidenceSha256}
                      onChange={(event) => setProviderEvidenceSha256(event.target.value.toLowerCase())}
                      autoComplete="off"
                      className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-xs"
                    />
                  </label>
                </div>
                <label className="mt-3 flex items-start gap-2 text-[11px] leading-5 text-slate-700">
                  <input
                    type="checkbox"
                    checked={replyConfirmed}
                    onChange={(event) => setReplyConfirmed(event.target.checked)}
                    className="mt-1"
                  />
                  I independently verified this exact provider outcome and evidence digest.
                </label>
                <button
                  type="button"
                  onClick={() => void reconcileReply()}
                  disabled={replyPending || !replyConfirmed || !replyEvidenceValid}
                  className="mt-3 rounded-xl bg-amber-700 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-800 disabled:opacity-40"
                >
                  {replyPending ? "Recording…" : "Record reconciliation"}
                </button>
                {replyNotice ? (
                  <p className="mt-2 rounded-lg bg-amber-100 px-3 py-2 text-[11px] text-amber-900" role="status">
                    {replyNotice}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>

          {operatorAccess.liteAdmin ? (
            <div className="mt-4 grid gap-4 xl:grid-cols-2">
              <details className="rounded-xl border border-amber-200 bg-white p-4">
                <summary className="cursor-pointer text-sm font-semibold text-slate-900">
                  Reconcile one booking notification
                </summary>
                <p className="mt-2 text-[11px] leading-5 text-slate-500">
                  Resolves only an exact stale/uncertain booking operation. It never calls WhatsApp.
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <label className="text-[11px] font-medium text-slate-700">
                    Operation ID
                    <input
                      value={bookingOperationId}
                      onChange={(event) => setBookingOperationId(event.target.value)}
                      placeholder="booking_…"
                      autoComplete="off"
                      className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-xs"
                    />
                  </label>
                  <label className="text-[11px] font-medium text-slate-700">
                    Verified outcome
                    <select
                      value={bookingOutcome}
                      onChange={(event) => {
                        const next = event.target.value === "sent" ? "sent" : "not_sent";
                        setBookingOutcome(next);
                        if (next === "not_sent") setBookingProviderMessageId("");
                      }}
                      className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-xs"
                    >
                      <option value="not_sent">Not sent</option>
                      <option value="sent">Sent</option>
                    </select>
                  </label>
                  <label className="text-[11px] font-medium text-slate-700 sm:col-span-2">
                    Request SHA-256
                    <input
                      type="password"
                      value={bookingRequestSha256}
                      onChange={(event) => setBookingRequestSha256(event.target.value.toLowerCase())}
                      autoComplete="off"
                      className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-xs"
                    />
                  </label>
                  <label className="text-[11px] font-medium text-slate-700 sm:col-span-2">
                    Provider message ID {bookingOutcome === "sent" ? "(required)" : "(not used)"}
                    <input
                      type="password"
                      value={bookingProviderMessageId}
                      onChange={(event) => setBookingProviderMessageId(event.target.value)}
                      disabled={bookingOutcome === "not_sent"}
                      autoComplete="off"
                      className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-xs disabled:bg-slate-50"
                    />
                  </label>
                  <label className="text-[11px] font-medium text-slate-700 sm:col-span-2">
                    Provider evidence SHA-256
                    <input
                      type="password"
                      value={bookingEvidenceSha256}
                      onChange={(event) => setBookingEvidenceSha256(event.target.value.toLowerCase())}
                      autoComplete="off"
                      className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-xs"
                    />
                  </label>
                </div>
                <label className="mt-3 flex items-start gap-2 text-[11px] leading-5 text-slate-700">
                  <input
                    type="checkbox"
                    checked={bookingConfirmed}
                    onChange={(event) => setBookingConfirmed(event.target.checked)}
                    className="mt-1"
                  />
                  I independently verified this exact booking notification outcome.
                </label>
                <button
                  type="button"
                  onClick={() => void reconcileBooking()}
                  disabled={bookingPending || !bookingConfirmed || !bookingEvidenceValid}
                  className="mt-3 rounded-xl bg-amber-700 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-800 disabled:opacity-40"
                >
                  {bookingPending ? "Recording…" : "Record booking evidence"}
                </button>
                {bookingNotice ? (
                  <p className="mt-2 rounded-lg bg-amber-100 px-3 py-2 text-[11px] text-amber-900" role="status">
                    {bookingNotice}
                  </p>
                ) : null}
              </details>

              <details className="rounded-xl border border-amber-200 bg-white p-4">
                <summary className="cursor-pointer text-sm font-semibold text-slate-900">
                  Reconcile one campaign
                </summary>
                <p className="mt-2 text-[11px] leading-5 text-slate-500">
                  Terminates one ambiguous recipient and marks every unsent remainder not sent.
                  It never resumes the send loop.
                </p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <label className="text-[11px] font-medium text-slate-700">
                    Operation ID
                    <input
                      value={campaignOperationId}
                      onChange={(event) => setCampaignOperationId(event.target.value)}
                      placeholder="campaign_…"
                      autoComplete="off"
                      className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-xs"
                    />
                  </label>
                  <label className="text-[11px] font-medium text-slate-700">
                    Verified outcome
                    <select
                      value={campaignOutcome}
                      onChange={(event) => {
                        const value = event.target.value;
                        const next =
                          value === "sent" ||
                          value === "finalize_recorded" ||
                          value === "halt_reserved"
                            ? value
                            : "not_sent";
                        setCampaignOutcome(next);
                        if (next !== "sent") setCampaignProviderMessageId("");
                        if (next === "finalize_recorded" || next === "halt_reserved") {
                          setCampaignRecipientOperationId("");
                        }
                      }}
                      className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-xs"
                    >
                      <option value="not_sent">Recipient not sent</option>
                      <option value="sent">Recipient sent</option>
                      <option value="finalize_recorded">Finalize recorded sends</option>
                      <option value="halt_reserved">Halt reserved recipients</option>
                    </select>
                  </label>
                  <label className="text-[11px] font-medium text-slate-700 sm:col-span-2">
                    Request SHA-256
                    <input
                      type="password"
                      value={campaignRequestSha256}
                      onChange={(event) => setCampaignRequestSha256(event.target.value.toLowerCase())}
                      autoComplete="off"
                      className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-xs"
                    />
                  </label>
                  <label className="text-[11px] font-medium text-slate-700 sm:col-span-2">
                    Recipient operation ID {campaignOutcome === "finalize_recorded" || campaignOutcome === "halt_reserved" ? "(not used)" : "(required)"}
                    <input
                      value={campaignRecipientOperationId}
                      onChange={(event) => setCampaignRecipientOperationId(event.target.value)}
                      disabled={campaignOutcome === "finalize_recorded" || campaignOutcome === "halt_reserved"}
                      placeholder="camp_recipient_…"
                      autoComplete="off"
                      className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-xs disabled:bg-slate-50"
                    />
                  </label>
                  <label className="text-[11px] font-medium text-slate-700 sm:col-span-2">
                    Provider message ID {campaignOutcome === "sent" ? "(required)" : "(not used)"}
                    <input
                      type="password"
                      value={campaignProviderMessageId}
                      onChange={(event) => setCampaignProviderMessageId(event.target.value)}
                      disabled={campaignOutcome !== "sent"}
                      autoComplete="off"
                      className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-xs disabled:bg-slate-50"
                    />
                  </label>
                  <label className="text-[11px] font-medium text-slate-700 sm:col-span-2">
                    Provider evidence SHA-256
                    <input
                      type="password"
                      value={campaignEvidenceSha256}
                      onChange={(event) => setCampaignEvidenceSha256(event.target.value.toLowerCase())}
                      autoComplete="off"
                      className="mt-1 h-10 w-full rounded-lg border border-slate-200 px-3 text-xs"
                    />
                  </label>
                </div>
                <label className="mt-3 flex items-start gap-2 text-[11px] leading-5 text-slate-700">
                  <input
                    type="checkbox"
                    checked={campaignConfirmed}
                    onChange={(event) => setCampaignConfirmed(event.target.checked)}
                    className="mt-1"
                  />
                  I verified the exact campaign evidence and accept that remaining recipients halt.
                </label>
                <button
                  type="button"
                  onClick={() => void reconcileCampaign()}
                  disabled={campaignPending || !campaignConfirmed || !campaignEvidenceValid}
                  className="mt-3 rounded-xl bg-amber-700 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-800 disabled:opacity-40"
                >
                  {campaignPending ? "Recording…" : "Record campaign evidence"}
                </button>
                {campaignNotice ? (
                  <p className="mt-2 rounded-lg bg-amber-100 px-3 py-2 text-[11px] text-amber-900" role="status">
                    {campaignNotice}
                  </p>
                ) : null}
              </details>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
