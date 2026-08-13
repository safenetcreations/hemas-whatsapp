import type { Metadata } from "next";
import { LiteAuthProvider } from "@/components/lite/lite-auth";
import { LiteShell } from "@/components/lite/lite-shell";

export const metadata: Metadata = {
  title: { default: "Hemas Connect Lite — WhatsApp helpdesk demo", template: "%s · Hemas Connect Lite" },
  description:
    "Hemas Connect Lite governed synthetic demo — a multi-agent WhatsApp canary helpdesk running on the Hemas Connect engine.",
  robots: { index: false, follow: false },
};

export default function LiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <LiteAuthProvider>
      <LiteShell>{children}</LiteShell>
    </LiteAuthProvider>
  );
}
