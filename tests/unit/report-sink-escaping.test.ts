/**
 * The bundle view escapes every report value where it is written into HTML.
 *
 * `renderReport()` and `writeReportBundle()` are public and accept a report from anywhere: a CI
 * artifact of another repository, a file someone edited. The TypeScript types say `page` and a
 * source line are numbers, but nothing at runtime made them so, and both were interpolated into
 * the HTML unescaped. A string there became markup in the reader's view. The CSP blocks scripts;
 * it does not stop injected elements, links or text that look like breaklint's own statements.
 *
 * The oracle is the final HTML of BOTH paths, built from a real report (the v0.10.0 demo and the
 * 0.11.1 screen fixture, tests/fixtures/reports/) with foreign values nested where numbers belong.
 * A value that is not a finite number is shown as "unavailable"; text is escaped; no element the
 * input carried may exist in the output.
 */

import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { renderReport, writeReportBundle } from "../../src/api/bundle.ts";

const FIXTURES = fileURLToPath(new URL("../fixtures/reports/", import.meta.url));
const INJECTED = /<[a-z]+ data-inject|data-inject="[^"]*"\s*>/u;

const tag = (name: string) => `"><b data-inject="${name}">${name}</b><x y="`;

function documentReport(): Record<string, any> {
  const report = JSON.parse(readFileSync(join(FIXTURES, "report5-v0.10.0-demo.json"), "utf8")) as Record<string, any>;
  const poison = (finding: Record<string, any>, index: number) => {
    finding.page = tag(`page-${index}`);
    finding.source = { file: "chapter.html", line: tag("source-line"), column: tag("source-column"), offset: 0, endLine: 1, endColumn: 1, endOffset: 1, coordinateSystem: "utf8-bytes-unicode-codepoints-v1" };
    finding.originalSource = {
      status: "verified",
      role: index % 2 === 0 ? "exact-original-range" : "verified-container-only",
      location: { file: "chapter.html", line: tag("line"), column: tag("column"), offset: tag("offset"), endLine: tag("end-line"), endColumn: tag("end-column"), endOffset: tag("end-offset"), coordinateSystem: tag("coordinates") },
      integrity: { sha256: tag("sha"), byteLength: tag("byte-length"), role: "authoring" },
      candidates: [],
    };
    finding.measurement.value = tag("value");
    finding.measurement.threshold = tag("threshold");
    finding.target.nodeKey = tag("node-key");
    finding.message = tag("message");
  };
  report.findings.forEach(poison);
  report.documents[0].findings.forEach(poison);
  report.runId = tag("run-id");
  return report;
}

function screenReport(): Record<string, any> {
  const report = JSON.parse(readFileSync(join(FIXTURES, "screen2-v0.11.1-overflow.json"), "utf8")) as Record<string, any>;
  report.targetInventory.omittedCount = tag("inventory-omitted");
  report.targetInventory.complete = false;
  report.coverage.notMeasured = tag("coverage-not-measured");
  report.scope.viewport.width = tag("viewport-width");
  report.scope.viewport.deviceScaleFactor = tag("scale");
  report.artifact.widthPx = tag("width-px");
  for (const finding of report.findings) {
    finding.target.box.x = tag("box-x");
    finding.target.scroll.y = tag("scroll-y");
    finding.measurement.value = tag("screen-value");
    finding.target.selector = tag("selector");
  }
  return report;
}

function bundleHtml(report: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "breaklint-sink-"));
  try {
    const result = writeReportBundle(report as never, { outDir: join(dir, "bundle") });
    return readFileSync(result.htmlPath, "utf8");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("C6: report values are escaped where the bundle view writes them", () => {
  for (const [name, build] of [["document report", documentReport], ["screen report", screenReport]] as const) {
    it(`renderReport(): no element from a nested foreign value survives (${name})`, () => {
      const html = renderReport(build());
      assert.doesNotMatch(html, INJECTED);
    });

    it(`writeReportBundle(): no element from a nested foreign value survives (${name})`, () => {
      const html = bundleHtml(build());
      assert.doesNotMatch(html, INJECTED);
    });
  }

  it("a value that is not a finite number is shown as unavailable, a finite one as itself", () => {
    const report = JSON.parse(readFileSync(join(FIXTURES, "report5-v0.10.0-demo.json"), "utf8")) as Record<string, any>;
    const page = report.findings[0].page as number;
    report.findings[1].page = "7; drop";
    report.documents[0].findings[1].page = "7; drop";
    for (const html of [renderReport(report), bundleHtml(report)]) {
      assert.match(html, new RegExp(`diagnostic page ${page}\\b`, "u"));
      assert.doesNotMatch(html, /7; drop/u);
      assert.match(html, /diagnostic page unavailable/u);
    }
  });

  it("title and theme options are escaped in text and attribute position", () => {
    const report = JSON.parse(readFileSync(join(FIXTURES, "report5-v0.10.0-demo.json"), "utf8"));
    const html = renderReport(report, { title: tag("title"), theme: tag("theme") as never });
    assert.doesNotMatch(html, INJECTED);
  });

  it("writeReportBundle() refuses a non-object before it creates the output directory", () => {
    const dir = mkdtempSync(join(tmpdir(), "breaklint-sink-null-"));
    try {
      for (const value of [null, "report", 42, []]) {
        const outDir = join(dir, `out-${String(value)}`);
        assert.throws(() => writeReportBundle(value as never, { outDir }));
        assert.equal(existsSync(outDir), false, `${JSON.stringify(value)} left ${outDir} behind`);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
