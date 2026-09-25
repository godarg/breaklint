/**
 * The schema stamps the shipped documents name are the ones the BUILT package carries.
 *
 * `dist/` is compiled from this tree into a temporary staging package, and the stamps are read by
 * running that build in child processes (tests/tools/docs-truth.mjs): the report stamp from its
 * CLI's `--demo --format json`, the context-pack and comparison stamps from its public API, the
 * readable-report set and the snapshot stamp from its enums. None of them is written in this file,
 * so a stamp that moves — the snapshot is moving in this release — moves the oracle with it.
 *
 * The documents are the repository's own README, SECURITY.md, docs/** (all shipped) and
 * CONTRIBUTING.md. CHANGELOG.md is not scanned: every entry states a change.
 */

import { strict as assert } from "node:assert";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { checkDocsTruth, currentStamps, scanText } from "../tools/docs-truth.mjs";
import type { PendingCorrection, Stamps } from "../tools/docs-truth.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const PENDING = readFileSync(join(ROOT, "tests/tools/docs-truth-pending.jsonl"), "utf8")
  .split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line) as PendingCorrection);

let stage = "";
let stamps: Stamps;

before(() => {
  stage = mkdtempSync(join(tmpdir(), "breaklint-docs-truth-"));
  // A package-shaped directory: its manifest, the demo fixture the CLI reads, and a fresh build.
  copyFileSync(join(ROOT, "package.json"), join(stage, "package.json"));
  mkdirSync(join(stage, "examples"));
  copyFileSync(join(ROOT, "examples/demo-snapshot.json"), join(stage, "examples/demo-snapshot.json"));
  symlinkSync(join(ROOT, "node_modules"), join(stage, "node_modules"));
  execFileSync(process.execPath, [join(ROOT, "node_modules/typescript/bin/tsc"), "-p", join(ROOT, "tsconfig.build.json"), "--outDir", join(stage, "dist")], {
    cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], timeout: 240_000,
  });
  stamps = currentStamps(stage);
});

after(() => {
  if (stage) rmSync(stage, { recursive: true, force: true });
});

