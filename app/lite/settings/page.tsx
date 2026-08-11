"use client";

import { useState } from "react";
import { useLiteAuth } from "@/components/lite/lite-auth";
import { liteSetupSeats } from "@/components/lite/lite-data";
import {
  LITE_ADMIN_EMAIL,
  LITE_PLAN,
  LITE_SEAT_HINTS,
} from "@/components/lite/lite-config";

export default function LiteSettingsPage() {
  const { user } = useLiteAuth();
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const isAdmin = (user?.email ?? "").toLowerCase() === LITE_ADMIN_EMAIL;

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

  return (
    <div className="space-y-6">
      <section>
        <h1 className="text-xl font-semibold text-slate-900">Plan & seats</h1>
        <p className="mt-1 text-sm text-slate-500">
          The Lite plan in one card — what the simple product includes, with demo figures.
        </p>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-blue-900/5 bg-white p-5 shadow-sm">
          <div className="flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-slate-900">Hemas Lite plan</h2>
            <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold uppercase text-blue-700">
              Demo pricing
            </span>
          </div>
          <p className="mt-3 text-2xl font-semibold text-blue-700">{LITE_PLAN.monthly}</p>
          <p className="text-xs text-slate-400">Setup {LITE_PLAN.setup}</p>
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
                      <p className="mt-1 font-mono text-[10px] text-slate-400">{seat.password}</p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-slate-400">
              Demo credentials on purpose — this workspace is synthetic-only by policy.
            </p>
          </div>

          <div className="rounded-2xl border border-blue-900/5 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold text-slate-900">Provisioning</h2>
            <p className="mt-1 text-xs text-slate-500">
              Creates or repairs the three seat accounts and their workspace memberships.
              Only the synthetic demo admin can run it.
            </p>
            <button
              type="button"
              onClick={() => void provision()}
              disabled={pending || !isAdmin}
              className="mt-3 rounded-xl bg-[#1863DC] px-4 py-2 text-sm font-semibold text-white hover:bg-[#0F56C4] disabled:opacity-40"
            >
              {pending ? "Provisioning…" : "Provision / repair seats"}
            </button>
            {!isAdmin ? (
              <p className="mt-2 text-[11px] text-slate-400">
                Sign in as the demo admin to enable this button.
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
    </div>
  );
}
