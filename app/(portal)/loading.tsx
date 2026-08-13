export default function PortalLoading() {
  return (
    <div className="space-y-6" aria-label="Loading Hemas Connect workspace" aria-busy="true">
      <div className="space-y-3">
        <div className="h-6 w-48 animate-pulse rounded-lg bg-blue-100" />
        <div className="h-4 w-full max-w-xl animate-pulse rounded bg-slate-200" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <div key={item} className="h-32 animate-pulse rounded-2xl border border-[var(--line)] bg-white" />
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-[1.45fr_0.75fr]">
        <div className="h-80 animate-pulse rounded-2xl border border-[var(--line)] bg-white" />
        <div className="h-80 animate-pulse rounded-2xl border border-[var(--line)] bg-white" />
      </div>
      <p className="text-sm font-medium text-slate-500">Loading governed workspace data…</p>
    </div>
  );
}
