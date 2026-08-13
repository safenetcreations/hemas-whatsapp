/**
 * Shared Meta Graph plumbing for the governed live canary lane.
 *
 * Single home for the secret params, the project boundary check and the
 * Graph send helper so the webhook (meta-canary) and the Lite agent lane
 * never declare the same secret twice.
 */

import { defineSecret } from "firebase-functions/params";
import {
  CLOUD_DEMO_PROJECT_ID,
  assertGovernedDemoProjectBoundary,
  isCloudDemoEnabled,
} from "../governed-project.js";

export const metaAccessToken = defineSecret("HEMAS_META_ACCESS_TOKEN");
export const metaAppSecret = defineSecret("HEMAS_META_APP_SECRET");
export const metaVerifyToken = defineSecret("HEMAS_META_VERIFY_TOKEN");
export const geminiApiKey = defineSecret("HEMAS_GEMINI_API_KEY");
/** Versioned AES keyring for short-lived, signed-inbound return routes. */
export const metaReturnRouteKeyring = defineSecret(
  "HEMAS_META_RETURN_ROUTE_KEYRING",
);
/** Stable HMAC key for public sender identity, quota, session, and STOP state. */
export const metaPublicIdentityKey = defineSecret(
  "HEMAS_META_PUBLIC_IDENTITY_KEY",
);

export function graphVersion(): string {
  const raw = process.env.HEMAS_META_GRAPH_VERSION?.trim() ?? "";
  return /^v\d{1,3}\.\d{1,2}$/.test(raw) ? raw : "v23.0";
}

/** Canary lane boundary: cloud demo project only, both gates on, no emulator. */
export function canaryBoundaryOrNull(): { projectId: string } | null {
  const projectId = process.env.GCLOUD_PROJECT ?? "";
  if (
    process.env.HEMAS_META_CANARY_ENABLED !== "true" ||
    !isCloudDemoEnabled() ||
    projectId !== CLOUD_DEMO_PROJECT_ID ||
    process.env.FIRESTORE_EMULATOR_HOST
  ) {
    return null;
  }
  try {
    const mode = assertGovernedDemoProjectBoundary({
      projectId,
      firestoreEmulatorHost: process.env.FIRESTORE_EMULATOR_HOST,
    });
    return mode === "cloud" ? { projectId } : null;
  } catch {
    return null;
  }
}

/**
 * Send one WhatsApp message body via the Graph API. Throws a content-free
 * error (status + Meta error code only) on failure; returns the provider
 * message id on success.
 */
export async function sendGraphMessage(
  phoneNumberId: string,
  token: string,
  to: string,
  body: Record<string, unknown>,
): Promise<{ providerMessageId: string | null }> {
  const url = `https://graph.facebook.com/${graphVersion()}/${phoneNumberId}/messages`;
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      ...body,
    }),
  });
  const detail = (await response.json().catch(() => null)) as
    | { messages?: Array<{ id?: string }>; error?: { code?: number; message?: string } }
    | null;
  if (!response.ok) {
    throw new Error(`graph ${response.status}${detail?.error?.code ? ` code ${detail.error.code}` : ""}`);
  }
  return { providerMessageId: detail?.messages?.[0]?.id ?? null };
}
