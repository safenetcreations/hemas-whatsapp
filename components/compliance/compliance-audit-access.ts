import { hasPermission } from "@/lib/domain/access-control";
import type { VerifiedWorkspaceSession } from "@/lib/firebase/workspace-session-model";

export type ComplianceAuditTimelineAccess =
  | "allowed"
  | "restricted"
  | "denied";

export function complianceAuditTimelineAccess(
  session: VerifiedWorkspaceSession,
): ComplianceAuditTimelineAccess {
  if (!hasPermission(session.role, "audit.view")) return "denied";
  if (
    session.role === "tenant_admin" &&
    session.scopeMode === "workspace_wide"
  ) {
    return "allowed";
  }
  if (
    session.role === "privacy_reviewer" &&
    session.scopeMode === "assigned"
  ) {
    return "allowed";
  }
  return "restricted";
}

export function complianceAuditAuthorityKey(
  session: VerifiedWorkspaceSession,
): string {
  return [
    session.workspaceId,
    session.uid,
    session.role,
    session.scopeMode,
    session.workspaceMode,
    session.dataClassification,
    session.teamIds.join("\u001f"),
    session.locationIds.join("\u001f"),
  ].join("\u001e");
}
