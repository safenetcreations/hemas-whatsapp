import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type IndexField = Readonly<{
  fieldPath: string;
  order?: "ASCENDING" | "DESCENDING";
}>;

type IndexDefinition = Readonly<{
  collectionGroup: string;
  queryScope: string;
  fields: readonly IndexField[];
}>;

const indexConfig = JSON.parse(
  readFileSync(resolve(process.cwd(), "firestore.indexes.json"), "utf8"),
) as Readonly<{
  indexes: readonly IndexDefinition[];
  fieldOverrides: readonly Readonly<{
    collectionGroup: string;
    fieldPath: string;
    indexes: readonly unknown[];
  }>[];
}>;

function fieldSignature(index: IndexDefinition): string {
  return index.fields
    .map((field) => `${field.fieldPath}:${field.order ?? ""}`)
    .join("|");
}

describe("Compliance audit query indexes", () => {
  it("pins both minimized timeline query shapes with descending cursor order", () => {
    const auditIndexes = indexConfig.indexes.filter(
      (index) =>
        index.collectionGroup === "auditEvents" &&
        index.queryScope === "COLLECTION",
    );
    const signatures = auditIndexes.map(fieldSignature);
    expect(signatures).toContain(
      "schemaVersion:ASCENDING|synthetic:ASCENDING|createdAt:DESCENDING",
    );
    expect(signatures).toContain(
      "schemaVersion:ASCENDING|synthetic:ASCENDING|outcome:ASCENDING|createdAt:DESCENDING",
    );
  });

  it("keeps raw audit metadata unindexed", () => {
    expect(indexConfig.fieldOverrides).toContainEqual({
      collectionGroup: "auditEvents",
      fieldPath: "metadata",
      indexes: [],
    });
  });
});
