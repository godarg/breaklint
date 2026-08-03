/**
 * The evidence path, end to end: a pristine PDF, a marked PDF, one decision, one set of PNG files.
 *
 * The order below is normative, and the FIRST step is where an earlier draft of this file was
 * wrong in a way its own tests could not see:
 *
 *   1. PDF_baseline := page.pdf()        BEFORE any overlay exists
 *   2. attach the overlay and set the marks
 *   3. read the isolated properties back — a diagnosis, never the conclusion
 *   4. PDF_marked  := page.pdf()
 *   5. detach and remove the overlay, then close the content page
 *   6. rasterise both PDFs and compare them AGAINST EACH OTHER
 *   7. equal and intact -> the evidence binds, PDF_marked is delivered
 *      otherwise        -> `mark-raster-diff`, every binding of this document is false,
 *                          and PDF_baseline is delivered
 *
 * **Why the baseline comes first.** The earlier order produced the unmarked PDF by DETACHING the
 * overlay again. A document that reacts to the overlay appearing — a `MutationObserver` that
 * recolours a paragraph when the layer arrives — leaves that change behind when the layer goes.
 * Both PDFs then carry the same corruption, the comparison reports zero, the binding is kept,
 * and the delivered file is the damaged one. The control carried the intervention. Taking the
 * baseline before the overlay has ever existed removes that whole class: the comparison is now
 * between a document that was never touched and a document that was.
 *
 * **Why the comparison is PDF against PDF and not screenshot against screenshot.** The paginator
 * rewrites the media condition of every author sheet to `print`, so a `@media print` rule
 * applies on screen too — which is why the obvious counter-example does not work. The gap is
 * elsewhere: sheets the paginator never saw, because they enter the tree after pagination.
 * breaklint itself attaches its layer after pagination, and a document may do the same. Those
 * cases are invisible to a screen comparison, and the screen comparison let two of them through,
 * the worst at 280 630 changed pixels in the delivered PDF.
 *
 * One claim this file does not make: that a screen diff of zero implies a bound finding. It was
 * made twice, retracted twice, and the second retraction was measured inside the very corpus the
 * claim had been narrowed to. A retreat to a smaller scope is itself a new claim and needs its
 * own run.
 *
 * What happens when the decision cannot be made at all — no rasteriser — is stated rather than
 * assumed: not being able to check is not the same as having checked and found nothing. The
 * document then gets the PDF that never saw an overlay, and every binding is false.
 */

import { join } from "node:path";

import type { PageLike } from "../acquire/browser.ts";
import type { Evidence, InfraEvent, NotMeasured } from "../core/types.ts";
import type { PlacedMark } from "./overlay.ts";
import { detachOverlay, installOverlay, readbackViolations, removeOverlay } from "./overlay.ts";
import type { PdfTextPage, RasterPage, Rasterizer } from "./rasterizer.ts";
import { readPngHeader, writeEvidencePng } from "./rasterizer.ts";

/** CSS pixels per millimetre, and PDF points per millimetre. Both are definitions, not measurements. */
const PX_PER_MM = 96 / 25.4;
const MM_PER_PT = 25.4 / 72;

/**
 * §11.4.3. The contract derives this from a measured `sd(Δy)` of 0.0777 mm on its own document.
 * This build measures 0.1141 mm on its own, which is about threefold headroom rather than the
 * fourfold the contract's arithmetic suggests. The number is unchanged; the justification for it
 * is weaker than the contract states, and that is written here rather than left implied.
 */
export const CONFORMANCE_TOLERANCE_MM = 0.35;

/**
 * A page's `Δy` values are judged against their own mean, because a mark's `top` is a box edge
 * while the PDF item's `y` is a glyph baseline — every `Δy` carries the same constant offset.
 * With a single pair that mean IS the value, so `|Δy − mean|` is 0 no matter how wrong the mark
 * is. Measured: a mark placed 40 mm off came out bound. A page therefore needs at least this
 * many pairs before the `Δy` criterion means anything.
 */
const MIN_PAIRS_FOR_DY = 2;

export interface EvidenceOptions {
  outDir: string;
  /** File-name stem for this document's artefacts. */
  documentKey: string;
  dpi?: number;
  /** `--no-evidence-binding`. Off means: no overlay at all, and every binding is false. */
  binding: boolean;
}

