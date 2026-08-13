import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);

test("patched uuid override remains load-compatible with Firebase Admin storage clients", () => {
  assert.doesNotThrow(() => require("gaxios"));
  assert.doesNotThrow(() => require("teeny-request"));

  const uuid = require("uuid") as { readonly v4?: unknown };
  const uuidPackage = require("uuid/package.json") as { readonly version?: unknown };
  assert.equal(uuidPackage.version, "11.1.1");
  assert.equal(typeof uuid.v4, "function");
  const generated = (uuid.v4 as () => string)();
  assert.match(generated, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
