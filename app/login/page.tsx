import type { Metadata } from "next";
import { AuthSessionProvider } from "@/components/auth/auth-session";
import { LoginCard } from "@/components/auth/login-card";

export const metadata: Metadata = { title: "Local demo access" };

export default function LoginPage() {
  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-[#eff6f3] px-4 py-12">
      <div className="pointer-events-none absolute -left-36 -top-36 h-96 w-96 rounded-full bg-emerald-200/35 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-44 -right-36 h-[30rem] w-[30rem] rounded-full bg-cyan-200/25 blur-3xl" />
      <AuthSessionProvider>
        <LoginCard />
      </AuthSessionProvider>
    </main>
  );
}
