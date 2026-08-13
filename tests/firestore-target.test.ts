import { describe, expect, it } from "vitest";
import { HEMAS_FIRESTORE_DATABASE_ID } from "@/lib/firebase/firestore-target";

describe("Firestore database target", () => {
  it("binds browser data access to the Standard default database", () => {
    expect(HEMAS_FIRESTORE_DATABASE_ID).toBe("(default)");
    expect(HEMAS_FIRESTORE_DATABASE_ID).not.toBe("default");
  });
});
