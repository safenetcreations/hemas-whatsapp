import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { scanTrackedText, type SensitiveFinding } from "./tracked-sensitive-contracts";

const MAX_TEXT_FILE_BYTES = 1_000_000;

function candidatePaths(): readonly string[] {
  return execFileSync(
    "git",
    ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { encoding: "utf8" },
  )
    .split("\0")
    .filter(Boolean);
}

function scan(): readonly SensitiveFinding[] {
  const findings: SensitiveFinding[] = [];
  for (const path of candidatePaths()) {
    // A pending deletion is safe to ignore; CI and committed checkouts contain
    // only paths that actually exist in the worktree.
    if (!existsSync(path)) continue;
    const stat = statSync(path);
    if (!stat.isFile() || stat.size > MAX_TEXT_FILE_BYTES) continue;
    const buffer = readFileSync(path);
    if (buffer.includes(0)) continue;
    findings.push(...scanTrackedText(path, buffer.toString("utf8")));
  }
  return findings;
}

try {
  const findings = scan();
  if (findings.length > 0) {
    for (const finding of findings) {
      // Report only the tracked path and rule name, never the matching value.
      console.error(`${finding.rule}: ${finding.path}`);
    }
    console.error(`Tracked-sensitive scan failed with ${findings.length} finding(s).`);
    process.exitCode = 1;
  } else {
    console.log("Tracked-sensitive scan passed with no high-confidence findings.");
  }
} catch {
  console.error("Tracked-sensitive scan could not complete; error details were suppressed.");
  process.exitCode = 1;
}
