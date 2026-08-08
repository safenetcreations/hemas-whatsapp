import { FailClosedError } from "./errors.js";

/**
 * Governed demo project boundary.
 *
 * The platform runs the synthetic demo in exactly two governed homes:
 *
 * 1. The loopback Firebase emulators under the reserved demo project ID
 *    (`demo-hemas-connect`). This is the default and requires an explicit
 *    loopback Firestore emulator host.
 * 2. The Hemas-owned cloud project (`hemas-whatsapp`) running the SAME
 *    synthetic demo semantics ("cloud demo"). This branch is inert unless the
 *    deployment explicitly sets `HEMAS_CLOUD_DEMO_ENABLED=true`, and it
 *    refuses any emulator-host leakage.
 *
 * Every other combination fails closed. External messaging, diagnosis and
 * real-patient gates are unchanged and enforced elsewhere; the cloud demo
 * carries the identical synthetic fixture graph only.
 */
export const EMULATOR_DEMO_PROJECT_ID = "demo-hemas-connect" as const;
export const CLOUD_DEMO_PROJECT_ID = "hemas-whatsapp" as const;

export type GovernedDemoBoundaryMode = "emulator" | "cloud";

export function isCloudDemoEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.HEMAS_CLOUD_DEMO_ENABLED === "true";
}

function parseLoopbackEmulatorHost(value: string): void {
  const normalized = value.includes("://") ? value : `http://${value}`;
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new FailClosedError(
      "invalid_audit_emulator",
      "Durable demo audit writes require a loopback Firestore emulator host and port.",
    );
  }
  const port = Number(url.port);
  if (
    (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") ||
    !Number.isInteger(port) ||
    port <= 0 ||
    port > 65535 ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new FailClosedError(
      "invalid_audit_emulator",
      "Durable demo audit writes require a loopback Firestore emulator host and port.",
    );
  }
}

export function assertGovernedDemoProjectBoundary(
  input: {
    readonly projectId: string;
    readonly firestoreEmulatorHost: string | undefined;
  },
  env: NodeJS.ProcessEnv = process.env,
): GovernedDemoBoundaryMode {
  if (input.projectId === EMULATOR_DEMO_PROJECT_ID) {
    if (!input.firestoreEmulatorHost) {
      throw new FailClosedError(
        "audit_emulator_required",
        "The Firestore emulator must be explicitly configured for durable demo audit writes.",
      );
    }
    parseLoopbackEmulatorHost(input.firestoreEmulatorHost);
    return "emulator";
  }

  if (input.projectId === CLOUD_DEMO_PROJECT_ID) {
    if (!isCloudDemoEnabled(env)) {
      throw new FailClosedError(
        "cloud_demo_not_enabled",
        "The governed cloud demo boundary is disabled unless HEMAS_CLOUD_DEMO_ENABLED is explicitly true.",
      );
    }
    if (input.firestoreEmulatorHost) {
      throw new FailClosedError(
        "cloud_demo_emulator_conflict",
        "The governed cloud demo boundary refuses emulator-host configuration.",
      );
    }
    return "cloud";
  }

  throw new FailClosedError(
    "invalid_audit_project",
    "Durable demo audit verification is restricted to the governed demo projects.",
  );
}
