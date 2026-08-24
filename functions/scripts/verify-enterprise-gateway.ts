/**
 * Emulator-only end-to-end proof for the Enterprise bulk gateway.
 *
 * Provisions a synthetic operator (verified email + hemasEnterpriseApi claim
 * + active tenant_admin membership), then exercises the public REST surface:
 * callback configuration, a bulk job of N items (default 1,000), an
 * idempotent replay, bounded dispatch passes until the job is terminal, and
 * a signed callback delivery sample. Refuses to run outside the loopback
 * emulators.
 */

import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getHemasFirestore } from "../src/firestore-target.js";

const PROJECT_ID = "demo-hemas-connect";
const WORKSPACE_ID = "workspace_safenet_demo";
const OPERATOR_EMAIL = "enterprise.operator@synthetic.invalid";
const OPERATOR_PASSWORD = "Synthetic-Enterprise-Only-2026!";
const FUNCTIONS_BASE =
  process.env.FUNCTIONS_EMULATOR_ORIGIN ?? "http://127.0.0.1:5001";
const API_BASE = `${FUNCTIONS_BASE}/${PROJECT_ID}/us-central1/enterpriseWhatsappApi`;
const DISPATCH_URL = `${FUNCTIONS_BASE}/${PROJECT_ID}/us-central1/enterpriseRunBulkDispatch`;

