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
 * `Δy` is judged against a REFERENCE rather than absolutely, because a mark's `top` is a box edge
 * while the PDF item's `y` is a glyph baseline — every `Δy` carries the same constant offset.
 * Judging `|Δy|` absolutely would measure that offset instead of the divergence.
 *
 * The reference is chosen in this order, and the order is the whole point:
 *
 *   - the page's own median, when the page has at least this many refound pairs. This is what
 *     the contract intends, and it is immune to a document whose zones differ — a title page in
 *     a display face and a body page in a text face need not share an offset.
 *   - otherwise the DOCUMENT's median. A page with a single pair has no usable reference of its
 *     own: with one value the median IS that value, so `|Δy − median|` is 0 however wrong the
 *     mark is. Measured before this existed: a mark placed 40 mm off came out bound.
 *
 * A document with fewer than this many refound pairs in total has no reference at all, and
 * nothing in it binds. That case is stated in the report rather than resolved.
 */
const MIN_PAIRS_FOR_REFERENCE = 2;

/**
 * Pairs a page needs before it may be called DIVERGENT — which is fatal, unlike merely binding
 * nothing.
 *
 * Two is enough to carry a reference and not enough to defend one. At two the median IS the mean,
 * so a single outlier moves it by half its own error and drags a CORRECT neighbour out of
 * tolerance with it. Measured on this build: one mark placed exactly right beside one displaced by
 * 40 mm bound nothing and raised `dom-pdf-divergence`, aborting the run over a page that contained
 * a perfectly good mark. At three, an outlier cannot move the median past the two that agree.
 *
 * A two-pair page that binds nothing is therefore `unverified` — "no evidence" — rather than
 * `render-unstable`. That is the weaker and honest statement, and it is the direction this whole
 * mechanism is supposed to fail in.
 */
const MIN_PAIRS_FOR_DIVERGENCE = 3;

/**
 * The largest `Δy` reference this build treats as a baseline offset rather than as a displacement.
 *
 * WHY A BOUND IS NEEDED AT ALL. `Δy` is judged as a residual around a reference taken from the
 * marks themselves. That normalisation has no floor: if EVERY mark is displaced by the same
 * amount, the reference absorbs it, every residual is 0, and the page reports `maxDyMm: 0.0000` —
 * the most confident answer the tool can give — while the PDF does not reproduce the DOM at all.
 * Measured on this build before the bound existed: a constructed 40 mm uniform displacement bound
 * every target and reported `maxDyMm: 0`. `Δx` never had this hole; it is judged absolutely.
 *
 * WHY THIS NUMBER. Measured first, then set — in that order, because the reverse is how this
 * project has produced most of its defects. Over the live corpus the largest absolute reference on
 * any binding page is `REFERENCE_CORPUS_MAX_ABS_MM` (0.0909 mm), which is what the mark's own
 * styling predicts: `font-size: 1px; line-height: 0` puts the glyph baseline within about a pixel
 * of the box edge, and a pixel is 0.26 mm. The bound is 1.0 mm — eleven times the measured maximum,
 * so it cannot fire on the baseline offset it exists to tolerate, and under three times the
 * residual tolerance, so it catches displacements long before they reach the scale any rule
 * reasons about. The live suite fails if the corpus ever exceeds the measured maximum, so the
 * headroom cannot silently erode.
 *
 * WHAT IT IS NOT. It is not calibrated. Three binding documents on one machine with one font stack
 * are not a corpus, and the bound would have to move for a document whose marks sit in a writing
 * mode or font this build never rendered. It is a named gap (L-36), not a settled threshold, and
 * it fails in the conservative direction: too small a bound withdraws bindings, it never invents
 * them.
 */
export const MAX_REFERENCE_DY_MM = 1.0;

/**
 * The largest absolute reference measured over the live corpus, in millimetres.
 * Measured 2026-08-04 over eight documents; the three that bind report 0.0909, 0.0909 and 0.0496.
 */
export const REFERENCE_CORPUS_MAX_ABS_MM = 0.0909;