export interface EvidenceOutcome {
  evidence: Evidence[];
  infrastructure: InfraEvent[];
  notMeasured: NotMeasured[];
  /** Which source blocks came out bound. Rules consult this when filling `Finding.evidence`. */
  boundSids: ReadonlySet<string>;
  marks: PlacedMark[];
  /** Marks whose token was not found exactly once in the PDF text stream. Read, not just kept. */
  ambiguousMarks: number;
  deliveredPdf: Uint8Array;
  /** True only when the delivered PDF is the one that carried the overlay. */
  deliveredWithOverlay: boolean;
  /**
   * Both candidates, kept for one purpose: an independent rasteriser has to be able to judge
   * the same bytes this module judged. Re-creating the overlay dance in a test to get at them
   * would mean testing a copy of the procedure rather than the procedure. The CLI ignores them.
   */
  candidates: { marked: Uint8Array | null; baseline: Uint8Array };
}

export interface ProduceEvidenceInput {
  page: PageLike;
  /** Closes the paginated document page. Called before any rasterising, never after. */
  closePage: () => Promise<void>;
  /** Null when no rasteriser could be opened. Then nothing binds, and the report says so. */
  rasterizer: Rasterizer | null;
  options: EvidenceOptions;
}

export async function produceEvidence(input: ProduceEvidenceInput): Promise<EvidenceOutcome> {
  const { page, closePage, rasterizer, options } = input;
  const dpi = options.dpi ?? 96;
  const infrastructure: InfraEvent[] = [];
  const notMeasured: NotMeasured[] = [];
  // The rasteriser's error list runs for the lifetime of the run, not of one document. Anything
  // that was already there belongs to an earlier document and is not this one's fault.
  const errorsAtStart = rasterizer?.pageErrors().length ?? 0;

  // --- 1. the baseline, taken before anything of ours exists in the document -----------------
  const baseline = await page.pdf({ printBackground: true, preferCSSPageSize: true });

  if (!options.binding) {
    await closePage();
    return finish({
      pdf: baseline,
      withOverlay: false,
      candidates: { marked: null, baseline },
      marks: [],
      ambiguousMarks: 0,
      styleViolations: 0,
      rasterDiffPx: 0,
      overlayRemoved: false,
      bindingPossible: false,
      // No overlay was ever installed, so nothing was removed. Saying `env/evidence-overlay-removed`
      // here would make "the user switched binding off" indistinguishable from "the overlay had
      // an effect", and the report already carries `config.evidenceBinding`.
      overlayInstalled: false,
      rasterizer,
      options,
      dpi,
      infrastructure,
      notMeasured,
      errorsAtStart,
    });
  }

  // --- 2 and 3 -------------------------------------------------------------------------------
  const installation = await installOverlay(page);
  const violations = await readbackViolations(page);

  // --- 4 and 5 -------------------------------------------------------------------------------
  const marked = await page.pdf({ printBackground: true, preferCSSPageSize: true });
  const detached = await detachOverlay(page);
  await removeOverlay(page);
  // §11.4a.2: everything below this line needs the content page gone. Measured at this product:
  // 45 003 ms with a page open, 109 ms without.
  await closePage();

  // Two measurements that used to be recorded and never consulted. A layer that could not be
  // detached is still in the document, and a page area that is `static` is not a containing
  // block for the absolutely positioned marks — their coordinates are then meaningless and a
  // zero diff would not notice.
  const integrityOk = installation.staticPageAreas === 0 && detached === installation.layers;
  if (installation.staticPageAreas > 0) {
    infrastructure.push({
      kind: "checker-crashed",
      detail:
        `${installation.staticPageAreas} page area(s) were position:static. Measured against ` +
        "paged.js 0.4.3, 0 of 4 were. The overlay places absolutely positioned marks and needs " +
        "the area to be a containing block; this build does not intervene to make it one, and " +
        "the binding is dropped instead.",
      measured: { staticPageAreas: installation.staticPageAreas, envId: "env/page-area-static" },
    });
  }
  if (detached !== installation.layers) {
    infrastructure.push({
      kind: "checker-crashed",
      detail: `overlay detach incomplete: ${installation.layers} layer(s) installed, ${detached} detached.`,
      measured: { installed: installation.layers, detached },
    });
  }

  // --- 6 -------------------------------------------------------------------------------------
  if (rasterizer === null) {
    return finish({
      pdf: baseline,
      withOverlay: false,
      candidates: { marked, baseline },
      marks: installation.marks,
      ambiguousMarks: 0,
      styleViolations: violations.length,
      rasterDiffPx: -1,
      overlayRemoved: true,
      bindingPossible: false,
      overlayInstalled: true,
      rasterizer,
      options,
      dpi,
      infrastructure,
      notMeasured,
      errorsAtStart,
    });
  }

  const keyMarked = `${options.documentKey}:marked`;
  const keyBaseline = `${options.documentKey}:baseline`;
  let pagesMarked: RasterPage[];
  let pagesBaseline: RasterPage[];
  let diffPixels: number;
  try {
    pagesMarked = await rasterizer.rasterise(keyMarked, marked, dpi);
    pagesBaseline = await rasterizer.rasterise(keyBaseline, baseline, dpi);
    const diff = await rasterizer.diff(keyMarked, keyBaseline);
    diffPixels = diff.pixels;
    if (diff.pixels !== 0) {
      infrastructure.push({
        kind: "mark-raster-diff",
        detail:
          diff.pixels < 0
            ? `the two PDFs are not comparable: ${diff.pagesA} page(s) with the overlay, ${diff.pagesB} without.`
            : `${diff.pixels} pixel(s) of the delivered PDF depend on the overlay being present.`,
        measured: { rasterDiffPx: diff.pixels, pagesMarked: diff.pagesA, pagesBaseline: diff.pagesB },
      });
    }
  } catch (error) {
    // A rasteriser that threw has said nothing about the overlay. That is not "no difference".
    await release(rasterizer, keyMarked, keyBaseline);
    infrastructure.push({
      kind: "checker-crashed",
      detail: `the rasteriser failed while comparing the two PDFs: ${String(error).slice(0, 300)}`,
      measured: null,
    });
    return finish({
      pdf: baseline,
      withOverlay: false,
      candidates: { marked, baseline },
      marks: installation.marks,
      ambiguousMarks: 0,
      styleViolations: violations.length,
      rasterDiffPx: -1,
      overlayRemoved: true,
      bindingPossible: false,
      overlayInstalled: true,
      rasterizer,
      options,
      dpi,
      infrastructure,
      notMeasured,
      errorsAtStart,
    });
  }

  const rasterErrors = rasterizer.pageErrors().length - errorsAtStart;
  if (rasterErrors > 0) {
    infrastructure.push({
      kind: "checker-crashed",
      detail: `the rasteriser page reported ${rasterErrors} error(s): ${rasterizer.pageErrors().slice(0, 3).join(" | ")}`,
      measured: { rasterPageErrors: rasterErrors },
    });
  }

  const clean = violations.length === 0 && diffPixels === 0 && rasterErrors === 0 && integrityOk;
  if (violations.length > 0) {
    infrastructure.push({
      kind: "mark-style-overridden",
      detail: violations.slice(0, 5).map((v) => `${v.token}: ${v.why}`).join("; "),
      measured: { violations: violations.length, marks: installation.marks.length },
    });
  }

  // --- 7 -------------------------------------------------------------------------------------
  const deliveredKey = clean ? keyMarked : keyBaseline;
  const deliveredPages = clean ? pagesMarked : pagesBaseline;
  try {
    await rasterizer.release(clean ? keyBaseline : keyMarked);
    // The comparison is over; the pixel buffers are no longer needed, only the canvases the PNG
    // encoding draws from. This halves what the page holds from here on.
    await rasterizer.dropPixels(deliveredKey);

    const textPages = clean ? await rasterizer.textItems(marked) : null;
    const conformance = textPages ? matchMarks(installation.marks, textPages) : null;

    return await finish({
      pdf: clean ? marked : baseline,
      withOverlay: clean,
      candidates: { marked, baseline },
      marks: installation.marks,
      ambiguousMarks: conformance?.ambiguous ?? 0,
      styleViolations: violations.length,
      rasterDiffPx: diffPixels,
      overlayRemoved: !clean,
      bindingPossible: clean,
      overlayInstalled: true,
      rasterizer,
      options,
      dpi,
      infrastructure,
      notMeasured,
      errorsAtStart,
      held: { key: deliveredKey, pages: deliveredPages },
      conformance,
    });
  } finally {
    await release(rasterizer, deliveredKey);
  }
}

