import type { Metadata } from "next";
import { LiteAuthProvider } from "@/components/lite/lite-auth";
import { LiteShell } from "@/components/lite/lite-shell";

export const metadata: Metadata = {
  title: { default: "Hemas Lite — simple WhatsApp helpdesk (demo)", template: "%s · Hemas Lite" },
  description:
    "Hemas Lite synthetic demo — the simple multi-agent WhatsApp helpdesk running on the governed Hemas Connect engine.",
  robots: { index: false, follow: false },
};

export default function LiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <LiteAuthProvider>
      <LiteShell>{children}</LiteShell>
    </LiteAuthProvider>
  );
}
