import type { Metadata } from "next";

import { SettingsWorkspace } from "@/components/settings/settings-workspace";

export const metadata: Metadata = {
  title: "Settings | Hemas Connect Demo",
  description:
    "Local-only synthetic workspace preferences with immutable production, provider, and security boundaries.",
};

export default function SettingsPage() {
  return <SettingsWorkspace />;
}
