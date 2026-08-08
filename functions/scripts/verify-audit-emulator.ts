import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import {
  createTenantAuditEvent,
  writeTenantAuditEvent,
} from "../src/audit.js";
import { createDemoFirestoreAuditSink } from "../src/audit-firestore.js";

const projectId = process.env.GCLOUD_PROJECT ?? "demo-hemas-connect";
const firestoreEmulatorHost = process.env.FIRESTORE_EMULATOR_HOST;

const app = initializeApp({
  projectId,
}, "hemas-audit-emulator-verifier");

try {
  const db = getFirestore(app);
  const sink = createDemoFirestoreAuditSink({
    db,
    projectId,
    firestoreEmulatorHost,
  });
  const event = createTenantAuditEvent({
    tenantId: "workspace_safenet_demo",
    actor: { type: "service", id: "synthetic-audit-verifier" },
    action: "audit.emulator_verified",
    resource: { type: "verification", id: "durable-audit" },
    outcome: "simulated",
    requestId: "audit-emulator-verification-001",
    occurredAt: new Date("2026-08-07T00:00:00.000Z"),
    metadata: {
      mode: "synthetic",
      messageBody: "must never persist",
      reportValue: "must never persist",
    },
  });

  await writeTenantAuditEvent("workspace_safenet_demo", sink, event);
  const snapshot = await db
    .doc(`workspaces/workspace_safenet_demo/auditEvents/${event.id}`)
    .get();
  const stored = snapshot.data();
  if (
    !snapshot.exists ||
    stored?.id !== event.id ||
    stored?.workspaceId !== "workspace_safenet_demo" ||
    stored?.synthetic !== true ||
    stored?.metadata?.messageBody !== "[REDACTED]" ||
    stored?.metadata?.reportValue !== "[REDACTED]"
  ) {
    throw new Error("Durable audit emulator record failed its redaction contract.");
  }

  let replayDenied = false;
  try {
    await writeTenantAuditEvent("workspace_safenet_demo", sink, event);
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error
      ? String(error.code)
      : "";
    replayDenied = code === "6" || code.includes("already-exists");
  }
  if (!replayDenied) {
    throw new Error("Durable audit sink did not preserve append-only create semantics.");
  }

  process.stdout.write(
    "Verified durable synthetic audit persistence: tenant path, redaction and replay denial passed.\n",
  );
} finally {
  await deleteApp(app);
}
