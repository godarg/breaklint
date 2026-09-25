/**
 * Which block a rule judges, and against what, where the snapshot records more than one candidate
 * answer — asked of the browser through the production chain rather than modelled.
 *
 *   - A wrapper that crosses a page break records its paragraphs' line boxes as well as its own.
 *     `layout/widow` and `layout/orphan` judged those lines by the wrapper's own value and reported
 *     splits the paragraphs had asked for (G-82). tests/fixtures/wrapper-fragmentation.html repeats
 *     three pinned geometries of tests/fixtures/widows-orphans.html inside sections.
 *   - `type/excessive-word-spacing` divided by the block's FIRST rendered space, which in justified
 *     text is either collapsed at a line end or stretched with its line (G-83).
 *     tests/fixtures/natural-space.html has one block of each, a real wide gap the stretched divisor
 *     hid, a block whose last line shows the natural space to compare with, and the wide block again
 *     inside a justified wrapper in another font, which must not report it a second time.
 *
 * The chain is the production one: `renderDocuments` with the real source injector, loopback
 * server, primitives, Paged.js bundle and collector, then the real rules through `runDocument`.
 * Prerequisites FAIL rather than skip, as everywhere in the live suite.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { renderDocuments, type RenderResult } from "../../src/acquire/render-run.ts";
import { resolveBrowser, resolvePackageRoot } from "../../src/acquire/browser.ts";
import type { DocumentInput } from "../../src/core/engine.ts";
import { runDocument } from "../../src/core/engine.ts";
import type { BlockRecord, Snapshot } from "../../src/core/types.ts";
import { orphan } from "../../src/rules/layout/orphan.ts";
import { widow } from "../../src/rules/layout/widow.ts";
import { linesOfBlock } from "../../src/rules/shared.ts";
import { excessiveWordSpacing } from "../../src/rules/type/excessive-word-spacing.ts";
import { WIDOWS_ORPHANS_SPLITS } from "../fixtures/fragmentation-levers.ts";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const WRAPPER_FIXTURE = "tests/fixtures/wrapper-fragmentation.html";
const SPACE_FIXTURE = "tests/fixtures/natural-space.html";
const optional = process.env.BREAKLINT_LIVE_OPTIONAL === "1";
const missing = [
  resolveBrowser().path ? null : "a browser",
  resolvePackageRoot("pagedjs", REPO) ? null : "pagedjs",
  resolvePackageRoot("pdfjs-dist", REPO) ? null : "pdfjs-dist",
].filter((value): value is string => value !== null);

/** Each wrapped case and the pinned unwrapped case whose geometry it repeats. */
const WRAPPED = { "wrap-w1": "w1", "wrap-relaxed": "relaxed", "wrap-orphan": "o-default-a" } as const;

function fragmentsOf(snapshot: Snapshot, authorId: string): BlockRecord[] {
  return snapshot.blocks.filter((block) => block.authorId === authorId);
}

function only(snapshot: Snapshot, authorId: string): BlockRecord {
  const found = fragmentsOf(snapshot, authorId);
  assert.equal(found.length, 1, `${authorId}: expected exactly one record, found ${found.length}`);
  return found[0]!;
}

