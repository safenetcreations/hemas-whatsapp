import { createHash } from "node:crypto";

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function deterministicBucket(value: string, bucketCount: number): number {
  if (!Number.isSafeInteger(bucketCount) || bucketCount <= 0) {
    throw new RangeError("bucketCount must be a positive safe integer");
  }
  const prefix = sha256Hex(value).slice(0, 12);
  return Number.parseInt(prefix, 16) % bucketCount;
}

export function deterministicId(prefix: string, value: string): string {
  if (!/^[a-z][a-z0-9-]{1,30}$/.test(prefix)) {
    throw new TypeError("prefix must be a safe lowercase identifier");
  }
  return `${prefix}-${sha256Hex(value).slice(0, 24)}`;
}
