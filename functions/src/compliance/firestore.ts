import {
  FieldPath,
  Timestamp,
  type Firestore,
} from "firebase-admin/firestore";
import type {
  ComplianceAuditDocument,
  ComplianceAuditQuery,
  ComplianceAuditSource,
} from "./service.js";

export function createFirestoreComplianceAuditSource(
  db: Firestore,
): ComplianceAuditSource {
  return {
    async getWorkspace(workspaceId) {
      const snapshot = await db.doc(`workspaces/${workspaceId}`).get();
      return snapshot.exists ? snapshot.data() : undefined;
    },
    async getMembership(workspaceId, uid) {
      const snapshot = await db
        .doc(`workspaces/${workspaceId}/members/${uid}`)
        .get();
      return snapshot.exists ? snapshot.data() : undefined;
    },
    async getAuditEvent(workspaceId, eventId) {
      const snapshot = await db
        .doc(`workspaces/${workspaceId}/auditEvents/${eventId}`)
        .get();
      return snapshot.exists
        ? { id: snapshot.id, data: snapshot.data() }
        : null;
    },
    async queryAuditEvents(
      input: ComplianceAuditQuery,
    ): Promise<readonly ComplianceAuditDocument[]> {
      let query = db
        .collection(`workspaces/${input.workspaceId}/auditEvents`)
        .where("schemaVersion", "==", 1)
        .where("synthetic", "==", true);
      if (input.outcome !== null) {
        query = query.where("outcome", "==", input.outcome);
      }
      query = query
        .orderBy("createdAt", "desc")
        .orderBy(FieldPath.documentId(), "desc");
      if (input.cursor !== null) {
        query = query.startAfter(
          Timestamp.fromDate(input.cursor.createdAt),
          input.cursor.id,
        );
      }
      const snapshot = await query.limit(input.pageSize).get();
      return snapshot.docs.map((document) => ({
        id: document.id,
        data: document.data(),
      }));
    },
  };
}
