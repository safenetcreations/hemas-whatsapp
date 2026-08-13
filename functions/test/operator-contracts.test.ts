import assert from "node:assert/strict";
import test from "node:test";
import {
  HEMAS_CLAIMS_APPLY_CONFIRMATION,
  HEMAS_RECEIPTS_APPLY_CONFIRMATION,
  OperatorInputError,
  aggregateCanaryReceipts,
  assertOperatorTarget,
  assertSafeOperatorEnvironment,
  assertClaimTargetEligibility,
  buildClaimsMergePlan,
  buildClaimsPublicSummary,
  classifyCanaryReceipt,
  parseClaimsCommand,
  parseReceiptCommand,
} from "../scripts/ops/contracts.js";

const NOW = Date.parse("2026-08-11T12:00:00.000Z");

test("operator target accepts only the exact project and primary Standard database", () => {
  const target = assertOperatorTarget("hemas-whatsapp", "(default)");
  assert.equal(target.databaseLabel, "primary-standard");
  assert.throws(() => assertOperatorTarget("demo-hemas-connect", "(default)"), OperatorInputError);
  assert.throws(() => assertOperatorTarget("hemas-whatsapp", "default"), OperatorInputError);
  assert.throws(() => assertOperatorTarget("hemas-whatsapp", undefined), OperatorInputError);
});

test("claims parser is dry-run by default and requires exactly one private selector", () => {
  const command = parseClaimsCommand([
    "--project", "hemas-whatsapp",
    "--database", "(default)",
    "--email", "private.operator@example.invalid",
    "--action", "grant",
    "--claims", "hemasPortalDemo,hemasLiteCanary,hemasLiteAdmin",
  ]);
  assert.equal(command.mode, "dry-run");
  assert.equal(command.identity.kind, "email");
  assert.deepEqual(command.claims, ["hemasPortalDemo", "hemasLiteCanary", "hemasLiteAdmin"]);
  assert.throws(
    () => parseClaimsCommand([
      "--project", "hemas-whatsapp",
      "--database", "(default)",
      "--email", "private.operator@example.invalid",
      "--uid", "private-uid",
      "--action", "grant",
      "--claims", "hemasLiteCanary",
    ]),
    OperatorInputError,
  );
});

test("claims apply requires the exact confirmation and rejects non-allowlisted claims", () => {
  const base = [
    "--project", "hemas-whatsapp",
    "--database", "(default)",
    "--uid", "private-uid",
    "--action", "revoke",
    "--claims", "hemasMetaCanary,hemasMetaCanaryAdmin",
  ];
  assert.throws(() => parseClaimsCommand([...base, "--apply"]), OperatorInputError);
  const command = parseClaimsCommand([
    ...base,
    "--apply",
    "--confirm", HEMAS_CLAIMS_APPLY_CONFIRMATION,
    "--disable-membership",
    "--revoke-tokens",
  ]);
  assert.equal(command.mode, "apply");
  assert.equal(command.revokeTokens, true);
  assert.equal(command.disableMembership, true);
  assert.deepEqual(command.claims, ["hemasMetaCanary", "hemasMetaCanaryAdmin"]);
  assert.throws(
    () => parseClaimsCommand([
      ...base,
      "--apply",
      "--confirm", HEMAS_CLAIMS_APPLY_CONFIRMATION,
      "--revoke-tokens",
    ]),
    OperatorInputError,
  );
  assert.throws(
    () => parseClaimsCommand([
      "--project", "hemas-whatsapp",
      "--database", "(default)",
      "--uid", "private-uid",
      "--action", "grant",
      "--claims", "hemasLiteCanary",
      "--disable-membership",
    ]),
    OperatorInputError,
  );
  assert.throws(
    () => parseClaimsCommand([...base.slice(0, -1), "administrator"]),
    OperatorInputError,
  );
});

test("claim merge preserves unrelated claims and revoke removes only requested keys", () => {
  const granted = buildClaimsMergePlan(
    { unrelated: "preserved", hemasLiteAdmin: false },
    "grant",
    ["hemasPortalDemo", "hemasLiteCanary", "hemasLiteAdmin"],
  );
  assert.deepEqual(granted.nextClaims, {
    unrelated: "preserved",
    hemasLiteAdmin: true,
    hemasPortalDemo: true,
    hemasLiteCanary: true,
  });
  assert.deepEqual(granted.changedClaims, [
    "hemasPortalDemo",
    "hemasLiteCanary",
    "hemasLiteAdmin",
  ]);

  const revoked = buildClaimsMergePlan(granted.nextClaims, "revoke", ["hemasLiteCanary"]);
  assert.deepEqual(revoked.nextClaims, {
    unrelated: "preserved",
    hemasLiteAdmin: true,
    hemasPortalDemo: true,
  });
});

test("public claim summary never serializes the email or UID selector value", () => {
  const privateSelector = "private.operator@example.invalid";
  const command = parseClaimsCommand([
    "--project", "hemas-whatsapp",
    "--database", "(default)",
    "--email", privateSelector,
    "--action", "grant",
    "--claims", "hemasLiteCanary",
  ]);
  const summary = buildClaimsPublicSummary(
    command,
    buildClaimsMergePlan({}, command.action, command.claims),
  );
  assert.equal(JSON.stringify(summary).includes(privateSelector), false);
  assert.equal(summary.identitySelector, "email");
});

