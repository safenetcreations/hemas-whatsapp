import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import test from "node:test";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

import {
  authorizeSyntheticIngressRoute,
  loadSyntheticIngressBoundary,
} from "../src/ingress/boundary.js";
import {
  createSyntheticWebhookFixtureSignature,
  parseSyntheticWebhookEnvelope,
  PUBLIC_SYNTHETIC_INGRESS_FIXTURE_SECRET,
  SYNTHETIC_RAW_CONTENT_TYPE,
  SYNTHETIC_WEBHOOK_SCHEMA,
} from "../src/ingress/contracts.js";
import {
  createAdminFirestoreIngressStore,
  processSyntheticWebhookEvent,
  syntheticIngressDocumentIds,
} from "../src/ingress/persistence.js";

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
const runHttpEmulatorTest =
  process.env.HEMAS_RUN_SYNTHETIC_INGRESS_HTTP_TEST === "true";

function syntheticWattalaRouteRecord(): Readonly<Record<string, unknown>> {
  const createdAt = new Date("2026-08-07T10:00:00.000Z");
  return {
    id: "synthetic-phone-route-wattala-demo",
    routeRef: "synthetic-phone-route-wattala-demo",
    workspaceId: "workspace_safenet_demo",
    connectionId: "connection_demo_simulator",
    teamId: "team_demo_general",
    locationId: "location_demo_wattala",
    active: true,
    synthetic: true,
    schemaVersion: 1,
    createdAt,
    updatedAt: createdAt,
  };
}

