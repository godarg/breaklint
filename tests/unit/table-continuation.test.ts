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
