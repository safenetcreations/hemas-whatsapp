import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";
import {
  AI_KNOWLEDGE_DOCUMENT_IDS,
  AI_KNOWLEDGE_SELECTION_IDS,
  AI_PERSISTED_SCENARIO_IDS,
  AI_PERSISTED_SCENARIO_MATRIX,
} from "@/lib/domain/ai-governance";

type FirestoreIndexConfig = Readonly<{
  indexes: readonly Readonly<{ collectionGroup: string }>[];
  fieldOverrides: readonly Readonly<{
    collectionGroup: string;
    fieldPath: string;
    indexes: readonly unknown[];
  }>[];
}>;

const workspaceFile = (path: string): string =>
  readFileSync(resolve(process.cwd(), path), "utf8");

function rulesMatchBlock(rules: string, matchPath: string): string {
  const start = rules.indexOf(`match /${matchPath}`);
  expect(start).toBeGreaterThanOrEqual(0);
  const nextMatch = rules.indexOf("match /", start + 1);
  return rules.slice(start, nextMatch === -1 ? undefined : nextMatch);
}

describe("AI governance security contract", () => {
  it("pins the independently approved immutable domain contract", () => {
    const hash = createHash("sha256")
      .update(workspaceFile("lib/domain/ai-governance.ts"), "utf8")
      .digest("hex");
    expect(hash).toBe(
      "c15836b067a288879303570fd9aa5465ee72792decf9ff0ae2555587c5549e3f",
    );
  });

  it("binds the portal route to the capability instead of a role allowlist", () => {
    const source = workspaceFile("components/auth/portal-route-access.ts");
    const policyStart = source.indexOf('"/ai-knowledge": {');
    const policyEnd = source.indexOf('"/connections": {', policyStart);
    const policy = source.slice(policyStart, policyEnd);
    expect(policy).toContain('kind: "permission"');
    expect(policy).toContain('permission: "ai_governance.view"');
    expect(policy).not.toContain("role_allowlist");
  });

  it("keeps every AI collection query-closed and uses only fixed strict gets", () => {
    const rules = workspaceFile("firestore.rules");
    for (const [matchPath, validator] of [
      [
        "knowledgeDocuments/{knowledgeDocumentId}",
        "validStaffSafeAiKnowledgeDocument(",
      ],
      [
        "knowledgeSelections/{selectionId}",
        "validStaffSafeAiKnowledgeSelection(",
      ],
      ["aiRuns/{aiRunId}", "validStaffSafeAiRetrospectiveRun("],
      ["aiRunEvents/{eventId}", "validStaffSafeAiRetrospectiveEvent("],
    ] as const) {
      const block = rulesMatchBlock(rules, matchPath);
      expect(block).toContain("allow get:");
      expect(block).toContain("!exists(");
      expect(block).toContain(validator);
      expect(block).toContain("allow list: if false;");
      expect(block).toContain("allow create, update, delete: if false;");
      expect(block).not.toMatch(/allow read:/u);
    }

    for (const id of AI_KNOWLEDGE_DOCUMENT_IDS) expect(rules).toContain(`'${id}'`);
    for (const id of AI_KNOWLEDGE_SELECTION_IDS) expect(rules).toContain(`'${id}'`);
    for (const scenarioId of AI_PERSISTED_SCENARIO_IDS) {
      const expected = AI_PERSISTED_SCENARIO_MATRIX[scenarioId];
      expect(rules).toContain(`'${expected.runId}'`);
      expect(rules).toContain(`'${expected.eventId}'`);
      expect(rules).toContain(`'${expected.auditEventId}'`);
    }
  });

  it("keeps handoffs, all AI secrets and receipts on explicit total deny", () => {
    const rules = workspaceFile("firestore.rules");
    for (const matchPath of [
      "handoffSessions/{handoffId}",
      "knowledgeDocumentSecrets/{document=**}",
      "aiRunSecrets/{document=**}",
      "aiRunEventSecrets/{document=**}",
    ]) {
      expect(rulesMatchBlock(rules, matchPath)).toContain(
        "allow get, list, create, update, delete: if false;",
      );
    }
    expect(rulesMatchBlock(rules, "idempotencyKeys/{idempotencyKeyId}")).toContain(
      "allow read, write: if false;",
    );
  });

  it("adds no AI query composite and exempts only protected no-query fields", () => {
    const config = JSON.parse(workspaceFile("firestore.indexes.json")) as FirestoreIndexConfig;
    const aiCollectionGroups = [
      "knowledgeDocuments",
      "knowledgeSelections",
      "aiRuns",
      "aiRunEvents",
      "knowledgeDocumentSecrets",
      "aiRunSecrets",
      "aiRunEventSecrets",
    ];
    expect(
      config.indexes.filter((index) =>
        aiCollectionGroups.includes(index.collectionGroup),
      ),
    ).toEqual([]);

    const expectedExemptions = {
      knowledgeDocumentSecrets: [
        "contentFingerprint",
        "approvalFingerprint",
        "protectedContentRef",
        "protectedContentFingerprint",
      ],
      aiRunSecrets: [
        "requestFingerprint",
        "runFingerprint",
        "protectedRequestFixtureRef",
        "protectedRequestFixtureFingerprint",
        "stopSuppressionEvidence",
      ],
      aiRunEventSecrets: [
        "requestFingerprint",
        "runFingerprint",
        "eventFingerprint",
        "protectedDecisionFixtureRef",
        "protectedDecisionFixtureFingerprint",
      ],
    } as const;

    for (const [collectionGroup, fieldPaths] of Object.entries(expectedExemptions)) {
      for (const fieldPath of fieldPaths) {
        expect(config.fieldOverrides).toContainEqual({
          collectionGroup,
          fieldPath,
          indexes: [],
        });
      }
    }
  });
});
