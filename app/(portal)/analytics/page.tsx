import type { Metadata } from "next";

import { AnalyticsWorkspace } from "@/components/analytics/analytics-workspace";

export const metadata: Metadata = {
  title: "Analytics | Hemas Connect Demo",
  description:
    "Content-free WhatsApp aggregate counters and clearly separated deterministic scenario analytics.",
};

export default function AnalyticsPage() {
  return <AnalyticsWorkspace />;
}
