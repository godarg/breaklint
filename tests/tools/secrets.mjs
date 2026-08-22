import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
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
const scratch = mkdtempSync(join(tmpdir(), "breaklint-gitleaks-canary-"));
try {
  const reportPath = join(scratch, "findings.json");
  const accessKey = `AKIA${randomBytes(8).toString("hex").toUpperCase()}`;
  const secretKey = randomBytes(30).toString("base64").slice(0, 40);
  writeFileSync(join(scratch, "canary.env"), `AWS_ACCESS_KEY_ID=${accessKey}\nAWS_SECRET_ACCESS_KEY=${secretKey}\n`);
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
  assert.ok(findings.some((finding) => String(finding.File).endsWith("canary.env")));

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