async function release(rasterizer: Rasterizer, ...keys: string[]): Promise<void> {
  for (const key of keys) {
    try {
      await rasterizer.release(key);
    } catch {
      // A release that fails leaves memory behind but must not mask the error that got us here.
    }
  }
}

/** What the mark extraction found, per page and per source block. */
export interface MarkConformance {
  boundSids: Set<string>;
  byPage: Map<number, PageConformance>;
  /** Marks whose token appeared zero times or more than once in the page's text stream. */
  ambiguous: number;
}

export interface PageConformance {
  marksMatched: number;
  marksTotal: number;
  maxDxMm: number;
  maxDyMm: number;
  sdDyMm: number;
  /** Source blocks with at least one mark on this page. */
  targetsTotal: number;
  /** Of those, the ones with at least one uniquely refound mark inside the tolerance. */
  targetsBound: number;
  /** False when the page has too few pairs for the mean-relative `Δy` criterion to say anything. */
  dyNormalisable: boolean;
}

/**
 * Pair each placed mark with its text item in the produced PDF.
 *
 * The comparison is deliberately asymmetric: `Δx` is judged in absolute terms, `Δy` against the
 * MEAN of all `Δy` on the page. A mark's `top` is a box edge; the PDF item's `y` is a glyph
 * baseline, so every `Δy` carries the same small constant offset. Judging `|Δy|` absolutely
 * would measure that offset rather than the divergence, and the tolerance would be describing a
 * font metric.
 *
 * That asymmetry has a hole at the bottom, and it is guarded rather than hoped away: with one
 * pair the mean is the value, so `|Δy − mean|` is zero however wrong the mark is. Below
 * `MIN_PAIRS_FOR_DY` the page reports `dyNormalisable: false` and binds nothing.
 *
 * An earlier release stated a global quota — "at least 90 % of marks matched". That is unusable:
 * the missing tenth can be exactly the targets a finding hangs on. Binding is decided per target,
 * and a target needs ONE of its two marks to be found within tolerance, not both.
 */
