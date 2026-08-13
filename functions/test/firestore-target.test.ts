import assert from "node:assert/strict";
import test from "node:test";
import { HEMAS_FIRESTORE_DATABASE_ID } from "../src/firestore-target.js";

test("server data access targets the Standard default database", () => {
  assert.equal(HEMAS_FIRESTORE_DATABASE_ID, "(default)");
  assert.notEqual(HEMAS_FIRESTORE_DATABASE_ID, "default");
});
