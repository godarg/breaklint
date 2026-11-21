/**
 * The `compare`, `context` and `bundle` subcommands at the process boundary of the BUILT package.
 *
 * `dist/` is compiled from this tree into a temporary package-shaped directory (the same staging
 * as tests/unit/docs-truth.test.ts), and every case runs `dist/cli/index.js` as a child process.
 * The exit code each case asserts is the one an installed `breaklint` returns to a CI step.
 *
 * The exit contract of the subcommands:
 *   0  the requested output was written completely
 *   1  `compare --fail-on-new` and at least one comparison result is `new`
 *   2  invalid invocation or input: unknown option, a file that is not a breaklint report of a
 *      readable version, an output that would overwrite an input, a non-empty bundle directory
 *   3  the output could not be written (I/O), or `compare`'s after report is `infrastructure`
 *   4  `compare`'s after report is `insufficient-coverage`, or findings exist and none of them
 *      can be matched (no stable identity, or no document of the same comparison scope in the
 *      other report), so the comparison states nothing about a repair
 * A failed or incomplete BEFORE report is a warning on stderr; it does not change the exit code.
 *
 * Real report fixtures (tests/fixtures/reports/, written by the named released builds, minified):
 *   report4-v0.5.0-demo.json        `breaklint --demo --format json` of v0.5.0 (report schema 4)
 *   report5-v0.10.0-demo.json       `breaklint --demo --format json` of v0.10.0 (report schema 5)
 *   screen1-v0.10.0-overflow.json   `checkPage` of v0.10.0 on a live overflowing page (screen 1)
 *   screen2-v0.11.1-overflow.json   `checkPage` of 0.11.1 on the same page (screen 2)
 * The current document report is produced in this file by the staged CLI's own `--demo`.
 */

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { cleanReportState, findingsReportState, infrastructureReportState, insufficientCoverageReportState } from "../fixtures/report-states.ts";
import type { Report } from "../../src/core/types.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const FIXTURES = join(ROOT, "tests/fixtures/reports");
const REAL_DOCUMENT = ["report4-v0.5.0-demo.json", "report5-v0.10.0-demo.json"];
const REAL_SCREEN = ["screen1-v0.10.0-overflow.json", "screen2-v0.11.1-overflow.json"];

let stage = "";
let cli = "";
let work = "";
let currentDemo = "";

before(() => {
  stage = mkdtempSync(join(tmpdir(), "breaklint-subcmd-contract-"));
  copyFileSync(join(ROOT, "package.json"), join(stage, "package.json"));
  mkdirSync(join(stage, "examples"));
  copyFileSync(join(ROOT, "examples/demo-snapshot.json"), join(stage, "examples/demo-snapshot.json"));
  symlinkSync(join(ROOT, "node_modules"), join(stage, "node_modules"));
  execFileSync(process.execPath, [join(ROOT, "node_modules/typescript/bin/tsc"), "-p", join(ROOT, "tsconfig.build.json"), "--outDir", join(stage, "dist")], {
    cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], timeout: 240_000,
  });
  cli = join(stage, "dist/cli/index.js");
  work = mkdtempSync(join(tmpdir(), "breaklint-subcmd-work-"));
  currentDemo = join(work, "current-demo.json");
  const demo = run(["--demo", "--format", "json", "--out", currentDemo]);
  assert.equal(demo.status, 1, `the staged demo must end with its documented exit 1:\n${demo.stderr}`);
});

after(() => {
  if (stage) rmSync(stage, { recursive: true, force: true });
  if (work) rmSync(work, { recursive: true, force: true });
});

function run(args: string[], cwd = work) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8", timeout: 60_000 });
}

/** The same child under a file-size limit (sh `ulimit -f`, 512- or 1024-byte blocks): writes past it fail with EFBIG. */
function runLimited(blocks: number, args: string[], cwd = work) {
  return spawnSync("/bin/sh", ["-c", `ulimit -f ${blocks}; exec "$0" "$@"`, process.execPath, cli, ...args], { cwd, encoding: "utf8", timeout: 60_000 });
}

