import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("portal sign-out layout", () => {
  it("keeps sign-out in the responsive sidebar instead of overlaying page content", () => {
    const gate = readFileSync(
      resolve(process.cwd(), "components/auth/portal-session-gate.tsx"),
      "utf8",
    );
    const shell = readFileSync(
      resolve(process.cwd(), "components/portal-shell.tsx"),
      "utf8",
    );

    expect(gate).toContain("export function SignOutControl()");
    expect(gate).not.toMatch(/fixed\s+bottom-4\s+right-4/);
    expect(shell).toContain(
      'import { SignOutControl } from "@/components/auth/portal-session-gate";',
    );
    expect(shell.match(/<SignOutControl \/>/g)).toHaveLength(1);
  });
});
