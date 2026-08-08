export type AuthSessionStatus =
  | "checking"
  | "authenticated"
  | "unauthenticated"
  | "unavailable";

export type PortalSessionDecision = "allow" | "wait" | "redirect";

export type WorkspaceGateStatus = "checking" | "verified" | "denied" | "unavailable";

export type CombinedPortalDecision =
  | { action: "allow" }
  | { action: "wait" }
  | {
      action: "redirect";
      reason:
        | "session-required"
        | "auth-unavailable"
        | "workspace-access-denied"
        | "workspace-unavailable";
    };

export function portalSessionDecision(status: AuthSessionStatus): PortalSessionDecision {
  if (status === "authenticated") return "allow";
  if (status === "checking") return "wait";
  return "redirect";
}

export function loginReasonForStatus(
  status: AuthSessionStatus,
): "session-required" | "auth-unavailable" {
  return status === "unavailable" ? "auth-unavailable" : "session-required";
}

export function combinedPortalDecision(
  authStatus: AuthSessionStatus,
  workspaceStatus: WorkspaceGateStatus,
): CombinedPortalDecision {
  if (workspaceStatus === "denied") {
    return { action: "redirect", reason: "workspace-access-denied" };
  }
  if (workspaceStatus === "unavailable") {
    return { action: "redirect", reason: "workspace-unavailable" };
  }
  if (authStatus === "unauthenticated") {
    return { action: "redirect", reason: "session-required" };
  }
  if (authStatus === "unavailable") {
    return { action: "redirect", reason: "auth-unavailable" };
  }
  if (authStatus === "authenticated" && workspaceStatus === "verified") {
    return { action: "allow" };
  }
  return { action: "wait" };
}
