import { z } from "zod";

const disabledBoolean = z
  .literal("false")
  .default("false")
  .transform(() => false as const);

const publicEnvSchema = z.object({
  appStage: z.enum(["demo", "development", "uat"]).default("demo"),
  externalMessagingEnabled: disabledBoolean,
  realPatientDataEnabled: disabledBoolean,
});

export function parsePublicEnv(input: {
  readonly NEXT_PUBLIC_APP_STAGE?: string;
  readonly NEXT_PUBLIC_EXTERNAL_MESSAGING_ENABLED?: string;
  readonly NEXT_PUBLIC_REAL_PATIENT_DATA_ENABLED?: string;
}) {
  return publicEnvSchema.parse({
    appStage: input.NEXT_PUBLIC_APP_STAGE,
    externalMessagingEnabled: input.NEXT_PUBLIC_EXTERNAL_MESSAGING_ENABLED,
    realPatientDataEnabled: input.NEXT_PUBLIC_REAL_PATIENT_DATA_ENABLED,
  });
}

export const publicEnv = parsePublicEnv({
  NEXT_PUBLIC_APP_STAGE: process.env.NEXT_PUBLIC_APP_STAGE,
  NEXT_PUBLIC_EXTERNAL_MESSAGING_ENABLED:
    process.env.NEXT_PUBLIC_EXTERNAL_MESSAGING_ENABLED,
  NEXT_PUBLIC_REAL_PATIENT_DATA_ENABLED:
    process.env.NEXT_PUBLIC_REAL_PATIENT_DATA_ENABLED,
});

export const isSafeDemo =
  publicEnv.appStage === "demo" &&
  !publicEnv.externalMessagingEnabled &&
  !publicEnv.realPatientDataEnabled;

export const publicStageLabel = publicEnv.appStage === "uat"
  ? "CONNECTED UAT CONFIGURATION"
  : publicEnv.appStage === "development"
    ? "LOCAL DEVELOPMENT"
    : "SAFENET SYNTHETIC DEMO";
