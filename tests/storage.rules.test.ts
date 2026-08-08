import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { afterAll, beforeAll, beforeEach, describe, it } from "vitest";

const PROJECT_ID = process.env.GCLOUD_PROJECT ?? "demo-hemas-connect";
const BUCKET = `gs://${PROJECT_ID}.appspot.com`;
const protectedPath = "workspaces/workspace-a/reports/synthetic-report.txt";

let testEnvironment: RulesTestEnvironment;

beforeAll(async () => {
  testEnvironment = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    storage: {
      rules: readFileSync(resolve(process.cwd(), "storage.rules"), "utf8"),
    },
  });
});

beforeEach(async () => {
  await testEnvironment.clearStorage();
});

afterAll(async () => {
  await testEnvironment.cleanup();
});

describe("server-only Cloud Storage policy", () => {
  it("denies public uploads at unknown paths", async () => {
    const storage = testEnvironment.unauthenticatedContext().storage(BUCKET);
    await assertFails(
      Promise.resolve(storage.ref("public/unknown.txt").putString("synthetic")),
    );
  });

  it("denies authenticated uploads inside a workspace", async () => {
    const storage = testEnvironment.authenticatedContext("admin-a").storage(BUCKET);
    await assertFails(
      Promise.resolve(storage.ref(protectedPath).putString("synthetic")),
    );
  });

  it("denies public and authenticated reads of backend-seeded objects", async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await context.storage(BUCKET).ref(protectedPath).putString("synthetic backend object");
    });

    await assertFails(
      testEnvironment.unauthenticatedContext().storage(BUCKET).ref(protectedPath).getDownloadURL(),
    );
    await assertFails(
      testEnvironment.authenticatedContext("admin-a").storage(BUCKET).ref(protectedPath).getDownloadURL(),
    );
  });

  it("denies authenticated deletion of backend-seeded objects", async () => {
    await testEnvironment.withSecurityRulesDisabled(async (context) => {
      await context.storage(BUCKET).ref(protectedPath).putString("synthetic backend object");
    });

    await assertFails(
      testEnvironment.authenticatedContext("admin-a").storage(BUCKET).ref(protectedPath).delete(),
    );
  });
});
