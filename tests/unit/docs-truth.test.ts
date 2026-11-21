/**
 * The schema stamps the shipped documents name are the ones the BUILT package carries.
 *
 * `dist/` is compiled from this tree into a temporary staging package, and the stamps are read by
 * running that build in child processes (tests/tools/docs-truth.mjs): the report stamp from its
 * CLI's `--demo --format json`, the context-pack and comparison stamps from its public API, the
 * readable-report set and the snapshot stamp from its enums. None of them is written in this file,
 * so a stamp that moves — the snapshot is moving in this release — moves the oracle with it.
 *
 * The documents are the repository's own README, SECURITY.md, docs/** (all shipped),
 * CONTRIBUTING.md and maintainers/** (not shipped, but moved there from docs/ and still read).
 * CHANGELOG.md is not scanned: every entry states a change.
 */

import { strict as assert } from "node:assert";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { checkDocsTruth, commentLines, currentStamps, internalNameIssues, peerCommandIssues, pinIssues, scanText, shippedCodeFiles, sourceCommentIssues, statusIssues } from "../tools/docs-truth.mjs";
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
    const result = checkDocsTruth({ packageDir: stage, docsRoot: ROOT, extra: [join(ROOT, "CONTRIBUTING.md")], maintainers: join(ROOT, "maintainers"), pending: PENDING, stamps });
    assert.ok(result.scanned >= 30, `only ${result.scanned} documents were scanned; the guard has lost its subject`);
    assert.deepEqual(result.issues, [], "a document names a schema stamp the built package does not carry");
  });

  it("reads maintainers/** too, so a page moved out of the package cannot go stale unseen", () => {
    const docs = mkdtempSync(join(tmpdir(), "breaklint-docs-truth-maintainers-"));
    try {
      mkdirSync(join(docs, "maintainers"), { recursive: true });
      writeFileSync(join(docs, "README.md"), `Live document reports use Report ${stamps.report}.\n`);
      writeFileSync(join(docs, "maintainers/status.md"), `Live document reports use Report ${stamps.report}.\n`);
      const ok = checkDocsTruth({ packageDir: stage, docsRoot: docs, maintainers: join(docs, "maintainers"), stamps });
      assert.deepEqual(ok.issues, [], "positive control: a current maintainers page fails");
      assert.equal(ok.scanned, 2);
      writeFileSync(join(docs, "maintainers/status.md"), `Live document reports use Report ${stamps.report - 1}.\n`);
      const stale = checkDocsTruth({ packageDir: stage, docsRoot: docs, maintainers: join(docs, "maintainers"), stamps });
      assert.ok(stale.issues.some((issue) => issue.startsWith("maintainers/status.md:1: says report")), stale.issues.join("\n"));
      // Without --maintainers the same stale page is not read: the CI call must pass it.
      assert.deepEqual(checkDocsTruth({ packageDir: stage, docsRoot: docs, stamps }).issues, []);
      rmSync(join(docs, "maintainers/status.md"));
      assert.ok(checkDocsTruth({ packageDir: stage, docsRoot: docs, maintainers: join(docs, "maintainers"), stamps }).issues
        .some((issue) => /holds no Markdown file/u.test(issue)), "an empty maintainers directory passed silently");
    } finally {
      rmSync(docs, { recursive: true, force: true });
    }
  });

  it("reads its stamps from the build, not from a constant in this test", () => {
    assert.equal(stamps.report, stamps.reportConstant, "the built CLI writes a different report stamp than its enums declare");
    assert.ok(stamps.readable.includes(stamps.report), "the built package cannot read the reports it writes");
    // If the snapshot stamp moves, a table row that still names the old one must fail.
    const moved = { ...stamps, snapshot: stamps.snapshot + 1 };
    assert.equal(scanText("x.md", `| Measured snapshot | ${stamps.snapshot} | geometry |\n`, moved).length, 1);
    assert.equal(scanText("x.md", `| Measured snapshot | ${stamps.snapshot} | geometry |\n`, stamps).length, 0);
    // Same check for the screen report contract stamp and reader set.
    const movedScreen = { ...stamps, screen: stamps.screen + 1 };
    assert.equal(scanText("x.md", `| Screen report | ${stamps.screen} | geometry |\n`, movedScreen).length, 1);
    assert.equal(scanText("x.md", `| Screen report | ${stamps.screen} | geometry |\n`, stamps).length, 0);
    assert.equal(scanText("x.md", `Readers accept Screen ${stamps.readableScreens.join(" and ")}.\n`, stamps).length, 0);
    assert.equal(scanText("x.md", `Readers accept Screen 1 and ${stamps.screen + 5}.\n`, stamps).length, 1);
    assert.equal(scanText("x.md", `Readers accept Report ${stamps.readable.join(" and ")}, Snapshot ${stamps.readableSnapshots.slice(0, -1).join(", ")} and ${stamps.readableSnapshots.at(-1)}, and Screen ${stamps.readableScreens.join(" and ")}.\n`, stamps).length, 0);
    assert.equal(scanText("x.md", `Readers accept Report ${stamps.report - 2} and ${stamps.report} and Screen ${stamps.readableScreens.join(" and ")}.\n`, stamps).length, 1);
    assert.equal(scanText("x.md", `Readers accept Report ${stamps.readable.join(" and ")} and Screen 1 and ${stamps.screen + 5}.\n`, stamps).length, 1);
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
      // DOC-1: the sentence maintainers/releasing.md carried into 0.11.1, and its "schema version" twin.
      `The screen report is its own version-${stamps.screen - 1} contract and contains no document-page semantics.`,
      `Screen reports use schema version ${stamps.screen - 1}.`,
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
    // A synthetic page and entry: the real list must be empty at a release, and the mechanism a
    // pull request may still use has to stay tested when it is.
    const unit = `The helpers accept a canonical document Report ${stamps.report - 1} and nothing else.`;
    const entry: PendingCorrection = { file: "docs/pending-fixture.md", kind: "report", number: stamps.report - 1, unit, reason: "canary" };
    const docs = mkdtempSync(join(tmpdir(), "breaklint-docs-truth-pending-"));
    try {
      mkdirSync(join(docs, "docs"), { recursive: true });
      const original = `# Fixture\n\nAn unrelated paragraph.\n\n${unit}\n`;
      const check = (text: string) => {
        writeFileSync(join(docs, entry.file), text);
        return checkDocsTruth({ packageDir: stage, docsRoot: docs, stamps, pending: [entry] });
      };
      assert.equal(check(original).issues.length, 0, "the unchanged page is not green with its pending entry");
      assert.equal(checkDocsTruth({ packageDir: stage, docsRoot: docs, stamps, pending: [] }).issues.length, 1, "the fixture sentence is not stale without its entry");
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

it("reads complete arbitrary-length snapshot reader lists without accepting a prefix", () => {
  // This independent grammar oracle deliberately uses four noncontiguous versions, not the
  // package's current set or values produced by the reader under test.
  const oracle = { ...stamps, snapshot: 8, readableSnapshots: [2, 4, 6, 8] };
  const valid = [
    "Readers accept Snapshot 2 and 4 and 6 and 8.",
    "Readers accept Snapshot 2, 4, 6 and 8.",
    "Readers accept Snapshot 2, 4, 6, and 8.",
    "Snapshots 2 or 4 or 6 or 8 are readable.",
  ];
  for (const text of valid) assert.deepEqual(scanText("x.md", text, oracle), [], text);
  const invalid = [
    "Readers accept Snapshot 2, 4 and 8.",                  // omitted reader
    "Readers accept Snapshot 2, 4, 6 and 8 and 9.",         // unsupported tail
    "Readers accept Snapshot 2, 4, 6, 6 and 8.",            // duplicate
    "Readers accept Snapshot 2 and 4 and 6.",               // supported prefix only
  ];
  for (const text of invalid) assert.equal(scanText("x.md", text, oracle).length, 1, text);
  assert.equal(scanText("x.md", "Readers accept Snapshot 2, 4, 6 and 8; Snapshot 9 records geometry.", oracle).length, 1,
    "a valid reader claim must not hide a separate stale current-state claim");
});

it("reads actual snapshot compatibility and refuses an unsupported readable stamp", () => {
  const actual = stamps as Stamps & { readableSnapshots?: number[] };
  assert.ok(Array.isArray(actual.readableSnapshots), "the child build did not report its snapshot readers");
  assert.ok(actual.readableSnapshots.includes(stamps.snapshot));
  assert.deepEqual(scanText("x.md", `Readers accept Snapshot ${actual.readableSnapshots.join(" and ")}.`, stamps), []);
  const future = stamps.snapshot + 1;
  assert.equal(scanText("x.md", `Legacy Snapshot ${future} remains readable.`, stamps).length, 1);
  assert.equal(scanText("x.md", `Readers accept Snapshot ${actual.readableSnapshots[0]} and ${future}.`, stamps).length, 1);
  assert.equal(scanText("x.md", `Snapshot ${future} records live geometry.`, stamps).length, 1);
  const path = join(stage, "examples/demo-snapshot.json"); const original = readFileSync(path);
  try {
    const legacy = JSON.parse(original.toString("utf8")); legacy.snapshot.schemaVersion = actual.readableSnapshots[0]; delete legacy.snapshot.figureIndex;
    writeFileSync(path, JSON.stringify(legacy));
    const oldRules = spawnSync(process.execPath, [join(stage, "dist/cli/index.js"), "--demo", "--format", "json"], { cwd: stage, encoding: "utf8" });
    const oldCode = oldRules.status; assert.equal(oldCode, 1, oldRules.stderr);
    const newRule = spawnSync(process.execPath, [join(stage, "dist/cli/index.js"), "--demo", "--only", "figure/caption-separated", "--format", "json"], { cwd: stage, encoding: "utf8" });
    const newCode = newRule.status; assert.equal(newCode, 4, newRule.stderr);
    const report = JSON.parse(newRule.stdout);
    assert.equal(report.documents[0].coverage["figure/caption-separated"].measured, 0);
    assert.equal(report.documents[0].notMeasured[0].reason, "env/figure-index-unavailable");
  } finally { writeFileSync(path, original); }
});

describe("release-status sentences and peer install commands in the shipped documents", () => {
  const peers = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).peerDependencies as Record<string, string>;

  it("a sentence that is true only before the tag fails; the current documents carry none", () => {
    assert.equal(statusIssues("README.md", "Publication of 0.11.0 is pending candidate review and tagging.\n").length, 2,
      "negative control: the 0.11.0 README sentence passed");
    assert.equal(statusIssues("README.md", "The release is pending final tagging by the maintainer.\n").length, 1);
    assert.deepEqual(statusIssues("README.md", "Tagged releases are listed on GitHub.\n"), [], "positive control");
    for (const file of ["README.md", "SECURITY.md"]) {
      assert.deepEqual(statusIssues(file, readFileSync(join(ROOT, file), "utf8")), [], `${file} carries a pre-tag status sentence`);
    }
  });

  it("an install command must name each peer with the range package.json declares", () => {
    const range = peers["puppeteer-core"]!;
    const floor = /^>=\s*(\d+\.\d+\.\d+)/u.exec(range)?.[1];
    assert.ok(floor, `the peer range ${range} has no readable floor; this test needs one`);
    const command = (spec: string) => `npm i -D breaklint ${spec} pagedjs@${peers.pagedjs} pdfjs-dist@${peers["pdfjs-dist"]}`;
    assert.deepEqual(peerCommandIssues("README.md", command(`puppeteer-core@^${floor}`), peers), [], "positive control: the caret form of the declared range");
    assert.deepEqual(peerCommandIssues("README.md", command(`puppeteer-core@${floor}`), peers), [], "positive control: an exact version inside the range");
    const [major, minor] = floor.split(".").map(Number) as [number, number];
    for (const stale of [`puppeteer-core@^${major}.${minor - 1}.0`, `puppeteer-core@^${major - 1}.0.0`, `puppeteer-core@${major + 1}.0.0`, "puppeteer-core"]) {
      assert.equal(peerCommandIssues("README.md", command(stale), peers).length, 1, `negative control: ${stale} passed`);
    }
    assert.equal(peerCommandIssues("docs/x.md", "npm i -D pagedjs@0.4.4", peers).length, 1, "negative control: a different pagedjs passed");
    assert.deepEqual(peerCommandIssues("SECURITY.md", "the puppeteer-core 25.8.0 pin", peers), [], "prose without an install command is not a command");
  });

  it("a versioned link into this repository pins the package's own tag", () => {
    const version = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version as string;
    const pinned = `[a](https://github.com/godarg/breaklint/blob/v${version}/docs/x.md) ![b](https://raw.githubusercontent.com/godarg/breaklint/v${version}/assets/b.png) uses: godarg/breaklint@v${version}`;
    assert.deepEqual(pinIssues("README.md", pinned, version), [], "positive control: links pinned to the package's tag");
    assert.deepEqual(pinIssues("docs/ci-recipe.md", "uses: godarg/breaklint@<release-tag-or-its-commit-sha>", version), [], "a placeholder is not a ref");
    for (const stale of ["https://github.com/godarg/breaklint/blob/main/maintainers/x.md", "https://github.com/godarg/breaklint/tree/main/maintainers",
      "https://raw.githubusercontent.com/godarg/breaklint/v0.10.0/assets/a.png", "uses: godarg/breaklint@v0.10.0"]) {
      assert.equal(pinIssues("docs/x.md", stale, version).length, 1, `negative control passed: ${stale}`);
    }
    for (const file of ["README.md", "SECURITY.md", "docs/agent-contract.md", "docs/known-limits.md", "docs/rules/layout-widow.md"]) {
      assert.deepEqual(pinIssues(file, readFileSync(join(ROOT, file), "utf8"), version), [], `${file} links to an unpinned or foreign ref`);
    }
  });

  it("no shipped file, CHANGELOG.md included, names a review persona or calls a rostered pass human", () => {
    // The 0.7.0 and 0.8.0 entries said exactly this until 0.11.1.
    const shipped = [
      "  a human pass is recorded only by the closed roster `@Brand`, `@Neo` and `@Founder`, rounds are",
      "- `npm run test:report-surfaces`, the human gate, is green on ledger round 4:",
      "  round 3, a rostered human review on 2026-09-25, passed all 32 cells.",
      "no open Blocker/High finding. The Founder reviewed and accepted the 21 changed rendered views and",
      "  produces exactly 9 pages. The first-party Dargel document",
    ];
    for (const line of shipped) assert.ok(internalNameIssues("CHANGELOG.md", `${line}\n`).length >= 1, `negative control passed: ${line}`);
    assert.deepEqual(internalNameIssues("SECURITY.md", "Report privately: **security@dargel-solutions.de**. It is never presented as a human review.\n"), [],
      "positive control: the contact address and a denial are not internal names");
    for (const file of ["README.md", "SECURITY.md", "CHANGELOG.md", "docs/source-bound-findings.md", "docs/agent-contract.md"]) {
      assert.deepEqual(internalNameIssues(file, readFileSync(join(ROOT, file), "utf8")), [], `${file} names an internal role or system`);
    }
  });

  it("no code comment in src/** or the built dist/** names a model, a register id or an internal role", () => {
    // 0.10.0 shipped exactly these in dist/ comments; each must be caught where tsc copies it.
    const shippedComments = [
      " * design review (Gemini, Z1) left open and explicitly refused to grant:",
      " * is the half of Gemini's A4 that is actually available.",
      "        // G-78: a confirmed parity-blank page carries zero flow blocks and zero marks.",
      "  /** 1-based page numbers confirmed blank (e.g. Paged.js parity blanks, G-78). */",
      "          // either allowance to the footnote area (G-100).",
      "// reviewed by @Neo and the Founder",
      "/* a second opinion from Codex */ const x = 1;",
      " * element on one page must shift by the same amount (CDX-20, CODE-PRINT-4/5).",
      "    // the decline code itself is unchanged (VALUE-DIAG-1).",
    ];
    // A " * " line is inside the block comment it came from; the control keeps that context.
    const inContext = (line: string) => line.startsWith(" * ") ? `/**\n${line}\n */\n` : `${line}\n`;
    for (const line of shippedComments) assert.ok(sourceCommentIssues("src/x.ts", inContext(line)).length >= 1, `negative control passed: ${line}`);
    // The same words outside any comment are not read by this guard.
    assert.deepEqual(sourceCommentIssues("src/x.ts", " * design review (Gemini, Z1)\n"), [], "a line outside any comment was read as one");
    // Positive controls: code that is not a comment, a URL and a lowercase domain are not comments or names.
    for (const line of [
      'const url = "https://dargel-solutions.de/schemas/breaklint/config-v1.json";',
      "const g = grid.G - 78; // a grid offset",
      "/** Measured against the fallback font. */",
      "// The digest is SHA-256 over UTF-8 bytes (FNV-1a for the short key).",
    ]) assert.deepEqual(sourceCommentIssues("src/x.ts", `${line}\n`), [], `positive control failed: ${line}`);
    assert.deepEqual(commentLines("a // b\n/* c\n d */ e"), ["  // b", "/* c", " d */  "], "comment extraction keeps line numbers");
    const files = shippedCodeFiles(ROOT).filter((file) => file.includes("/src/"));
    assert.ok(files.length >= 60, `only ${files.length} source files found; the comment guard has lost its subject`);
    const built = shippedCodeFiles(stage).filter((file) => file.includes("/dist/"));
    assert.ok(built.length >= 120, `only ${built.length} built files found in the staged package`);
    const issues = [...files, ...built].flatMap((file) => sourceCommentIssues(file, readFileSync(file, "utf8")));
    assert.deepEqual(issues, [], "a shipped code comment names a model, a register id or an internal role");
  });

  it("the shipped documents fail the whole check when one carries a stale status sentence or peer", () => {
    const docs = mkdtempSync(join(tmpdir(), "breaklint-docs-truth-peers-"));
    try {
      writeFileSync(join(docs, "README.md"), `npm i -D breaklint puppeteer-core@^25.8.0 pagedjs@${peers.pagedjs}\n\nPublication is pending candidate review.\n`);
      const result = checkDocsTruth({ packageDir: stage, docsRoot: docs, stamps });
      assert.equal(result.valid, false);
      assert.ok(result.issues.some((issue) => /installs puppeteer-core@\^25\.8\.0/u.test(issue)), result.issues.join("\n"));
      assert.ok(result.issues.some((issue) => /pending candidate review/u.test(issue)), result.issues.join("\n"));
    } finally {
      rmSync(docs, { recursive: true, force: true });
    }
  });
});
