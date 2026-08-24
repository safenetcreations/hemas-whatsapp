import assert from "node:assert/strict";
import test from "node:test";
import {
  ENTERPRISE_MEDIA_LIMITS,
  ENTERPRISE_TEMPLATE_HEADER_MEDIA_KINDS,
  EnterpriseMediaError,
  assertDynamicCtaSuffix,
  assertEnterpriseMediaDescriptor,
  assertPublicHttpsUrl,
  isTemplateHeaderMediaKind,
  resolveDynamicCtaUrl,
} from "../src/enterprise/media.js";

const validImage = {
  kind: "image",
  mimeType: "image/jpeg",
  sizeBytes: 512_000,
  link: "https://cdn.hemas-connect.example/media/visit-header.jpg",
};

test("media descriptors accept every documented kind at its limit", () => {
  for (const [kind, limit] of Object.entries(ENTERPRISE_MEDIA_LIMITS)) {
    for (const mimeType of limit.mimeTypes) {
      const descriptor = assertEnterpriseMediaDescriptor({
        kind,
        mimeType,
        sizeBytes: limit.maxBytes,
        link: "https://cdn.hemas-connect.example/media/sample",
      });
      assert.equal(descriptor.kind, kind);
      assert.equal(descriptor.mimeType, mimeType);
      assert.equal(descriptor.sizeBytes, limit.maxBytes);
    }
  }
});

test("media descriptors normalize mime case and require exact keys", () => {
  const descriptor = assertEnterpriseMediaDescriptor({ ...validImage, mimeType: "IMAGE/JPEG" });
  assert.equal(descriptor.mimeType, "image/jpeg");
  assert.throws(
    () => assertEnterpriseMediaDescriptor({ ...validImage, extra: true }),
    (error: unknown) => error instanceof EnterpriseMediaError && error.code === "invalid_media_kind",
  );
  assert.throws(
    () => assertEnterpriseMediaDescriptor(null),
    (error: unknown) => error instanceof EnterpriseMediaError && error.code === "invalid_media_kind",
  );
});

test("media descriptors reject wrong mime, size and kind", () => {
  assert.throws(
    () => assertEnterpriseMediaDescriptor({ ...validImage, kind: "sticker" }),
    (error: unknown) => error instanceof EnterpriseMediaError && error.code === "invalid_media_kind",
  );
  assert.throws(
    () => assertEnterpriseMediaDescriptor({ ...validImage, mimeType: "image/gif" }),
    (error: unknown) => error instanceof EnterpriseMediaError && error.code === "invalid_media_mime",
  );
  assert.throws(
    () =>
      assertEnterpriseMediaDescriptor({
        ...validImage,
        sizeBytes: ENTERPRISE_MEDIA_LIMITS.image.maxBytes + 1,
      }),
    (error: unknown) => error instanceof EnterpriseMediaError && error.code === "invalid_media_size",
  );
  for (const sizeBytes of [0, -1, 1.5, "big"]) {
    assert.throws(
      () => assertEnterpriseMediaDescriptor({ ...validImage, sizeBytes }),
      (error: unknown) =>
        error instanceof EnterpriseMediaError && error.code === "invalid_media_size",
    );
  }
});

test("public HTTPS validation rejects private and malformed destinations", () => {
  assert.equal(
    assertPublicHttpsUrl("https://api.customer.example/hook", "URL"),
    "https://api.customer.example/hook",
  );
  const rejected = [
    "http://api.customer.example/hook",
    "https://user:pass@api.customer.example/hook",
    "https://localhost/hook",
    "https://127.0.0.1/hook",
    "https://[::1]/hook",
    "https://internal-host/hook",
    "https://service.local/hook",
    "https://service.internal/hook",
    "not-a-url",
    "",
    `https://api.customer.example/${"a".repeat(600)}`,
  ];
  for (const candidate of rejected) {
    assert.throws(
      () => assertPublicHttpsUrl(candidate, "URL"),
      (error: unknown) =>
        error instanceof EnterpriseMediaError && error.code === "invalid_media_link",
    );
  }
});

test("template headers permit image, video and document but never audio", () => {
  assert.deepEqual([...ENTERPRISE_TEMPLATE_HEADER_MEDIA_KINDS], ["image", "video", "document"]);
  assert.equal(isTemplateHeaderMediaKind("image"), true);
  assert.equal(isTemplateHeaderMediaKind("audio"), false);
});

test("dynamic CTA suffixes stay bounded relative path segments", () => {
  assert.equal(assertDynamicCtaSuffix(" visits/2026/summary-01 "), "visits/2026/summary-01");
  const rejected = [
    "",
    "/leading-slash",
    "a//b",
    "a/../b",
    "..",
    "a b",
    "a?b=c",
    "a#b",
    "https://evil.example",
    "a".repeat(257),
  ];
  for (const candidate of rejected) {
    assert.throws(
      () => assertDynamicCtaSuffix(candidate),
      (error: unknown) =>
        error instanceof EnterpriseMediaError && error.code === "invalid_cta_suffix",
    );
  }
});

test("resolved CTA URLs compose from a trailing-slash catalogue base only", () => {
  assert.equal(
    resolveDynamicCtaUrl("https://demo.hemas-connect.example/visit/", "ref-001"),
    "https://demo.hemas-connect.example/visit/ref-001",
  );
  assert.throws(
    () => resolveDynamicCtaUrl("https://demo.hemas-connect.example/visit", "ref-001"),
    (error: unknown) =>
      error instanceof EnterpriseMediaError && error.code === "invalid_cta_suffix",
  );
});