export function matchMarks(marks: readonly PlacedMark[], pages: readonly PdfTextPage[]): MarkConformance {
  interface Paired {
    mark: PlacedMark;
    dxMm: number;
    dyMm: number;
  }
  const pairedByPage = new Map<number, Paired[]>();
  const totalByPage = new Map<number, number>();
  const targetsByPage = new Map<number, Set<string>>();
  let ambiguous = 0;

  for (const mark of marks) {
    totalByPage.set(mark.page, (totalByPage.get(mark.page) ?? 0) + 1);
    const targets = targetsByPage.get(mark.page) ?? new Set<string>();
    targets.add(mark.sid);
    targetsByPage.set(mark.page, targets);

    const page = pages[mark.page - 1];
    if (!page) {
      ambiguous++;
      continue;
    }
    const hits = page.items.filter((item) => item.text.replace(/\s+/gu, "") === mark.token);
    if (hits.length !== 1) {
      // Zero and two are the same answer here: the mark was not UNIQUELY refound, so it cannot
      // stand for a position. Counting a two-hit token as found would bind a finding to whichever
      // of the two the code happened to look at first.
      ambiguous++;
      continue;
    }
    const hit = hits[0]!;
    const list = pairedByPage.get(mark.page) ?? [];
    list.push({
      mark,
      dxMm: mark.xPx / PX_PER_MM - hit.x * MM_PER_PT,
      dyMm: mark.yPx / PX_PER_MM - (page.heightPt - hit.y) * MM_PER_PT,
    });
    pairedByPage.set(mark.page, list);
  }

  const boundSids = new Set<string>();
  const byPage = new Map<number, PageConformance>();

  for (const [pageNumber, targets] of targetsByPage) {
    const paired = pairedByPage.get(pageNumber) ?? [];
    const dys = paired.map((p) => p.dyMm);
    const meanDy = dys.length ? dys.reduce((a, b) => a + b, 0) / dys.length : 0;
    const sdDy =
      dys.length > 1 ? Math.sqrt(dys.reduce((s, v) => s + (v - meanDy) ** 2, 0) / (dys.length - 1)) : 0;
    const dyNormalisable = paired.length >= MIN_PAIRS_FOR_DY;

    const boundHere = new Set<string>();
    if (dyNormalisable) {
      for (const p of paired) {
        if (
          Math.abs(p.dxMm) <= CONFORMANCE_TOLERANCE_MM &&
          Math.abs(p.dyMm - meanDy) <= CONFORMANCE_TOLERANCE_MM
        ) {
          boundHere.add(p.mark.sid);
          boundSids.add(p.mark.sid);
        }
      }
    }

    byPage.set(pageNumber, {
      marksMatched: paired.length,
      marksTotal: totalByPage.get(pageNumber) ?? 0,
      maxDxMm: paired.length ? round4(Math.max(...paired.map((p) => Math.abs(p.dxMm)))) : 0,
      maxDyMm: paired.length ? round4(Math.max(...paired.map((p) => Math.abs(p.dyMm - meanDy)))) : 0,
      sdDyMm: round4(sdDy),
      targetsTotal: targets.size,
      targetsBound: boundHere.size,
      dyNormalisable,
    });
  }
  return { boundSids, byPage, ambiguous };
}

