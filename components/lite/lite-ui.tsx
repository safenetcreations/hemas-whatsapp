import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function liteCx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

export const LITE_PANEL =
  "rounded-2xl border border-[var(--lite-line)] bg-white shadow-[0_1px_2px_rgba(19,52,63,0.03),0_12px_34px_rgba(19,52,63,0.045)]";

export const LITE_FIELD =
  "min-h-11 w-full rounded-xl border border-[var(--lite-line-strong)] bg-white px-3.5 py-2.5 text-sm text-[var(--lite-ink)] outline-none transition placeholder:text-slate-400 hover:border-[#9db5bc] focus:border-[var(--lite-brand)] focus:ring-4 focus:ring-[var(--lite-brand)]/10 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400";

export const LITE_BUTTON_PRIMARY =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[var(--lite-brand)] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_6px_16px_rgba(0,115,146,0.18)] transition hover:bg-[var(--lite-brand-strong)] focus-visible:ring-4 focus-visible:ring-[var(--lite-brand)]/20 disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none";

export const LITE_BUTTON_SECONDARY =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-[var(--lite-line-strong)] bg-white px-4 py-2.5 text-sm font-semibold text-[var(--lite-ink-secondary)] transition hover:border-[var(--lite-brand)]/35 hover:bg-[var(--lite-brand-soft)] hover:text-[var(--lite-brand-strong)] disabled:cursor-not-allowed disabled:opacity-45";

export function LitePageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: ReactNode;
  description: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="max-w-3xl">
        {eyebrow ? (
          <p className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-[var(--lite-brand)]">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="font-display text-[1.75rem] font-bold leading-tight tracking-[-0.035em] text-[var(--lite-ink)] sm:text-[2rem]">
          {title}
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-[var(--lite-muted)] sm:text-[15px]">
          {description}
        </p>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function LiteSectionHeader({
  title,
  description,
  action,
  icon: Icon,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <div className="flex flex-wrap items-start gap-3">
      {Icon ? (
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--lite-brand-soft)] text-[var(--lite-brand)]">
          <Icon size={19} strokeWidth={2} aria-hidden="true" />
        </span>
      ) : null}
      <div className="min-w-0 flex-1">
        <h2 className="font-display text-base font-bold tracking-[-0.015em] text-[var(--lite-ink)]">
          {title}
        </h2>
        {description ? (
          <p className="mt-1 text-sm leading-5 text-[var(--lite-muted)]">{description}</p>
        ) : null}
      </div>
      {action ? <div className="ml-auto shrink-0">{action}</div> : null}
    </div>
  );
}

type LiteStatusTone = "neutral" | "brand" | "success" | "warning" | "danger" | "info";

const LITE_STATUS_TONES: Record<LiteStatusTone, string> = {
  neutral: "border-slate-200 bg-slate-50 text-slate-600",
  brand: "border-[#b8dce4] bg-[var(--lite-brand-soft)] text-[var(--lite-brand-strong)]",
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  danger: "border-rose-200 bg-rose-50 text-rose-700",
  info: "border-sky-200 bg-sky-50 text-sky-800",
};

export function LiteStatus({
  children,
  tone = "neutral",
  dot = false,
}: {
  children: ReactNode;
  tone?: LiteStatusTone;
  dot?: boolean;
}) {
  return (
    <span
      className={liteCx(
        "inline-flex min-h-7 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-bold leading-none",
        LITE_STATUS_TONES[tone],
      )}
    >
      {dot ? <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

export function LiteMetricCard({
  label,
  value,
  detail,
  icon: Icon,
  accent = "teal",
}: {
  label: string;
  value: ReactNode;
  detail: ReactNode;
  icon: LucideIcon;
  accent?: "teal" | "blue" | "orange" | "violet";
}) {
  const tones = {
    teal: "bg-[var(--lite-brand-soft)] text-[var(--lite-brand)]",
    blue: "bg-blue-50 text-blue-700",
    orange: "bg-orange-50 text-orange-700",
    violet: "bg-violet-50 text-violet-700",
  } as const;

  return (
    <article className={liteCx(LITE_PANEL, "group relative overflow-hidden p-5 sm:p-6")}>
      <span className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-[var(--lite-brand)] via-[#1392b6] to-transparent opacity-75" />
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--lite-muted)]">
            {label}
          </p>
          <p className="mt-3 font-display text-[2rem] font-bold leading-none tracking-[-0.045em] text-[var(--lite-ink)] [font-variant-numeric:tabular-nums]">
            {value}
          </p>
        </div>
        <span className={liteCx("grid h-11 w-11 shrink-0 place-items-center rounded-xl", tones[accent])}>
          <Icon size={20} strokeWidth={2} aria-hidden="true" />
        </span>
      </div>
      <p className="mt-3 text-xs leading-5 text-[var(--lite-muted)]">{detail}</p>
    </article>
  );
}

export function LiteNotice({
  children,
  tone = "info",
}: {
  children: ReactNode;
  tone?: "info" | "success" | "warning" | "danger";
}) {
  const tones = {
    info: "border-sky-200 bg-sky-50 text-sky-900",
    success: "border-emerald-200 bg-emerald-50 text-emerald-900",
    warning: "border-amber-200 bg-amber-50 text-amber-950",
    danger: "border-rose-200 bg-rose-50 text-rose-900",
  } as const;
  return (
    <div
      className={liteCx("rounded-xl border px-4 py-3 text-sm leading-5", tones[tone])}
      role={tone === "danger" ? "alert" : "status"}
    >
      {children}
    </div>
  );
}

export function LiteEmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: ReactNode;
  description: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="grid min-h-52 place-items-center px-6 py-10 text-center">
      <div className="max-w-sm">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-[var(--lite-line)] bg-[var(--lite-brand-soft)] text-[var(--lite-brand)] shadow-sm">
          <Icon size={22} aria-hidden="true" />
        </span>
        <h3 className="mt-4 font-display text-base font-bold text-[var(--lite-ink)]">{title}</h3>
        <p className="mt-1.5 text-sm leading-6 text-[var(--lite-muted)]">{description}</p>
        {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
      </div>
    </div>
  );
}

/**
 * Human label for a booking day id such as `day_2026-08-13`. Legacy or
 * malformed ids (earlier bot versions stored non-ISO day ids) must never
 * render "Invalid Date"; they fall back to a neutral label.
 */
export function formatLiteBookingDay(dayId: string): string {
  const day = dayId.replace(/^day_/, "").trim();
  const timestamp = Date.parse(`${day}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(timestamp)) {
    return "Date to be confirmed";
  }
  return new Date(timestamp).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "2-digit",
    month: "short",
  });
}
