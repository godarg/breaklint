import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const EXPECTED_VERSION = "8.30.1";
const ROOT = new URL("../..", import.meta.url);

function run(args, options = {}) {
  return spawnSync("gitleaks", args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
  });
}

const version = run(["version"], { capture: true });
assert.equal(version.status, 0, `gitleaks is required: ${version.stderr}`);
assert.equal(version.stdout.trim(), EXPECTED_VERSION, "use the pinned gitleaks release");

const common = ["--config", ".gitleaks.toml", "--redact", "--no-banner", "--no-color"];
const history = run(["git", ".", ...common, "--log-opts=--all"]);
assert.equal(history.status, 0, "gitleaks found a secret in Git history");

const worktree = run(["dir", ".", ...common]);
assert.equal(worktree.status, 0, "gitleaks found a secret in the current worktree");

// A green scanner proves little until a secret makes it red. The canary is assembled only in a
// private temporary directory, so no credential-shaped literal enters source or Git history.
//
// THE CANARY IS DETERMINISTIC AND ATTRIBUTED, AND BOTH HALVES OF THAT COST A RELEASE ONCE.
// It used to plant `AKIA` + `randomBytes(8).toString("hex").toUpperCase()` beside a random base64
// secret and assert only that SOMETHING was found in `canary.env`. Measured on the pinned 8.30.1
// over 25 draws of exactly that shape: 24 red, and of those, 23 came from `generic-api-key` firing
// on the random SECRET while `aws-access-token` fired once. An uppercase-hex body is digit-heavy —
// ten of its sixteen symbols are digits — and this build of the AWS rule does not flag it. Swept
// against digits-in-body over six draws each: 0 digits 6/6 caught, 1 digit 3/6, 5 digits 1/6,
// 6 or more 0/6. So the check was passing on a different rule than the one it named, and failing
// whenever the random secret happened to fall under the generic rule's own entropy floor — which
// it did in 1 of 8 local runs and in the CI run that blocked release 0.4.0.
//
// Therefore: one letter-only key, fixed, assembled from parts so no complete token appears in this
// file, and an assertion on the rule id. A canary whose outcome depends on dice measures the dice.
const scratch = mkdtempSync(join(tmpdir(), "breaklint-gitleaks-canary-"));
try {
  const reportPath = join(scratch, "findings.json");
  const accessKey = ["AK", "IA", "ZBRMTQVLXKFWHNCD"].join("");
  writeFileSync(join(scratch, "canary.env"), `AWS_ACCESS_KEY_ID=${accessKey}\n`);
  const canary = run(
    [
      "dir",
      scratch,
      ...common,
      "--report-format",
      "json",
      "--report-path",
      reportPath,
    ],
    { capture: true },
  );
  assert.equal(canary.status, 1, `gitleaks canary stayed green: ${canary.stdout}${canary.stderr}`);
  const findings = JSON.parse(readFileSync(reportPath, "utf8"));
  assert.ok(findings.length >= 1, "gitleaks returned red without recording the canary finding");
  // The RULE, not merely the file. Asserting the file alone is what let a neighbouring rule stand
  // in for the one this canary is about.
  assert.ok(
    findings.some(
      (finding) => finding.RuleID === "aws-access-token" && String(finding.File).endsWith("canary.env"),
    ),
    `gitleaks did not attribute the canary to aws-access-token: ${JSON.stringify(findings.map((f) => f.RuleID))}`,
  );

  // The project rule is independent of the default credential rules. A plausible account name
  // outside the tightly scoped redaction fixtures must therefore be caught by its own canary.
  // Assemble the synthetic path at runtime: putting the complete canary in this source file would
  // make the scanner correctly reject its own test harness before the isolated canary can run.
  const homePathCanary = ["", "Users", "releaseoperator", "Documents", "report.pdf"].join("/");
  writeFileSync(join(scratch, "home-path.txt"), `${homePathCanary}\n`);
  const homeReportPath = join(scratch, "home-findings.json");
  const homeCanary = run(
    [
      "dir",
      scratch,
      ...common,
      "--report-format",
      "json",
      "--report-path",
      homeReportPath,
    ],
    { capture: true },
  );
  assert.equal(homeCanary.status, 1, `home-path canary stayed green: ${homeCanary.stdout}${homeCanary.stderr}`);
  const homeFindings = JSON.parse(readFileSync(homeReportPath, "utf8"));
  assert.ok(
    homeFindings.some(
      (finding) => finding.RuleID === "absolute-home-path" && String(finding.File).endsWith("home-path.txt"),
    ),
    "gitleaks did not attribute the non-allowlisted home-path canary to absolute-home-path",
  );
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

process.stdout.write(
  `secrets: history clean, worktree clean, secret and home-path canaries caught by gitleaks ${EXPECTED_VERSION}\n`,
);