/** The median, not the mean: one grossly displaced mark drags a mean and does not move a median. */
function median(values: readonly number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

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

  // --- 2 to 5 --------------------------------------------------------------------------------
  // Everything that touches the page sits inside one try, and the page is closed in the finally.
  // Without it, a throw anywhere in here leaves the content page open — and since the ordering
  // guard now refuses every rasteriser call while one is, a single failed document would take
  // every later document of the run down with it.
  let installation, violations, marked: Uint8Array, detached: number;
  try {
    installation = await installOverlay(page);
    violations = await readbackViolations(page);
    marked = await page.pdf({ printBackground: true, preferCSSPageSize: true });
    detached = await detachOverlay(page);
    await removeOverlay(page);
  } catch (error) {
    await closePage();
    infrastructure.push({
      kind: "checker-crashed",
      detail: `the evidence overlay failed on this document: ${String(error).slice(0, 300)}`,
      measured: null,
    });
    return finish({
      pdf: baseline,
      withOverlay: false,
      candidates: { marked: null, baseline },
      marks: [],
      ambiguousMarks: 0,
      styleViolations: 0,
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
  // §11.4a.2: everything below this line needs the content page gone. Measured at this product:
  // no answer at all inside 15 s with a page open, well under a second without one.
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

    // §11.4.3 names `dom-pdf-divergence` and gives it exit 3, next to a rule that gives the same
    // case a false binding flag. Both are right, for different scopes: a target out of tolerance
    // is a finding without evidence, and a PAGE whose own marks all miss is an apparatus that
    // disagrees with itself. The rules measured the DOM; if the PDF does not reproduce that page,
    // a report of findings on it describes a document nobody will see.
    if (conformance && conformance.divergentPages > 0) {
      const pages = [...conformance.byPage].filter(([, c]) => c.divergent).map(([n]) => n);
      infrastructure.push({
        kind: "render-unstable",
        // The message states what was measured per page rather than a summary that holds for some
        // pages and not others. An earlier wording said "every mark was refound", which the
        // trigger does not require: a page needs only enough uniquely refound pairs to carry a
        // reference, so 2 of 20 marks refound produced a fatal event claiming all 20 were.
        detail:
          `dom-pdf-divergence on page(s) ${pages.join(", ")}: the PDF does not reproduce the ` +
          "geometry the rules measured. Per page below, `refound` of `placed` marks were located " +
          "uniquely in the text stream, and `reason` says whether those marks scattered around " +
          "their own reference or agreed on a reference that is itself displaced.",
        measured: {
          divergentPages: conformance.divergentPages,
          pages,
          toleranceMm: CONFORMANCE_TOLERANCE_MM,
          maxReferenceDyMm: MAX_REFERENCE_DY_MM,
          // The reference a page BORROWS when it has too few pairs of its own. Reported because a
          // displaced document median explains several pages at once, and reading the per-page
          // numbers without it invites the same mistake twice.
          documentMedianDyMm: conformance.documentMedianDyMm,
          perPage: pages.map((n) => {
            const c = conformance.byPage.get(n)!;
            return {
              page: n,
              refound: c.marksMatched,
              placed: c.marksTotal,
              maxDxMm: c.maxDxMm,
              maxDyMm: c.maxDyMm,
              referenceDyMm: c.referenceDyMm,
              referenceFrom: c.referenceFrom,
              reason: c.referenceOutOfRange ? "reference-displaced" : "marks-scattered",
            };
          }),
        },
      });
    }

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
  /** Pages that had their own reference and still bound nothing. See `PageConformance.divergent`. */
  divergentPages: number;
  documentMedianDyMm: number;
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
  /** Where the `Δy` reference came from. `none` means the document had too few pairs as well. */
  referenceFrom: "page" | "document" | "none";
  /**
   * The reference itself, in millimetres — the value `maxDyMm` is a residual around.
   *
   * Reported because without it `maxDyMm` cannot be read honestly: a page whose marks are ALL
   * displaced by the same amount reports `maxDyMm: 0` however large that amount is. The residual
   * says the marks agree with each other; only the reference says what they agree ON.
   */
  referenceDyMm: number;
  /** The reference exceeded `MAX_REFERENCE_DY_MM` — a common displacement, not a baseline offset. */
  referenceOutOfRange: boolean;
  /**
   * The page carried its own reference and still bound nothing — its marks are in the PDF and
   * they are in the wrong place. This is `dom-pdf-divergence`, and it is an infrastructure fault
   * rather than a document property: the rules measured the DOM, and the PDF does not reproduce
   * it. A report of findings on such a page would describe a document nobody will see.
   */
  divergent: boolean;
}

/**
 * Pair each placed mark with its text item in the produced PDF.
 *
 * The comparison is deliberately asymmetric: `Δx` is judged in absolute terms, `Δy` as a residual
 * around a REFERENCE. A mark's `top` is a box edge; the PDF item's `y` is a glyph baseline, so
 * every `Δy` carries the same small constant offset. Judging `|Δy|` absolutely would measure that
 * offset rather than the divergence, and the tolerance would be describing a font metric.
 *
 * The reference is staged: the page's own median where it has at least `MIN_PAIRS_FOR_REFERENCE`
 * uniquely refound pairs, otherwise the document's median, and where the document has too few
 * pairs there is no reference and nothing binds.
 *
 * That asymmetry has two holes. Both are guarded rather than hoped away, because both were
 * measured OPEN on an earlier build of this file:
 *
 *   - At the bottom. With one pair the median is the value, so `|Δy − reference|` is zero however
 *     wrong the mark is; a verifier measured a mark displaced 40 mm counted as bound. Binding
 *     needs `MIN_PAIRS_FOR_REFERENCE`; calling a page DIVERGENT — which is fatal — needs
 *     `MIN_PAIRS_FOR_DIVERGENCE`, because at two pairs the median is the mean and one outlier
 *     drags a correct neighbour out of tolerance with it.
 *   - In the middle, and this one is not a matter of degree. A residual cannot see a displacement
 *     shared by every mark: the reference absorbs it and `maxDyMm` reports 0.0000 for a uniform
 *     shift of any size. `MAX_REFERENCE_DY_MM` bounds the reference itself for that reason.
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
  const allDys = [...pairedByPage.values()].flat().map((p) => p.dyMm);
  const documentMedian = median(allDys);
  const documentReferenceUsable = allDys.length >= MIN_PAIRS_FOR_REFERENCE;
  let divergentPages = 0;

  for (const [pageNumber, targets] of targetsByPage) {
    const paired = pairedByPage.get(pageNumber) ?? [];
    const dys = paired.map((p) => p.dyMm);
    const ownReference = paired.length >= MIN_PAIRS_FOR_REFERENCE;
    const reference = ownReference ? median(dys) : documentMedian;
    const referenceUsable = ownReference || documentReferenceUsable;
    const meanDy = dys.length ? dys.reduce((a, b) => a + b, 0) / dys.length : 0;
    const sdDy =
      dys.length > 1 ? Math.sqrt(dys.reduce((s, v) => s + (v - meanDy) ** 2, 0) / (dys.length - 1)) : 0;

    // A reference far from zero is not a baseline offset, it is a common displacement, and the
    // residual below cannot see it — which is why this is not expressed as a tolerance on
    // `dyMm - reference`. Nothing on such a page binds.
    const referenceOutOfRange = referenceUsable && Math.abs(reference) > MAX_REFERENCE_DY_MM;

    const boundHere = new Set<string>();
    if (referenceUsable && !referenceOutOfRange) {
      for (const p of paired) {
        if (
          Math.abs(p.dxMm) <= CONFORMANCE_TOLERANCE_MM &&
          Math.abs(p.dyMm - reference) <= CONFORMANCE_TOLERANCE_MM
        ) {
          boundHere.add(p.mark.sid);
          boundSids.add(p.mark.sid);
        }
      }
    }

    // A page that carried its OWN reference and still bound nothing is divergent, and the word
    // is precise: its marks disagree with the DOM beyond the tolerance while agreeing among
    // themselves about where the reference is. A systematic horizontal shift does exactly that,
    // because `Δx` is judged absolutely. This cannot be a reference artefact — the reference came
    // from the page itself — which is why the condition is restricted to `ownReference`. A page
    // with a single pair simply has no reference and is silent, never divergent.
    // Two disjoint ways for a page to be divergent, and both need the same robustness floor.
    //
    //   `boundHere.size === 0` — the marks agreed on a reference and none sits within tolerance
    //   OF it: they scatter.
    //   `referenceOutOfRange`  — they agreed on a reference that is itself displaced. The residual
    //   is then small or zero, so the first condition would never fire.
    //
    // The floor applies to both because a two-point reference is evidence of neither: one good
    // mark beside one outlier produces a reference halfway between them, which is simultaneously
    // out of range AND leaves both marks unbound. Reading that as a collapsed page aborts the run
    // over a single bad extraction. Below the floor the page binds nothing and stays `unverified`.
    //
    // `paired.length >= MIN_PAIRS_FOR_DIVERGENCE` implies `ownReference`, since the divergence
    // floor is the higher of the two — so a page can never be called divergent on a BORROWED
    // reference, which is what stops a wrong document median from aborting a run.
    const divergent = paired.length >= MIN_PAIRS_FOR_DIVERGENCE && (referenceOutOfRange || boundHere.size === 0);
    if (divergent) divergentPages++;

    byPage.set(pageNumber, {
      marksMatched: paired.length,
      marksTotal: totalByPage.get(pageNumber) ?? 0,
      maxDxMm: paired.length ? round4(Math.max(...paired.map((p) => Math.abs(p.dxMm)))) : 0,
      maxDyMm: paired.length ? round4(Math.max(...paired.map((p) => Math.abs(p.dyMm - reference)))) : 0,
      sdDyMm: round4(sdDy),
      targetsTotal: targets.size,
      targetsBound: boundHere.size,
      referenceFrom: ownReference ? "page" : referenceUsable ? "document" : "none",
      referenceDyMm: referenceUsable ? round4(reference) : 0,
      referenceOutOfRange,
      divergent,
    });
  }
  return { boundSids, byPage, ambiguous, divergentPages, documentMedianDyMm: round4(documentMedian) };
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
          perPage.referenceFrom !== "none" &&
          !perPage.divergent &&
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
                referenceDyMm: perPage.referenceDyMm,
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
