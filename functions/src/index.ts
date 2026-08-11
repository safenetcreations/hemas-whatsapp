import { logger } from "firebase-functions";
import { onRequest } from "firebase-functions/v2/https";
import { ConfigValidationError, loadRuntimeConfig } from "./config.js";
import { buildInvalidReadinessReport, buildReadinessReport } from "./readiness.js";

export { createTenantAuditEvent, sanitizeAuditMetadata, tenantAuditPath } from "./audit.js";
export {
  FirestoreAuditSink,
  assertDemoAuditEmulatorBoundary,
  createDemoFirestoreAuditSink,
  toFirestoreAuditRecord,
} from "./audit-firestore.js";
export { createHemasSystemAdapters } from "./adapters/hemas-systems.js";
export { createWhatsAppMetaAdapter } from "./adapters/whatsapp-meta.js";
export * from "./flows/index.js";
export { demoRequestSyntheticAppointment } from "./appointments/index.js";
export { demoControlSyntheticCampaign } from "./campaigns/index.js";
export { demoControlSyntheticAutomationRun } from "./automations/index.js";
export { demoControlSyntheticCareEnrollment } from "./care/index.js";
export { listComplianceAuditEvents } from "./compliance/index.js";
export { demoRecordSyntheticAiRetrospective } from "./ai-governance/index.js";
export { demoAppendInternalNote } from "./demo-services.js";
export { syntheticInboundWebhook } from "./ingress/index.js";
export { demoSendMetaCanaryTemplate, metaCanaryWebhook } from "./meta-canary/index.js";
export {
  liteClaimConversation,
  liteDemoSetup,
  liteSendAgentReply,
  liteSendCampaign,
} from "./lite/index.js";
export {
  assertWorkspaceAuthorization,
  executeAuditedWorkspaceMutation,
  fingerprintServiceRequest,
  idempotencyDocumentId,
} from "./service-kernel.js";
export { generateSyntheticMessages } from "./simulator/messages.js";
export {
  canAuthorizedHumanCloseUrgentEscalation,
  reviewSyntheticPatientMessage,
} from "./simulator/reviewer.js";
export {
  generateSyntheticCampaignRecipients,
  summarizeSyntheticCampaign,
  syntheticCampaignRecipientAt,
} from "./simulator/campaign.js";

export const hemasConnectReadiness = onRequest(
  {
    cors: false,
    memory: "128MiB",
    timeoutSeconds: 10,
    maxInstances: 5,
    concurrency: 20,
  },
  (request, response) => {
    response.set({
      "Cache-Control": "no-store, max-age=0",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    });

    if (request.method !== "GET") {
      response.set("Allow", "GET");
      response.status(405).json({
        service: "hemas-connect-functions",
        status: "method_not_allowed",
        safeMode: true,
      });
      return;
    }

    try {
      const report = buildReadinessReport(loadRuntimeConfig());
      response.status(report.status === "ready" ? 200 : 503).json(report);
    } catch (error) {
      if (error instanceof ConfigValidationError) {
        logger.warn("Hemas Connect readiness configuration rejected.", {
          issueCount: error.issues.length,
        });
        response.status(503).json(buildInvalidReadinessReport(error.issues));
        return;
      }
      logger.error("Hemas Connect readiness failed closed.");
      response.status(503).json(buildInvalidReadinessReport(["runtime readiness check failed"]));
    }
  },
);
