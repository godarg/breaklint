import assert from "node:assert/strict";
import { it } from "node:test";
import { loadCorpus } from "../fixtures/corpus.ts";
import { runDocument } from "../../src/core/engine.ts";
import { halfEmptyPage } from "../../src/rules/layout/half-empty-page.ts";
const corpus = loadCorpus();
const sample = () => structuredClone(corpus.find(entry => entry.name === "half-empty-trigger")!.snapshot);
const judge = (snapshot: ReturnType<typeof sample>) => runDocument({ path: "original.html", snapshot, infrastructure: [] },
  { activeRules: [halfEmptyPage], optionsByRule: {}, coverageFloors: {}, failOn: "warn" }).report;

it("does not call glyph-low prose empty when less than one measured line remains", () => {
  const snapshot = sample();
  // Independent geometric oracle: 606*(1-.99)=6.06 px, below this block's 15.4 px line.
  snapshot.pages[0]!.fill = { vertical: .99, net: .57, topGap: 0, area: .4 };
  assert.deepEqual(judge(snapshot).findings, []);
});
it("does not call an almost full page empty merely because one short line could fit", () => {
  const snapshot = sample();
  // Independent measured-scale control: 606*.04=24.24 px < 2*15.4 px.
  snapshot.pages[0]!.fill = { vertical: .96, net: .52, topGap: 0, area: .4 };
  assert.deepEqual(judge(snapshot).findings, []);
});
it("a natural document ending is measured without a low-fill warning", () => {
  const snapshot = sample();
  snapshot.pages[0]!.isLast = true;
  snapshot.pages[0]!.outgoingBreakCause = { kind: "document-end", determinedBy: "document-boundary", cascadeHint: null };
  const report = judge(snapshot);
  assert.deepEqual(report.findings, []); assert.equal(report.coverage[halfEmptyPage.id]!.measured, 1);
});
it("an observed forced ending remains an explicit unknown, not invented author intent", () => {
  const snapshot = sample();
  snapshot.pages[0]!.outgoingBreakCause = { kind: "forced", determinedBy: "pagedjs-break-attributes", cascadeHint: "stylesheet" };
  const report = judge(snapshot);
  assert.deepEqual(report.findings, []); assert.equal(report.notMeasured[0]!.reason, "env/forced-break");
  assert.equal(report.coverage[halfEmptyPage.id]!.measured, 0);
});
it("still reports a short overflow page and a late-starting final page without claiming a cause", () => {
  const short = judge(sample()); assert.equal(short.findings.length, 1);
  assert.match(short.findings[0]!.message, /overflow.*break-token/u);
  assert.match(short.findings[0]!.message, /cause and author intent are unknown/u);
  const late = sample(); late.pages[0]!.fill = { vertical: .99, net: .05, topGap: .94, area: .01 };
  late.pages[0]!.isLast = true;
  late.pages[0]!.outgoingBreakCause = { kind: "document-end", determinedBy: "document-boundary", cascadeHint: null };
  assert.equal(judge(late).findings.length, 1);
});