const round4 = (v: number): number => Math.round(v * 10_000) / 10_000;

interface FinishInput {
  pdf: Uint8Array;
  withOverlay: boolean;
  candidates: { marked: Uint8Array | null; baseline: Uint8Array };
  marks: PlacedMark[];
  ambiguousMarks: number;
  styleViolations: number;
  rasterDiffPx: number;
  overlayRemoved: boolean;
  bindingPossible: boolean;
  /** False on the path where binding was switched off and no layer ever existed. */
  overlayInstalled: boolean;
  rasterizer: Rasterizer | null;
  options: EvidenceOptions;
  dpi: number;
  infrastructure: InfraEvent[];
  notMeasured: NotMeasured[];
  /** How many rasteriser page errors existed BEFORE this document. The list is cumulative. */
  errorsAtStart: number;
  /** Set when the delivered PDF is already rasterised and held under this key. */
  held?: { key: string; pages: RasterPage[] };
  conformance?: MarkConformance | null;
}

/**
 * Write the PNG files and assemble the `Evidence` records.
 *
 * The evidence image is produced even when the binding is lost. That is the point of separating
 * the two: the reader still gets to see the page, and the report says in its own field that the
 * picture is evidence of the PDF and not of the finding.
 *
 * A page counts as bound when EVERY source block with a mark on it has at least one mark inside
 * the tolerance. An earlier version asked only whether every mark had been refound — which is a
 * question about the extractor, not about the geometry. It reported `verified` for a page whose
 * marks sat 40 mm from where the DOM said they were.
 */
