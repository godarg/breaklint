/**
 * The public report API at its two remaining edges: what it writes into an output directory it
 * did not create (C2/C3), and how it reads a report that carries a readable schema stamp but not
 * the parts its projections consume (C1).
 *
 * `writeReportBundle()` is public. The CLI refuses a used `--out-dir`; the API does not, because
 * updating a bundle in place is a legitimate use. A file in that directory can be a hard link to a
 * file elsewhere, and opening it with O_TRUNC wrote through the link into that other file. The
 * oracle is the byte content of the outside file, which the bundle has no business changing.
 *
 * `renderReport()` and `createContextPack()` keep their legacy fallback: a value they cannot read
 * is marked "legacy or invalid", never thrown at and never shown as an empty clean-looking report.
 */

import assert from "node:assert/strict";
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { renderReport, writeReportBundle } from "../../src/api/bundle.ts";
import { createContextPack } from "../../src/api/context.ts";

const FIXTURES = fileURLToPath(new URL("../fixtures/reports/", import.meta.url));
const LEGACY = "legacy-or-invalid-report-cannot-establish-source-or-repair-claims";

function documentFixture(): Record<string, any> {
  return JSON.parse(readFileSync(join(FIXTURES, "report5-v0.10.0-demo.json"), "utf8")) as Record<string, any>;
}

let work = "";
before(() => { work = mkdtempSync(join(tmpdir(), "breaklint-api-boundary-")); });
after(() => { if (work) rmSync(work, { recursive: true, force: true }); });

describe("C2/C3: writeReportBundle() replaces its own files and never writes through a link", () => {
  it("a hard-linked file in a used bundle directory keeps the other name's bytes", () => {
    const dir = join(work, "hardlink");
    const outDir = join(dir, "bundle");
    mkdirSync(join(outDir, "assets"), { recursive: true });
    const outside = join(dir, "keep.json");
    const kept = "a file outside the bundle that must not change\n";
    writeFileSync(outside, kept);
    for (const name of ["report.json", "report.html", "context.json", "bundle.json"]) {
      linkSync(outside, join(outDir, name));
    }
    const result = writeReportBundle(documentFixture() as never, { outDir });
    assert.equal(readFileSync(outside, "utf8"), kept, "the bundle wrote through a hard link into a file outside it");
    assert.match(readFileSync(result.reportPath, "utf8"), /"profileKind": "document"/u, "the bundle's own report.json was not written");
    assert.match(readFileSync(result.htmlPath, "utf8"), /^<!doctype html>/u);
  });

  it("a symlink in place of a bundle file is refused, and its target is unchanged", () => {
    const dir = join(work, "symlink");
    const outDir = join(dir, "bundle");
    mkdirSync(outDir, { recursive: true });
    const outside = join(dir, "keep.json");
    writeFileSync(outside, "kept\n");
    symlinkSync(outside, join(outDir, "report.json"));
    assert.throws(() => writeReportBundle(documentFixture() as never, { outDir }));
    assert.equal(readFileSync(outside, "utf8"), "kept\n");
  });

  it("outDir through a symlinked directory and .. is the directory the file system resolves", () => {
    const dir = join(work, "dotdot");
    mkdirSync(join(dir, "elsewhere/inner"), { recursive: true });
    symlinkSync(join(dir, "elsewhere/inner"), join(dir, "link"));
    const result = writeReportBundle(documentFixture() as never, { outDir: `${dir}/link/../fresh` });
    assert.equal(existsSync(join(dir, "elsewhere/fresh/report.json")), true);
    assert.equal(existsSync(join(dir, "fresh")), false, "the bundle went to the lexically normalised directory");
    assert.equal(result.reportPath, join(realpathSync.native(join(dir, "elsewhere")), "fresh/report.json"), "the result names the directory written");
    // Without a `..` after a symlink the result keeps the caller's spelling.
    const plain = writeReportBundle(documentFixture() as never, { outDir: join(dir, "plain") });
    assert.equal(plain.outDir, join(dir, "plain"));
  });
});

describe("C1: a stamped report without the parts a projection reads is legacy or invalid", () => {
  const stamped: [string, Record<string, unknown>][] = [
    ["no documents", { schemaVersion: 5, profileKind: "document", runId: "r", findings: [] }],
    ["no verdict", { schemaVersion: 5, profileKind: "document", runId: "r", findings: [], documents: [] }],
    ["document without coverage", { schemaVersion: 5, profileKind: "document", runId: "r", runVerdict: "clean", exitCode: 0, findings: [], documents: [{ path: "a.html", findings: [], evaluations: [], infrastructure: [], notMeasured: [] }] }],
  ];
  for (const [name, report] of stamped) {
    it(`createContextPack() and renderReport() mark it instead of projecting or throwing (${name})`, () => {
      assert.equal(createContextPack(report).selection.reason, LEGACY);
      assert.match(renderReport(report), /Legacy or invalid report/u);
    });
  }

  it("a damaged coverage decline list ([null]) is legacy or invalid, not a TypeError", () => {
    const report = documentFixture();
    const first = Object.keys(report.documents[0].coverage)[0]!;
    report.documents[0].coverage[first].notMeasured = [null];
    report.documents[0].coverage[first].notMeasuredCount = 1;
    assert.equal(createContextPack(report).selection.reason, LEGACY);
    assert.match(renderReport(report), /Legacy or invalid report/u);
  });

  it("a complete real report is still projected", () => {
    assert.notEqual(createContextPack(documentFixture()).selection.reason, LEGACY);
    assert.doesNotMatch(renderReport(documentFixture()), /Legacy or invalid report/u);
  });
});
