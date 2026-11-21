import assert from "node:assert/strict";
import { it } from "node:test";
import { RULES_BY_ID } from "../../src/rules/index.ts";
import { loadCorpus } from "../fixtures/corpus.ts";
import { runDocument } from "../../src/core/engine.ts";

// Independent, hand-authored truth: a two-column table has its existing header on page 1,
// and two data rows on page 2. These facts are not produced by the rules under test.
const header = "layout/table-header-not-repeated";
const alignment = "layout/table-column-drift";
function sample(repeated = false, drift = 0) {
  const snapshot = structuredClone(loadCorpus()[0]!.snapshot);
  const page = snapshot.pages[0]!;
  snapshot.pages = [{ ...page, pageNumber: 1, isLast: false }, { ...page, nodeKey: "p2", pageNumber: 2, isLast: true }];
  const block = snapshot.blocks[0]!;
  snapshot.blocks = [1, 2].map(n => ({ ...block, tag: "table", sid: "s-table", nodeKey: `t${n}`, page: n,
    authorId: "ledger", blockSignature: "Name Value Alpha 1 Beta 2", fragmentIndex: n - 1, fragmentCount: 2 }));
  const cells = (sid: string, words: string[], shift = 0) => words.map((text, i) => ({ sid: `${sid}-${i}`, tag: sid === "head" ? "th" : "td", text,
    box: { x: 48 + i * 180 + (i ? shift : 0), y: 48, width: 180 - (i ? shift : 0), height: 24 }, visible: true, colSpan: 1, rowSpan: 1 }));
  const h = { sid: "head", cells: cells("head", ["Name", "Value"]) };
  const a = { sid: "row-a", cells: cells("row-a", ["Alpha", "1"]) };
  const b = { sid: "row-b", cells: cells("row-b", ["Beta", "2"], drift) };
  snapshot.tableIndex = { complete: true, tables: [{ sid: "s-table", rows: structuredClone([h, a, b]), headerRowSids: ["head"],
    fragments: [{ page: 1, flowReason: null, box: { x: 48, y: 48, width: 360, height: 48 }, rows: structuredClone([h, a]), visible: true },
      { page: 2, flowReason: null, box: { x: 48, y: 48, width: 360, height: 48 }, rows: structuredClone(repeated ? [h, b] : [b]), visible: true }] }] };
  return snapshot;
}
function judge(id: string, snapshot = sample()) {
  const rule = RULES_BY_ID.get(id);
  assert.ok(rule, `missing table continuation check ${id}`);
  return runDocument({ path: "table.html", snapshot, infrastructure: [] }, { activeRules: [rule], optionsByRule: {}, coverageFloors: {}, failOn: "warn" }).report;
}
it("reports a missing existing header on the actual continuation fragment", () => {
  const report = judge(header);
  assert.equal(report.findings.length, 1); assert.equal(report.findings[0]!.page, 2);
  assert.equal(report.coverage[header]!.measured, 2);
});
it("identifies a header-only first fragment without inventing the pagination cause", () => {
  const snapshot = sample();
  const table = snapshot.tableIndex!.tables[0]!;
  const firstData = table.fragments[0]!.rows.pop()!;
  table.fragments[1]!.rows.unshift(firstData);
  const report = judge(header, snapshot);
  assert.equal(report.findings.length, 1);
  assert.match(report.findings[0]!.message, /first fragment on page 1 contains only the header/u);
  assert.match(report.findings[0]!.message, /first data row appears on page 2/u);
  assert.match(report.findings[0]!.message, /cause and author intent are unknown/u);
  // Negative control: a header with its first data row is not a stranded header.
  assert.doesNotMatch(judge(header).findings[0]!.message, /contains only the header/u);
});
it("accounts for a missing rendered table and declines measured ancestor column flow", () => {
  const missing = sample(); missing.tableIndex!.tables[0]!.fragments = [];
  const report = judge(header, missing);
  assert.equal(report.coverage[header]!.candidates, 1); assert.equal(report.coverage[header]!.measured, 0);
  assert.equal(report.verdict, "insufficient-coverage");
  const columns = sample(); columns.tableIndex!.tables[0]!.fragments[1]!.flowReason = "env/multicolumn";
  const declined = judge(header, columns);
  assert.deepEqual(declined.findings, []); assert.equal(declined.notMeasured[0]!.reason, "env/multicolumn");
});
it("respects a visible repeated header and does not replace it with table wrapper geometry", () => {
  assert.equal(judge(header, sample(true)).findings.length, 0);
  const snapshot = sample(true);
  const table = snapshot.tableIndex!.tables[0]!;
  table.fragments[1]!.rows[0]!.cells.forEach(cell => { cell.visible = false; });
  assert.equal(judge(header, snapshot).findings.length, 1);
});
it("checks column tracks against the first visible header and reports measured displacement", () => {
  assert.equal(judge(alignment, sample(false, 32)).findings.length, 1);
  assert.equal(judge(alignment).findings.length, 0);
});
it("declines changed source content and spanning cells, and declines legacy snapshots explicitly", () => {
  for (const change of ["text", "span", "legacy"]) {
    const snapshot = sample();
    if (change === "legacy") delete snapshot.tableIndex;
    else if (change === "text") snapshot.tableIndex!.tables[0]!.fragments[1]!.rows[0]!.cells[0]!.text = "Changed";
    else snapshot.tableIndex!.tables[0]!.fragments[1]!.rows[0]!.cells[0]!.colSpan = 2;
    const report = judge(header, snapshot);
    assert.equal(report.findings.length, 0); assert.equal(report.verdict, "insufficient-coverage");
  }
});

