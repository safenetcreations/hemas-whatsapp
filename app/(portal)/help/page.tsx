import type { Metadata } from "next";

import { HelpWorkspace } from "@/components/settings/help-workspace";

export const metadata: Metadata = {
  title: "Help & Escalation | Hemas Connect Demo",
  description:
    "Synthetic-demo operational guidance, safety escalation boundaries, and local acceptance checklist evidence.",
};

export default function HelpPage() {
  return <HelpWorkspace />;
}
