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

  /*
   * GHSA-mrhx-c7xc-m3w5 affects zod below 4.6.6. The 0.11.0 text said the new peer floor's chain
   * "admits a fixed zod"; it also admits the vulnerable 4.6.5. The section must state what the
   * lockfile proves — the range the chain declares and the version this repository resolves —
   * read here from package-lock.json, not from the text under test.
   */
  it("SECURITY.md's zod paragraph states the declared range and the resolved version the lockfile proves", () => {
    const lock = JSON.parse(readFileSync(join(ROOT, "package-lock.json"), "utf8")) as {
      packages: Record<string, { version?: string; dependencies?: Record<string, string>; peerDependencies?: Record<string, string> }>;
    };
    const puppeteer = lock.packages["node_modules/puppeteer-core"]!;
    const bidiVersion = puppeteer.dependencies?.["chromium-bidi"];
    const bidi = lock.packages["node_modules/chromium-bidi"]!;
    const zodRange = bidi.dependencies?.zod;
    const zodResolved = lock.packages["node_modules/zod"]?.version;
    assert.ok(bidiVersion && bidi.version === bidiVersion && zodRange && zodResolved, "the lockfile no longer carries the puppeteer-core -> chromium-bidi -> zod chain; this guard has lost its subject");
    const floor = /^>=(\S+) </u.exec(lock.packages[""]!.peerDependencies?.["puppeteer-core"] ?? "")?.[1];
    assert.equal(floor, puppeteer.version, "the peer floor is not the locked puppeteer-core; the paragraph would describe another chain");
    const security = readFileSync(join(ROOT, "SECURITY.md"), "utf8");
    const at = security.indexOf("GHSA-mrhx-c7xc-m3w5");
    const section = security.slice(security.lastIndexOf("\n## ", at), security.indexOf("\n## ", at));
    assert.ok(section.includes(`\`puppeteer-core@${floor}\``), `the paragraph does not name puppeteer-core@${floor}`);
    assert.ok(section.includes(`\`chromium-bidi@${bidiVersion}\``), `the paragraph does not name chromium-bidi@${bidiVersion}`);
    assert.ok(section.includes(`\`zod: ${zodRange}\``), `the paragraph does not name the declared range zod: ${zodRange}`);
    assert.ok(section.includes(`zod ${zodResolved}`), `the paragraph does not name the resolved zod ${zodResolved}`);
    // ^4.6.5 admits 4.6.5, which the advisory affects: the floor alone closes nothing.
    if (/^\^4\.6\.[0-5]$/u.test(zodRange)) assert.match(section, /does not by itself exclude/u, "the paragraph claims more than the peer floor proves");
    assert.doesNotMatch(section, /closing the|closes the/u, "the paragraph claims the exception is closed by the floor");
  });
});
