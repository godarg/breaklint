import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { buildSourceModel } from "../../src/measure/snapshot.ts";
import { injectSourceIds } from "../../src/source/inject.ts";
import { RULES_BY_ID } from "../../src/rules/index.ts";
import { runDocument } from "../../src/core/engine.ts";
import { loadCorpus } from "../fixtures/corpus.ts";
import type { Snapshot } from "../../src/core/types.ts";
import { resolveConfig } from "../../src/config/resolve.ts";
import { findingsReportState } from "../fixtures/report-states.ts";
import { figureBodyIdentity } from "../../src/source/figure-index.ts";

it("indexes source captions, inline duplicate IDs and local reference groups", () => {
  const html = readFileSync(new URL("../fixtures/figures/references.html", import.meta.url), "utf8");
  const model = buildSourceModel(injectSourceIds(html, "references.html").html, "references.html");
  assert.ok(Object.hasOwn(model, "figureIndex"), "source semantic inventory is not collected");
  assert.equal(model.figureIndex.ids.repeated, 2);
  assert.equal(model.figureIndex.referenceBlocks.length, 3);
  assert.deepEqual(model.figureIndex.referenceBlocks.flatMap(g => g.references.map(r => r.targetId)), ["plot", "missing-a", "missing-b", "repeated"]);
});

it("registers useful figure checks as warning and default-off", () => {
  const config = resolveConfig({ file: {}, cli: {} });
  for (const id of ["figure/caption-separated", "figure/dangling-reference"]) {
    const rule = RULES_BY_ID.get(id);
    assert.ok(rule, `missing requested rule ${id}`);
    assert.equal(rule.severity, "warn");
    assert.equal(rule.calibrated, false);
    assert.ok(!config.activeRules.some(r => r.id === id));
  }
});

const corpus = loadCorpus();
function sample(name: string): Snapshot { return structuredClone(corpus.find(entry => entry.name === name)!.snapshot); }
function judge(snapshot: Snapshot, id: string) {
  const rule = RULES_BY_ID.get(id)!;
  return runDocument({ path: "authored.html", snapshot, infrastructure: [] }, { activeRules: [rule], optionsByRule: {}, coverageFloors: {}, failOn: "warn" }).report;
}
it("reports the caption's real source target and measured page pair", () => {
  const snapshot = sample("caption-separated-trigger");
  const result = judge(snapshot, "figure/caption-separated");
  assert.deepEqual(result.findings.map(f => [f.ruleId, f.target.sid, f.page, f.measurement.value]), [["figure/caption-separated", "s-caption", 2, 1]]);
  assert.deepEqual([result.coverage["figure/caption-separated"]?.candidates, result.coverage["figure/caption-separated"]?.measured], [1, 1]);
});
it("declines missing, duplicate, invisible, mismatched and outside-page body witnesses instead of using the wrapper", () => {
  for (const change of ["missing", "duplicate", "hidden", "identity", "outside", "multiple-captions"]) {
    const snapshot = sample("caption-separated-trigger"); const f = snapshot.figureIndex!.figures[0]!;
    if (change === "missing") f.bodyFragments = [];
    if (change === "duplicate") f.bodyFragments.push({ ...f.bodyFragments[0]!, page: 2 });
    if (change === "hidden") f.bodyFragments[0]!.visible = false;
    if (change === "identity") f.bodyFragments[0]!.identity = "another-body";
    if (change === "outside") f.bodyFragments[0]!.box.y = -200;
    if (change === "multiple-captions") f.captionSids.push("s-second");
    const result = judge(snapshot, "figure/caption-separated");
    assert.deepEqual(result.findings, [], change); assert.equal(result.coverage["figure/caption-separated"]?.measured, 0, change);
    assert.ok(result.notMeasured.every(n => n.reason === "env/figure-body-unsupported"), change);
  }
});
it("reports one source block for several missing hrefs and declines duplicate targets", () => {
  const snapshot = sample("figure-reference-trigger");
  const group = snapshot.figureIndex!.referenceBlocks[0]!;
  group.references.push({ href: "#other", targetId: "other" });
  let result = judge(snapshot, "figure/dangling-reference");
  assert.deepEqual(result.findings.map(f => [f.ruleId, f.target.sid, f.measurement.value]), [["figure/dangling-reference", "s-reference", 2]]);
  assert.equal(result.evaluations.length, 1);
  snapshot.figureIndex!.ids.plot = 2;
  result = judge(snapshot, "figure/dangling-reference");
  assert.deepEqual(result.findings, []); assert.equal(result.coverage["figure/dangling-reference"]?.measured, 0);
  assert.equal(result.notMeasured[0]?.reason, "env/figure-reference-ambiguous");
});
it("never fabricates a complete inventory for a legacy snapshot", () => {
  const snapshot = sample("widow-trigger"); snapshot.schemaVersion = 5; delete snapshot.figureIndex;
  assert.ok(judge(snapshot, "layout/widow").findings.length > 0);
  for (const id of ["figure/caption-separated", "figure/dangling-reference"]) {
    const result = judge(snapshot, id); assert.equal(result.verdict, "insufficient-coverage");
    assert.equal(result.notMeasured[0]?.reason, "env/figure-index-unavailable");
  }
});
it("keeps nested figures separate, counts every ID and declines script-bearing source", () => {
  const html = '<figure id="outer"><figure id="inner"><svg id="image"><text id="svg-child">X</text></svg><figcaption id="cap">Figure 1</figcaption></figure></figure><script>void 0</script>';
  const model = buildSourceModel(injectSourceIds(html, "nested.html").html, "nested.html");
  assert.equal(model.figureIndex.complete, false); assert.equal(model.figureIndex.ids["svg-child"], 1);
  assert.equal(model.figureIndex.figures[0]?.body, null); assert.equal(model.figureIndex.figures[0]?.captionSids.length, 0);
  assert.equal(model.figureIndex.figures[1]?.captionSids.length, 1);
});
it("malformed fragment encoding stays explicitly unmeasurable", () => {
  const snapshot = sample("figure-reference-trigger"); snapshot.figureIndex!.referenceBlocks[0]!.references[0]!.targetId = null;
  const result = judge(snapshot, "figure/dangling-reference"); assert.equal(result.verdict, "insufficient-coverage");
  assert.deepEqual(result.findings, []);
});

