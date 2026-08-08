import { AuthSessionProvider } from "@/components/auth/auth-session";
import { PortalPermissionGate } from "@/components/auth/portal-permission-gate";
import { PortalSessionGate } from "@/components/auth/portal-session-gate";
import { WorkspaceSessionProvider } from "@/components/auth/workspace-session";
import { PortalShell } from "@/components/portal-shell";

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthSessionProvider>
      <WorkspaceSessionProvider>
        <PortalSessionGate>
          <PortalShell>
            <PortalPermissionGate>{children}</PortalPermissionGate>
          </PortalShell>
        </PortalSessionGate>
      </WorkspaceSessionProvider>
    </AuthSessionProvider>
  );
}
