import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

type FirestoreIndex = {
  readonly collectionGroup: string;
};

function rulesMatchBlock(rules: string, matchPath: string): string {
  const start = rules.indexOf(`match /${matchPath}`);
  expect(start).toBeGreaterThanOrEqual(0);
  const nextMatch = rules.indexOf("match /", start + 1);
  return rules.slice(start, nextMatch === -1 ? undefined : nextMatch);
}

describe("Connections fixed-document Firestore contract", () => {
  it("defines no unused collection-query index for either fixed catalogue", () => {
    const parsed = JSON.parse(
      readFileSync(resolve(process.cwd(), "firestore.indexes.json"), "utf8"),
    ) as { readonly indexes: readonly FirestoreIndex[] };

    expect(
      parsed.indexes.filter((index) =>
        ["whatsappConnections", "integrations"].includes(index.collectionGroup),
      ),
    ).toEqual([]);
  });

  it("uses exactly three server-fresh fixed document reads and no list API", () => {
    const source = readFileSync(
      resolve(
        process.cwd(),
        "lib/firebase/repositories/connection-repository.ts",
      ),
      "utf8",
    );
    const firestoreImport = source.match(
      /import\s*\{[\s\S]*?\}\s*from "firebase\/firestore";/,
    )?.[0];
    const loader = source.slice(source.indexOf("export async function loadDemoConnectionCentre"));

    expect(firestoreImport).toBeDefined();
    expect(firestoreImport).toContain("doc");
    expect(firestoreImport).toContain("getDocFromServer");
    for (const forbiddenImport of [
      "collection",
      "getDocsFromServer",
      "limit",
      "orderBy",
      "query",
      "where",
    ]) {
      expect(firestoreImport).not.toMatch(new RegExp(`\\b${forbiddenImport}\\b`));
    }

    expect(loader.match(/\bgetDocFromServer\(/g)).toHaveLength(3);
    expect(loader.match(/\bdoc\(/g)).toHaveLength(3);
    expect(loader).toContain("DEMO_WHATSAPP_CONNECTION_ID");
    expect(loader).toContain("DEMO_INTEGRATION_IDS[0]");
    expect(loader).toContain("DEMO_INTEGRATION_IDS[1]");
    expect(loader).toContain('"whatsappConnections"');
    expect(loader.match(/"integrations"/g)).toHaveLength(2);
    expect(loader).not.toMatch(/\b(getDocsFromServer|collection|query|where|orderBy|limit)\s*\(/);
  });

  it("keeps both catalogues list-closed while allowing only fixed strict gets", () => {
    const rules = readFileSync(
      resolve(process.cwd(), "firestore.rules"),
      "utf8",
    );
    const whatsappBlock = rulesMatchBlock(
      rules,
      "whatsappConnections/{connectionId}",
    );
    const integrationsBlock = rulesMatchBlock(
      rules,
      "integrations/{integrationId}",
    );

    expect(whatsappBlock).toContain("connectionId == 'connection_demo_simulator'");
    expect(whatsappBlock).toContain("!exists(");
    expect(whatsappBlock).toContain("validStaffSafeDemoWhatsAppConnection(");
    expect(whatsappBlock).toContain("allow list: if false;");
    expect(integrationsBlock).toContain("'integration_demo_his_simulator'");
    expect(integrationsBlock).toContain("'integration_demo_lims_simulator'");
    expect(integrationsBlock).toContain("!exists(");
    expect(integrationsBlock).toContain("validStaffSafeDemoIntegration(");
    expect(integrationsBlock).toContain("allow list: if false;");
  });

  it("keeps connection secrets and global provider routes on explicit total deny", () => {
    const rules = readFileSync(
      resolve(process.cwd(), "firestore.rules"),
      "utf8",
    );
    for (const matchPath of [
      "whatsappConnectionSecrets/{document=**}",
      "integrationSecrets/{document=**}",
      "phoneRoutes/{document=**}",
      "wabaRoutes/{document=**}",
    ]) {
      const block = rulesMatchBlock(rules, matchPath);
      expect(block).toMatch(/allow (get, list, create, update, delete|read, write): if false;/);
    }
  });
});