async function finish(input: FinishInput): Promise<EvidenceOutcome> {
  const { rasterizer, options, dpi, infrastructure, notMeasured } = input;
  const evidence: Evidence[] = [];
  const boundSids = new Set(input.conformance?.boundSids ?? []);

  if (input.overlayInstalled && !input.bindingPossible) {
    notMeasured.push({
      scope: "document",
      ruleId: null,
      reason: "env/evidence-overlay-removed",
      target: null,
      count: 1,
    });
  }

  // Any page whose evidence file could not be written. A binding whose evidence does not exist
  // is a binding that cannot be checked, so one failure withdraws the bindings of the whole
  // document: the marks carry no page-to-target map at this point, and a partly-evidenced
  // document that says nothing about which part is worse than one that binds nothing.
  let evidenceIncomplete = false;

  if (rasterizer !== null) {
    const key = input.held?.key ?? `${options.documentKey}:delivered`;
    let pages: RasterPage[];
    try {
      pages = input.held?.pages ?? (await rasterizer.rasterise(key, input.pdf, dpi));
    } catch (error) {
      infrastructure.push({
        kind: "checker-crashed",
        detail: `the delivered PDF could not be rasterised for evidence: ${String(error).slice(0, 300)}`,
        measured: null,
      });
      return outcome(input, [], new Set<string>());
    }

    try {
      for (let i = 0; i < pages.length; i++) {
        const path = join(options.outDir, `${options.documentKey}-page-${String(i + 1).padStart(3, "0")}.png`);
        const bytes = await rasterizer.encodePng(key, i);
        // Read the header back out of the bytes that are about to be written. A file that claims
        // a size the rasteriser did not report is not the evidence, it is a second image.
        const header = readPngHeader(bytes);
        const expected = pages[i]!;
        if (!header.signature || !header.ihdr || header.width !== expected.width || header.height !== expected.height) {
          infrastructure.push({
            kind: "checker-crashed",
            detail:
              `the bytes for page ${i + 1} are not a PNG of the size the rasteriser reported ` +
              `(header ${header.width}x${header.height}, reported ${expected.width}x${expected.height}).`,
            measured: { page: i + 1, bytes: bytes.length, header, reported: expected },
          });
          evidenceIncomplete = true;
          continue;
        }
        writeEvidencePng(path, bytes);

        const perPage = input.conformance?.byPage.get(i + 1) ?? null;
        const pageBound =
          input.bindingPossible &&
          perPage !== null &&
          perPage.dyNormalisable &&
          perPage.targetsTotal > 0 &&
          perPage.targetsBound === perPage.targetsTotal;
        evidence.push({
          key: `${options.documentKey}#${i + 1}`,
          page: i + 1,
          path,
          origin: "pdf-raster",
          // "verified" requires that an extractor was present AND every target of the page
          // bound. Absent extractor is not an infrastructure fault; it is an unverified page,
          // and the report carries that word rather than a silence.
          pdfConformance: pageBound ? "verified" : "unverified",
          conformance: perPage
            ? {
                marksMatched: perPage.marksMatched,
                marksTotal: perPage.marksTotal,
                maxDxMm: perPage.maxDxMm,
                maxDyMm: perPage.maxDyMm,
                sdDyMm: perPage.sdDyMm,
              }
            : null,
          overlayCheck: {
            styleViolations: input.styleViolations,
            rasterDiffPx: input.rasterDiffPx,
            removed: input.overlayRemoved,
          },
          bindsFinding: pageBound,
        });
      }
    } finally {
      if (!input.held) await release(rasterizer, key);
    }

    if (input.bindingPossible && pages.length === 0) {
      infrastructure.push({
        kind: "checker-crashed",
        detail: "the delivered PDF rasterised to zero pages, so no evidence exists to bind to.",
        measured: { pages: 0 },
      });
      evidenceIncomplete = true;
    }

    // Read the error list AGAIN. Encoding and extraction happen after the comparison was judged,
    // and a fault there would otherwise arrive too late to change anything — which is exactly
    // what the interface promises it cannot do. Counted from where THIS document started: the
    // list is cumulative over the run, and charging document 3 with document 1's fault would
    // make one early error permanently unbindable for everything after it.
    const lateErrors = rasterizer.pageErrors().length - input.errorsAtStart;
    if (lateErrors > 0 && input.bindingPossible) {
      infrastructure.push({
        kind: "checker-crashed",
        detail:
          `the rasteriser page reported ${lateErrors} error(s) while producing this document's ` +
          "evidence; every binding of this document is withdrawn.",
        measured: { rasterPageErrors: lateErrors, whenNoticed: "after encoding" },
      });
      evidenceIncomplete = true;
    }

    if (evidenceIncomplete) {
      for (const e of evidence) {
        e.bindsFinding = false;
        e.pdfConformance = "unverified";
      }
      boundSids.clear();
    }
  }

  return outcome(input, evidence, boundSids);
}

function outcome(input: FinishInput, evidence: Evidence[], boundSids: Set<string>): EvidenceOutcome {
  return {
    evidence,
    infrastructure: input.infrastructure,
    notMeasured: input.notMeasured,
    boundSids,
    marks: input.marks,
    ambiguousMarks: input.ambiguousMarks,
    deliveredPdf: input.pdf,
    deliveredWithOverlay: input.withOverlay,
    candidates: input.candidates,
  };
}
