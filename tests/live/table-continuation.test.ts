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

it("measures tables with regular full-width colspan separators and declines irregular colspan rows", async () => {
  const root = mkdtempSync(join(tmpdir(), "breaklint-table-colspan-live-"));
  try {
    const rows = Array.from({ length: 22 }, (_, i) =>
      i === 0 || i === 11
        ? `<tr><td colspan="3"><strong>Section ${i === 0 ? "A" : "B"}</strong></td></tr>`
        : `<tr><td>Row ${i}</td><td>${i * 10}</td><td>OK</td></tr>`,
    ).join("\n");
    const regularHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Regular Colspan</title>
<style>@page { size: 120mm 135mm; margin: 10mm; } body { font: 13px/1.4 serif; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; }
th, td { border: 1px solid #333; padding: 5px; }</style></head>
<body><h1>Regular Colspan Table</h1>
<table><thead><tr><th colspan="2">Identity</th><th>Status</th></tr><tr><th>Name</th><th>Metric</th><th>Flag</th></tr></thead>
<tbody>${rows}</tbody></table></body></html>`;
    const regularPath = join(root, "regular.html");
    writeFileSync(regularPath, regularHtml);
    const rendered = await renderDocuments([regularPath], {
      outDir: root, evidenceBinding: true, sourceMapInjection: true, locale: "en-US", network: { mode: "offline", allowed: [] },
    });
    assert.equal(rendered.fatal, null);
    const input = rendered.documents[0]!;
    assert.ok(input.snapshot);
    const report = runDocument(input, { activeRules: [tableHeaderNotRepeated, tableColumnDrift], optionsByRule: {}, coverageFloors: {}, failOn: "warn" }).report;
    assert.equal(report.coverage[tableHeaderNotRepeated.id]!.notMeasuredCount, 0, JSON.stringify(report.notMeasured));
    assert.ok(report.coverage[tableHeaderNotRepeated.id]!.measured >= 2);
    assert.equal(report.coverage[tableColumnDrift.id]!.notMeasuredCount, 0, JSON.stringify(report.notMeasured));
    assert.equal(report.findings.filter(f => f.ruleId === tableColumnDrift.id).length, 0);

    const irregularHtml = regularHtml.replace('<tr><td colspan="3"><strong>Section A</strong></td></tr>', '<tr><td colspan="2">Irregular</td></tr>');
    const irregularPath = join(root, "irregular.html");
    writeFileSync(irregularPath, irregularHtml);
    const irrRendered = await renderDocuments([irregularPath], {
      outDir: root, evidenceBinding: true, sourceMapInjection: true, locale: "en-US", network: { mode: "offline", allowed: [] },
    });
    assert.equal(irrRendered.fatal, null);
    const irrReport = runDocument(irrRendered.documents[0]!, { activeRules: [tableHeaderNotRepeated, tableColumnDrift], optionsByRule: {}, coverageFloors: {}, failOn: "warn" }).report;
    assert.equal(irrReport.verdict, "insufficient-coverage");
    assert.ok(irrReport.notMeasured.some(n => n.reason === "env/table-structure-unsupported"));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
it("measures a grouped [2,2] header over four data columns and a ragged figure table (P1/P2)", async () => {
  const root = mkdtempSync(join(tmpdir(), "breaklint-table-grouped-live-"));
  try {
    const rows = Array.from({ length: 30 }, (_, i) => `<tr><td>R${i}</td><td>${i * 3}</td><td>${i * 7}</td><td>ok</td></tr>`).join("\n");
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Grouped header</title>
<style>@page { size: 120mm 135mm; margin: 10mm; } body { font: 13px/1.4 serif; }
table { width: 100%; border-collapse: collapse; table-layout: fixed; } th, td { border: 1px solid #333; padding: 5px; }</style></head>
<body><h1>Grouped header</h1><table><thead><tr><th colspan="2">First pair</th><th colspan="2">Second pair</th></tr></thead>
<tbody>${rows}</tbody></table>
<figure><table><tbody><tr><td>Item</td><td>Count</td><td>Note</td></tr><tr><td>Alpha</td><td>3</td><td>fine</td></tr>
<tr><td>Total</td><td>3</td></tr></tbody></table><figcaption>Table 2. Ragged sum row.</figcaption></figure></body></html>`;
    const path = join(root, "grouped.html"); writeFileSync(path, html);
    const rendered = await renderDocuments([path], {
      outDir: root, evidenceBinding: true, sourceMapInjection: true, locale: "en-US", network: { mode: "offline", allowed: [] },
    });
    assert.equal(rendered.fatal, null);
    const input = rendered.documents[0]!;
    assert.ok(input.snapshot, JSON.stringify(input.infrastructure));
    const report = runDocument(input, { activeRules: [tableColumnDrift, captionSeparated], optionsByRule: {}, coverageFloors: {}, failOn: "warn" }).report;
    const grouped = input.snapshot.tableIndex!.tables[0]!;
    assert.ok(grouped.fragments.filter(f => f.visible).length >= 2, "the grouped table must continue onto a later page");
    const ragged = input.snapshot.tableIndex!.tables[1]!;
    const driftEvaluations = report.evaluations.filter(e => e.ruleId === tableColumnDrift.id);
    const groupedEvaluations = driftEvaluations.filter(e => e.targetRef?.sid === grouped.sid);
    assert.ok(groupedEvaluations.length >= 2);
    assert.ok(groupedEvaluations.every(e => e.status === "measured"), JSON.stringify(report.notMeasured));
    // The ragged figure table has no column grid: column drift still declines it explicitly.
    const raggedDrift = driftEvaluations.filter(e => e.targetRef?.sid === ragged.sid);
    assert.ok(raggedDrift.length >= 1 && raggedDrift.every(e => e.status === "not-measured"));
    assert.equal(report.findings.filter(f => f.ruleId === tableColumnDrift.id).length, 0);
    assert.equal(report.coverage[captionSeparated.id]!.notMeasuredCount, 0, JSON.stringify(report.notMeasured));
    assert.equal(report.coverage[captionSeparated.id]!.measured, 1);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
});