test("operator environment refuses emulators and conflicting ambient projects", () => {
  const target = assertOperatorTarget("hemas-whatsapp", "(default)");
  assert.doesNotThrow(() => assertSafeOperatorEnvironment({}, target));
  assert.doesNotThrow(() => assertSafeOperatorEnvironment({
    GCLOUD_PROJECT: "hemas-whatsapp",
    FIREBASE_CONFIG: JSON.stringify({ projectId: "hemas-whatsapp" }),
  }, target));
  assert.throws(
    () => assertSafeOperatorEnvironment({ FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" }, target),
    OperatorInputError,
  );
  assert.throws(
    () => assertSafeOperatorEnvironment({ GOOGLE_CLOUD_PROJECT: "another-project" }, target),
    OperatorInputError,
  );
});

test("claim operations require a real verified Firebase identity", () => {
  assert.doesNotThrow(() =>
    assertClaimTargetEligibility(
      { uid: "private-operator-uid", emailVerified: true },
      "grant",
    ),
  );
  assert.throws(
    () =>
      assertClaimTargetEligibility(
        { uid: "private-operator-uid", emailVerified: false },
        "grant",
      ),
    OperatorInputError,
  );
  assert.throws(
    () =>
      assertClaimTargetEligibility(
        { uid: "private-operator-uid", emailVerified: "true" },
        "grant",
      ),
    OperatorInputError,
  );
  assert.throws(
    () => assertClaimTargetEligibility({ uid: "", emailVerified: true }, "grant"),
    OperatorInputError,
  );
  assert.doesNotThrow(() =>
    assertClaimTargetEligibility(
      { uid: "compromised-operator-uid", emailVerified: false },
      "revoke",
    ),
  );
});

test("receipt classification deletes only timestamped schema-v1 records before cutoff", () => {
  const cutoff = Date.parse("2026-07-01T00:00:00.000Z");
  const oldLegacy = classifyCanaryReceipt({
    schemaVersion: 1,
    receivedAt: { toMillis: () => Date.parse("2026-06-01T00:00:00.000Z") },
    fromNumber: "legacy-raw-value",
  }, NOW, cutoff);
  assert.equal(oldLegacy.eligibleForDeletion, true);
  assert.equal(oldLegacy.hasRawSenderField, true);

  assert.equal(classifyCanaryReceipt({
    schemaVersion: 2,
    receivedAt: new Date("2026-06-01T00:00:00.000Z"),
  }, NOW, cutoff).eligibleForDeletion, false);
  assert.equal(classifyCanaryReceipt({
    schemaVersion: 1,
    receivedAt: null,
  }, NOW, cutoff).eligibleForDeletion, false);
});

test("receipt aggregate exposes counts by schema and age without identifiers", () => {
  const cutoff = Date.parse("2026-07-01T00:00:00.000Z");
  const records = [
    {
      schemaVersion: 1,
      receivedAt: new Date("2026-06-01T00:00:00.000Z"),
      fromNumber: "legacy-raw-value",
    },
    { schemaVersion: 2, receivedAt: new Date("2026-08-10T00:00:00.000Z") },
    { schemaVersion: 1, receivedAt: null },
    { schemaVersion: 3, receivedAt: new Date("2026-07-20T00:00:00.000Z") },
  ];
  const aggregate = aggregateCanaryReceipts(records, NOW, cutoff);
  assert.deepEqual(aggregate.schema, { v1: 2, v2: 1, other_or_missing: 1 });
  assert.equal(aggregate.age.under_7_days, 1);
  assert.equal(aggregate.age["7_to_29_days"], 1);
  assert.equal(aggregate.age["30_to_89_days"], 1);
  assert.equal(aggregate.age.missing_or_invalid, 1);
  assert.deepEqual(aggregate.legacyV1, {
    total: 2,
    withRawSenderField: 1,
    missingOrInvalidTimestamp: 1,
    eligibleForDeletion: 1,
  });
  assert.equal(JSON.stringify(aggregate).includes("legacy-raw-value"), false);
});

test("receipt command is dry-run first and apply needs its exact phrase", () => {
  const base = [
    "--project", "hemas-whatsapp",
    "--database", "(default)",
    "--cutoff", "2026-07-01T00:00:00.000Z",
  ];
  assert.equal(parseReceiptCommand(base, NOW).mode, "dry-run");
  assert.throws(() => parseReceiptCommand([...base, "--apply"], NOW), OperatorInputError);
  assert.equal(parseReceiptCommand([
    ...base,
    "--apply",
    "--confirm", HEMAS_RECEIPTS_APPLY_CONFIRMATION,
  ], NOW).mode, "apply");
  assert.throws(
    () => parseReceiptCommand([
      ...base.slice(0, -1),
      "2026-09-01T00:00:00.000Z",
    ], NOW),
    OperatorInputError,
  );
  assert.throws(
    () => parseReceiptCommand([
      ...base.slice(0, -1),
      "2026-08-01T00:00:00.000Z",
    ], NOW),
    OperatorInputError,
  );
});