describe("schema stamps in the shipped documents", () => {
  it("every stamp README, SECURITY.md, docs/** and CONTRIBUTING.md name is the built package's", () => {
    const result = checkDocsTruth({ packageDir: stage, docsRoot: ROOT, extra: [join(ROOT, "CONTRIBUTING.md")], pending: PENDING, stamps });
    assert.ok(result.scanned >= 30, `only ${result.scanned} documents were scanned; the guard has lost its subject`);
    assert.deepEqual(result.issues, [], "a document names a schema stamp the built package does not carry");
  });

  it("reads its stamps from the build, not from a constant in this test", () => {
    assert.equal(stamps.report, stamps.reportConstant, "the built CLI writes a different report stamp than its enums declare");
    assert.ok(stamps.readable.includes(stamps.report), "the built package cannot read the reports it writes");
    // If the snapshot stamp moves, a table row that still names the old one must fail.
    const moved = { ...stamps, snapshot: stamps.snapshot + 1 };
    assert.equal(scanText("x.md", `| Measured snapshot | ${stamps.snapshot} | geometry |\n`, moved).length, 1);
    assert.equal(scanText("x.md", `| Measured snapshot | ${stamps.snapshot} | geometry |\n`, stamps).length, 0);
  });

  it("rejects the stale current-state forms that shipped, and each one names its line", () => {
    const stale = [
      `Live document reports use Report ${stamps.report - 1}; the screen profile has a separate contract.`,
      `| Document report | ${stamps.report - 1} | Findings |`,
      `| AI context / comparison | ${stamps.context - 1} each | Bounded projection |`,
      `Keep document Report${stamps.report - 1} and the configuration contract distinct.`,
      `Keep the measurement Snapshot${stamps.snapshot - 1} distinct.`,
      `every leaf carries a fingerprint in report schema ${stamps.report - 2}.`,
      `The helpers accept a canonical document Report ${stamps.report - 1}.`,
      `Readers accept Report ${stamps.report - 2} and ${stamps.report}.`,
      `The context pack is ${stamps.context - 1}.`,
      `Stored measurement snapshots are schema ${stamps.snapshot + 1}.`,
    ];
    for (const line of stale) {
      const issues = scanText("README.md", `Intro.\n\n${line}\n`, stamps);
      assert.equal(issues.length, 1, `a stale mention passed: ${line}\n${issues.join("\n")}`);
      assert.match(issues[0]!, /^README\.md:3: /u, "the issue does not name the line");
    }
  });

  it("accepts a mention that says it is history, and only in a form that says so", () => {
    const historical = [
      `0.5.0 moves live document output to Report ${stamps.report - 1} and Snapshot ${stamps.snapshot}.`,
      `Report ${stamps.report - 2} consumers must migrate when adopting 0.5.0.`,
      `Legacy Report ${stamps.report - 2} input is shown as legacy.`,
      `Readers accept Report ${stamps.readable.join(" and ")}.`,
      `Reports ${stamps.readable.join(" and ")} are readable.`,
      `| Snapshot schema | 2 → 3, for the added field. Report schema stays 3 in 0.2.3 |`,
      `The report carries schema 3 from 0.2.3, schema 4 from 0.5.0 and schema ${stamps.report} today.`,
      "<!-- docs-truth: historical -->\nThe demo reported Snapshot 1.\n<!-- docs-truth: end -->",
    ];
    for (const line of historical) {
      assert.deepEqual(scanText("x.md", `${line}\n`, stamps), [], `a historical mention was rejected: ${line}`);
    }
    // A release version alone is not an anchor, and neither is a transition word without one.
    assert.equal(scanText("x.md", `Live reports use Report ${stamps.report - 1} in 0.6.0.\n`, stamps).length, 1);
    assert.equal(scanText("x.md", `Live reports moved to Report ${stamps.report - 1}.\n`, stamps).length, 1);
    // A version newer than the package cannot anchor anything.
    assert.equal(scanText("x.md", `99.0.0 moves live reports to Report ${stamps.report - 1}.\n`, stamps).length, 1);
    // The forms are read per mention and per sentence, not from whatever surrounds it: a version
    // in the next sentence, a common word, "legacy" elsewhere, an arrow elsewhere in a row.
    const loose = [
      `0.6.0 is out. Live reports moved to Report ${stamps.report - 1}.`,
      `Live reports use Report ${stamps.report - 1} from the CLI in 0.6.0.`,
      `Live reports were Report ${stamps.report - 1} until the next release, 0.6.0 said.`,
      `Live reports use Report ${stamps.report - 1}, not the legacy format.`,
      `| Document report | ${stamps.report - 1} | findings → evaluations |`,
      `Stored snapshots stay at Snapshot ${stamps.snapshot - 1} for readers of 0.5.0.`,
    ];
    for (const line of loose) {
      assert.equal(scanText("x.md", `${line}\n`, stamps).length, 1, `a current-state mention passed as history: ${line}`);
    }
  });

  it("a pending correction that is no longer needed fails, so the list can only shrink", () => {
    const result = checkDocsTruth({
      packageDir: stage, docsRoot: ROOT, stamps,
      pending: [...PENDING, { file: "README.md", kind: "report", number: 1, unit: "a sentence that is not there", reason: "canary" }],
    });
    assert.ok(result.issues.some((issue) => /pending entry matches no issue/u.test(issue) && /canary/u.test(issue)));
  });

  /*
   * The release workflow runs the tool with --release. A pending entry is a sentence this check
   * knows is stale; pull requests may carry one while its owner fixes it, a tag may not ship one.
   */
  it("--release refuses any pending entry, and then allows no exception", () => {
    const tool = join(ROOT, "tests/tools/docs-truth.mjs");
    const docs = mkdtempSync(join(tmpdir(), "breaklint-docs-truth-release-"));
    try {
      const run = (args: string[]) => spawnSync(process.execPath, [tool, "--package", stage, ...args], { encoding: "utf8", timeout: 120_000 });
      const pendingFile = join(docs, "pending.jsonl");
      writeFileSync(pendingFile, `${JSON.stringify({ file: "README.md", kind: "report", number: stamps.report - 1, unit: "x", reason: "canary" })}\n`);
      const refused = run(["--docs-root", docs, "--pending", pendingFile, "--release"]);
      assert.equal(refused.status, 1, refused.stdout + refused.stderr);
      assert.match(refused.stderr, /a release must not ship documents this check knows are stale[\s\S]*Correct those sentences and delete their entries in a commit on main, let CI go green on that commit, and tag that commit/u);

      writeFileSync(pendingFile, "");
      const nothing = run(["--docs-root", docs, "--pending", pendingFile, "--release"]);
      assert.equal(nothing.status, 1, "a run that found no document passed");
      assert.match(nothing.stderr, /nothing was checked/u);
      writeFileSync(join(docs, "README.md"), `Live document reports use Report ${stamps.report}.\n`);
      const clean = run(["--docs-root", docs, "--pending", pendingFile, "--release"]);
      assert.equal(clean.status, 0, clean.stdout + clean.stderr);
      assert.match(clean.stdout, /with no pending exception/u);

      writeFileSync(join(docs, "README.md"), `Live document reports use Report ${stamps.report - 1}.\n`);
      const stale = run(["--docs-root", docs, "--pending", pendingFile, "--release"]);
      assert.equal(stale.status, 1, "a stale sentence passed a release run");
    } finally {
      rmSync(docs, { recursive: true, force: true });
    }
  });

  it("a pending entry absorbs exactly its one sentence, and nothing added to it or copied from it", () => {
    assert.ok(PENDING.length > 0, "no pending entry is left to exercise; delete this test with the last one");
    const entry = PENDING[0]!;
    const docs = mkdtempSync(join(tmpdir(), "breaklint-docs-truth-pending-"));
    try {
      mkdirSync(join(docs, "docs"), { recursive: true });
      const original = readFileSync(join(ROOT, entry.file), "utf8");
      assert.ok(original.replace(/\s+/gu, " ").includes(entry.unit), `the pending sentence is not in ${entry.file}`);
      const check = (text: string) => {
        writeFileSync(join(docs, entry.file), text);
        return checkDocsTruth({ packageDir: stage, docsRoot: docs, stamps, pending: PENDING.filter((e) => e.file === entry.file) });
      };
      assert.deepEqual(check(original).issues, [], "the unchanged page is not green with its pending entries");
      // A second copy of the pending sentence is a second issue.
      assert.equal(check(`${original}\n${entry.unit}\n`).issues.length, 1, "a copied pending sentence was absorbed");
      // A new stale claim inside the pending sentence un-matches the entry: the claim and the entry both fail.
      const words = entry.unit.split(" ");
      const edited = original.replace(words.slice(-3).join(" "), `${words.slice(-3).join(" ").replace(/\.$/u, "")} and write Snapshot ${stamps.snapshot - 1}.`);
      assert.notEqual(edited, original, "the pending sentence could not be edited in place");
      const result = check(edited);
      assert.ok(result.issues.some((issue) => /says snapshot/u.test(issue)), "a stale claim added to a pending sentence passed");
      assert.ok(result.issues.some((issue) => /pending entry matches no issue/u.test(issue)), "an edited pending sentence still matched its entry");
    } finally {
      rmSync(docs, { recursive: true, force: true });
    }
  });
});
