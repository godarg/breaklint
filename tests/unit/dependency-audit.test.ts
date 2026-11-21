/**
 * The dependency gate says what it is. Until 0.11.1 `.github/dependabot.yml` asked for lockfile-only
 * security pull requests while the repository's Dependabot security updates were switched off, and
 * a clean `npm run test:advisories` printed "Dependabot security updates configured" over a
 * configuration that opened nothing. The file is gone on purpose: an automatic lockfile pull request
 * would move package-lock.json, one of the inputs every visual review round is bound to.
 * `test:advisories` is the gate; Dependabot alerts only notify.
 */

import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { EXIT, dependabotIssues } from "../tools/dependency-audit.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const DEPENDABOT = join(ROOT, ".github/dependabot.yml");

describe("dependency gate", () => {
  it("the repository carries no dependabot.yml, and the contract rejects one", () => {
    assert.equal(existsSync(DEPENDABOT), false, ".github/dependabot.yml exists: its pull requests would move the review-bound lockfile");
    assert.deepEqual(dependabotIssues(null), [], "the absent file fails the contract");
    const lockfileOnly = 'version: 2\nupdates:\n  - package-ecosystem: "npm"\n    directory: "/"\n    schedule:\n      interval: "daily"\n    versioning-strategy: lockfile-only\n';
    assert.match(dependabotIssues(lockfileOnly).join("\n"), /dependabot\.yml must not exist/u, "the contract accepts a lockfile-only configuration");
    assert.match(dependabotIssues('version: 2\nupdates:\n  - package-ecosystem: "github-actions"\n    directory: "/"\n').join("\n"), /must not exist/u);
  });

  it("a clean audit claims nothing is configured that does not run", () => {
    // The real script, with a stand-in npm that answers every audit with the recorded clean report.
    const bin = mkdtempSync(join(tmpdir(), "breaklint-audit-npm-"));
    try {
      const clean = JSON.parse(readFileSync(join(ROOT, "tests/fixtures/audit/clean.json"), "utf8")) as { status: number; report: unknown };
      writeFileSync(join(bin, "report.json"), JSON.stringify(clean.report));
      writeFileSync(
        join(bin, "npm"),
        `#!/usr/bin/env node\nif (process.argv[2] !== "audit") process.exit(2);\nprocess.stdout.write(require("node:fs").readFileSync(${JSON.stringify(join(bin, "report.json"))}, "utf8"));\nprocess.exit(${clean.status});\n`,
      );
      chmodSync(join(bin, "npm"), 0o755);
      const run = spawnSync(process.execPath, ["tests/tools/dependency-audit.mjs"], {
        cwd: ROOT, encoding: "utf8", env: { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH ?? ""}` },
      });
      assert.equal(run.status, EXIT.clean, `${run.stdout}${run.stderr}`);
      assert.match(run.stdout, /have 0 advisories/u, "the stand-in audit was not the one that ran");
      assert.doesNotMatch(run.stdout, /configured/u, "the clean summary claims a configuration");
    } finally {
      rmSync(bin, { recursive: true, force: true });
    }
  });

  it("SECURITY.md promises no automatic lockfile pull request", () => {
    const security = readFileSync(join(ROOT, "SECURITY.md"), "utf8");
    const drift = security.slice(security.indexOf("## Advisory drift"), security.indexOf("\n## ", security.indexOf("## Advisory drift") + 1));
    assert.ok(drift.length > 100, "SECURITY.md has no Advisory drift section; this guard has lost its subject");
    assert.doesNotMatch(drift, /dependabot\.yml` makes|lockfile-only pull requests:/u, "SECURITY.md still promises Dependabot pull requests");
    assert.match(drift, /no `\.github\/dependabot\.yml`/u, "SECURITY.md does not say that no Dependabot configuration exists");
  });
});
