/**
 * The evidence path against a real browser and a real paginator.
 *
 * This file is separate from `tests/unit` and `tests/e2e` on purpose. Everything there runs over
 * serialisable data in milliseconds and needs no environment. Everything here needs Chrome,
 * Paged.js and pdfjs-dist, and it is the only place where the claims about the evidence path can
 * be checked at all — they are claims about a renderer, and a mock of a renderer would be a mock
 * of the thing in question.
 *
 * **A missing prerequisite is a failure here, not a skip.** A suite that goes green by running
 * nothing is the most expensive kind of green there is: it makes every claim in `docs/status.md`
 * look checked. Set `BREAKLINT_LIVE_OPTIONAL=1` to turn the failure back into a skip for a local
 * run on a machine without a browser — never in a release gate.
 *
 * The corpus is built around its red conditions, not around its coverage:
 *
 *   R1  the NEUTRAL document must keep its binding. A check that always fires checks nothing,
 *       and this project has already shipped one that did (an absolute 1 px box threshold that
 *       a nine-character mark exceeds by construction).
 *   R2  at least one hostile stylesheet must BREAK the binding through a COUNTED pixel
 *       difference. `-1` means "not comparable" and is not allowed to satisfy this — reading it
 *       as a difference was a real defect in the first version of this file.
 *   R3  the property readback must fire on at least one case. Since the marks were given inline
 *       `!important` isolation, no author STYLESHEET can reach them any more — so the case that
 *       exercises it is a script, and the corpus says so rather than quietly having no such case.
 *   R4  an independent rasteriser (poppler's `pdftoppm`, never a product dependency) must agree
 *       in sign with the product rasteriser on every pair, and both must have counted.
 *   R5  the delivered PDF must be pixel-identical to a PDF of the same document produced on a
 *       page that never had an overlay at all. This is the check that catches a document which
 *       mutates itself permanently when the overlay arrives.
 *   R6  the ordering rule of §11.4a.2 is measured at THIS product, not inherited: with a content
 *       page open the rasteriser must fail to answer, and with it closed it must answer.
 *   R7  a document that already contains elements of our own class names must come through
 *       untouched. Finding our layers by class selector would delete author content.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { launchBrowser, resolveBrowser, resolvePackageRoot, type BrowserLike, type PageLike } from "../../src/acquire/browser.ts";
import {
  cleanupBrowserProfile, closeBrowserBounded, closeRasterizerBounded, integritySource, integrityStatusSource,
  paginationApparatusSource, PAGINATION_PREVIEW_SOURCE, withPagination, type RuntimeIntegrityStatus,
} from "../../src/acquire/render-run.ts";
import { PRIMITIVES_SOURCE, TEST_PRIMITIVES_CAPABILITY } from "../../src/measure/primitives.ts";
import { produceEvidence, REFERENCE_CORPUS_MAX_ABS_MM, type EvidenceOutcome } from "../../src/render/evidence.ts";
import { openRasterizer, readPngHeader, type Rasterizer } from "../../src/render/rasterizer.ts";
import { comparePng, decodePng, inkPixels } from "../tools/png.ts";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const PARAGRAPHS = 9;
const TEXT =
  "Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda my ny xi omikron pi rho " +
  "sigma tau ypsilon phi chi psi omega alpha beta gamma delta epsilon zeta eta theta iota.";

type Expectation = "bound" | "raster-breaks-it" | "readback-fires" | "integrity-breaks-it";

interface Case {
  name: string;
  css: string;
  script: string;
  body: string;
  expect: Expectation;
  why: string;
}

const base = { css: "", script: "", body: "" };

const CASES: readonly Case[] = [
  {
    ...base,
    name: "H0_neutral",
    expect: "bound",
    why: "R1. Nothing hostile. If this one loses its binding, the procedure always fires and means nothing.",
  },
  {
    ...base,
    name: "C1_layerBackground",
    css: ".bl-overlay{width:100%!important;height:100%!important;background:#c00!important}",
    expect: "bound",
    why:
      "The attack that changed 287 028 pixels before the layer carried inline isolation. It is in the " +
      "corpus as a case that must now be NEUTRALISED — an isolation nobody ever sees working is an " +
      "isolation nobody has measured.",
  },
  {
    ...base,
    name: "A1_authorUsesOurClassNames",
    body: `<div class="bl-overlay" data-bl-sid="own1">A block of the author's that happens to be called bl-overlay.</div>
<p data-bl-sid="own2">Text with <span class="bl-mark">a span the author called bl-mark</span> inside it.</p>`,
    expect: "bound",
    why:
      "R7. Nothing in the overlay may be found again by class name. If it were, the readback would " +
      "judge the author's span and the removal would delete the author's div — a checker that " +
      "deletes content on a name collision is worse than one that binds nothing.",
  },
  {
    ...base,
    name: "C9_pseudoElement",
    css: ".bl-overlay::after{content:'';position:absolute;left:6mm;top:6mm;width:40mm;height:14mm;background:#c00}",
    expect: "raster-breaks-it",
    why:
      "R2. A pseudo-element belongs to no element whose computed style could be read back, so no " +
      "property enumeration can reach it. Only the raster comparison can.",
  },
  {
    ...base,
    name: "C12_presenceSelector",
    css: ".pagedjs_page_content:has(.bl-overlay) p{color:#c00!important;letter-spacing:2px!important}",
    expect: "raster-breaks-it",
    why:
      "R2. This rule does not touch the mark; it changes the document AROUND it, and only while the " +
      "layer is in the tree. It is the case that decides detaching over hiding.",
  },
  {
    ...base,
    name: "M1_persistentMutation",
    script: `<script>
new MutationObserver(() => {
  if (document.querySelector(".bl-overlay")) {
    for (const p of document.querySelectorAll("p[data-bl-sid]")) p.style.setProperty("color", "#c00", "important");
  }
}).observe(document.documentElement, { childList: true, subtree: true });
</script>`,
    expect: "raster-breaks-it",
    why:
      "R5, and the reason the baseline PDF is taken FIRST. This document changes itself permanently " +
      "when the overlay arrives; removing the layer again does not undo it. Producing the unmarked " +
      "PDF by detaching would compare two equally corrupted files, report zero, keep the binding, " +
      "and deliver the damaged one — a control that already carries the intervention.",
  },
  {
    ...base,
    name: "X1_scriptRemovesOurLayer",
    script: `<script>
new MutationObserver(() => {
  for (const layer of document.querySelectorAll(".bl-overlay")) layer.remove();
}).observe(document.documentElement, { childList: true, subtree: true });
</script>`,
    expect: "integrity-breaks-it",
    why:
      "R8. The document throws our layer away as fast as we attach it, and the pixel comparison is " +
      "then perfectly happy — both PDFs look the same. Measured, this case fails closed through " +
      "TWO signals at once: the detach count comes back short AND the readback fires, because " +
      "removing the layer also detaches the marks and a detached node has no computed position. " +
      "It therefore shows fail-closed behaviour but does NOT isolate the integrity count; a " +
      "mutation that removes `integrityOk` from the verdict leaves this fixture green. The " +
      "isolated gate for that is in tests/unit/evidence-decision.test.ts, where the two signals " +
      "can be set independently. Saying otherwise here would be a fixture claiming a complication " +
      "it does not carry.",
  },
  {
    ...base,
    name: "S1_scriptRecoloursMarks",
    script: `<script>
new MutationObserver(() => {
  for (const m of document.querySelectorAll(".bl-mark")) m.style.setProperty("color", "#000", "important");
}).observe(document.documentElement, { childList: true, subtree: true });
</script>`,
    expect: "readback-fires",
    why:
      "R3. Since the marks carry inline !important, an author STYLESHEET can no longer reach them — " +
      "inline important beats stylesheet important of the same origin. A script can, by rewriting the " +
      "style attribute itself. Without this case the readback has no red condition in this corpus.",
  },
];

function document_(kase: Case, pagedjs: string): string {
  const paragraphs = Array.from(
    { length: PARAGRAPHS },
    (_, i) => `<p data-bl-sid="b${i + 1}">${i + 1}. ${TEXT}</p>`,
  ).join("\n");
  const author = `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${kase.name}</title><style>
@page{size:148mm 105mm;margin:12mm}
body{font:10pt/1.45 Georgia,serif;margin:0} p{margin:0 0 8px}
${kase.css}
</style></head><body>
${kase.body}
${paragraphs}
${kase.script}
</body></html>`;
  return withPagination(author, pagedjs, false);
}

async function installAndPaginate(page: PageLike, html: string): Promise<void> {
  await page.evaluate<void>(PRIMITIVES_SOURCE);
  await page.evaluate<void>(integritySource([]));
  await page.setContent(html, { waitUntil: "load" });
  await page.evaluate<void>(paginationApparatusSource(TEST_PRIMITIVES_CAPABILITY));
  const pagination = await page.evaluate<{ paginationError: string | null }>(PAGINATION_PREVIEW_SOURCE);
  assert.equal(pagination.paginationError, null);
  const epoch = await page.evaluate<RuntimeIntegrityStatus>(integrityStatusSource(TEST_PRIMITIVES_CAPABILITY));
  assert.equal(epoch.paginationPreviewCalls, 1);
}

/** poppler. A measuring instrument here and nothing else — it is never a product dependency. */
function foreignRasterDiff(a: Uint8Array, b: Uint8Array, dir: string, tag: string): number {
  const out: string[][] = [];
  for (const [name, bytes] of [
    [`${tag}-a`, a],
    [`${tag}-b`, b],
  ] as const) {
    const pdf = join(dir, `${name}.pdf`);
    writeFileSync(pdf, bytes);
    execFileSync("pdftoppm", ["-png", "-r", "96", pdf, join(dir, name)]);
    out.push(readdirSync(dir).filter((f) => f.startsWith(`${name}-`) && f.endsWith(".png")).sort());
  }
  const [pagesA, pagesB] = out as [string[], string[]];
  if (pagesA.length !== pagesB.length) return -1;
  let total = 0;
  for (let i = 0; i < pagesA.length; i++) {
    const d = comparePng(decodePng(readFileSync(join(dir, pagesA[i]!))), decodePng(readFileSync(join(dir, pagesB[i]!))));
    if (d < 0) return -1;
    total += d;
  }
  return total;
}

