/**
 * Stage-aware wording for data-boundary copy.
 *
 * The same synthetic demo runs in two governed homes (see runtime-mode.ts):
 * the loopback emulators ("demo" stage) and the Hemas-owned cloud project
 * ("uat" stage, served by Firebase App Hosting). User-visible boundary copy
 * must describe the home it is actually running in — telling a cloud
 * evaluator that reads come from "the local Firestore emulator" is wrong and
 * undermines trust.
 *
 * These are build-time constants (NEXT_PUBLIC_*), so the strings are fixed per
 * deployment and remain byte-identical to the historical wording on the
 * default local stage.
 */
const stage = process.env.NEXT_PUBLIC_APP_STAGE ?? "demo";

/** True when this build is the governed cloud demo (App Hosting, `uat`). */
export const CLOUD_DEMO_STAGE: boolean = stage === "uat";

/** "the governed cloud demo project" | "the local Firestore emulator" */
export const DATA_SOURCE: string = CLOUD_DEMO_STAGE
  ? "the governed cloud demo project"
  : "the local Firestore emulator";

/** "governed cloud project" | "Firestore emulator" — for pills and short labels. */
export const DATA_SOURCE_SHORT: string = CLOUD_DEMO_STAGE
  ? "governed cloud project"
  : "Firestore emulator";

/** "the governed cloud Functions endpoint" | "the local Functions emulator" */
export const FUNCTIONS_SOURCE: string = CLOUD_DEMO_STAGE
  ? "the governed cloud Functions endpoint"
  : "the local Functions emulator";

/** "authenticated cloud reads" | "authenticated emulator reads" */
export const READS_LABEL: string = CLOUD_DEMO_STAGE
  ? "authenticated cloud reads"
  : "authenticated emulator reads";

/**
 * Tolerant read mode. In the cloud demo the Lite canary lane writes live
 * (non-synthetic) conversation, contact and template records into the same
 * workspace collections. Enterprise read models must not fail closed for the
 * whole page because one record belongs to another lane; they skip and count
 * it instead. Local emulator runs keep the strict behaviour the tests pin.
 */
export const TOLERANT_READS: boolean = CLOUD_DEMO_STAGE;
