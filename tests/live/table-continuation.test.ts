import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { renderDocuments } from "../../src/acquire/render-run.ts";
import { runDocument } from "../../src/core/engine.ts";
import { tableHeaderNotRepeated, tableColumnDrift } from "../../src/rules/layout/table-continuation.ts";
import { captionSeparated } from "../../src/rules/figure/caption-separated.ts";
import { coverageFloorMap, resolveConfig } from "../../src/config/resolve.ts";

describe("source-bound table checks, live", () => {
it("keeps unsupported span attributes out of optional inventory without losing default checks", async () => {
  // Independent HTML truth: rowspan=0 grows to the end of its row group, rather than one row.
  // The present inventory only represents positive integer spans; malformed values also decline.
  const variants = [
    { name: "row-group-span", attributes: 'rowspan="0"', supported: false },
    { name: "malformed-span", attributes: 'colspan="0" rowspan="2px"', supported: false },
    { name: "unit-span-control", attributes: 'colspan="1" rowspan="1"', supported: true },
  ];
  for (const variant of variants) {
    const root = mkdtempSync(join(tmpdir(), "breaklint-table-span-live-"));
    try {
      const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Span control</title>
<style>@page { size: 120mm 140mm; margin: 10mm; } body { font: 14px/1.5 serif; }
table { border-collapse: collapse; } th, td { border: 1px solid black; padding: 6px; }</style>
<body><h1>Span control</h1><table><thead><tr><th>Label</th><th>Value</th></tr></thead><tbody>
<tr><td ${variant.attributes}>Quartz</td><td>11</td></tr><tr><td>Maple</td><td>22</td></tr>
</tbody></table><p>End of control.</p></body></html>`;
      const path = join(root, "input.html"); writeFileSync(path, html);
      const rendered = await renderDocuments([path], {
        outDir: root, evidenceBinding: true, sourceMapInjection: true, locale: "en-US", network: { mode: "offline", allowed: [] },
      });
      assert.equal(rendered.fatal, null, variant.name);
      const input = rendered.documents[0]!;
      assert.ok(input.snapshot, JSON.stringify(input.infrastructure));
      const pdf = readdirSync(root).find(name => name.endsWith("-checked.pdf")); assert.ok(pdf);
      const text = spawnSync("pdftotext", ["-layout", join(root, pdf), "-"], { encoding: "utf8" });
      assert.equal(text.status, 0, text.stderr);
      for (const label of ["Quartz", "Maple"]) assert.equal((text.stdout.match(new RegExp(`\\b${label}\\b`, "gu")) ?? []).length, 1);
      const config = resolveConfig({ file: {}, cli: {} });
      const report = runDocument(input, { activeRules: config.activeRules, optionsByRule: config.optionsByRule,
        coverageFloors: coverageFloorMap(config), failOn: config.failOn }).report;
      assert.notEqual(report.exitReason, "checker-crashed", variant.name);
      assert.equal(Object.keys(report.coverage).length, 12, variant.name);
      const tables = runDocument(input, { activeRules: [tableHeaderNotRepeated, tableColumnDrift], optionsByRule: {}, coverageFloors: {}, failOn: "warn" }).report;
      if (variant.supported) {
        assert.equal(input.snapshot.tableIndex?.complete, true);
        assert.equal(tables.coverage[tableHeaderNotRepeated.id]!.measured, 1);
        assert.equal(tables.findings.length, 0);
      } else {
        assert.equal(input.snapshot.tableIndex, undefined);
        assert.equal(tables.verdict, "insufficient-coverage");
        assert.equal(tables.notMeasured[0]!.reason, "env/table-index-unavailable");
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
});
it("collects actual continued cells and independently witnesses missing heads in the delivered PDF", async () => {
  const root = mkdtempSync(join(tmpdir(), "breaklint-table-live-"));
  try {
    const rendered = await renderDocuments([fileURLToPath(new URL("../fixtures/table-continuation.html", import.meta.url))], {
      outDir: root, evidenceBinding: true, sourceMapInjection: true, locale: "en-US", network: { mode: "offline", allowed: [] },
    });
    assert.equal(rendered.fatal, null);
    const input = rendered.documents[0]!;
    assert.ok(input.snapshot, JSON.stringify(input.infrastructure));
    assert.equal(input.snapshot.schemaVersion, 7);
    const pdf = readdirSync(root).find(name => name.endsWith("-checked.pdf"));
    assert.ok(pdf);
    const text = spawnSync("pdftotext", ["-layout", join(root, pdf), "-"], { encoding: "utf8" });
    assert.equal(text.status, 0, text.stderr);
    const pages = text.stdout.split("\f").filter(page => page.trim().length > 0);
    assert.ok(pages.length > 1);
    assert.equal((text.stdout.match(/Station label/gu) ?? []).length, 1, "independent PDF oracle sees the original header once");
    assert.equal((text.stdout.match(/\bAlpha\b/gu) ?? []).length, 1);
    assert.equal((text.stdout.match(/\bUpsilon\b/gu) ?? []).length, 1);
    const report = runDocument(input, { activeRules: [tableHeaderNotRepeated, tableColumnDrift], optionsByRule: {}, coverageFloors: {}, failOn: "warn" }).report;
    assert.equal(report.coverage[tableHeaderNotRepeated.id]!.notMeasuredCount, 0, JSON.stringify(report.notMeasured));
    const missingPages = pages.flatMap((text, at) => at > 0 && !text.includes("Station label") ? [at + 1] : []);
    assert.deepEqual(report.findings.filter(f => f.ruleId === tableHeaderNotRepeated.id).map(f => f.page), missingPages);
    assert.equal(report.findings.filter(f => f.ruleId === tableColumnDrift.id).length, 0, "authored fixed tracks remain aligned");
    for (const finding of report.findings) assert.equal(finding.evidence.bindsFinding, true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("witnesses the last table row and separated caption independently in PDF text", async () => {
  const root = mkdtempSync(join(tmpdir(), "breaklint-table-caption-live-"));
  try {
    const original = readFileSync(new URL("../fixtures/table-continuation.html", import.meta.url), "utf8");
    const html = original.replace("</style>", "figure { margin: 0; } figcaption { break-before: page; }</style>")
      .replace('<table id="readings">', '<figure><table id="readings">')
      .replace("</tbody></table>", "</tbody></table><figcaption>Table 1: Station summary</figcaption></figure>");
    const path = join(root, "input.html"); writeFileSync(path, html);
    const rendered = await renderDocuments([path], {
      outDir: root, evidenceBinding: true, sourceMapInjection: true, locale: "en-US", network: { mode: "offline", allowed: [] },
    });
    assert.equal(rendered.fatal, null);
    const input = rendered.documents[0]!;
    assert.ok(input.snapshot, JSON.stringify(input.infrastructure));
    const pdf = readdirSync(root).find(name => name.endsWith("-checked.pdf")); assert.ok(pdf);
    const text = spawnSync("pdftotext", ["-layout", join(root, pdf), "-"], { encoding: "utf8" });
    assert.equal(text.status, 0, text.stderr);
    const pages = text.stdout.split("\f").filter(page => page.trim());
    const lastRowPage = pages.findIndex(page => page.includes("Upsilon")) + 1;
    const captionPage = pages.findIndex(page => page.includes("Table 1: Station summary")) + 1;
    assert.ok(lastRowPage > 1, "the authored table really spans multiple pages");
    assert.ok(captionPage > lastRowPage, "the PDF independently places the caption after the last body row");
    assert.equal((text.stdout.match(/\bUpsilon\b/gu) ?? []).length, 1);
    const report = runDocument(input, { activeRules: [captionSeparated], optionsByRule: {}, coverageFloors: {}, failOn: "warn" }).report;
    assert.equal(report.coverage[captionSeparated.id]!.measured, 1, JSON.stringify(report.notMeasured));
    assert.equal(report.findings.length, 1);
    assert.deepEqual(report.evaluations[0]!.measurements.slice(0, 2).map(m => m.value), [lastRowPage, captionPage]);
    assert.equal(report.findings[0]!.evidence.bindsFinding, true);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
});
