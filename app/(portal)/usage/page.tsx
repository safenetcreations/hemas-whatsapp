import type { Metadata } from "next";

import { UsageWorkspace } from "@/components/analytics/usage-workspace";

export const metadata: Metadata = {
  title: "Synthetic Usage | Hemas Connect Demo",
  description:
    "A deterministic non-billing usage ledger with fictional cost-planning ranges and no provider connections.",
};

export default function UsagePage() {
  return <UsageWorkspace />;
}
