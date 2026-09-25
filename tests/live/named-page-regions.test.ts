/**
 * A named-page region inside a wrapper, through the production chain: the real injector, loopback
 * server, paginator, collector, snapshot assembly, rules and coverage — what a consumer's report
 * says about the document.
 *
 * Measured before this change on a self-authored report of this shape (patched Chromium 141, no
 * evidence binding): every boundary from the region's second page on classified `forced` with the
 * reason `page@<the main wrapper>`, the boundary into the region `overflow`, 9 of 14 widow and
 * orphan candidates declined as `env/forced-break`, coverage below the floor and exit 4. The
 * collector-level cases for the same shapes are in `tests/live/breaks.test.ts`.
 *
 * The oracle is the page geometry, which the classification does not read: the region's named
 * page has its own margins, so a page's content width says which named page it was laid out at.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { renderDocuments, type RenderResult } from "../../src/acquire/render-run.ts";
import { resolveBrowser, resolvePackageRoot } from "../../src/acquire/browser.ts";
import { exitCodeFor, runDocument } from "../../src/core/engine.ts";
import { coverageFloorMap, resolveConfig } from "../../src/config/resolve.ts";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const FIXTURE = join(REPO, "tests", "fixtures", "named-page-wrapper.html");
const optional = process.env.BREAKLINT_LIVE_OPTIONAL === "1";
const missing = [
  resolveBrowser().path ? null : "a browser",
  resolvePackageRoot("pagedjs", REPO) ? null : "pagedjs",
  resolvePackageRoot("pdfjs-dist", REPO) ? null : "pdfjs-dist",
].filter((value): value is string => value !== null);

describe("named-page regions through the production chain, live", () => {
  let root = "";
  let result: RenderResult | null = null;

  before(async () => {
    if (missing.length > 0) {
      if (optional) return;
      assert.fail(`this suite cannot run without: ${missing.join(", ")}. Set BREAKLINT_LIVE_OPTIONAL=1 to skip.`);
    }
    root = mkdtempSync(join(tmpdir(), "breaklint-named-pages-"));
    // Evidence binding is not what is under test, and leaving it out keeps the case observable on
    // browsers whose PDF does not carry the marks.
    result = await renderDocuments([FIXTURE], {
      outDir: join(root, "evidence"), evidenceBinding: false, sourceMapInjection: true,
      network: { mode: "offline", allowed: [] }, locale: "de-DE",
    });
  });

  after(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  it("forces only the boundaries into and out of the region, and widows and orphans keep their coverage", (t) => {
    if (missing.length > 0 && optional) return t.skip(`missing: ${missing.join(", ")}`);
    assert.equal(result?.fatal ?? null, null, JSON.stringify(result?.fatal));
    const document = result!.documents[0]!;
    const snapshot = document.snapshot;
    assert.ok(snapshot, `no snapshot: ${JSON.stringify(document.infrastructure)}`);
    assert.deepEqual(document.infrastructure.filter((event) => event.kind === "break-cause-undetermined"), []);

    const widths = snapshot.pages.map((page) => Math.round(page.contentBox.width));
    const wide = Math.max(...widths);
    assert.ok(widths.filter((width) => width === wide).length >= 3, `premise: the region spans three pages or more: ${JSON.stringify(widths)}`);
    assert.ok(widths[0]! < wide && widths[widths.length - 1]! < wide, `premise: the region is in the middle: ${JSON.stringify(widths)}`);
    const wrapper = snapshot.blocks.filter((block) => block.authorId === "report");
    assert.equal(wrapper.length, snapshot.pages.length, "premise: the wrapper has a fragment on every page");

    // The oracle: forced exactly where the content width changes, overflow everywhere else.
    const changed = snapshot.pages.map((page, i) => i > 0 && widths[i] !== widths[i - 1]);
    assert.deepEqual(
      snapshot.pages.map((page) => page.incomingBreakCause.kind),
      changed.map((change, i) => (i === 0 ? "document-start" : change ? "forced" : "overflow")),
      `break causes: ${JSON.stringify(snapshot.pages.map((page) => page.incomingBreakCause))}`,
    );
    // And a forced boundary names the element that opened its page, never the wrapper.
    const opened = snapshot.pages.filter((_, i) => changed[i]).map((page) => {
      const sid = (page.incomingBreakCause as { reason?: string }).reason?.replace(/^page@/u, "");
      return snapshot.blocks.find((block) => block.sid === sid)?.authorId ?? null;
    });
    assert.deepEqual(opened, ["wide", "closing"]);

    const config = resolveConfig({ file: {}, cli: {} });
    const { report } = runDocument(document, {
      failOn: config.failOn, activeRules: config.activeRules, optionsByRule: config.optionsByRule,
      coverageFloors: coverageFloorMap(config),
    });
    // The declines a forced boundary is entitled to, computed from the geometry: a widow
    // candidate is a continuation fragment on a page the region's named page forced open, an
    // orphan candidate a fragment with a successor on a page it forced shut.
    const forcedOpen = new Set(snapshot.pages.filter((_, i) => changed[i]).map((page) => page.pageNumber));
    const forcedShut = new Set(snapshot.pages.filter((_, i) => changed[i + 1] === true).map((page) => page.pageNumber));
    const expectedWidowDeclines = snapshot.blocks.filter((block) => block.fragmentIndex > 0 && forcedOpen.has(block.page)).length;
    const expectedOrphanDeclines = snapshot.blocks.filter((block) =>
      block.fragmentCount > 1 && block.fragmentIndex < block.fragmentCount - 1 && forcedShut.has(block.page)).length;
    const declines = (ruleId: string) => report.coverage[ruleId]!.notMeasured
      .filter((row) => row.reason === "env/forced-break").reduce((sum, row) => sum + row.count, 0);
    assert.equal(declines("layout/widow"), expectedWidowDeclines, JSON.stringify(report.coverage["layout/widow"]));
    assert.equal(declines("layout/orphan"), expectedOrphanDeclines, JSON.stringify(report.coverage["layout/orphan"]));
    for (const ruleId of ["layout/widow", "layout/orphan"]) {
      const coverage = report.coverage[ruleId]!;
      assert.ok(coverage.measured > 0, `premise: ${ruleId} measured something: ${JSON.stringify(coverage)}`);
      assert.equal(coverage.ok, true, `${ruleId} fell below its coverage floor: ${JSON.stringify(coverage)}`);
    }
    assert.notEqual(exitCodeFor(report.verdict), 4, `verdict ${report.verdict}`);
  });
});