function fail(message: string): never {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function assertCondition(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

async function main(): Promise<void> {
  if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    fail("This harness runs only against the loopback emulators.");
  }
  const itemCount = Math.min(
    1_000,
    Math.max(1, Number(process.env.ENTERPRISE_SMOKE_ITEMS ?? "1000") || 1_000),
  );

  const app =
    getApps().find((candidate) => candidate.name === "[DEFAULT]") ??
    initializeApp({ projectId: PROJECT_ID });
  const auth = getAuth(app);
  const db = getHemasFirestore(app);

  const user = await auth
    .getUserByEmail(OPERATOR_EMAIL)
    .catch(() =>
      auth.createUser({
        email: OPERATOR_EMAIL,
        password: OPERATOR_PASSWORD,
        emailVerified: true,
      }),
    );
  await auth.setCustomUserClaims(user.uid, { hemasEnterpriseApi: true });
  await db.doc(`workspaces/${WORKSPACE_ID}/members/${user.uid}`).set({
    id: user.uid,
    uid: user.uid,
    workspaceId: WORKSPACE_ID,
    displayLabel: "Enterprise Gateway Operator (synthetic)",
    role: "tenant_admin",
    status: "active",
    scopeMode: "assigned",
    teamIds: ["team_demo_general"],
    locationIds: ["location_demo_wattala"],
    synthetic: true,
  });

  const signIn = await fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: OPERATOR_EMAIL,
        password: OPERATOR_PASSWORD,
        returnSecureToken: true,
      }),
    },
  );
  assertCondition(signIn.ok, `operator sign-in failed: ${signIn.status}`);
  const idToken = ((await signIn.json()) as { idToken: string }).idToken;
  const authHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${idToken}`,
  };

  const callbackResponse = await fetch(`${API_BASE}/v1/whatsapp/callbacks`, {
    method: "PUT",
    headers: { ...authHeaders, "Idempotency-Key": `cbcfg-${Date.now()}-smoke` },
    body: JSON.stringify({
      dlrUrl: "https://api.hemas-crm.example/webhooks/dlr",
      replyUrl: "https://api.hemas-crm.example/webhooks/replies",
    }),
  });
  assertCondition(callbackResponse.status === 200, `callback config -> ${callbackResponse.status}`);
  const callbackResult = (await callbackResponse.json()) as {
    signingKey: string;
    secretVersion: number;
  };
  assertCondition(/^[A-Za-z0-9+/]{43}=$/.test(callbackResult.signingKey), "signing key shape");

  const idempotencyKey = `bulk-smoke-${Date.now()}`;
  const body = JSON.stringify({
    clientBatchId: `batch_smoke_${Date.now()}`,
    template: {
      templateName: "hemas_visit_summary_cta",
      bodyParams: ["Synthetic Operator"],
      ctaSuffix: "visits/smoke-0001",
    },
    items: Array.from({ length: itemCount }, (_, index) => ({
      to: `9477${String(1_000_000 + index)}`,
      clientReference: `crm-smoke-${index}`,
    })),
  });

  const submitStarted = Date.now();
  const submit = await fetch(`${API_BASE}/v1/whatsapp/bulk-jobs`, {
    method: "POST",
    headers: { ...authHeaders, "Idempotency-Key": idempotencyKey },
    body,
  });
  const submitMs = Date.now() - submitStarted;
  assertCondition(submit.status === 202, `submit -> ${submit.status}`);
  const job = (await submit.json()) as {
    jobId: string;
    itemCount: number;
    idempotent: boolean;
  };
  assertCondition(job.itemCount === itemCount, "submit itemCount");
  assertCondition(job.idempotent === false, "fresh submit not idempotent");

  const replay = await fetch(`${API_BASE}/v1/whatsapp/bulk-jobs`, {
    method: "POST",
    headers: { ...authHeaders, "Idempotency-Key": idempotencyKey },
    body,
  });
  assertCondition(replay.status === 202, `replay -> ${replay.status}`);
  const replayResult = (await replay.json()) as { idempotent: boolean; jobId: string };
  assertCondition(replayResult.idempotent === true, "replay is idempotent");
  assertCondition(replayResult.jobId === job.jobId, "replay same job id");

  const conflict = await fetch(`${API_BASE}/v1/whatsapp/bulk-jobs`, {
    method: "POST",
    headers: { ...authHeaders, "Idempotency-Key": idempotencyKey },
    body: body.replace("visits/smoke-0001", "visits/smoke-0002"),
  });
  assertCondition(conflict.status === 409, `divergent replay -> ${conflict.status}`);

  const dispatchStarted = Date.now();
  let passes = 0;
  let terminalStatus = "";
  for (; passes < 60; passes += 1) {
    const dispatch = await fetch(DISPATCH_URL, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ data: {} }),
    });
    assertCondition(dispatch.status === 200, `dispatch pass -> ${dispatch.status}`);
    const snapshot = await fetch(`${API_BASE}/v1/whatsapp/bulk-jobs/${job.jobId}`, {
      headers: authHeaders,
    });
    assertCondition(snapshot.status === 200, `job read -> ${snapshot.status}`);
    const state = (await snapshot.json()) as {
      status: string;
      sentCount: number;
      queuedCount: number;
    };
    if (state.status === "completed" || state.status === "completed_partial") {
      terminalStatus = state.status;
      assertCondition(state.sentCount === itemCount, "all items sent");
      assertCondition(state.queuedCount === 0, "no queued remainder");
      break;
    }
  }
  const dispatchMs = Date.now() - dispatchStarted;
  assertCondition(terminalStatus === "completed", `job terminal status: ${terminalStatus || "not reached"}`);

  const workspaceRef = db.collection("workspaces").doc(WORKSPACE_ID);
  const [items, secrets, receipts, deliveredSample] = await Promise.all([
    workspaceRef.collection("enterprise_bulk_job_items").where("jobId", "==", job.jobId).count().get(),
    workspaceRef.collection("enterprise_bulk_item_secrets").where("jobId", "==", job.jobId).count().get(),
    workspaceRef.collection("enterprise_bulk_send_receipts").where("jobId", "==", job.jobId).count().get(),
    workspaceRef
      .collection("enterprise_callback_deliveries")
      .where("status", "==", "delivered")
      .limit(5)
      .get(),
  ]);
  assertCondition(items.data().count === itemCount, "item ledger count");
  assertCondition(secrets.data().count === 0, "every recipient secret consumed");
  assertCondition(receipts.data().count === itemCount, "wamid receipt per item");
  assertCondition(deliveredSample.size > 0, "at least one signed callback delivered");
  for (const doc of deliveredSample.docs) {
    const payload = doc.data().payload as { data?: { clientReference?: unknown } };
    assertCondition(
      typeof payload.data?.clientReference === "string" &&
        (payload.data.clientReference as string).startsWith("crm-smoke-"),
      "DLR echoes client_reference",
    );
  }

  console.log(
    JSON.stringify(
      {
        result: "PASS",
        itemCount,
        submitMs,
        dispatchMs,
        dispatchPasses: passes + 1,
        intakeItemsPerSecond: Math.round((itemCount / Math.max(1, submitMs)) * 1000),
        terminalStatus,
        callbackSecretVersion: callbackResult.secretVersion,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});