test("Admin adapter persists the synthetic pipeline only through the Firestore emulator", {
  skip: emulatorHost ? false : "FIRESTORE_EMULATOR_HOST is not configured",
}, async () => {
  assert.ok(emulatorHost);
  const suffix = String(process.pid);
  const boundary = loadSyntheticIngressBoundary({
    GCLOUD_PROJECT: "demo-hemas-connect",
    FIRESTORE_EMULATOR_HOST: emulatorHost,
    HEMAS_RUNTIME_MODE: "demo",
    HEMAS_PROVIDER_MODE: "synthetic",
    HEMAS_INTEGRATION_MODE: "synthetic",
    HEMAS_OUTBOUND_ENABLED: "false",
    HEMAS_DIAGNOSIS_ENABLED: "false",
    HEMAS_SYNTHETIC_INGRESS_SECRET: PUBLIC_SYNTHETIC_INGRESS_FIXTURE_SECRET,
  });
  const authorization = authorizeSyntheticIngressRoute(
    boundary,
    "synthetic-phone-route-wattala-demo",
  );
  const app = initializeApp(
    { projectId: "demo-hemas-connect" },
    `synthetic-ingress-emulator-test-${suffix}`,
  );
  const db = getFirestore(app);

  try {
    await db.doc("workspaces/workspace_safenet_demo").set({
      id: "workspace_safenet_demo",
      name: "Synthetic ingress emulator test",
      status: "active",
      mode: "demo",
      dataClassification: "synthetic_only",
      synthetic: true,
    }, { merge: true });
    await db.doc("phoneRoutes/synthetic-phone-route-wattala-demo").set(
      syntheticWattalaRouteRecord(),
    );
    const envelope = parseSyntheticWebhookEnvelope(Buffer.from(JSON.stringify({
      schema: SYNTHETIC_WEBHOOK_SCHEMA,
      version: 1,
      mode: "demo",
      eventId: `synthetic-event-emulator-${suffix}`,
      routeRef: "synthetic-phone-route-wattala-demo",
      occurredAt: "2026-08-07T12:00:00.000Z",
      event: {
        kind: "message_inbound",
        providerMessageRef: `synthetic-message-emulator-${suffix}`,
        contactRef: `synthetic-contact-emulator-${suffix}`,
        scenarioCode: "appointment_request",
        textCode: "APPOINTMENT_REQUEST_EN",
        language: "en",
      },
    }), "utf8"));
    const ids = syntheticIngressDocumentIds(authorization, envelope);
    const store = createAdminFirestoreIngressStore({ db, authorization });
    const result = await processSyntheticWebhookEvent({
      store,
      authorization,
      envelope,
      requestHash: createHash("sha256").update(JSON.stringify(envelope), "utf8").digest("hex"),
      receivedAt: new Date("2026-08-07T12:10:00.000Z"),
    });
    assert.equal(result.action, "inbound_message_created");

    const [receipt, contact, contactSecret, message] = await Promise.all([
      db.doc(
        `workspaces/workspace_safenet_demo/webhookEvents/${ids.webhookEventId}`,
      ).get(),
      db.doc(`workspaces/workspace_safenet_demo/contacts/${ids.contactId}`).get(),
      db.doc(`workspaces/workspace_safenet_demo/contactSecrets/${ids.contactId}`).get(),
      db.doc(`workspaces/workspace_safenet_demo/messages/${ids.messageId}`).get(),
    ]);
    assert.equal(receipt.data()?.synthetic, true);
    assert.equal(contact.exists, true);
    assert.equal(contact.data()?.maskedPhone, "Synthetic fixture contact · no phone stored");
    assert.equal("phoneLookupHmac" in (contact.data() ?? {}), false);
    assert.equal("encryptedPhoneRef" in (contact.data() ?? {}), false);
    assert.equal("encryptedDisplayNameRef" in (contact.data() ?? {}), false);
    assert.equal("externalPatientRef" in (contact.data() ?? {}), false);
    assert.equal(contactSecret.exists, true);
    assert.match(String(contactSecret.data()?.phoneLookupHmac), /^[a-f0-9]{64}$/);
    assert.equal(contactSecret.data()?.contactId, ids.contactId);
    assert.equal(contactSecret.data()?.workspaceId, "workspace_safenet_demo");
    assert.equal(contactSecret.data()?.externalPatientRef, null);
    assert.equal(contactSecret.data()?.synthetic, true);
    assert.equal(contactSecret.data()?.schemaVersion, 1);
    assert.deepEqual(Object.keys(contactSecret.data() ?? {}).sort(), [
      "contactId",
      "createdAt",
      "encryptedDisplayNameRef",
      "encryptedPhoneRef",
      "externalPatientRef",
      "id",
      "phoneLookupHmac",
      "schemaVersion",
      "synthetic",
      "updatedAt",
      "workspaceId",
    ]);
    assert.equal(message.data()?.metadataOnly, true);
    assert.equal(message.data()?.schemaVersion, 1);
    assert.equal(message.data()?.status, "received");

    const stopEnvelope = parseSyntheticWebhookEnvelope(Buffer.from(JSON.stringify({
      schema: SYNTHETIC_WEBHOOK_SCHEMA,
      version: 1,
      mode: "demo",
      eventId: `synthetic-event-stop-${suffix}`,
      routeRef: "synthetic-phone-route-wattala-demo",
      occurredAt: "2026-08-07T12:03:00.000Z",
      event: {
        kind: "message_inbound",
        providerMessageRef: `synthetic-message-stop-${suffix}`,
        contactRef: `synthetic-contact-emulator-${suffix}`,
        scenarioCode: "stop_request",
        textCode: "STOP_REQUEST_EN",
        language: "en",
      },
    }), "utf8"));
    const stopIds = syntheticIngressDocumentIds(authorization, stopEnvelope);
    const stopRequestHash = createHash("sha256")
      .update(JSON.stringify(stopEnvelope), "utf8")
      .digest("hex");
    const stopResult = await processSyntheticWebhookEvent({
      store,
      authorization,
      envelope: stopEnvelope,
      requestHash: stopRequestHash,
      receivedAt: new Date("2026-08-07T12:10:30.000Z"),
    });
    assert.equal(stopResult.action, "inbound_message_created");
    const stopReplay = await processSyntheticWebhookEvent({
      store,
      authorization,
      envelope: stopEnvelope,
      requestHash: stopRequestHash,
      receivedAt: new Date("2026-08-07T12:11:00.000Z"),
    });
    assert.equal(stopReplay.replayed, true);
    const [consentWithdrawal, suppressedContact] = await Promise.all([
      db.doc(
        `workspaces/workspace_safenet_demo/consentRecords/${stopIds.consentRecordId}`,
      ).get(),
      db.doc(`workspaces/workspace_safenet_demo/contacts/${stopIds.contactId}`).get(),
    ]);
    assert.equal(consentWithdrawal.data()?.purpose, "health_campaigns");
    assert.equal(consentWithdrawal.data()?.category, "marketing");
    assert.equal(consentWithdrawal.data()?.status, "withdrawn");
    assert.equal(consentWithdrawal.data()?.source, "inbound_keyword");
    assert.equal(consentWithdrawal.data()?.schemaVersion, 1);
    assert.equal(consentWithdrawal.data()?.synthetic, true);
    assert.equal(
      (suppressedContact.data()?.suppression as { readonly suppressMarketing?: unknown })
        ?.suppressMarketing,
      true,
    );
    assert.equal(
      (suppressedContact.data()?.suppression as { readonly suppressAll?: unknown })
        ?.suppressAll,
      false,
    );

    const outboundProviderRef = `synthetic-message-outbound-emulator-${suffix}`;
    const statusEnvelope = (eventId: string, status: "delivered" | "sent") =>
      parseSyntheticWebhookEnvelope(Buffer.from(JSON.stringify({
        schema: SYNTHETIC_WEBHOOK_SCHEMA,
        version: 1,
        mode: "demo",
        eventId,
        routeRef: "synthetic-phone-route-wattala-demo",
        occurredAt: "2026-08-07T12:05:00.000Z",
        event: {
          kind: "message_status",
          providerMessageRef: outboundProviderRef,
          contactRef: `synthetic-contact-emulator-${suffix}`,
          status,
          statusCode: "SYNTHETIC_STATUS_OK",
        },
      }), "utf8"));
    const delivered = statusEnvelope(`synthetic-event-delivered-${suffix}`, "delivered");
    const lateSent = statusEnvelope(`synthetic-event-late-sent-${suffix}`, "sent");
    const outboundIds = syntheticIngressDocumentIds(authorization, delivered);
    await db.doc(
      `workspaces/workspace_safenet_demo/messages/${outboundIds.messageId}`,
    ).create({
      id: outboundIds.messageId,
      workspaceId: "workspace_safenet_demo",
      conversationId: ids.conversationId,
      contactId: ids.contactId,
      teamId: "team_demo_general",
      locationId: "location_demo_wattala",
      direction: "outbound",
      type: "interactive",
      status: "sent",
      externalDispatch: "simulation_only",
      actorId: null,
      receivedAt: null,
      sentAt: new Date("2026-08-07T12:02:00.000Z"),
      deliveredAt: null,
      metadataOnly: true,
      synthetic: true,
      schemaVersion: 1,
      createdAt: new Date("2026-08-07T12:02:00.000Z"),
      updatedAt: new Date("2026-08-07T12:02:00.000Z"),
    });
    const deliveredResult = await processSyntheticWebhookEvent({
      store,
      authorization,
      envelope: delivered,
      requestHash: createHash("sha256")
        .update(JSON.stringify(delivered), "utf8")
        .digest("hex"),
      receivedAt: new Date("2026-08-07T12:11:00.000Z"),
    });
    const lateResult = await processSyntheticWebhookEvent({
      store,
      authorization,
      envelope: lateSent,
      requestHash: createHash("sha256")
        .update(JSON.stringify(lateSent), "utf8")
        .digest("hex"),
      receivedAt: new Date("2026-08-07T12:12:00.000Z"),
    });
    assert.equal(deliveredResult.currentStatus, "delivered");
    assert.equal(lateResult.currentStatus, "delivered");
    assert.equal(lateResult.stateChanged, false);
    const [updatedMessage, deliveredStatus, lateStatus] = await Promise.all([
      db.doc(`workspaces/workspace_safenet_demo/messages/${outboundIds.messageId}`).get(),
      db.doc(
        `workspaces/workspace_safenet_demo/messageStatusEvents/${
          syntheticIngressDocumentIds(authorization, delivered).statusEventId
        }`,
      ).get(),
      db.doc(
        `workspaces/workspace_safenet_demo/messageStatusEvents/${
          syntheticIngressDocumentIds(authorization, lateSent).statusEventId
        }`,
      ).get(),
    ]);
    assert.equal(updatedMessage.data()?.status, "delivered");
    assert.equal(deliveredStatus.data()?.stateChanged, true);
    assert.equal(lateStatus.data()?.stateChanged, false);
  } finally {
    await deleteApp(app);
  }
});

