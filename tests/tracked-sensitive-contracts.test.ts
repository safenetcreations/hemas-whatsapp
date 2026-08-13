import { describe, expect, it } from "vitest";
import { scanTrackedText } from "@/scripts/ops/tracked-sensitive-contracts";

describe("tracked-sensitive scanner contracts", () => {
  it("blocks tracked environment files but permits explicit examples", () => {
    expect(scanTrackedText("functions/.env.production", "SAFE=false")).toEqual([
      { path: "functions/.env.production", rule: "tracked-environment-file" },
    ]);
    expect(scanTrackedText("functions/.env.example", "SAFE=false")).toEqual([]);
  });

  it("detects high-confidence credential material without returning the value", () => {
    const privateKey = [
      "-----BEGIN PRIVATE",
      " KEY-----",
      "sensitive-payload",
      "-----END PRIVATE KEY-----",
    ].join("");
    const findings = scanTrackedText("config/fixture.txt", privateKey);
    expect(findings).toEqual([
      { path: "config/fixture.txt", rule: "private-key-material" },
    ]);
    expect(JSON.stringify(findings)).not.toContain("sensitive-payload");
  });

  it("blocks raw Sri Lankan mobile numbers only on client-visible paths", () => {
    const rawMobile = ["+94", "77", "123", "4567"].join("");
    expect(scanTrackedText("components/contact.tsx", rawMobile)).toEqual([
      { path: "components/contact.tsx", rule: "client-visible-sri-lanka-mobile" },
    ]);
    expect(scanTrackedText("tests/contact-fixture.ts", rawMobile)).toEqual([]);
  });

  it("does not flag public Firebase client descriptors", () => {
    const descriptor = "NEXT_PUBLIC_FIREBASE_API_KEY=public-client-descriptor";
    expect(scanTrackedText("apphosting.yaml", descriptor)).toEqual([]);
  });

  it("blocks populated provider configuration and client-visible provider IDs", () => {
    const environmentAssignment = ["HEMAS_META_PHONE_NUMBER_ID=", "123", "456", "789"].join("");
    expect(scanTrackedText("functions/provider.env", environmentAssignment)).toEqual([
      { path: "functions/provider.env", rule: "provider-identifier-config" },
    ]);
    expect(scanTrackedText("functions/.env.example", "HEMAS_META_PHONE_NUMBER_ID=")).toEqual([]);

    const clientIdentifier = ["phoneNumberId: \"", "123", "456", "789", "\""].join("");
    expect(scanTrackedText("components/provider.tsx", clientIdentifier)).toEqual([
      { path: "components/provider.tsx", rule: "client-visible-provider-identifier" },
    ]);
  });
});
