export const syntheticAuthProjectId = "demo-hemas-connect";
export const syntheticDemoEmail = "demo.admin@synthetic.invalid";
export const syntheticDemoPassword = "Synthetic-Demo-Only-2026!";

export type LocalAuthPolicyInput = {
  hostname: string;
  projectId?: string;
  appStage?: string;
  useFirebaseEmulators?: string;
  externalMessagingEnabled?: string;
  realPatientDataEnabled?: string;
};

export type LocalAuthPolicyResult =
  | { allowed: true }
  | {
      allowed: false;
      reason:
        | "non_loopback_host"
        | "non_demo_project"
        | "unsafe_stage"
        | "emulators_disabled"
        | "external_messaging_enabled"
        | "real_patient_data_enabled";
    };

export function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

export function evaluateLocalAuthPolicy(input: LocalAuthPolicyInput): LocalAuthPolicyResult {
  if (!isLoopbackHostname(input.hostname)) {
    return { allowed: false, reason: "non_loopback_host" };
  }

  if ((input.projectId ?? syntheticAuthProjectId) !== syntheticAuthProjectId) {
    return { allowed: false, reason: "non_demo_project" };
  }

  const stage = input.appStage ?? "demo";
  if (stage !== "demo" && stage !== "development") {
    return { allowed: false, reason: "unsafe_stage" };
  }

  if ((input.useFirebaseEmulators ?? "true") !== "true") {
    return { allowed: false, reason: "emulators_disabled" };
  }

  if ((input.externalMessagingEnabled ?? "false") !== "false") {
    return { allowed: false, reason: "external_messaging_enabled" };
  }

  if ((input.realPatientDataEnabled ?? "false") !== "false") {
    return { allowed: false, reason: "real_patient_data_enabled" };
  }

  return { allowed: true };
}

export function isExpectedSyntheticIdentity(email: string | null): boolean {
  return email?.trim().toLowerCase() === syntheticDemoEmail;
}
