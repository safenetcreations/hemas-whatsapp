import type { Metadata } from "next";
import { TeamWorkspace } from "@/components/team/team-workspace";

export const metadata: Metadata = {
  title: "Team & Routing",
  description: "Synthetic-only team, access policy and queue routing workspace.",
};

export default function TeamPage() {
  return <TeamWorkspace />;
}
