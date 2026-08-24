/**
 * Hemas Connect ENTERPRISE — media acceptance and dynamic-URL CTA contracts.
 *
 * Pure, deterministic validation for the two provider-facing surfaces the
 * Enterprise gateway exposes:
 * - Declared media descriptors (image / video / audio / document) checked
 *   against the documented WhatsApp Cloud API type and size limits.
 * - Dynamic-URL call-to-action suffixes appended to a catalogue-fixed HTTPS
 *   base URL. The customer never supplies a full URL, only a bounded suffix.
 *
 * Nothing here talks to Firebase or the network; the engine composes these
 * checks inside its own governed boundary.
 */

export type EnterpriseMediaKind = "image" | "video" | "audio" | "document";

export interface EnterpriseMediaLimit {
  readonly mimeTypes: readonly string[];
  readonly maxBytes: number;
}

/** Documented WhatsApp Cloud API media acceptance matrix (v23.0). */
export const ENTERPRISE_MEDIA_LIMITS: Readonly<Record<EnterpriseMediaKind, EnterpriseMediaLimit>> = {
  image: {
    mimeTypes: ["image/jpeg", "image/png"],
    maxBytes: 5 * 1024 * 1024,
  },
  video: {
    mimeTypes: ["video/mp4", "video/3gpp"],
    maxBytes: 16 * 1024 * 1024,
  },
  audio: {
    mimeTypes: ["audio/aac", "audio/amr", "audio/mpeg", "audio/mp4", "audio/ogg"],
    maxBytes: 16 * 1024 * 1024,
  },
  document: {
    mimeTypes: [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "text/plain",
    ],
    maxBytes: 100 * 1024 * 1024,
  },
} as const;

/** Meta permits media template headers for these kinds only (never audio). */
export const ENTERPRISE_TEMPLATE_HEADER_MEDIA_KINDS = [
  "image",
  "video",
  "document",
] as const;

export type EnterpriseTemplateHeaderMediaKind =
  (typeof ENTERPRISE_TEMPLATE_HEADER_MEDIA_KINDS)[number];

export class EnterpriseMediaError extends Error {
  constructor(
    readonly code:
      | "invalid_media_kind"
      | "invalid_media_mime"
      | "invalid_media_size"
      | "invalid_media_link"
      | "invalid_cta_suffix",
    message: string,
  ) {
    super(message);
    this.name = "EnterpriseMediaError";
  }
}

export interface EnterpriseMediaDescriptor {
  readonly kind: EnterpriseMediaKind;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly link: string;
}

function isMediaKind(value: unknown): value is EnterpriseMediaKind {
  return value === "image" || value === "video" || value === "audio" || value === "document";
}

const PRIVATE_HOST_PATTERN =
  /^(localhost|.*\.local|.*\.internal|.*\.localhost|\d{1,3}(\.\d{1,3}){3}|\[[0-9a-fA-F:]+\])$/;

/**
 * Customer-reachable HTTPS URL only: no credentials, no literal IPs, no
 * loopback or link-local style hostnames, bounded length.
 */
export function assertPublicHttpsUrl(raw: unknown, subject: string): string {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value || value.length > 512) {
    throw new EnterpriseMediaError("invalid_media_link", `${subject} must be 1-512 characters.`);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new EnterpriseMediaError("invalid_media_link", `${subject} is not a valid URL.`);
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hostname.length === 0 ||
    !url.hostname.includes(".") ||
    PRIVATE_HOST_PATTERN.test(url.hostname)
  ) {
    throw new EnterpriseMediaError(
      "invalid_media_link",
      `${subject} must be a public HTTPS URL without credentials.`,
    );
  }
  return url.toString();
}

/** Exact-key media descriptor validated against the acceptance matrix. */
export function assertEnterpriseMediaDescriptor(raw: unknown): EnterpriseMediaDescriptor {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new EnterpriseMediaError("invalid_media_kind", "Media descriptor is required.");
  }
  const value = raw as Record<string, unknown>;
  const keys = Object.keys(value);
  const allowed = ["kind", "mimeType", "sizeBytes", "link"];
  if (keys.length !== allowed.length || !keys.every((key) => allowed.includes(key))) {
    throw new EnterpriseMediaError(
      "invalid_media_kind",
      "Media descriptor must contain exactly kind, mimeType, sizeBytes and link.",
    );
  }
  if (!isMediaKind(value.kind)) {
    throw new EnterpriseMediaError(
      "invalid_media_kind",
      "Media kind must be image, video, audio or document.",
    );
  }
  const limit = ENTERPRISE_MEDIA_LIMITS[value.kind];
  const mimeType = typeof value.mimeType === "string" ? value.mimeType.trim().toLowerCase() : "";
  if (!limit.mimeTypes.includes(mimeType)) {
    throw new EnterpriseMediaError(
      "invalid_media_mime",
      `Mime type is not accepted for ${value.kind} media.`,
    );
  }
  const sizeBytes = value.sizeBytes;
  if (!Number.isInteger(sizeBytes) || (sizeBytes as number) < 1 || (sizeBytes as number) > limit.maxBytes) {
    throw new EnterpriseMediaError(
      "invalid_media_size",
      `Declared ${value.kind} size must be between 1 and ${limit.maxBytes} bytes.`,
    );
  }
  const link = assertPublicHttpsUrl(value.link, "Media link");
  return { kind: value.kind, mimeType, sizeBytes: sizeBytes as number, link };
}

export function isTemplateHeaderMediaKind(
  kind: EnterpriseMediaKind,
): kind is EnterpriseTemplateHeaderMediaKind {
  return (ENTERPRISE_TEMPLATE_HEADER_MEDIA_KINDS as readonly string[]).includes(kind);
}

export const ENTERPRISE_CTA_SUFFIX_MAX_LENGTH = 256;

/**
 * Bounded dynamic-URL suffix appended to a catalogue-fixed base URL. The
 * character set deliberately excludes anything that could re-anchor the URL
 * (no scheme separators, no "..", no query/fragment metacharacters).
 */
export function assertDynamicCtaSuffix(raw: unknown): string {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (
    !value ||
    value.length > ENTERPRISE_CTA_SUFFIX_MAX_LENGTH ||
    !/^[A-Za-z0-9._~/-]+$/.test(value) ||
    value.includes("..") ||
    value.startsWith("/") ||
    value.includes("//")
  ) {
    throw new EnterpriseMediaError(
      "invalid_cta_suffix",
      "Dynamic CTA suffix must be a bounded relative path segment.",
    );
  }
  return value;
}

/** Compose the full resolved CTA URL for evidence and preview surfaces. */
export function resolveDynamicCtaUrl(baseUrl: string, suffix: string): string {
  const base = assertPublicHttpsUrl(baseUrl, "CTA base URL");
  if (!base.endsWith("/")) {
    throw new EnterpriseMediaError(
      "invalid_cta_suffix",
      "CTA base URLs must end with a trailing slash.",
    );
  }
  return `${base}${assertDynamicCtaSuffix(suffix)}`;
}
