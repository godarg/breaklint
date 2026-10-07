import assert from "node:assert/strict";
import { it } from "node:test";
import { loadCorpus } from "../fixtures/corpus.ts";
import { buildSourceModel } from "../../src/measure/snapshot.ts";
import { injectSourceIds } from "../../src/source/inject.ts";
import { runDocument } from "../../src/core/engine.ts";
import { captionSeparated } from "../../src/rules/figure/caption-separated.ts";

function sample(captionPage: number, order: "before" | "after" = "after") {
  const snapshot = structuredClone(loadCorpus().find(entry => entry.name === "caption-separated-trigger")!.snapshot);
  const p = snapshot.pages[0]!;
  snapshot.pages = [1, 2, 3].map(n => ({ ...p, pageNumber: n, nodeKey: `p${n}`, isLast: n === 3 }));
  snapshot.blocks[0]!.page = captionPage;
  const figure = snapshot.figureIndex!.figures[0]!;
  figure.captionPosition = order;
  figure.body = { tag: "table", tableSid: "s-table", identity: "table:s-table" };
  // A deliberately misleading wrapper witness must not decide this case.
  figure.bodyFragments = [{ page: captionPage, box: { x: 48, y: 48, width: 200, height: 100 }, visible: true, identity: "table:s-table" }];
  const row = (n: number) => ({ sid: `r${n}`, cells: [{ sid: `c${n}`, tag: "td", text: `Row ${n}`, colSpan: 1, rowSpan: 1 }] });
  snapshot.tableIndex = { complete: true, tables: [{ sid: "s-table", headerRowSids: [], rows: [row(1), row(2)],
    fragments: [1, 2].map(n => ({ page: n, flowReason: null, visible: true,
      box: { x: -100, y: -100, width: 1000, height: 1000 },
      rows: [{ ...row(n), cells: row(n).cells.map(cell => ({ ...cell, box: { x: 48, y: 48, width: 120, height: 24 }, visible: true })) }] })) }] };
  return snapshot;
}
function judge(snapshot = sample(2)) {
  return runDocument({ path: "table-caption.html", snapshot, infrastructure: [] }, {
    activeRules: [captionSeparated], optionsByRule: {}, coverageFloors: {}, failOn: "warn",
  }).report;
}
it("uses source order and concrete first/last table cells instead of figure or table wrapper boxes", () => {
  assert.equal(judge(sample(2)).coverage[captionSeparated.id]!.measured, 1);
  assert.deepEqual(judge(sample(2)).findings, []);
  assert.deepEqual(judge(sample(1, "before")).findings, []);
  for (const [captionPage, order, bodyPage] of [[3, "after", 2], [2, "before", 1]] as const) {
    const report = judge(sample(captionPage, order));
    assert.equal(report.findings.length, 1);
    assert.deepEqual(report.evaluations[0]!.measurements.slice(0, 2).map(m => m.value), [bodyPage, captionPage]);
  }
});
it("declines missing order, incomplete membership, spanned cells and invisible body fragments", () => {
  for (const change of ["order", "changed", "missing", "span", "hidden", "columns"]) {
    const snapshot = sample(3); const table = snapshot.tableIndex!.tables[0]!;
    if (change === "order") delete snapshot.figureIndex!.figures[0]!.captionPosition;
    if (change === "changed") table.fragments[1]!.rows[0]!.cells[0]!.text = "Altered";
    if (change === "missing") table.fragments[1]!.rows = [];
    if (change === "span") table.fragments[1]!.rows[0]!.cells[0]!.colSpan = 2;
    if (change === "hidden") table.fragments[1]!.rows[0]!.cells[0]!.visible = false;
    if (change === "columns") table.fragments[1]!.flowReason = "env/multicolumn";
    const report = judge(snapshot);
    assert.deepEqual(report.findings, [], change);
    assert.equal(report.coverage[captionSeparated.id]!.measured, 0, change);
    assert.equal(report.verdict, "insufficient-coverage", change);
  }
});
it("records authored table and caption ordering without inferring design intent", () => {
  for (const order of ["before", "after"] as const) {
    const body = '<table><tr><td>Original independent fixture</td></tr></table>';
    const caption = '<figcaption>Table 1</figcaption>';
    const html = `<figure>${order === "before" ? caption + body : body + caption}</figure>`;
    const index = buildSourceModel(injectSourceIds(html, "table-caption.html").html, "table-caption.html").figureIndex;
    assert.equal(index.complete, true);
    assert.equal(index.figures[0]!.body!.tag, "table");
    assert.equal(index.figures[0]!.captionPosition, order);
  }
});
