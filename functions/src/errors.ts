export class FailClosedError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "FailClosedError";
    this.code = code;
  }
}

export function assertSafeTenantId(tenantId: string): void {
  if (!/^[a-z0-9][a-z0-9_-]{2,62}$/.test(tenantId)) {
    throw new FailClosedError("invalid_tenant", "A valid tenant scope is required.");
  }
}

export function assertSameTenant(expected: string, actual: string): void {
  assertSafeTenantId(expected);
  assertSafeTenantId(actual);
  if (expected !== actual) {
    throw new FailClosedError("tenant_mismatch", "Cross-tenant operation denied.");
  }
}