function caseDir(name: string): string {
  const dir = join(work, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeJson(path: string, value: unknown): string {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  return path;
}

function demoReport(): Report {
  return JSON.parse(readFileSync(currentDemo, "utf8")) as Report;
}

function realFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf8"));
}

function show(result: ReturnType<typeof run>): string {
  return `exit ${result.status}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`;
}

/** A report whose findings were removed, with the verdict it keeps. */
function withoutFindings(report: Report): Report {
  report.findings = [];
  for (const document of report.documents) document.findings = [];
  return report;
}

describe("C1: a subcommand reads only a breaklint report of a readable version", () => {
  it("accepts real old and current reports of every readable version", () => {
    const dir = caseDir("c1-accept");
    const documents = [...REAL_DOCUMENT.map((name) => join(FIXTURES, name)), currentDemo];
    for (const [index, file] of [...documents, ...REAL_SCREEN.map((name) => join(FIXTURES, name))].entries()) {
      const context = run(["context", file, "--out", join(dir, `context-${index}.json`)]);
      assert.equal(context.status, 0, `${file}\n${show(context)}`);
      const pack = JSON.parse(readFileSync(join(dir, `context-${index}.json`), "utf8")) as { selection: { reason: string | null } };
      assert.notEqual(pack.selection.reason, "legacy-or-invalid-report-cannot-establish-source-or-repair-claims", file);
      const bundle = run(["bundle", file, "--out-dir", join(dir, `bundle-${index}`), "--evidence-dir", dir]);
      assert.equal(bundle.status, 0, `${file}\n${show(bundle)}`);
      assert.doesNotMatch(readFileSync(join(dir, `bundle-${index}`, "report.html"), "utf8"), /Legacy or invalid report/u, file);
    }
    for (const [index, file] of documents.entries()) {
      const compare = run(["compare", file, documents[(index + 1) % documents.length]!, "--out", join(dir, `compare-${index}.json`)]);
      assert.notEqual(compare.status, 2, `${file}\n${show(compare)}`);
      assert.equal(existsSync(join(dir, `compare-${index}.json`)), true, show(compare));
    }
  });

  it("rejects a JSON value that is not a breaklint report with exit 2 and writes nothing", () => {
    const dir = caseDir("c1-reject");
    const context = run(["context", currentDemo, "--out", join(dir, "a-context-pack.json")]);
    assert.equal(context.status, 0, show(context));
    const after = findingsReportState(); after.runId = "after-run";
    const comparison = run(["compare", writeJson(join(dir, "b.json"), findingsReportState()), writeJson(join(dir, "a.json"), after), "--out", join(dir, "a-comparison.json")]);
    assert.notEqual(comparison.status, 2, show(comparison));
    const schema3 = { ...demoReport(), schemaVersion: 3 };
    const screen3 = { ...(realFixture(REAL_SCREEN[1]!) as Record<string, unknown>), schemaVersion: 3 };
    const inputs: [string, unknown][] = [
      ["empty-object", {}], ["null", null], ["array", []], ["string", "hello"], ["number", 42],
      ["sarif", { version: "2.1.0", runs: [] }],
      ["context-pack", JSON.parse(readFileSync(join(dir, "a-context-pack.json"), "utf8"))],
      ["comparison", JSON.parse(readFileSync(join(dir, "a-comparison.json"), "utf8"))],
      ["package-json", JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"))],
      ["reduced-document", { schemaVersion: 5, profileKind: "document", runId: "reduced", documents: [] }],
      ["schema-3-document", schema3], ["schema-3-screen", screen3],
      ["unknown-profile", { ...demoReport(), profileKind: "print" }],
    ];
    for (const [name, value] of inputs) {
      const file = writeJson(join(dir, `${name}.json`), value);
      const ctx = run(["context", file, "--out", join(dir, `${name}-ctx.json`)]);
      assert.equal(ctx.status, 2, `context ${name}\n${show(ctx)}`);
      assert.match(ctx.stderr, /is not a breaklint report/u, `context ${name}`);
      assert.equal(existsSync(join(dir, `${name}-ctx.json`)), false, `context ${name} wrote an output`);
      const bundle = run(["bundle", file, "--out-dir", join(dir, `${name}-bundle`)]);
      assert.equal(bundle.status, 2, `bundle ${name}\n${show(bundle)}`);
      assert.match(bundle.stderr, /is not a breaklint report/u, `bundle ${name}`);
      assert.equal(existsSync(join(dir, `${name}-bundle`)), false, `bundle ${name} created its output directory`);
      for (const pair of [[file, currentDemo], [currentDemo, file]]) {
        const cmp = run(["compare", ...pair, "--out", join(dir, `${name}-cmp.json`)]);
        assert.equal(cmp.status, 2, `compare ${name}\n${show(cmp)}`);
        assert.match(cmp.stderr, /is not a breaklint report/u, `compare ${name}`);
        assert.equal(existsSync(join(dir, `${name}-cmp.json`)), false, `compare ${name} wrote an output`);
      }
    }
  });

  it("rejects a report whose consumed nested values have the wrong type, naming the field", () => {
    const dir = caseDir("c1-nested");
    const documentCases: [string, (r: Record<string, any>) => void, RegExp][] = [
      ["page-string", (r) => { r.findings[0].page = "2"; r.documents[0].findings[0].page = "2"; }, /findings\[0\]\.page/u],
      ["finding-null", (r) => { r.documents[0].findings[0] = null; }, /documents\[0\]\.findings\[0\]/u],
      ["document-findings-object", (r) => { r.documents[0].findings = {}; }, /documents\[0\]\.findings/u],
      ["location-without-line", (r) => { r.findings[0].originalSource.location = { file: "a.html" }; }, /findings\[0\]\.originalSource\.location\.line/u],
      ["measurement-object", (r) => { r.findings[0].measurement.value = { "<b>": 1 }; }, /findings\[0\]\.measurement\.value/u],
      ["measurement-nan", (r) => { r.findings[0].measurement.threshold = "NaN"; r.findings[0].measurement.value = Number.NaN; }, /findings\[0\]\.measurement\.value/u],
      ["coverage-string", (r) => { const first = Object.keys(r.documents[0].coverage)[0]!; r.documents[0].coverage[first].candidates = "1"; }, /coverage\[".*"\]\.candidates/u],
      ["evaluation-target-null", (r) => { r.evaluations[0].targetRef = null; }, /evaluations\[0\]\.targetRef/u],
      ["verdict-unknown", (r) => { r.runVerdict = "fine"; }, /runVerdict/u],
      ["active-rules-missing", (r) => { delete r.config.activeRules; }, /config\.activeRules/u],
      // A damaged archive: the coverage decline list holds a non-object the projections read.
      ["coverage-not-measured-null", (r) => { const first = Object.keys(r.documents[0].coverage)[0]!; r.documents[0].coverage[first].notMeasured = [null]; r.documents[0].coverage[first].notMeasuredCount = 1; }, /coverage\[".*"\]\.notMeasured\[0\]/u],
      ["coverage-not-measured-reason", (r) => { const first = Object.keys(r.documents[0].coverage)[0]!; r.documents[0].coverage[first].notMeasured = [{ count: 1 }]; r.documents[0].coverage[first].notMeasuredCount = 1; }, /coverage\[".*"\]\.notMeasured\[0\]\.reason/u],
    ];
    for (const [name, mutate, field] of documentCases) {
      const report = demoReport() as unknown as Record<string, any>;
      mutate(report);
      const file = writeJson(join(dir, `${name}.json`), report);
      for (const args of [["context", file], ["bundle", file, "--out-dir", join(dir, `${name}-bundle`)], ["compare", currentDemo, file]]) {
        const result = run(args);
        assert.equal(result.status, 2, `${args[0]} ${name}\n${show(result)}`);
        assert.match(result.stderr, /is not a breaklint report/u, `${args[0]} ${name}`);
        assert.match(result.stderr, field, `${args[0]} ${name} does not name the field`);
      }
      assert.equal(existsSync(join(dir, `${name}-bundle`)), false, `bundle ${name} created its output directory`);
    }
    const screenCases: [string, (r: Record<string, any>) => void, RegExp][] = [
      ["box-string", (r) => { r.findings[0].target.box.x = "0"; }, /findings\[0\]\.target\.box\.x/u],
      ["viewport-null", (r) => { r.scope.viewport = null; }, /scope\.viewport/u],
      ["byte-length-string", (r) => { r.artifact.byteLength = "3225"; }, /artifact\.byteLength/u],
      ["events-missing", (r) => { delete r.events; }, /events/u],
    ];
    for (const fixture of REAL_SCREEN) {
      for (const [name, mutate, field] of screenCases) {
        const report = realFixture(fixture) as Record<string, any>;
        mutate(report);
        const file = writeJson(join(dir, `${fixture}-${name}.json`), report);
        for (const args of [["context", file], ["bundle", file, "--out-dir", join(dir, `${fixture}-${name}-bundle`)]]) {
          const result = run(args);
          assert.equal(result.status, 2, `${args[0]} ${fixture} ${name}\n${show(result)}`);
          assert.match(result.stderr, /is not a breaklint report/u);
          assert.match(result.stderr, field, `${args[0]} ${fixture} ${name} does not name the field`);
        }
      }
    }
  });

  it("compare reads document reports only: a real screen report is exit 2", () => {
    const result = run(["compare", join(FIXTURES, REAL_SCREEN[1]!), join(FIXTURES, REAL_SCREEN[1]!)]);
    assert.equal(result.status, 2, show(result));
  });
});

describe("C2/C3: an output never replaces an input, and a bundle directory starts empty", () => {
  it("refuses --out that names an input by path, alias, symlink or hard link (exit 2, input unchanged)", () => {
    const dir = caseDir("c23-collision");
    mkdirSync(join(dir, "sub"));
    const reportPath = join(dir, "report.json");
    copyFileSync(currentDemo, reportPath);
    const original = readFileSync(reportPath);
    symlinkSync(reportPath, join(dir, "link.json"));
    linkSync(reportPath, join(dir, "hard.json"));
    const before = writeJson(join(dir, "before.json"), findingsReportState());
    const afterReport = findingsReportState(); afterReport.runId = "after-run";
    const afterPath = writeJson(join(dir, "after.json"), afterReport);
    const cmp = run(["compare", before, afterPath, "--out", join(dir, "cmp.json")]);
    assert.notEqual(cmp.status, 2, show(cmp));
    const cmpOriginal = readFileSync(join(dir, "cmp.json"));
    const beforeOriginal = readFileSync(before);
    const afterOriginal = readFileSync(afterPath);
    const cases: [string, string[]][] = [
      ["context same path", ["context", reportPath, "--out", reportPath]],
      ["context relative alias", ["context", "report.json", "--out", "./sub/../report.json"]],
      ["context symlink", ["context", reportPath, "--out", join(dir, "link.json")]],
      ["context hard link", ["context", reportPath, "--out", join(dir, "hard.json")]],
      ["context hard link as input", ["context", join(dir, "hard.json"), "--out", reportPath]],
      ["context --comparison", ["context", afterPath, "--comparison", join(dir, "cmp.json"), "--out", join(dir, "cmp.json")]],
      ["compare after", ["compare", before, afterPath, "--out", afterPath]],
      ["compare before", ["compare", before, afterPath, "--out", before]],
    ];
    for (const [name, args] of cases) {
      const result = run(args, dir);
      assert.equal(result.status, 2, `${name}\n${show(result)}`);
      assert.match(result.stderr, /would overwrite an input/u, name);
    }
    assert.deepEqual(readFileSync(reportPath), original, "the input report was changed");
    assert.deepEqual(readFileSync(join(dir, "cmp.json")), cmpOriginal, "the comparison input was changed");
    assert.deepEqual(readFileSync(before), beforeOriginal);
    assert.deepEqual(readFileSync(afterPath), afterOriginal);
  });

  it("an --out or --out-dir through a symlinked directory and .. is written where the file system resolves it", () => {
    // `link/..` is `elsewhere` for the file system and `.` for a lexical normalisation. The
    // collision check and the write must name the same file, or an input in `.` is replaced
    // while the check looked at `elsewhere`.
    const dir = caseDir("c23-symlink-dotdot");
    mkdirSync(join(dir, "elsewhere/inner"), { recursive: true });
    symlinkSync(join(dir, "elsewhere/inner"), join(dir, "link"));
    const reportPath = join(dir, "report.json");
    copyFileSync(currentDemo, reportPath);
    const original = readFileSync(reportPath);
    const context = run(["context", "report.json", "--out", "link/../report.json"], dir);
    assert.equal(context.status, 0, show(context));
    assert.deepEqual(readFileSync(reportPath), original, "the input report in the working directory was replaced");
    assert.equal(existsSync(join(dir, "elsewhere/report.json")), true, "the output is not where the file system resolves --out");
    const compare = run(["compare", "report.json", "report.json", "--out", "link/../cmp.json"], dir);
    assert.notEqual(compare.status, 2, show(compare));
    assert.equal(existsSync(join(dir, "elsewhere/cmp.json")), true, "compare --out is not where the file system resolves it");
    assert.equal(existsSync(join(dir, "cmp.json")), false);
    // When the resolved file IS an input, the collision is refused.
    copyFileSync(currentDemo, join(dir, "elsewhere/input.json"));
    const inside = run(["context", "elsewhere/input.json", "--out", "link/../input.json"], dir);
    assert.equal(inside.status, 2, show(inside));
    assert.match(inside.stderr, /would overwrite an input/u);
    // The bundle directory follows the same resolution: checked and written in one place.
    const bundle = run(["bundle", "report.json", "--out-dir", "link/../fresh"], dir);
    assert.equal(bundle.status, 0, show(bundle));
    assert.equal(existsSync(join(dir, "elsewhere/fresh/report.json")), true, "the bundle is not where the file system resolves --out-dir");
    assert.equal(existsSync(join(dir, "fresh")), false, "the bundle was written to the lexically normalised directory");
    // A used directory reached through the link is refused, not written into.
    const used = run(["bundle", "report.json", "--out-dir", "link/.."], dir);
    assert.equal(used.status, 2, show(used));
    assert.deepEqual(readFileSync(reportPath), original);
  });

  it("bundle requires a new or empty --out-dir: a second run without --comparison cannot leave a stale comparison", () => {
    const dir = caseDir("c23-bundle");
    const before = writeJson(join(dir, "before.json"), findingsReportState());
    const afterReport = findingsReportState(); afterReport.runId = "after-run";
    const afterPath = writeJson(join(dir, "after.json"), afterReport);
    const cmp = run(["compare", before, afterPath, "--out", join(dir, "cmp.json")]);
    assert.notEqual(cmp.status, 2, show(cmp));
    const first = run(["bundle", afterPath, "--out-dir", join(dir, "out"), "--comparison", join(dir, "cmp.json")]);
    assert.equal(first.status, 0, show(first));
    const firstFiles = readdirSync(join(dir, "out")).sort();
    const firstReport = readFileSync(join(dir, "out/report.json"));
    const second = run(["bundle", before, "--out-dir", join(dir, "out")]);
    assert.equal(second.status, 2, show(second));
    assert.match(second.stderr, /new or empty directory/u);
    assert.deepEqual(readdirSync(join(dir, "out")).sort(), firstFiles);
    assert.deepEqual(readFileSync(join(dir, "out/report.json")), firstReport, "the first bundle was overwritten");
    // An input inside the target directory is refused by the same rule.
    const inside = run(["bundle", join(dir, "out/report.json"), "--out-dir", join(dir, "out")]);
    assert.equal(inside.status, 2, show(inside));
    assert.deepEqual(readFileSync(join(dir, "out/report.json")), firstReport);
    // An existing empty directory is a valid target; a regular file is not.
    mkdirSync(join(dir, "empty"));
    const empty = run(["bundle", before, "--out-dir", join(dir, "empty")]);
    assert.equal(empty.status, 0, show(empty));
    const asFile = run(["bundle", before, "--out-dir", before]);
    assert.equal(asFile.status, 2, show(asFile));
  });

  it("a failed write leaves the previous output intact and no temporary file (exit 3)", () => {
    const dir = caseDir("c23-failed-write");
    const previous = "previous complete output\n";
    for (const [name, args] of [
      ["context", ["context", currentDemo, "--out", join(dir, "context.json")]],
      ["compare", ["compare", currentDemo, currentDemo, "--out", join(dir, "compare.json")]],
    ] as const) {
      const target = join(dir, `${name}.json`);
      writeFileSync(target, previous);
      const result = runLimited(1, [...args]);
      assert.equal(result.status, 3, `${name}\n${show(result)}`);
      assert.equal(readFileSync(target, "utf8"), previous, `${name}: the previous output was destroyed by a partial write`);
      assert.deepEqual(readdirSync(dir).filter((entry) => !entry.endsWith(".json")), [], `${name}: a temporary file was left behind`);
      assert.doesNotMatch(result.stderr, /\n\s+at /u, `${name}: a stack trace reached the user`);
    }
  });
});

describe("C4/C5: the exit contract of compare, context and bundle", () => {
  it("compare: after infrastructure is 3, after insufficient-coverage is 4", () => {
    const dir = caseDir("c45-after");
    const before = writeJson(join(dir, "before.json"), withoutFindings(cleanReportState()));
    const infra = writeJson(join(dir, "infra.json"), withoutFindings(infrastructureReportState()));
    const coverage = writeJson(join(dir, "coverage.json"), withoutFindings(insufficientCoverageReportState()));
    assert.equal(run(["compare", before, infra]).status, 3);
    assert.equal(run(["compare", before, coverage]).status, 4);
    // With findings in both, the after verdict still decides first.
    const findingsBefore = writeJson(join(dir, "findings-before.json"), findingsReportState());
    assert.equal(run(["compare", findingsBefore, writeJson(join(dir, "infra-f.json"), infrastructureReportState())]).status, 3);
  });

  it("compare: a failed or incomplete before report is a warning on stderr, not the exit code", () => {
    const dir = caseDir("c45-before");
    const clean = writeJson(join(dir, "clean.json"), withoutFindings(cleanReportState()));
    for (const [name, report] of [["infrastructure", infrastructureReportState()], ["insufficient-coverage", insufficientCoverageReportState()]] as const) {
      const before = writeJson(join(dir, `${name}.json`), withoutFindings(report));
      const result = run(["compare", before, clean, "--out", join(dir, `${name}-cmp.json`)]);
      assert.equal(result.status, 0, `${name}\n${show(result)}`);
      assert.match(result.stderr, new RegExp(`before report.*${name}`, "u"), name);
      assert.equal(existsSync(join(dir, `${name}-cmp.json`)), true);
    }
  });

  it("compare: findings without any matchable one is 4 with a hint; no findings at all is 0", () => {
    const dir = caseDir("c45-unmatchable");
    const before = writeJson(join(dir, "before.json"), findingsReportState());
    const afterReport = findingsReportState(); afterReport.runId = "after-run";
    const afterPath = writeJson(join(dir, "after.json"), afterReport);
    const result = run(["compare", before, afterPath, "--out", join(dir, "cmp.json")]);
    assert.equal(result.status, 4, show(result));
    assert.match(result.stderr, /stable identity/u);
    const written = JSON.parse(readFileSync(join(dir, "cmp.json"), "utf8")) as { results: { status: string }[] };
    assert.ok(written.results.length > 0 && written.results.every((item) => item.status === "unmatchable"), "the comparison itself is still written");
    // The real CLI demo has the same property: its findings carry no stable identity.
    assert.equal(run(["compare", currentDemo, currentDemo]).status, 4);
    const none = writeJson(join(dir, "none.json"), withoutFindings(cleanReportState()));
    assert.equal(run(["compare", none, none]).status, 0);
  });

  it("compare: findings with a stable identity but no counterpart document of the same scope is 4", () => {
    // Two different documents compared by mistake: every finding has a stable identity, but no
    // after document shares its comparison scope, so nothing was matched against anything.
    const dir = caseDir("c45-scope");
    const hash = (seed: string) => seed.repeat(64).slice(0, 64);
    const scoped = (report: Report, documentSeed: string, runId: string): Report => {
      report.runId = runId;
      for (const document of report.documents) {
        document.comparisonScope = { projectId: hash("a"), documentId: hash(documentSeed), scenario: "document-print" };
      }
      const stamp = (finding: Report["findings"][number], index: number) => {
        const value = hash(String(index + 1));
        finding.stableIdentity = { status: "unique", value, candidates: [value], identityContract: "logical-source-value-v1", canonicalization: "canonical-node-v1", authorAnchorSha256: hash("c"), semanticSha256: hash("d") };
      };
      report.findings.forEach(stamp);
      for (const document of report.documents) document.findings.forEach(stamp);
      return report;
    };
    const before = writeJson(join(dir, "before.json"), scoped(demoReport(), "b", "before-run"));
    const afterPath = writeJson(join(dir, "after.json"), scoped(demoReport(), "e", "after-run"));
    const result = run(["compare", before, afterPath, "--out", join(dir, "cmp.json")]);
    const written = JSON.parse(readFileSync(join(dir, "cmp.json"), "utf8")) as { results: { status: string; reasons: string[] }[] };
    assert.ok(written.results.length > 0, "the fixture must produce comparison results");
    assert.ok(written.results.every((item) => item.status !== "unmatchable"), "the fixture must carry stable identities");
    assert.ok(written.results.every((item) => item.reasons.includes("scope-incompatible-or-unknown")), "the fixture must differ in scope");
    assert.equal(result.status, 4, show(result));
    assert.match(result.stderr, /comparison scope/u);
    // The same reports against themselves share the scope and are matched: not 4.
    const self = run(["compare", before, before]);
    assert.notEqual(self.status, 4, show(self));
  });

  it("compare: --fail-on-new without a new result keeps 0; --repository must name a directory", () => {
    const dir = caseDir("c45-options");
    const none = writeJson(join(dir, "none.json"), withoutFindings(cleanReportState()));
    const plain = run(["compare", none, none, "--fail-on-new"]);
    assert.equal(plain.status, 0, show(plain));
    const repository = run(["compare", none, none, "--repository", dir]);
    assert.equal(repository.status, 0, show(repository));
    assert.equal(run(["compare", none, none, "--repository", join(dir, "missing")]).status, 2);
    assert.equal(run(["compare", none, none, "--repository", none]).status, 2);
    assert.equal(run(["compare", none, none, "--repository"]).status, 2);
  });

  it("an output that cannot be written is 3 for every subcommand", () => {
    const dir = caseDir("c45-io");
    const blocker = join(dir, "blocker");
    writeFileSync(blocker, "a file where a directory is needed\n");
    const report = writeJson(join(dir, "report.json"), withoutFindings(cleanReportState()));
    assert.equal(run(["compare", report, report, "--out", join(blocker, "cmp.json")]).status, 3);
    assert.equal(run(["context", report, "--out", join(blocker, "ctx.json")]).status, 3);
    assert.equal(run(["bundle", report, "--out-dir", join(blocker, "bundle")]).status, 3);
  });

  it("context and bundle: a complete projection of a failed or incomplete report is 0; its verdict is in the output", () => {
    const dir = caseDir("c45-projection");
    for (const [name, report] of [["infrastructure", infrastructureReportState()], ["insufficient-coverage", insufficientCoverageReportState()]] as const) {
      const file = writeJson(join(dir, `${name}.json`), report);
      const ctx = run(["context", file, "--out", join(dir, `${name}-ctx.json`)]);
      assert.equal(ctx.status, 0, show(ctx));
      assert.equal((JSON.parse(readFileSync(join(dir, `${name}-ctx.json`), "utf8")) as { run: { verdict: string } }).run.verdict, name);
      const bundle = run(["bundle", file, "--out-dir", join(dir, `${name}-bundle`)]);
      assert.equal(bundle.status, 0, show(bundle));
    }
  });
});

describe("C7: stated limits and complete help", () => {
  it("bundle without --evidence-dir says where evidence would come from; with it, it does not", () => {
    const dir = caseDir("c7-evidence");
    const report = writeJson(join(dir, "report.json"), findingsReportState());
    const without = run(["bundle", report, "--out-dir", join(dir, "a")]);
    assert.equal(without.status, 0, show(without));
    assert.match(without.stderr, /--evidence-dir/u);
    const withDir = run(["bundle", report, "--out-dir", join(dir, "b"), "--evidence-dir", dir]);
    assert.equal(withDir.status, 0, show(withDir));
    assert.doesNotMatch(withDir.stderr, /--evidence-dir/u);
  });

  it("--max-findings and --max-text report the limit that took effect", () => {
    const dir = caseDir("c7-limits");
    const report = writeJson(join(dir, "report.json"), findingsReportState());
    const many = run(["context", report, "--max-findings", "2000", "--out", join(dir, "a.json")]);
    assert.equal(many.status, 0, show(many));
    assert.match(many.stderr, /--max-findings 2000.*\b100\b/u);
    const wide = run(["context", report, "--max-text", "5000", "--out", join(dir, "b.json")]);
    assert.match(wide.stderr, /--max-text 5000.*\b1200\b/u);
    const narrow = run(["context", report, "--max-text", "10", "--out", join(dir, "c.json")]);
    assert.match(narrow.stderr, /--max-text 10.*\b80\b/u);
    const inRange = run(["context", report, "--max-findings", "3", "--max-text", "200", "--out", join(dir, "d.json")]);
    assert.doesNotMatch(inRange.stderr, /--max-/u);
    const bundle = run(["bundle", report, "--out-dir", join(dir, "bundle"), "--max-findings", "500"]);
    assert.equal(bundle.status, 0, show(bundle));
    assert.match(bundle.stderr, /--max-findings 500.*\b100\b/u);
  });

  it("the help texts name every option, its range and the exit codes", () => {
    const main = run(["--help"]);
    assert.equal(main.status, 0);
    assert.match(main.stdout, /breaklint compare <before\.json> <after\.json> \[--out <file>\] \[--repository <dir>\] \[--fail-on-new\]/u);
    assert.match(main.stdout, /breaklint bundle <report\.json> --out-dir <dir> \[--evidence-dir <dir>\] \[--title <text>\] \[--theme light\|dark\] \[--comparison <file>\] \[--max-findings <n>\]/u);
    for (const sub of ["compare", "context", "bundle"]) {
      const help = run([sub, "--help"]);
      assert.equal(help.status, 0);
      assert.match(help.stdout, /exit codes/u, sub);
    }
    assert.match(run(["context", "--help"]).stdout, /1–100/u);
    assert.match(run(["context", "--help"]).stdout, /80–1200/u);
    assert.match(run(["bundle", "--help"]).stdout, /1–100/u);
    assert.match(run(["compare", "--help"]).stdout, /--repository <dir>/u);
    assert.match(run(["compare", "--help"]).stdout, /--fail-on-new/u);
  });
});
