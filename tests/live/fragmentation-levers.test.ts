/**
 * What the browser does with the CSS levers rule advice names, when Paged.js 0.4.3 paginates —
 * asked of the browser rather than assumed, and pinned.
 *
 * Two published claims depend on this and nothing else can settle them:
 *
 *   - `layout/widow` and `layout/orphan` used to say that CSS `widows`/`orphans` are "ignored by
 *     Paged.js", and a registry guard banned both from all advice. Paged.js never reads them, but
 *     it cuts each page where the browser's own column fragmentation broke, and on the measured
 *     browser that fragmentation applies both. The rules' advice, their pages and the guard now
 *     say so, and the guard reads the pin in tests/fixtures/fragmentation-levers.ts.
 *   - `layout/hyphen-across-page` used to recommend soft hyphens and `hyphens: manual` as cures.
 *     Paged.js marks a page split after a soft hyphen exactly like a split inside a word, so the
 *     cure re-created the finding. The word-local levers its advice now names are the controls.
 *
 * The chain is the production one: `renderDocuments` with the real source injector, loopback
 * server, primitives, Paged.js bundle and collector, then the real rules through `runDocument`.
 * Line counts are read with `linesOfBlock`, the function the rules themselves read them with.
 *
 * FAILS BOTH WAYS by construction. Every case is compared against a literal split, so a browser
 * that stops applying a property is red, and so is one that applies it differently from what the
 * pin — and therefore the published text — says. A red run names the sentences to change.
 *
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
import { hyphenAcrossPage } from "../../src/rules/layout/hyphen-across-page.ts";
import { orphan } from "../../src/rules/layout/orphan.ts";
import { widow } from "../../src/rules/layout/widow.ts";
import { linesOfBlock } from "../../src/rules/shared.ts";
import {
  claimsToChange, leversApplied, ORPHANS_CASES, PIN_RECORDED_ON, SOFT_HYPHEN_BOUNDARY, SOFT_HYPHEN_FIXTURE,
  WIDOWS_CASES, WIDOWS_ORPHANS_FIXTURE, WIDOWS_ORPHANS_SPLITS,
  type SoftHyphenCase, type Splits, type WidowsOrphansCase,
} from "../fixtures/fragmentation-levers.ts";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const optional = process.env.BREAKLINT_LIVE_OPTIONAL === "1";
const missing = [
  resolveBrowser().path ? null : "a browser",
  resolvePackageRoot("pagedjs", REPO) ? null : "pagedjs",
  resolvePackageRoot("pdfjs-dist", REPO) ? null : "pdfjs-dist",
].filter((value): value is string => value !== null);

/** The class Paged.js sets on the element it hyphenated at a page split. */
const PAGEDJS_HYPHEN_CLASS = "pagedjs_hyphen";

function fragmentsOf(snapshot: Snapshot, authorId: string): BlockRecord[] {
  return snapshot.blocks.filter((block) => block.authorId === authorId);
}

/** The page a case starts on: its label's page. The label opens that page with a forced break. */
function labelPage(snapshot: Snapshot, caseId: string): number {
  const labels = fragmentsOf(snapshot, `label-${caseId}`);
  assert.equal(labels.length, 1, `case ${caseId}: its label must be exactly one unsplit block, found ${labels.length}`);
  return labels[0]!.page;
}

/**
 * Lines of the case's probe paragraph on the label's page and on the page after, read the way the
 * rules read them. Every line of the paragraph must be on one of those two pages, or the case has
 * measured something other than one split.
 */
function splitOf(snapshot: Snapshot, caseId: string, totalLines: number): [number, number] {
  const page = labelPage(snapshot, caseId);
  const fragments = fragmentsOf(snapshot, `probe-${caseId}`);
  assert.ok(fragments.length > 0, `case ${caseId}: no probe paragraph was collected`);
  const on = (p: number) => fragments.filter((f) => f.page === p)
    .reduce((sum, f) => sum + linesOfBlock(snapshot, f.nodeKey).length, 0);
  const split: [number, number] = [on(page), on(page + 1)];
  assert.equal(split[0] + split[1], totalLines,
    `case ${caseId}: the probe paragraph's lines are not all on pages ${page} and ${page + 1}: ` +
      JSON.stringify(fragments.map((f) => ({ page: f.page, lines: linesOfBlock(snapshot, f.nodeKey).length }))));
  return split;
}

function driftMessage(
  property: "widows" | "orphans",
  measured: Record<string, readonly number[]>,
  pinned: Record<string, readonly number[]>,
  browser: string,
): string {
  return `${browser} under Paged.js 0.4.3 no longer splits the ${property} cases as pinned.\n` +
    `  measured: ${JSON.stringify(measured)}\n  pinned:   ${JSON.stringify(pinned)} (${PIN_RECORDED_ON})\n` +
    `Re-measure, update WIDOWS_ORPHANS_SPLITS in tests/fixtures/fragmentation-levers.ts, and change ` +
    `every sentence the pin decides for ${property}:\n${claimsToChange(property)}`;
}