test("Functions emulator enforces GET verification, raw signature order and redacted POST replay", {
  skip: runHttpEmulatorTest ? false : "HTTP emulator verification was not requested",
}, async () => {
  assert.ok(emulatorHost);
  const suffix = `http-${process.pid}`;
  const app = initializeApp(
    { projectId: "demo-hemas-connect" },
    `synthetic-ingress-http-test-${suffix}`,
  );
  const db = getFirestore(app);
  const endpoint =
    "http://127.0.0.1:5001/demo-hemas-connect/us-central1/syntheticInboundWebhook";

  try {
    await db.doc("workspaces/workspace_safenet_demo").set({
      id: "workspace_safenet_demo",
      name: "Synthetic ingress HTTP emulator test",
      status: "active",
      mode: "demo",
      dataClassification: "synthetic_only",
      synthetic: true,
    }, { merge: true });
    await db.doc("phoneRoutes/synthetic-phone-route-wattala-demo").set(
      syntheticWattalaRouteRecord(),
    );

    const verificationUrl = new URL(endpoint);
    verificationUrl.searchParams.set("hub.mode", "subscribe");
    verificationUrl.searchParams.set(
      "hub.verify_token",
      PUBLIC_SYNTHETIC_INGRESS_FIXTURE_SECRET,
    );
    verificationUrl.searchParams.set("hub.challenge", "synthetic-challenge-http1234");
    const verification = await fetch(verificationUrl);
    assert.equal(verification.status, 200);
    assert.equal(await verification.text(), "synthetic-challenge-http1234");

    const malformed = "{not-json";
    const rejected = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": SYNTHETIC_RAW_CONTENT_TYPE,
        "x-hub-signature-256": `sha256=${"0".repeat(64)}`,
      },
      body: malformed,
    });
    assert.equal(rejected.status, 401);
    assert.equal((await rejected.json() as { readonly code?: unknown }).code,
      "invalid_synthetic_webhook_signature");

    const payload = Buffer.from(JSON.stringify({
      schema: SYNTHETIC_WEBHOOK_SCHEMA,
      version: 1,
      mode: "demo",
      eventId: `synthetic-event-${suffix}`,
      routeRef: "synthetic-phone-route-wattala-demo",
      occurredAt: new Date(Date.now() - 1_000).toISOString(),
      event: {
        kind: "message_inbound",
        providerMessageRef: `synthetic-message-${suffix}`,
        contactRef: `synthetic-contact-${suffix}`,
        scenarioCode: "appointment_request",
        textCode: "APPOINTMENT_REQUEST_EN",
        language: "en",
      },
    }), "utf8");
    const headers = {
      "content-type": SYNTHETIC_RAW_CONTENT_TYPE,
      "x-hub-signature-256": createSyntheticWebhookFixtureSignature(payload),
    };
    const accepted = await fetch(endpoint, { method: "POST", headers, body: payload });
    assert.equal(accepted.status, 200);
    const acceptedText = await accepted.text();
    const acceptedBody = JSON.parse(acceptedText) as {
      readonly status?: unknown;
      readonly receipt?: { readonly action?: unknown; readonly replayed?: unknown };
    };
    assert.equal(acceptedBody.status, "accepted");
    assert.equal(acceptedBody.receipt?.action, "inbound_message_created");
    assert.equal(acceptedBody.receipt?.replayed, false);
    assert.equal(acceptedText.includes(`synthetic-contact-${suffix}`), false);
    assert.equal(acceptedText.includes(`synthetic-message-${suffix}`), false);

    const replay = await fetch(endpoint, { method: "POST", headers, body: payload });
    assert.equal(replay.status, 200);
    const replayBody = await replay.json() as {
      readonly receipt?: { readonly replayed?: unknown };
    };
    assert.equal(replayBody.receipt?.replayed, true);
  } finally {
    await deleteApp(app);
  }
});