describe("rule targets on wrapped and justified blocks, live", () => {
  let root = "";
  let result: RenderResult | null = null;
  let wrapped: DocumentInput | null = null;
  let spaced: DocumentInput | null = null;

  before(async () => {
    if (missing.length > 0) {
      if (optional) return;
      assert.fail(`this suite cannot run without: ${missing.join(", ")}. Set BREAKLINT_LIVE_OPTIONAL=1 to skip.`);
    }
    root = mkdtempSync(join(tmpdir(), "breaklint-targets-"));
    result = await renderDocuments([join(REPO, WRAPPER_FIXTURE), join(REPO, SPACE_FIXTURE)], {
      outDir: join(root, "evidence"),
      // The questions are the split and the measured space; evidence binding changes neither.
      evidenceBinding: false,
      sourceMapInjection: true,
      network: { mode: "offline", allowed: [] },
      locale: "en-US",
    });
    wrapped = result.documents[0] ?? null;
    spaced = result.documents[1] ?? null;
  });

  after(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("renders both fixtures through the production chain on Paged.js 0.4.3", (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    assert.equal(result?.fatal, null, `render failed: ${JSON.stringify(result?.fatal)}`);
    assert.equal(result?.environment?.pagedjsVersion, "0.4.3");
    for (const document of [wrapped, spaced]) {
      assert.ok(document?.snapshot,
        `${document?.path}: no snapshot — ${JSON.stringify(document?.infrastructure.map((event) => event.kind))}`);
    }
    t.diagnostic(`browser: ${result?.environment?.browserVersion ?? "unknown"}`);
  });

  it("splits each wrapped paragraph as its pinned unwrapped case, with the section crossing the same break", (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    const snapshot = wrapped?.snapshot;
    assert.ok(snapshot, "no snapshot; the first case reports why");
    const measured: Record<string, [number, number]> = {};
    const pinned: Record<string, [number, number]> = {};
    for (const [caseId, pinnedCase] of Object.entries(WRAPPED)) {
      const page: number = only(snapshot, `label-${caseId}`).page;
      const on = (authorId: string, p: number): number => fragmentsOf(snapshot, authorId).filter((f) => f.page === p)
        .reduce((sum, f) => sum + linesOfBlock(snapshot, f.nodeKey).length, 0);
      measured[caseId] = [on(`probe-${caseId}`, page), on(`probe-${caseId}`, page + 1)];
      pinned[caseId] = [...WIDOWS_ORPHANS_SPLITS[pinnedCase]];
      // The premise: the section has a fragment on both pages, recording the paragraph's lines.
      assert.deepEqual(fragmentsOf(snapshot, caseId).map((f) => f.page), [page, page + 1], `${caseId}: the section does not cross the break`);
      assert.deepEqual(fragmentsOf(snapshot, caseId).map((f) => f.effectiveStyle.widows), [2, 2], `${caseId}: the section's widows is not the initial value`);
    }
    assert.deepEqual(measured, pinned, "the wrapped geometry no longer splits as the pinned unwrapped cases");
  });

  it("judges a wrapped split at the paragraph: one widow, on the relaxed paragraph, and no finding on any section", (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    const document = wrapped;
    assert.ok(document?.snapshot, "no snapshot; the first case reports why");
    const report = runDocument(document, { failOn: "never", activeRules: [widow, orphan], optionsByRule: {}, coverageFloors: {} }).report;
    const relaxed = fragmentsOf(document.snapshot, "probe-wrap-relaxed").find((fragment) => fragment.fragmentIndex === 1);
    assert.ok(relaxed, "the relaxed case has no continuation fragment");
    assert.deepEqual(
      report.findings.map((finding) => ({ ruleId: finding.ruleId, nodeKey: finding.target.nodeKey })),
      [{ ruleId: "layout/widow", nodeKey: relaxed.nodeKey }],
    );
    // The sections are still candidates, measured rather than dropped: three continuation
    // fragments for widow, three closing fragments for orphan, plus the two split paragraphs each.
    for (const ruleId of ["layout/widow", "layout/orphan"]) {
      assert.deepEqual([report.coverage[ruleId]?.candidates, report.coverage[ruleId]?.measured], [5, 5], ruleId);
    }
  });

  it("records the font's own space as the natural space, equal to the gaps of an unjustified last line", (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    const snapshot = spaced?.snapshot;
    assert.ok(snapshot, "no snapshot; the first case reports why");
    const natural = only(snapshot, "natural");
    const last = linesOfBlock(snapshot, natural.nodeKey).at(-1)!;
    const boxes = last.wordBoxes ?? [];
    assert.ok(boxes.length >= 4, "the natural probe's last line does not carry several words");
    const gaps = boxes.slice(1).map((box, i) => box.x - (boxes[i]!.x + boxes[i]!.width));
    for (const gap of gaps) assert.ok(Math.abs(gap - natural.spaceWidth) <= 0.05, `last-line gap ${gap} against recorded ${natural.spaceWidth}`);
    // One font, one natural space — whatever the first rendered space of each block looked like.
    for (const id of ["hanging", "inline", "wide", "wrapped"]) assert.equal(only(snapshot, id).spaceWidth, natural.spaceWidth, id);
  });

  it("reports the real wide gap and neither the collapsed nor the stretched first space", (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    const document = spaced;
    assert.ok(document?.snapshot, "no snapshot; the first case reports why");
    const report = runDocument(document, { failOn: "never", activeRules: [excessiveWordSpacing], optionsByRule: {}, coverageFloors: {} }).report;
    // The wide paragraph, and the same paragraph inside a justified serif `<div>` — reported once,
    // on the paragraph whose font sets the gap, not again on the div in the div's font.
    const snapshot: Snapshot = document.snapshot;
    const expected = ["wide", "wrapped"].map((id) => only(snapshot, id));
    assert.deepEqual(
      report.findings.map((finding) => ({ ruleId: finding.ruleId, nodeKey: finding.target.nodeKey })),
      expected.map((block) => ({ ruleId: "type/excessive-word-spacing", nodeKey: block.nodeKey })),
    );
    // Monospace in `ch`: the gaps are whole advances, so the worst factor is an integer, and the
    // same one for both.
    const factors = report.findings.map((finding) => finding.measurement.value);
    for (const factor of factors) assert.ok(Math.abs(factor - Math.round(factor)) <= 0.05 && factor >= 6, `worst gap factor ${factor}`);
    assert.equal(factors[0], factors[1]);
    // Six justified records: four paragraphs, the wrapped one, and the div, measured with no line of
    // its own.
    assert.deepEqual([report.coverage["type/excessive-word-spacing"]?.candidates, report.coverage["type/excessive-word-spacing"]?.measured], [6, 6]);
  });
});