it("integer allowance constraints reject fractions, overflow and unknown keys through the real CLI", () => {
  const root = mkdtempSync(join(tmpdir(), "breaklint-figure-config-"));
  try {
    for (const [id, key] of [["figure/caption-separated", "maxPageDistance"], ["figure/dangling-reference", "maxMissingTargets"]]) {
      for (const options of [{ [key!]: 0.5 }, { [key!]: -1 }, { [key!]: Number.MAX_SAFE_INTEGER + 1 }, { unknown: 0 }]) {
        const path = join(root, "bad.json"); writeFileSync(path, JSON.stringify({ rules: { [id!]: options } }));
        const result = spawnSync(process.execPath, ["--import", "tsx", "src/cli/index.ts", "--config", path, "--demo"], { encoding: "utf8" });
        const nativeCode = result.status;
        assert.equal(nativeCode, 2, `${id}: ${JSON.stringify(options)}\n${result.stdout}${result.stderr}`);
      }
      const config = resolveConfig({ file: { rules: { [id!]: { [key!]: 1 } } }, cli: {} });
      assert.equal(config.optionsByRule[id!]![key!], 1);
      assert.ok(Object.entries(config.sources).some(([path, source]) => path.includes(key!) && source === "config"));
      const rule = RULES_BY_ID.get(id!)!;
      const snapshot = sample(id === "figure/caption-separated" ? "caption-separated-trigger" : "figure-reference-trigger");
      const report = runDocument({ path: "authored.html", snapshot, infrastructure: [] }, { activeRules: [rule], optionsByRule: { [id!]: { [key!]: 1 } }, coverageFloors: {}, failOn: "warn" }).report;
      assert.deepEqual(report.findings, [], "a registry option must actually affect the predicate");
      assert.equal(report.evaluations[0]?.measurements.at(-1)?.threshold, 1);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("malformed optional inventory cannot silently classify links or image placement", () => {
  for (const mutate of [
    (s: Snapshot) => { s.figureIndex!.ids.plot = -1; },
    (s: Snapshot) => { s.figureIndex!.figures[0]!.bodyFragments[0]!.box.width = Number.NaN; },
    (s: Snapshot) => { s.figureIndex!.figures[0]!.bodyFragments[0]!.page = 999; },
  ]) {
    const snapshot = sample("caption-separated-trigger"); mutate(snapshot);
    const report = judge(snapshot, "figure/caption-separated");
    assert.equal(report.verdict, "infrastructure"); assert.deepEqual(report.findings, []);
    assert.ok(report.infrastructure.some(event => event.kind === "checker-crashed"));
  }
});

it("normalizes only proven paginator break metadata while preserving authored SVG content", () => {
  const svg = '<svg width="240" height="120"><text>BODY</text></svg>';
  const original = figureBodyIdentity("svg", null, svg);
  assert.equal(figureBodyIdentity("svg", null, svg.replace("<svg ", '<svg data-next-break-before="page" ')), original);
  for (const changed of [svg.replace("BODY", "OTHER"), svg.replace("240", "120"), svg.replace("<svg ", '<svg class="other" '), svg.replace("<svg ", '<svg style="display:none" ')]) {
    assert.notEqual(figureBodyIdentity("svg", null, changed), original);
  }
  const html = '<figure><svg data-next-break-before="page"><text>BODY</text></svg><figcaption>Figure 1</figcaption></figure>';
  assert.equal(buildSourceModel(injectSourceIds(html, "authored-metadata.html").html, "authored-metadata.html").figureIndex.complete, false);
});

it("declines multicolumn figure flow even when the caption's own computed columns are auto", () => {
  const snapshot = sample("caption-separated-trigger"); const caption = snapshot.blocks[0]!;
  snapshot.blocks.push({ ...caption, nodeKey: "figure-owner", sid: snapshot.figureIndex!.figures[0]!.sid, tag: "figure", effectiveStyle: { ...caption.effectiveStyle, columns: "2" } });
  const report = judge(snapshot, "figure/caption-separated");
  assert.deepEqual(report.findings, []); assert.equal(report.coverage["figure/caption-separated"]?.measured, 0);
  assert.equal(report.notMeasured[0]?.reason, "env/multicolumn");
});

it("keeps the source-less presentation fixture scoped to its declared baseline", () => {
  const report = findingsReportState();
  assert.equal(report.exitCode, 1);
  assert.equal(report.rulesRun, 13);
  assert.ok(Object.keys(report.documents[0]!.coverage).every(id => !id.startsWith("figure/")));
});