describe("fragmentation levers under Paged.js, live", () => {
  let root = "";
  let result: RenderResult | null = null;
  let widowsOrphans: DocumentInput | null = null;
  let softHyphen: DocumentInput | null = null;
  let browser = "unknown browser";

  before(async () => {
    if (missing.length > 0) {
      if (optional) return;
      assert.fail(`this suite cannot run without: ${missing.join(", ")}. Set BREAKLINT_LIVE_OPTIONAL=1 to skip.`);
    }
    root = mkdtempSync(join(tmpdir(), "breaklint-levers-"));
    result = await renderDocuments(
      [join(REPO, WIDOWS_ORPHANS_FIXTURE), join(REPO, SOFT_HYPHEN_FIXTURE)],
      {
        outDir: join(root, "evidence"),
        // Pagination and measurement happen before any evidence is drawn; the question here is
        // the split, and evidence binding does not change it.
        evidenceBinding: false,
        sourceMapInjection: true,
        network: { mode: "offline", allowed: [] },
        locale: "en-US",
      },
    );
    widowsOrphans = result.documents[0] ?? null;
    softHyphen = result.documents[1] ?? null;
    browser = result.environment?.browserVersion ?? browser;
  });

  after(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("renders both fixtures through the production chain on Paged.js 0.4.3, with the authored values computed", (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    assert.equal(result?.fatal, null, `render failed: ${JSON.stringify(result?.fatal)}`);
    assert.equal(result?.documents.length, 2);
    assert.equal(result?.environment?.pagedjsVersion, "0.4.3", "the pin was recorded against Paged.js 0.4.3");
    for (const document of [widowsOrphans, softHyphen]) {
      assert.ok(document?.snapshot,
        `${document?.path}: no snapshot — ${JSON.stringify(document?.infrastructure.map((event) => event.kind))}`);
    }
    t.diagnostic(`browser: ${browser}; pin recorded on ${PIN_RECORDED_ON}`);

    // The premise of every split below: the browser computed the value the fixture authored. A
    // fixture whose declaration was dropped would measure the initial value three times over.
    const snapshot = widowsOrphans!.snapshot!;
    const authored: Record<WidowsOrphansCase, { widows: number; orphans: number }> = {
      "w1": { widows: 1, orphans: 2 },
      "w-default": { widows: 2, orphans: 2 },
      "w5": { widows: 5, orphans: 2 },
      "o1-a": { widows: 2, orphans: 1 },
      "o-default-a": { widows: 2, orphans: 2 },
      "o4-a": { widows: 2, orphans: 4 },
      "o1-b": { widows: 2, orphans: 1 },
      "o-default-b": { widows: 2, orphans: 2 },
      "o4-b": { widows: 2, orphans: 4 },
      "relaxed": { widows: 6, orphans: 6 },
    };
    for (const [caseId, expected] of Object.entries(authored)) {
      const fragments = fragmentsOf(snapshot, `probe-${caseId}`);
      assert.ok(fragments.length > 0, `case ${caseId}: no probe paragraph was collected`);
      for (const fragment of fragments) {
        assert.deepEqual(
          { widows: fragment.effectiveStyle.widows, orphans: fragment.effectiveStyle.orphans },
          expected,
          `case ${caseId}: computed widows/orphans differ from the fixture`,
        );
      }
    }
  });

  it("applies widows 1, the initial value and 5 as authored: 8+1, 7+2, 4+5 over one geometry", (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    const snapshot = widowsOrphans?.snapshot;
    assert.ok(snapshot, "no snapshot; the first case reports why");
    const measured = Object.fromEntries(WIDOWS_CASES.map((id) => [id, splitOf(snapshot, id, 9)]));
    const pinned = Object.fromEntries(WIDOWS_CASES.map((id) => [id, [...WIDOWS_ORPHANS_SPLITS[id]]]));
    assert.deepEqual(measured, pinned, driftMessage("widows", measured, pinned, browser));
  });

  it("applies orphans 1, the initial value and 4 as authored, moving the paragraph where too few lines fit", (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    const snapshot = widowsOrphans?.snapshot;
    assert.ok(snapshot, "no snapshot; the first case reports why");
    const measured = Object.fromEntries(ORPHANS_CASES.map((id) => [id, splitOf(snapshot, id, 9)]));
    const pinned = Object.fromEntries(ORPHANS_CASES.map((id) => [id, [...WIDOWS_ORPHANS_SPLITS[id]]]));
    assert.deepEqual(measured, pinned, driftMessage("orphans", measured, pinned, browser));
  });

  /**
   * The reason both rules are warnings, measured. With widows + orphans > lines no split conforms,
   * CSS Fragmentation Level 3 §4.3 lets the browser drop the rule, and `lines < widows` is then a
   * permitted outcome rather than a defect. The pin also says WHICH half the browser dropped,
   * because the widow advice says it: it keeps `orphans` and relaxes `widows`.
   */
  it("relaxes widows, not orphans, when no conforming split exists — the reason layout/widow stays a warning", (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    const snapshot = widowsOrphans?.snapshot;
    assert.ok(snapshot, "no snapshot; the first case reports why");
    const measured = { relaxed: splitOf(snapshot, "relaxed", 9) };
    const pinned = { relaxed: [...WIDOWS_ORPHANS_SPLITS.relaxed] as [number, number] };
    assert.deepEqual(measured, pinned, driftMessage("widows", measured, pinned, browser));

    // The whole measured matrix must still derive "applied" for both properties, or a partial
    // drift could leave the individual literals looking coincidentally right.
    const all = Object.fromEntries(
      (Object.keys(WIDOWS_ORPHANS_SPLITS) as WidowsOrphansCase[]).map((id) => [id, splitOf(snapshot, id, 9)]),
    ) as unknown as Splits;
    assert.deepEqual(leversApplied(all), leversApplied(WIDOWS_ORPHANS_SPLITS));
  });

  it("the rules read those splits: one layout/widow finding, on the relaxed case, and no layout/orphan finding", (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    const document = widowsOrphans;
    assert.ok(document?.snapshot, "no snapshot; the first case reports why");
    const report = runDocument(document, { failOn: "never", activeRules: [widow, orphan], optionsByRule: {}, coverageFloors: {} }).report;
    // Every case that split is a candidate for both rules: 7 of the 10 split, 3 moved whole.
    const splitCases = Object.values(WIDOWS_ORPHANS_SPLITS).filter(([first]) => first > 0).length;
    assert.equal(report.coverage["layout/widow"]?.candidates, splitCases, "every split case must be a widow candidate");
    assert.equal(report.coverage["layout/widow"]?.measured, splitCases, "and measured, not declined");
    assert.equal(report.coverage["layout/orphan"]?.candidates, splitCases, "every split case must be an orphan candidate");
    assert.equal(report.coverage["layout/orphan"]?.measured, splitCases, "and measured, not declined");

    const relaxed = fragmentsOf(document.snapshot, "probe-relaxed").find((fragment) => fragment.fragmentIndex === 1);
    assert.ok(relaxed, "the relaxed case has no continuation fragment");
    assert.deepEqual(
      report.findings.map((finding) => ({ ruleId: finding.ruleId, nodeKey: finding.target.nodeKey })),
      [{ ruleId: "layout/widow", nodeKey: relaxed.nodeKey }],
      "with the browser applying both properties, only the relaxation is left for the rules to report",
    );
  });

  it("marks a page split after a soft hyphen as a boundary hyphen, and none after the word-local levers", (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    const snapshot = softHyphen?.snapshot;
    assert.ok(snapshot, "no snapshot; the first case reports why");
    const measured = Object.fromEntries((Object.keys(SOFT_HYPHEN_BOUNDARY) as SoftHyphenCase[]).map((id) => {
      const split = splitOf(snapshot, id, 6);
      const opening = fragmentsOf(snapshot, `probe-${id}`).find((fragment) => fragment.fragmentIndex === 0);
      return [id, { split, boundaryHyphen: opening?.classList.includes(PAGEDJS_HYPHEN_CLASS) ?? false }];
    }));
    const pinned = Object.fromEntries(Object.entries(SOFT_HYPHEN_BOUNDARY)
      .map(([id, entry]) => [id, { split: [...entry.split], boundaryHyphen: entry.boundaryHyphen }]));
    assert.deepEqual(measured, pinned,
      `${browser} under Paged.js 0.4.3 no longer marks the soft-hyphen cases as pinned (${PIN_RECORDED_ON}). ` +
        `Re-measure, update SOFT_HYPHEN_BOUNDARY, and change:\n${claimsToChange("soft-hyphen")}`);

    // The consumer-visible consequence: the rule reports exactly the soft-hyphen case.
    const report = runDocument(softHyphen!, { failOn: "never", activeRules: [hyphenAcrossPage], optionsByRule: {}, coverageFloors: {} }).report;
    const shy = fragmentsOf(snapshot, "probe-shy").find((fragment) => fragment.fragmentIndex === 0);
    assert.deepEqual(
      report.findings.map((finding) => ({ ruleId: finding.ruleId, nodeKey: finding.target.nodeKey })),
      [{ ruleId: "layout/hyphen-across-page", nodeKey: shy!.nodeKey }],
    );

    // Recorded, not asserted: whether this browser hyphenates English at all. It decides whether
    // `hyphens: auto` in type/excessive-word-spacing's advice does anything where it is measured.
    const lines = (id: string) => fragmentsOf(snapshot, id).reduce((sum, f) => sum + linesOfBlock(snapshot, f.nodeKey).length, 0);
    const auto = lines("probe-auto");
    const control = lines("probe-auto-control");
    assert.ok(auto > 0 && control > 0, "the dictionary probe paragraphs were not collected");
    t.diagnostic(`hyphens: auto ${auto} lines vs hyphens: none ${control} lines — ` +
      `${auto < control ? "this browser hyphenates English" : "no English hyphenation dictionary in this browser"}`);
  });
});
