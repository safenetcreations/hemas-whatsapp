import type { Metadata } from "next";
import { InboxExperience } from "@/components/inbox/inbox-experience";

export const metadata: Metadata = {
  title: "Shared inbox · Hemas Connect synthetic demo",
  description: "A local-only synthetic patient conversation workspace with governed human handoff and safety controls.",
};

export default function InboxPage() {
  return <InboxExperience />;
}
