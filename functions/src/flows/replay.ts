import { FailClosedError } from "../errors.js";

export interface ReplayProtectedResult {
  readonly replayed: boolean;
}

export interface ReplayExecutionInput {
  readonly tenantId: string;
  readonly sessionId: string;
  readonly action: string;
  readonly idempotencyKey: string;
  readonly requestFingerprint: string;
  readonly expiresAt: number;
  readonly nowSeconds: number;
}

interface ReplayRecord {
  readonly idempotencyKey: string;
  readonly requestFingerprint: string;
  readonly expiresAt: number;
  readonly result: ReplayProtectedResult;
}

/**
 * Ephemeral single-process protection for deterministic demo tests only.
 * It is intentionally neither durable nor suitable for horizontally scaled runtimes.
 */
export class InMemoryFlowReplayGuard {
  private readonly records = new Map<string, ReplayRecord>();

  get size(): number {
    return this.records.size;
  }

  clear(): void {
    this.records.clear();
  }

  execute<Result extends ReplayProtectedResult>(
    input: ReplayExecutionInput,
    createResult: () => Result,
  ): Result {
    if (
      !input.tenantId ||
      !input.sessionId ||
      !input.action ||
      !input.idempotencyKey ||
      !/^[a-f0-9]{64}$/.test(input.requestFingerprint) ||
      !Number.isSafeInteger(input.expiresAt) ||
      !Number.isSafeInteger(input.nowSeconds)
    ) {
      throw new FailClosedError("invalid_replay_context", "Replay context is malformed.");
    }

    for (const [key, record] of this.records) {
      if (record.expiresAt <= input.nowSeconds) this.records.delete(key);
    }

    const scope = `${input.tenantId}:${input.sessionId}:${input.action}`;
    const existing = this.records.get(scope);
    if (existing) {
      if (existing.idempotencyKey === input.idempotencyKey) {
        if (existing.requestFingerprint !== input.requestFingerprint) {
          throw new FailClosedError(
            "flow_idempotency_conflict",
            "The idempotency key was already used for a different synthetic request.",
          );
        }
        return { ...existing.result, replayed: true } as Result;
      }
      throw new FailClosedError(
        "flow_replay_detected",
        "The synthetic session action was already consumed.",
      );
    }

    const result = createResult();
    this.records.set(scope, {
      idempotencyKey: input.idempotencyKey,
      requestFingerprint: input.requestFingerprint,
      expiresAt: input.expiresAt,
      result,
    });
    return result;
  }
}
