export interface SeedEmulatorHosts {
  readonly firestore: string;
  readonly auth: string;
}

export function requireExactLoopbackEmulatorHost(
  value: string | undefined,
  label: string,
  expectedPort: number,
): string {
  if (!value) {
    throw new Error(`Refusing privileged seed: ${label} is not configured.`);
  }

  const match = /^(127\.0\.0\.1|localhost):(\d+)$/.exec(value);
  if (!match || Number(match[2]) !== expectedPort) {
    throw new Error(
      `Refusing privileged seed: ${label} must be exactly 127.0.0.1:${expectedPort} or localhost:${expectedPort}.`,
    );
  }

  return value;
}

export function assertSafeSeedEmulatorHosts(environment: {
  readonly FIRESTORE_EMULATOR_HOST?: string;
  readonly FIREBASE_AUTH_EMULATOR_HOST?: string;
}): SeedEmulatorHosts {
  return {
    firestore: requireExactLoopbackEmulatorHost(
      environment.FIRESTORE_EMULATOR_HOST,
      "FIRESTORE_EMULATOR_HOST",
      8080,
    ),
    auth: requireExactLoopbackEmulatorHost(
      environment.FIREBASE_AUTH_EMULATOR_HOST,
      "FIREBASE_AUTH_EMULATOR_HOST",
      9099,
    ),
  };
}