/**
 * Ink per page of a PDF, measured by poppler rather than by the product. The counterpart to the
 * blank-page assertion below: it is the only way to tell "the rasteriser produced nothing" from
 * "this page of the document really is nearly empty", and those two must not share an oracle.
 */
function foreignPageInk(bytes: Uint8Array, dir: string, tag: string): number[] {
  const pdf = join(dir, `${tag}-ink.pdf`);
  writeFileSync(pdf, bytes);
  execFileSync("pdftoppm", ["-png", "-r", "96", pdf, join(dir, `${tag}-ink`)]);
  return readdirSync(dir)
    .filter((f) => f.startsWith(`${tag}-ink-`) && f.endsWith(".png"))
    .sort()
    .map((f) => inkPixels(decodePng(readFileSync(join(dir, f)))));
}

const hasPoppler = (() => {
  try {
    execFileSync("pdftoppm", ["-v"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
})();

// The env var is checked for what it POINTS AT, not for being set. Reading it as "a browser is
// available" made `BREAKLINT_CHROME=/nonexistent` a green prerequisite — the variable answered a
// question about itself instead of about the machine.
// and it is answered by the PRODUCTION resolver, called — not by a reimplementation of it.
//
// This used to be a hand-copy, and it had already diverged in two ways at once. It listed three
// candidate paths where `resolveBrowser()` lists six (it did not know `Chromium.app`,
// `google-chrome-stable` or `chromium-browser`), and it treated `BREAKLINT_CHROME` as EXCLUSIVE
// while production treats it as the first candidate and falls through when it does not exist.
// Measured: with `BREAKLINT_CHROME=/nonexistent/chrome` this gate announced `cannot run without:
// a browser` and failed the run — while `before()` two lines later launched the real Chrome
// through `launchBrowser()` and all sixteen measurements completed. The gate on which
// `docs/status.md` rests every live claim was answering a different question from the suite it
// guards. A false FAIL rather than a false green, which is the safe direction, and still wrong.
const chromeAvailable = resolveBrowser().path !== null;
const pagedjsRoot = resolvePackageRoot("pagedjs", REPO);
const pdfjsPresent = resolvePackageRoot("pdfjs-dist", REPO) !== null;
const optional = process.env.BREAKLINT_LIVE_OPTIONAL === "1";

const missing = [
  chromeAvailable ? null : "a browser",
  pagedjsRoot ? null : "pagedjs",
  pdfjsPresent ? null : "pdfjs-dist",
  hasPoppler ? null : "pdftoppm (the independent rasteriser)",
].filter((x): x is string => x !== null);

describe("evidence path, live", () => {
  let browser: BrowserLike;
  let browserProfile: string | null = null;
  let rasterizer: Rasterizer;
  let workDir: string;
  let pagedjs: string;
  let openContentPages = 0;
  // Evidence.path is deliberately relative to the declared artefact directory, never CWD.
  const evidenceFile = (reference: string): string => join(workDir, "out", reference);
  const results = new Map<string, EvidenceOutcome & { foreignDiff: number; referenceDiff: number; foreignInk: number[] }>();
  // Every number this file asserts on, written out. A claim of "green" that cannot name the file
  // it was measured from is a claim about a memory.
  const measured: Record<string, unknown> = { missingPrerequisites: missing };

  it("the prerequisites for this suite are present", () => {
    // The first assertion in the file, and the one that stops the suite from proving nothing.
    if (missing.length && optional) {
      assert.ok(true);
      return;
    }
    assert.deepEqual(
      missing,
      [],
      `this suite carries every live claim in docs/status.md and cannot run without: ${missing.join(", ")}. ` +
        "Set BREAKLINT_LIVE_OPTIONAL=1 to downgrade this to a skip for a local run — never in a release gate.",
    );
  });

  before(async () => {
    if (missing.length && optional) return;
    workDir = mkdtempSync(join(tmpdir(), "breaklint-live-"));
    mkdirSync(join(workDir, "out"), { recursive: true });
    pagedjs = readFileSync(join(pagedjsRoot!, "dist", "paged.js"), "utf8");

    const launched = await launchBrowser(REPO);
    assert.ok(launched.browser, `browser did not launch: ${launched.detail}`);
    browser = launched.browser;
    browserProfile = launched.userDataDir ?? null;

    const opened = await openRasterizer(browser, { fromDir: REPO, contentPagesOpen: () => openContentPages });
    assert.ok(opened.rasterizer, `rasteriser did not open: ${opened.detail}`);
    rasterizer = opened.rasterizer;

    for (const kase of CASES) {
      const page = await browser.newPage();
      openContentPages++;
      await page.setViewport({ width: 900, height: 700, deviceScaleFactor: 1 });
      await installAndPaginate(page, document_(kase, pagedjs));

      const outcome = await produceEvidence({
        page,
        closePage: async () => {
          await page.close();
          openContentPages--;
        },
        rasterizer,
        options: { outDir: join(workDir, "out"), documentKey: kase.name, binding: true },
      });

      // R5: a PDF of the same document from a page that never had an overlay at all.
      const referencePage = await browser.newPage();
      openContentPages++;
      await referencePage.setViewport({ width: 900, height: 700, deviceScaleFactor: 1 });
      await installAndPaginate(referencePage, document_(kase, pagedjs));
      const referencePdf = await referencePage.pdf({ printBackground: true, preferCSSPageSize: true });
      await referencePage.close();
      openContentPages--;

      await rasterizer.rasterise(`${kase.name}:reference`, referencePdf);
      await rasterizer.rasterise(`${kase.name}:delivered`, outcome.deliveredPdf);
      const referenceDiff = (await rasterizer.diff(`${kase.name}:reference`, `${kase.name}:delivered`)).pixels;
      await rasterizer.release(`${kase.name}:reference`);
      await rasterizer.release(`${kase.name}:delivered`);

      const foreignDiff =
        hasPoppler && outcome.candidates.marked
          ? foreignRasterDiff(outcome.candidates.marked, outcome.candidates.baseline, workDir, kase.name)
          : Number.NaN;

      const foreignInk = hasPoppler ? foreignPageInk(outcome.deliveredPdf, workDir, kase.name) : [];

      results.set(kase.name, { ...outcome, foreignDiff, referenceDiff, foreignInk });
    }
  });

  after(async () => {
    if (rasterizer) {
      measured.rasterizer = {
        name: rasterizer.name,
        loadedVersion: rasterizer.version,
        declaredVersion: rasterizer.declaredVersion,
        pageErrors: [...rasterizer.pageErrors()],
      };
    }
    if (browser) measured.browserVersion = await browser.version();
    // `pdftoppm -v` writes to stderr, so redirect it rather than record an empty string.
    measured.foreignOracle = hasPoppler
      ? execFileSync("/bin/sh", ["-c", "pdftoppm -v 2>&1 | head -1"]).toString().trim()
      : "ABSENT — the foreign oracle arm did not run";
    measured.cases = Object.fromEntries(
      [...results].map(([name, r]) => [
        name,
        {
          pages: r.evidence.length,
          rasterDiffPx: r.evidence[0]?.overlayCheck.rasterDiffPx ?? null,
          styleViolations: r.evidence[0]?.overlayCheck.styleViolations ?? null,
          overlayRemoved: r.evidence[0]?.overlayCheck.removed ?? null,
          deliveredWithOverlay: r.deliveredWithOverlay,
          boundSourceBlocks: r.boundSids.size,
          marksPlaced: r.marks.length,
          ambiguousMarks: r.ambiguousMarks,
          pdfConformance: [...new Set(r.evidence.map((e) => e.pdfConformance))],
          maxDxMm: Math.max(0, ...r.evidence.map((e) => e.conformance?.maxDxMm ?? 0)),
          maxDyMm: Math.max(0, ...r.evidence.map((e) => e.conformance?.maxDyMm ?? 0)),
          sdDyMm: Math.max(0, ...r.evidence.map((e) => e.conformance?.sdDyMm ?? 0)),
          maxAbsReferenceDyMm: Math.max(0, ...r.evidence.map((e) => Math.abs(e.conformance?.referenceDyMm ?? 0))),
          foreignRasterDiffPx: r.foreignDiff,
          deliveredVsUnmarkedPx: r.referenceDiff,
          evidencePngs: r.evidence.map((e) => {
            const decoded = decodePng(readFileSync(evidenceFile(e.path)));
            return { page: e.page, width: decoded.width, height: decoded.height, inkPixels: inkPixels(decoded) };
          }),
          infrastructure: r.infrastructure.map((e) => e.kind),
          notMeasured: r.notMeasured.map((n) => n.reason),
        },
      ]),
    );
    // Written to a `.partial` name. `npm run test:live` promotes it to the requested path only
    // after the runner has exited 0, so a measurement report can never be a record of a run that
    // failed halfway. The file on its own was not evidence of a green run, and it looked like one.
    const target = process.env.BREAKLINT_LIVE_REPORT;
    if (target) writeFileSync(`${target}.partial`, JSON.stringify(measured, null, 2) + "\n");
    let rasterizerError: string | null = null;
    let browserError: string | null = null;
    let profileError: string | null = null;
    try {
      [rasterizerError, browserError] = await Promise.all([
        rasterizer ? closeRasterizerBounded(rasterizer) : Promise.resolve(null),
        browser ? closeBrowserBounded(browser) : Promise.resolve(null),
      ]);
    } finally {
      profileError = cleanupBrowserProfile(browserProfile);
      if (workDir) rmSync(workDir, { recursive: true, force: true });
    }
    assert.equal(rasterizerError, null);
    assert.equal(browserError, null);
    assert.equal(profileError, null);
    assert.equal(browserProfile ? existsSync(browserProfile) : false, false);
  });

  const live = (): boolean => !(missing.length && optional);

  it("the rasteriser reports the version of the library that was loaded", { skip: live() ? false : "prerequisites absent" }, () => {
    // Two independent sources: what the manifest declares and what the module in the browser
    // says about itself. Comparing the name against its own literal would prove nothing.
    assert.match(rasterizer.version, /^\d+\.\d+\.\d+/u);
    assert.equal(rasterizer.version, rasterizer.declaredVersion);
  });

  it("R6 — the ordering rule holds at THIS product, measured in both directions", { skip: live() ? false : "prerequisites absent" }, async () => {
    // Not the guard: the phenomenon the guard exists for. A second rasteriser is opened with the
    // guard deliberately disarmed, and the same PDF is asked for twice — once with a content
    // page open, once without. Asserting on the test's own counter, as an earlier version did,
    // says nothing about the rasteriser at all.
    const unguarded = await openRasterizer(browser, { fromDir: REPO, contentPagesOpen: () => 0 });
    assert.ok(unguarded.rasterizer, "the probe rasteriser did not open");
    const probe = unguarded.rasterizer;
    const pdf = results.get("H0_neutral")!.deliveredPdf;

    const page = await browser.newPage();
    await installAndPaginate(page, document_(CASES[0]!, pagedjs));

    // Three outcomes, kept apart. Mapping a rejection onto an elapsed time — which an earlier
    // version of this test did — makes "it threw immediately" indistinguishable from "it came
    // back with the pages", and the closed-page arm would then pass on a broken rasteriser.
    type Outcome =
      | { kind: "rastered"; ms: number; pages: number }
      | { kind: "threw"; ms: number; why: string }
      | { kind: "no answer" };

    const race = async (label: string): Promise<Outcome> => {
      const started = Date.now();
      const answered: Promise<Outcome> = probe
        .rasterise(`probe:${label}`, pdf)
        .then((pages) => ({ kind: "rastered" as const, ms: Date.now() - started, pages: pages.length }))
        .catch((e: unknown) => ({ kind: "threw" as const, ms: Date.now() - started, why: String(e).slice(0, 120) }));
      const timedOut = new Promise<Outcome>((resolve) =>
        setTimeout(() => resolve({ kind: "no answer" }), 15_000).unref(),
      );
      return Promise.race([answered, timedOut]);
    };

    const withPageOpen = await race("open");
    await page.close();
    const withPageClosed = await race("closed");
    measured.orderingProbe = { withPageOpen, withPageClosed };

    assert.equal(withPageOpen.kind, "no answer", `the rasteriser answered while a content page was open: ${JSON.stringify(withPageOpen)}`);
    assert.equal(withPageClosed.kind, "rastered", `with every page closed the rasteriser still did not deliver pages: ${JSON.stringify(withPageClosed)}`);
    assert.ok(
      withPageClosed.kind === "rastered" && withPageClosed.pages > 0,
      "the rasteriser returned an empty page list, which is not an answer either",
    );

    // And the guard, which turns that silence into a sentence.
    await assert.rejects(
      async () => {
        openContentPages++;
        try {
          await rasterizer.rasterise("guard-probe", pdf);
        } finally {
          openContentPages--;
        }
      },
      /content page\(s\) are still open/u,
    );
    await probe.close();
  });

  it("R1 — the neutral document keeps its binding", { skip: live() ? false : "prerequisites absent" }, () => {
    const r = results.get("H0_neutral")!;
    assert.ok(r.evidence.length > 0, "no evidence pages were produced at all");
    assert.equal(r.deliveredWithOverlay, true, "the neutral case did not deliver the marked PDF");
    assert.equal(
      r.evidence.every((e) => e.overlayCheck.rasterDiffPx === 0 && e.overlayCheck.styleViolations === 0),
      true,
      `neutral case was disturbed: ${JSON.stringify(r.evidence[0]?.overlayCheck)}`,
    );
    assert.equal(r.boundSids.size, PARAGRAPHS, `bound ${r.boundSids.size} of ${PARAGRAPHS} source blocks`);
    assert.equal(r.ambiguousMarks, 0, "a mark was not uniquely refound in a document with nothing wrong with it");
    assert.equal(
      r.evidence.every((e) => e.pdfConformance === "verified" && e.bindsFinding),
      true,
      "the neutral case produced unverified pages",
    );
  });

  it("R1b — the marks are refound in the PDF within the stated tolerance", { skip: live() ? false : "prerequisites absent" }, () => {
    const r = results.get("H0_neutral")!;
    for (const e of r.evidence) {
      assert.ok(e.conformance, `page ${e.page} carries no conformance record`);
      assert.equal(e.conformance.marksMatched, e.conformance.marksTotal, `page ${e.page} lost marks`);
      assert.ok(e.conformance.maxDxMm <= 0.35, `page ${e.page}: max |dx| ${e.conformance.maxDxMm} mm`);
      assert.ok(e.conformance.maxDyMm <= 0.35, `page ${e.page}: max |dy - reference| ${e.conformance.maxDyMm} mm`);
      // The residual above says the marks agree with EACH OTHER. This says what they agree ON.
      // Without it a uniform displacement of any size passes the line above with maxDyMm 0, and
      // the bound in `MAX_REFERENCE_DY_MM` would have nothing measured behind its headroom claim.
      assert.ok(
        Math.abs(e.conformance.referenceDyMm) <= REFERENCE_CORPUS_MAX_ABS_MM,
        `page ${e.page}: reference ${e.conformance.referenceDyMm} mm exceeds the measured corpus ` +
          `maximum ${REFERENCE_CORPUS_MAX_ABS_MM} mm — the headroom behind MAX_REFERENCE_DY_MM has eroded`,
      );
    }
    const marks = r.evidence.reduce((s, e) => s + (e.conformance?.marksTotal ?? 0), 0);
    // Two marks per fragment, and every fragment carries both — including a middle one. Fewer
    // than two per source block would mean the continuation fragments are unbindable again.
    assert.ok(marks >= PARAGRAPHS * 2, `only ${marks} marks placed for ${PARAGRAPHS} blocks`);
  });

  it("R2 — hostile cases break the binding through a COUNTED pixel difference", { skip: live() ? false : "prerequisites absent" }, () => {
    const breakers = CASES.filter((c) => c.expect === "raster-breaks-it");
    assert.ok(breakers.length > 0, "the corpus contains no case that should break the binding");
    for (const kase of breakers) {
      const r = results.get(kase.name)!;
      const diff = r.evidence[0]?.overlayCheck.rasterDiffPx ?? 0;
      // `> 0`, not `!== 0`: -1 means the two rasterisations were not comparable at all, and a
      // corpus that satisfies its central red condition through broken page counts has counted
      // nothing.
      assert.ok(diff > 0, `${kase.name} reported ${diff} instead of a counted difference — ${kase.why}`);
      assert.equal(r.deliveredWithOverlay, false, `${kase.name} still delivered the marked PDF`);
      assert.equal(r.boundSids.size, 0, `${kase.name} still bound ${r.boundSids.size} blocks`);
      assert.equal(
        r.infrastructure.some((e) => e.kind === "mark-raster-diff"),
        true,
        `${kase.name} produced no mark-raster-diff event`,
      );
      assert.equal(
        r.notMeasured.some((n) => n.reason === "env/evidence-overlay-removed"),
        true,
        `${kase.name} did not record why the binding is gone`,
      );
    }
  });

  it("the inline isolation neutralises the attacks it is there for", { skip: live() ? false : "prerequisites absent" }, () => {
    // The counterpart to R2. If every case broke the binding, the corpus would be measuring a
    // procedure that refuses everything, and that is the failure mode this project keeps hitting.
    const r = results.get("C1_layerBackground")!;
    assert.equal(r.evidence[0]?.overlayCheck.rasterDiffPx, 0, "the layer background reached the PDF");
    assert.equal(r.deliveredWithOverlay, true);
    assert.equal(r.boundSids.size, PARAGRAPHS);
  });

  it("R7 — a document using our own class names comes through untouched", { skip: live() ? false : "prerequisites absent" }, () => {
    const r = results.get("A1_authorUsesOurClassNames")!;
    // The author's span is not absolutely positioned and not transparent. A readback that found
    // marks by class would report violations for it and drop the binding of a harmless document.
    assert.equal(r.evidence[0]?.overlayCheck.styleViolations, 0, "the author's own .bl-mark was judged as one of ours");
    assert.equal(r.evidence[0]?.overlayCheck.rasterDiffPx, 0);
    assert.equal(r.deliveredWithOverlay, true);
    // Two extra source blocks in this fixture, both of them the author's.
    assert.equal(r.boundSids.size, PARAGRAPHS + 2, `bound ${r.boundSids.size} blocks`);
    assert.equal(r.referenceDiff, 0, "the delivered PDF lost the author's content");
  });

  it("R8 — a document that discards our layer fails closed, and both signals are recorded", { skip: live() ? false : "prerequisites absent" }, () => {
    const r = results.get("X1_scriptRemovesOurLayer")!;
    // The pixels agree — that is what makes the case worth having. What does NOT hold is the
    // tempting claim that this fixture isolates the integrity count: measured, the readback
    // fires here too (20 violations), because a mark removed from the tree has no computed
    // position. Both are asserted, so the test says what it shows.
    assert.equal(r.evidence[0]?.overlayCheck.rasterDiffPx, 0, "this case is only interesting while the pixels match");
    assert.ok((r.evidence[0]?.overlayCheck.styleViolations ?? 0) > 0, "the readback stayed silent on detached marks");
    assert.equal(r.deliveredWithOverlay, false, "the marked PDF was delivered although a layer never came back");
    assert.equal(r.boundSids.size, 0);
    assert.equal(
      r.infrastructure.some((e) => e.kind === "checker-crashed" && e.detail.includes("detach incomplete")),
      true,
      `no detach-incomplete event: ${JSON.stringify(r.infrastructure)}`,
    );
    assert.equal(r.referenceDiff, 0, "the delivered PDF is not the untouched one");
  });

  it("the browser cannot read one local file from another", { skip: live() ? false : "prerequisites absent" }, async () => {
    // `--allow-file-access-from-files` was passed for as long as the rasteriser loaded itself
    // over `file://`. It is browser-WIDE, so it also applied to the audited document — untrusted
    // HTML, usually loaded from disk. The switch was removed when the rasteriser moved to a
    // loopback origin, and this is the check that it stays removed: an audit, not a test, caught
    // it being left in place while three documents said it was gone.
    const dir = mkdtempSync(join(tmpdir(), "breaklint-fileaccess-"));
    try {
      writeFileSync(join(dir, "neighbour.txt"), "the-neighbouring-file");
      writeFileSync(join(dir, "probe.html"), "<!doctype html><meta charset=\"utf-8\"><body>probe</body>");
      const page = await browser.newPage();
      await page.goto(pathToFileURL(join(dir, "probe.html")).href, { waitUntil: "load" });
      const outcome = await page.evaluate<string>(
        'fetch("./neighbour.txt").then((r) => r.text()).then((t) => "READ:" + t).catch((e) => "BLOCKED:" + String(e).slice(0, 60))',
      );
      await page.close();
      measured.localFileAccess = outcome;
      assert.match(
        outcome,
        /^BLOCKED/u,
        `a local document read a neighbouring file: ${outcome}. The browser-wide file-access switch is back.`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("R3 — the property readback fires on the case that reaches the marks", { skip: live() ? false : "prerequisites absent" }, () => {
    const r = results.get("S1_scriptRecoloursMarks")!;
    assert.ok(
      (r.evidence[0]?.overlayCheck.styleViolations ?? 0) > 0,
      "the readback saw nothing when the mark's own style attribute was rewritten",
    );
    assert.equal(
      r.infrastructure.some((e) => e.kind === "mark-style-overridden"),
      true,
      "no mark-style-overridden event",
    );
    assert.equal(r.deliveredWithOverlay, false);
    assert.equal(r.boundSids.size, 0);
  });

  it("R4 — an independent rasteriser agrees in sign on every pair, and both counted", { skip: live() ? false : "prerequisites absent" }, () => {
    for (const kase of CASES) {
      const r = results.get(kase.name)!;
      const product = r.evidence[0]?.overlayCheck.rasterDiffPx ?? 0;
      // Both sides must have COUNTED. Comparing `!== 0` against `!== 0` would let a pair of
      // incomparable rasterisations agree with a real difference.
      assert.ok(product >= 0, `${kase.name}: the product rasteriser could not compare (${product})`);
      assert.ok(r.foreignDiff >= 0, `${kase.name}: poppler could not compare (${r.foreignDiff})`);
      assert.equal(
        product !== 0,
        r.foreignDiff !== 0,
        `${kase.name}: product rasteriser says ${product}, poppler says ${r.foreignDiff}`,
      );
    }
  });

  it("R5 — the delivered PDF is identical to one produced without any overlay", { skip: live() ? false : "prerequisites absent" }, () => {
    for (const kase of CASES) {
      const r = results.get(kase.name)!;
      assert.equal(
        r.referenceDiff,
        0,
        `${kase.name}: the delivered PDF differs from an unmarked one by ${r.referenceDiff} pixels`,
      );
    }
  });

  it("R5b — mutation: the PDF that was WITHHELD does differ from an unmarked one", { skip: live() ? false : "prerequisites absent" }, async () => {
    // Without this, R5 says only that some comparison ran and returned zero. The withheld
    // candidate is the same bytes the module judged, so the comparison is shown to have teeth on
    // the one document where the answer is known to be "different".
    const kase = "C12_presenceSelector";
    const r = results.get(kase)!;
    assert.ok(r.candidates.marked, "the withheld candidate was not kept");
    await rasterizer.rasterise("mutation:withheld", r.candidates.marked);
    await rasterizer.rasterise("mutation:delivered", r.deliveredPdf);
    const d = (await rasterizer.diff("mutation:withheld", "mutation:delivered")).pixels;
    await rasterizer.release("mutation:withheld");
    await rasterizer.release("mutation:delivered");
    assert.ok(d > 0, `the withheld PDF and the delivered one are identical (${d}) — then withholding it changed nothing`);
    measured.mutationWithheldVsDeliveredPx = d;
  });

  it("the evidence files are PNGs of the size the rasteriser reported, and they are not blank", { skip: live() ? false : "prerequisites absent" }, () => {
    for (const kase of CASES) {
      const r = results.get(kase.name)!;
      assert.ok(r.evidence.length > 0, `${kase.name} produced no evidence pages`);
      for (const e of r.evidence) {
        const bytes = readFileSync(evidenceFile(e.path));
        const header = readPngHeader(bytes);
        assert.equal(header.signature && header.ihdr, true, `${e.path} is not a PNG`);
        const decoded = decodePng(bytes);
        assert.equal(decoded.width, header.width);
        assert.equal(decoded.height, header.height);
        // The two lines above compare two readers of the SAME bytes, which cannot show a file
        // that disagrees with what the rasteriser reported. That comparison happens inside
        // `finish()`, and a mismatch there raises `checker-crashed` and drops the file — so the
        // check that the file matches the measurement is the absence of that event.
        // Specifically the PNG rejection, not `checker-crashed` in general: X1 raises that kind
        // on purpose, and asserting on the kind would make this test contradict that fixture.
        assert.equal(
          r.infrastructure.some((e) => e.detail.includes("not a PNG of the size the rasteriser reported")),
          false,
          `${kase.name}: the product itself rejected an evidence page`,
        );
        // A blank page passes every structural check ever written. This is the one that fails.
        //
        // It may NOT fail on a page the document itself left nearly empty, and the difference is
        // not visible from inside this rasteriser. Measured: on Linux, Liberation Serif is wider
        // than the macOS serif these fixtures were written against, so A1 paginates to three
        // pages and the third carries the two words that no longer fit — 169 inked pixels, and a
        // flat `> 500` called that a broken rasteriser. The threshold was never measuring the
        // rasteriser; it was encoding one platform's line breaking.
        //
        // So the foreign rasteriser decides. A sparse page is allowed exactly when poppler, which
        // shares no code with the product, finds it sparse too. A page that is blank HERE and
        // inked THERE still fails, which is the case this assertion exists for.
        const ink = inkPixels(decoded);
        const foreign = r.foreignInk[e.page - 1];
        assert.ok(
          ink > 500 || (foreign !== undefined && foreign <= 500),
          `${e.path} carries almost no ink (${ink} px) while poppler found ${foreign ?? "no measurement"} on the same page`,
        );
      }
      // Mutation control: two evidence pages of the same document must not be the same image.
      if (r.evidence.length > 1) {
        const a = decodePng(readFileSync(evidenceFile(r.evidence[0]!.path)));
        const b = decodePng(readFileSync(evidenceFile(r.evidence[1]!.path)));
        assert.notEqual(comparePng(a, b), 0, `${kase.name}: pages 1 and 2 are the same image`);
      }
    }
  });

  it("R4b — the product rasteriser and poppler agree on page count and size", { skip: live() ? false : "prerequisites absent" }, () => {
    const dir = mkdtempSync(join(tmpdir(), "breaklint-foreign-"));
    try {
      for (const kase of CASES) {
        const r = results.get(kase.name)!;
        const pdf = join(dir, `${kase.name}.pdf`);
        writeFileSync(pdf, r.deliveredPdf);
        execFileSync("pdftoppm", ["-png", "-r", "96", pdf, join(dir, kase.name)]);
        const foreign = readdirSync(dir).filter((f) => f.startsWith(`${kase.name}-`) && f.endsWith(".png")).sort();
        assert.equal(foreign.length, r.evidence.length, `${kase.name}: page count differs from the foreign rasteriser`);
        for (let i = 0; i < foreign.length; i++) {
          const theirs = decodePng(readFileSync(join(dir, foreign[i]!)));
          const ours = decodePng(readFileSync(evidenceFile(r.evidence[i]!.path)));
          // Tolerance 1 px: the two rasterisers round the page box differently. Anything larger
          // is a disagreement about the document, not about rounding.
          assert.ok(Math.abs(theirs.width - ours.width) <= 1, `${kase.name} page ${i + 1} width ${ours.width} vs ${theirs.width}`);
          assert.ok(Math.abs(theirs.height - ours.height) <= 1, `${kase.name} page ${i + 1} height ${ours.height} vs ${theirs.height}`);
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("no case reported a rasteriser page error", { skip: live() ? false : "prerequisites absent" }, () => {
    assert.deepEqual([...rasterizer.pageErrors()], []);
  });
});
