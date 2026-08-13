export type SensitiveFindingRule =
  | "tracked-environment-file"
  | "private-key-material"
  | "service-account-json"
  | "github-token"
  | "meta-access-token"
  | "stripe-live-secret"
  | "slack-token"
  | "npm-auth-token"
  | "provider-identifier-config"
  | "client-visible-sri-lanka-mobile"
  | "client-visible-provider-identifier";

export type SensitiveFinding = {
  readonly path: string;
  readonly rule: SensitiveFindingRule;
};

function isDisallowedEnvironmentPath(path: string): boolean {
  const fileName = path.split("/").at(-1) ?? path;
  return fileName.startsWith(".env") && fileName !== ".env.example";
}

function isClientVisiblePath(path: string): boolean {
  return /^(?:app|components|lib|public)\//.test(path);
}

const CONTENT_RULES: ReadonlyArray<{
  readonly rule: Exclude<SensitiveFindingRule, "tracked-environment-file" | "client-visible-sri-lanka-mobile">;
  readonly pattern: RegExp;
}> = [
  {
    rule: "private-key-material",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  },
  {
    rule: "service-account-json",
    pattern: /"type"\s*:\s*"service_account"[\s\S]{0,5000}"private_key"\s*:/,
  },
  {
    rule: "github-token",
    pattern: /\bgh(?:p|o|u|s|r)_[A-Za-z0-9]{30,}\b/,
  },
  {
    rule: "meta-access-token",
    pattern: /\bEAA[A-Za-z0-9]{30,}\b/,
  },
  {
    rule: "stripe-live-secret",
    pattern: /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/,
  },
  {
    rule: "slack-token",
    pattern: /\bxox(?:b|p|a|r|s)-[A-Za-z0-9-]{20,}\b/,
  },
  {
    rule: "npm-auth-token",
    pattern: /(?:^|\n)\s*\/\/[^\s=]+\/:_authToken\s*=\s*[^\s${][^\s]*/,
  },
  {
    rule: "provider-identifier-config",
    pattern:
      /(?:^|\n)[ \t]*HEMAS_META_(?:PHONE_NUMBER_ID|WABA_ID|ALLOWLISTED_RECIPIENTS|WELCOME_MEDIA_ID)[ \t]*=[ \t]*(?!#|\$\{|<|replace(?:-with)?)[^\r\n \t]+/i,
  },
];

export function scanTrackedText(path: string, content: string): readonly SensitiveFinding[] {
  const findings: SensitiveFinding[] = [];
  if (isDisallowedEnvironmentPath(path)) {
    findings.push({ path, rule: "tracked-environment-file" });
  }
  for (const candidate of CONTENT_RULES) {
    if (candidate.pattern.test(content)) {
      findings.push({ path, rule: candidate.rule });
    }
  }
  if (
    isClientVisiblePath(path) &&
    /(?<![0-9])(?:\+?94|0)7[0-9]{8}(?![0-9])/.test(content)
  ) {
    findings.push({ path, rule: "client-visible-sri-lanka-mobile" });
  }
  if (
    isClientVisiblePath(path) &&
    /\b(?:phoneNumberId|wabaId)\s*:\s*["'][0-9]{8,32}["']/.test(content)
  ) {
    findings.push({ path, rule: "client-visible-provider-identifier" });
  }
  return findings;
}