// P2 (CDX-12): a grouped header [2,2] over data rows [1,1,1,1]. Hand-authored geometry: four
// 90 px columns from x=48; the header cells span two columns each.
function grouped(opts: { headerOnlyLead?: boolean; innerShift?: number; outerShift?: number } = {}) {
  const snapshot = structuredClone(loadCorpus()[0]!.snapshot);
  const page = snapshot.pages[0]!;
  snapshot.pages = [{ ...page, pageNumber: 1, isLast: false }, { ...page, nodeKey: "p2", pageNumber: 2, isLast: true }];
  const block = snapshot.blocks[0]!;
  snapshot.blocks = [1, 2].map(n => ({ ...block, tag: "table", sid: "s-grp", nodeKey: `g${n}`, page: n,
    authorId: "grouped", blockSignature: "Q1 Q2 a b c d", fragmentIndex: n - 1, fragmentCount: 2 }));
  const head = { sid: "head", cells: ["Q1", "Q2"].map((text, i) => ({ sid: `head-${i}`, tag: "th", text,
    box: { x: 48 + i * 180, y: 48, width: 180, height: 24 }, visible: true, colSpan: 2, rowSpan: 1 })) };
  const data = (sid: string, inner = 0, outer = 0) => ({ sid, cells: ["a", "b", "c", "d"].map((text, i) => {
    // inner shift moves the boundary between columns 0|1 (inside the first header group);
    // outer shift moves the boundary between columns 1|2 (a coarse header edge).
    let x = 48 + i * 90; let width = 90;
    if (i === 0) width += inner; if (i === 1) { x += inner; width -= inner; width += outer; } if (i === 2) { x += outer; width -= outer; }
    return { sid: `${sid}-${i}`, tag: "td", text: `${text}`, box: { x, y: 72, width, height: 24 }, visible: true, colSpan: 1, rowSpan: 1 };
  }) });
  const a = data("row-a"); const b = data("row-b", opts.innerShift ?? 0, opts.outerShift ?? 0);
  const lead = opts.headerOnlyLead ? [head] : [head, a];
  const cont = opts.headerOnlyLead ? [a, b] : [b];
  if (opts.headerOnlyLead) cont[0] = data("row-a", opts.innerShift ?? 0, opts.outerShift ?? 0);
  snapshot.tableIndex = { complete: true, tables: [{ sid: "s-grp", rows: structuredClone([head, a, b]), headerRowSids: ["head"],
    fragments: [{ page: 1, flowReason: null, box: { x: 48, y: 48, width: 360, height: 48 }, rows: structuredClone(lead), visible: true },
      { page: 2, flowReason: null, box: { x: 48, y: 48, width: 360, height: 48 }, rows: structuredClone(cont), visible: true }] }] };
  return snapshot;
}
it("measures column drift under a grouped [2,2] header over [1,1,1,1] data rows (P2)", () => {
  const aligned = judge(alignment, grouped());
  assert.equal(aligned.coverage[alignment]!.measured, 2);
  assert.deepEqual(aligned.findings, []);
  assert.equal(aligned.verdict, "clean");
  // Real continuation displacement of an inner edge (only observable from page-1 data rows).
  const inner = judge(alignment, grouped({ innerShift: 25 }));
  assert.equal(inner.findings.length, 1);
  assert.equal(inner.findings[0]!.page, 2);
  assert.equal(inner.findings[0]!.measurement.value, 25);
  // A coarse header edge displacement is measured against the observed header edge.
  const outer = judge(alignment, grouped({ outerShift: 12 }));
  assert.equal(outer.findings.length, 1);
  assert.equal(outer.findings[0]!.measurement.value, 12);
  // The header rule measured this table already and still does.
  assert.equal(judge(header, grouped()).coverage[header]!.measured, 2);
});
it("reports missing reference edges as coverage when the grouped header stands alone on page 1 (P2)", () => {
  const report = judge(alignment, grouped({ headerOnlyLead: true, innerShift: 25 }));
  // Inner edges 0|1 and 2|3 have no observation on the first fragment: never invented, never clean.
  assert.deepEqual(report.findings, []);
  assert.equal(report.verdict, "insufficient-coverage");
  assert.ok(report.notMeasured.some(n => n.reason === "env/table-structure-unsupported"));
});
it("keeps measuring the observed header edges when inner reference edges are missing (P2)", () => {
  // Header [2,2] alone on page 1, rows [1,1,1,1] on page 2: the coarse edges 0|, 1|2 and |3 are
  // observed on the first fragment; the inner edges 0|1 and 2|3 are not. A real displacement of
  // an observed edge is a finding; the edges without a reference are declined, one each.
  const report = judge(alignment, grouped({ headerOnlyLead: true, outerShift: 12 }));
  assert.equal(report.findings.length, 1, "a displaced observed header edge must be measured");
  assert.equal(report.findings[0]!.page, 2);
  assert.equal(report.findings[0]!.measurement.value, 12);
  const coverage = report.coverage[alignment]!;
  assert.equal(coverage.measured, 2, "both fragments are measured against the observed edges");
  const declined = coverage.notMeasured.filter(n => n.reason === "env/table-structure-unsupported");
  assert.equal(declined.reduce((sum, n) => sum + n.count, 0), 4, "each continued edge without a reference is declined");
  assert.ok(declined.every(n => /reference edge/u.test(n.detail ?? "")), "the decline names the missing reference edge");
  assert.equal(coverage.candidates, 6);
  // Without displacement nothing is invented: no finding, and the gap stays visible.
  const aligned = judge(alignment, grouped({ headerOnlyLead: true }));
  assert.deepEqual(aligned.findings, []);
  assert.equal(aligned.coverage[alignment]!.measured, 2);
  assert.equal(aligned.coverage[alignment]!.notMeasuredCount, 4);
});
it("keeps declining irregular grids for column drift while caption-separated measures them (P2/P1)", () => {
  const snapshot = grouped();
  const table = snapshot.tableIndex!.tables[0]!;
  table.rows[2]!.cells.pop(); table.fragments[1]!.rows[0]!.cells.pop();
  const report = judge(alignment, snapshot);
  assert.deepEqual(report.findings, []);
  assert.equal(report.verdict, "insufficient-coverage");
});
it("declines rowspan in thead with its machine code and an observed sub-cause (P5/P11)", () => {
  // <tr><th rowspan=2>Name</th><th colspan=2>Q1</th></tr><tr><th>a</th><th>b</th></tr>: the usual
  // grouped header with a rowspan. It stays declined; the decline now says why.
  const snapshot = sample();
  const table = snapshot.tableIndex!.tables[0]!;
  const spanned = (rows: typeof table.rows) => { rows[0]!.cells[0]!.rowSpan = 2; };
  spanned(table.rows);
  for (const fragment of table.fragments) for (const row of fragment.rows) if (row.sid === "head") row.cells[0]!.rowSpan = 2;
  for (const id of [header, alignment]) {
    const report = judge(id, snapshot);
    assert.equal(report.verdict, "insufficient-coverage");
    const declines = report.notMeasured.filter(n => n.ruleId === id);
    assert.ok(declines.length > 0);
    for (const decline of declines) {
      assert.equal(decline.reason, "env/table-structure-unsupported");
      assert.equal(decline.detail, "rowSpan > 1 in thead");
    }
  }
  // A data-row rowspan names a different observed condition; an irregular grid another one.
  const dataSpan = sample(); dataSpan.tableIndex!.tables[0]!.rows[1]!.cells[0]!.rowSpan = 2;
  for (const f of dataSpan.tableIndex!.tables[0]!.fragments) for (const row of f.rows) if (row.sid === "row-a") row.cells[0]!.rowSpan = 2;
  assert.equal(judge(header, dataSpan).notMeasured[0]!.detail, "rowSpan > 1 in a data row");
  const ragged = sample(); const rt = ragged.tableIndex!.tables[0]!;
  rt.rows[2]!.cells.pop(); rt.fragments[1]!.rows[0]!.cells.pop();
  assert.equal(judge(alignment, ragged).notMeasured[0]!.detail, "rows have unequal column counts (no regular column grid)");
});
