import type { Metadata } from "next";
import { CampaignControlCentre } from "@/components/campaigns/campaign-control-centre";

export const metadata: Metadata = {
  title: "Campaign Control Centre | Hemas Connect Demo",
  description:
    "Authenticated persisted 50,000-record campaign simulation with aggregate-only evidence and external delivery disabled.",
};

export default function CampaignsPage() {
  return <CampaignControlCentre />;
}
