import type { Metadata } from "next";

import { AnalyticsWorkspace } from "@/components/analytics/analytics-workspace";

export const metadata: Metadata = {
  title: "Synthetic Analytics | Hemas Connect Demo",
  description:
    "Privacy-preserving deterministic sample analytics for operational funnels, handoffs, and safeguards.",
};

export default function AnalyticsPage() {
  return <AnalyticsWorkspace />;
}
