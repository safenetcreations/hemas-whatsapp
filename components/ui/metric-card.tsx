import type { LucideIcon } from "lucide-react";

export function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  tone = "brand",
}: {
  label: string;
  value: string;
  detail: string;
  icon: LucideIcon;
  tone?: "brand" | "amber" | "blue" | "violet";
}) {
  const tones = {
    brand: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
    blue: "bg-blue-50 text-blue-700",
    violet: "bg-violet-50 text-violet-700",
  };

  return (
    <article className="rounded-2xl border border-[var(--line)] bg-white p-4 shadow-[0_1px_2px_rgba(23,34,31,0.03)] sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-[var(--muted)]">{label}</p>
          <p className="mt-2 text-2xl font-bold tracking-[-0.03em] text-[var(--ink)] sm:text-[1.75rem]">
            {value}
          </p>
        </div>
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${tones[tone]}`}>
          <Icon size={19} aria-hidden="true" />
        </span>
      </div>
      <p className="mt-3 text-xs leading-5 text-[var(--muted)]">{detail}</p>
    </article>
  );
}
