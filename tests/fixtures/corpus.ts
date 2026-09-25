/**
 * The snapshot corpus.
 *
 * Two halves, and the split is the point. The `trigger` fixtures each contain the complication
 * that makes exactly one rule fire — a corpus in which the breaking case is missing is not a
 * corpus. The `clean` fixtures contain the cases most likely to produce a false alarm: the
 * formula minus, the inch mark, the parity blank page, the deliberate chapter break, the
 * fully set page whose net fill reads far below 1.
 *
 * A false alarm on a clean fixture is a release blocker, not a note. A rule that cries wolf on
 * a correct document gets switched off after the second time, and a switched-off rule finds
 * nothing at all.
 */

import type { BlockRecord, Box, PageRecord, Snapshot, SvgRecord, SvgTextTarget, TextLine, TextRun } from "../../src/core/types.ts";
import { SNAPSHOT_SCHEMA_VERSION } from "../../src/core/enums.ts";

export interface CorpusEntry {
  name: string;
  kind: "trigger" | "clean";
  /** Which rule this fixture is about. Clean fixtures name the rule they must NOT trigger. */
  about: string;
  /** What makes it a real test — the complication that would be missing in a naive fixture. */
  complication: string;
  /**
   * Rules that may legitimately also fire here. Two rules can describe the same page from two
   * angles — a nearly empty page IS also an orphaned continuation page. The overlap has to be
   * DECLARED, so that an undeclared one stays a finding rather than being absorbed silently.
   */
  alsoFires?: string[];
  snapshot: Snapshot;
}

const box = (x: number, y: number, width: number, height: number) => ({ x, y, width, height });
const ink = (count: number) => ({ count, maskHash: `h${count}` });

function style(over: Partial<BlockRecord["effectiveStyle"]> = {}): BlockRecord["effectiveStyle"] {
  return {
    breakInside: "auto",
    breakBefore: "auto",
    breakAfter: "auto",
    columns: "auto",
    writingMode: "horizontal-tb",
    visibility: "visible",
    widows: 2,
    orphans: 2,
    textAlign: "left",
    wordSpacing: "normal",
    fontFamily: "Source Serif",
    fontSize: 11,
    lineHeight: 15.4,
    lang: "de",
    ...over,
  };
}

function page(n: number, over: Partial<PageRecord> = {}): PageRecord {
  return {
    pageNumber: n,
    nodeKey: `pg${n}`,
    epoch: 0,
    blank: false,
    isLast: false,
    contentBox: box(48, 48, 399, 606),
    marginBoxes: [],
    incomingBreakCause:
      n === 1
        ? { kind: "document-start", determinedBy: "document-boundary", cascadeHint: null }
        : { kind: "overflow", determinedBy: "break-token", cascadeHint: null },
    outgoingBreakCause: { kind: "overflow", determinedBy: "break-token", cascadeHint: null },
    fill: { vertical: 0.94, topGap: 0.02, net: 0.66, area: 1 },
    firstSemanticBlockKey: `sig:page${n}`,
    notMeasured: [],
    ...over,
  };
}

function block(id: string, over: Partial<BlockRecord> = {}): BlockRecord {
  return {
    nodeKey: id,
    sid: `s-${id}`,
    authorId: null,
    blockSignature: `signature of ${id}`,
    fragmentIndex: 0,
    fragmentCount: 1,
    page: 1,
    box: box(48, 48, 399, 60),
    tag: "p",
    classList: [],
    lineHeight: 15.4,
    spaceWidth: 4.2,
    effectiveStyle: style(),
    display: "block",
    marginCopies: 0,
    lines: [0],
    ...over,
  };
}

function line(blockKey: string, index: number, width = 399): TextLine {
  return {
    blockKey,
    index,
    box: box(48, 48 + index * 15.4, width, 15.4),
    visible: true,
    width,
    wordBoxes: null,
  };
}

function run(blockKey: string, text: string, over: Partial<TextRun> = {}): TextRun {
  return { blockKey, text, nodeType: "text", ancestorTags: ["p", "body"], lang: "de", excluded: false, ...over };
}

function snapshot(parts: {
  pages?: PageRecord[];
  blocks?: BlockRecord[];
  textLines?: TextLine[];
  textRuns?: TextRun[];
  svg?: SvgRecord[];
  uriRefs?: Snapshot["uriRefs"];
}): Snapshot {
  return {
    // The current stamp, not a literal: these are hand-authored snapshots of the current shape,
    // and the engine refuses any other stamp. A literal 2 stood here through schemas 3 and 4,
    // which is the claim-without-migration the stamp exists to prevent.
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    meta: {
      renderer: null,
      browserVersion: "",
      pagedjsVersion: "0.4.3",
      platform: "",
      locale: "de-DE",
      inputIdentity: null,
      freezeSignature: "fixture",
      freezeRetries: 0,
      epochCount: 1,
      interventions: [],
    },
    source: {
      map: {},
      parser: "fixture",
      complete: true,
      injectedAttribute: "data-bl-sid",
      collisionChecked: true,
      input: { identityStatus: "unknown", rawBytesSha256: null, byteLength: null, encoding: null, complete: false },
      provenance: {
        binding: "unavailable", copyIntegrity: "unavailable", sourceRole: "unknown",
        producerId: null, receiptHash: null, diagnostics: ["fixture has no source-bound provenance"],
      },
    },
    pages: parts.pages ?? [page(1)],
    blocks: parts.blocks ?? [],
    textLines: parts.textLines ?? [],
    textRuns: parts.textRuns ?? [],
    svg: parts.svg ?? [],
    uriRefs: parts.uriRefs ?? [],
    resources: [],
    notMeasured: [],
  };
}

type FixtureSvgText = Omit<SvgTextTarget, "boxLocal" | "bboxUser" | "userToLocal"> &
  Partial<Pick<SvgTextTarget, "boxLocal" | "bboxUser" | "userToLocal">>;

const IDENTITY = [1, 0, 0, 1, 0, 0] as const;

/**
 * A hand-authored SVG record. Unless a fixture says otherwise it is the untransformed case: the
 * local frame's origin sits at the viewport's screen corner, the viewport is its only clip when its
 * overflow clips, and every target's local box is its screen box moved by that origin. Fixtures
 * whose point is that the two frames DIFFER pass `viewportLocal` and `boxLocal` explicitly.
 */
function svgWith(texts: FixtureSvgText[], over: Partial<SvgRecord> = {}): SvgRecord {
  const viewportScreen = over.viewportScreen ?? box(48, 48, 300, 200);
  const clipped = over.clipped ?? !/\bvisible\b/u.test(over.overflow ?? "hidden");
  const viewport = box(0, 0, viewportScreen.width, viewportScreen.height);
  const local = (b: Box): Box => box(b.x - viewportScreen.x, b.y - viewportScreen.y, b.width, b.height);
  return {
    nodeKey: "svg1",
    page: 1,
    sourceKey: "svgsig:chart",
    measurable: true,
    viewportScreen,
    overflow: "hidden",
    clipped,
    viewportLocal: {
      viewport,
      clips: clipped ? [viewport] : [],
      localToScreen: [1, 0, 0, 1, viewportScreen.x, viewportScreen.y],
      oracleDeltaPx: null,
      modelDeltaPx: null,
      uncertaintyPx: null,
    },
    viewportDiagnostic: null,
    textTargetCount: texts.length,
    textTargetsCapped: false,
    unreadableTargets: 0,
    unsupportedTargets: 0,
    notRenderedTargets: 0,
    shapes: [{ boxScreen: box(60, 60, 200, 120), strokeWidth: 2 }],
    paths: [],
    inkPasses: { E: ink(0), S: ink(9000), F: ink(11100) },
    inkCollected: true,
    inkStable: true,
    ...over,
    texts: texts.map((text) => {
      const boxLocal = text.boxLocal ?? local(text.boxScreen);
      return { ...text, boxLocal, bboxUser: text.bboxUser ?? boxLocal, userToLocal: text.userToLocal ?? IDENTITY };
    }),
  };
}

function svgText(key: string, T: number, T0: number, over: Partial<FixtureSvgText> = {}): FixtureSvgText {
  return {
    targetKey: `bt-${key}`,
    svgTextKey: `svg:svgsig:chart|id:${key}`,
    boxScreen: box(60, 120, 80, 12),
    clipState: "clip-path" as const,
    ambiguityGroupSize: 1,
    ink: { T: { ...ink(T), intersectShapes: 0, missingInFull: 0 }, T0: ink(T0) },
    ...over,
  };
}

export function loadCorpus(): CorpusEntry[] {
  return [
    // ---------------------------------------------------------------- layout/widow
    {
      name: "widow-trigger",
      kind: "trigger",
      about: "layout/widow",
      complication:
        "The continuation carries one line where widows asks for two, AND the total line count " +
        "is below widows+orphans, so no conforming split exists — the case the specification " +
        "explicitly permits and the rule must still report as a warning.",
      snapshot: snapshot({
        pages: [page(1), page(2)],
        blocks: [
          block("w1", { fragmentIndex: 0, fragmentCount: 2, page: 1, lines: [0, 1, 2] }),
          block("w2", { fragmentIndex: 1, fragmentCount: 2, page: 2, lines: [3] }),
        ],
        textLines: [line("w1", 0), line("w1", 1), line("w1", 2), line("w2", 3)],
      }),
    },
    {
      name: "widow-clean-widows-1",
      kind: "clean",
      about: "layout/widow",
      complication:
        "The same split with widows: 1. One line is exactly what was asked for. orphans is set " +
        "to 1 as well — the first version left it at 2, and layout/orphan then fired on the " +
        "same fixture. A clean fixture that carries an unintended complication is not clean.",
      snapshot: snapshot({
        pages: [page(1), page(2)],
        blocks: [
          block("w1", { fragmentIndex: 0, fragmentCount: 2, page: 1, effectiveStyle: style({ widows: 1, orphans: 1 }) }),
          block("w2", { fragmentIndex: 1, fragmentCount: 2, page: 2, effectiveStyle: style({ widows: 1, orphans: 1 }) }),
        ],
        textLines: [line("w1", 0), line("w2", 1)],
      }),
    },
    {
      name: "widow-clean-forced-break",
      kind: "clean",
      about: "layout/widow",
      complication:
        "A single line after a break the author asked for. Reporting it would report the " +
        "author's own decision back to them. Note the OUTGOING cause on page 1: the first " +
        "version set only the incoming cause on page 2 and left page 1 outgoing as overflow, " +
        "which violates the invariant that pages[i].incoming IS pages[i-1].outgoing — and " +
        "layout/orphan duly fired. A fixture that breaks a snapshot invariant tests nothing.",
      snapshot: snapshot({
        pages: [
          page(1, { outgoingBreakCause: { kind: "forced", determinedBy: "pagedjs-break-attributes", cascadeHint: "stylesheet" } }),
          page(2, { incomingBreakCause: { kind: "forced", determinedBy: "pagedjs-break-attributes", cascadeHint: "stylesheet" } }),
        ],
        blocks: [
          block("w1", { fragmentIndex: 0, fragmentCount: 2, page: 1 }),
          block("w2", { fragmentIndex: 1, fragmentCount: 2, page: 2 }),
        ],
        textLines: [line("w1", 0), line("w2", 1)],
      }),
    },
    {
      name: "widow-clean-multicolumn",
      kind: "clean",
      about: "layout/widow",
      complication: "A multi-column page. Not a defect, and the rule must decline rather than pass.",
      snapshot: snapshot({
        pages: [page(1), page(2)],
        blocks: [
          block("w1", { fragmentIndex: 0, fragmentCount: 2, page: 1, effectiveStyle: style({ columns: "2" }) }),
          block("w2", { fragmentIndex: 1, fragmentCount: 2, page: 2, effectiveStyle: style({ columns: "2" }) }),
        ],
        textLines: [line("w1", 0), line("w2", 1)],
      }),
    },
    {
      name: "widow-clean-vertical",
      kind: "clean",
      about: "layout/widow",
      complication: "Vertical writing mode — a layout this version does not measure.",
      snapshot: snapshot({
        pages: [page(1), page(2)],
        blocks: [
          block("w1", { fragmentIndex: 0, fragmentCount: 2, page: 1, effectiveStyle: style({ writingMode: "vertical-rl" }) }),
          block("w2", { fragmentIndex: 1, fragmentCount: 2, page: 2, effectiveStyle: style({ writingMode: "vertical-rl" }) }),
        ],
        textLines: [line("w1", 0), line("w2", 1)],
      }),
    },

    {
      name: "widow-partial-coverage",
      kind: "clean",
      about: "layout/widow",
      complication:
        "Two continuation fragments: one single-column and conforming, one multi-column and " +
        "therefore declined. Coverage lands at exactly 0.5 — the default floor for a warning. " +
        "This fixture is what makes the coverage floor testable at all; without it the floor " +
        "would only ever be exercised at 0 and 1, where a comparison bug is invisible.",
      snapshot: snapshot({
        pages: [page(1), page(2)],
        blocks: [
          block("ok1", { fragmentIndex: 0, fragmentCount: 2, page: 1, effectiveStyle: style({ widows: 1, orphans: 1 }) }),
          block("ok2", { fragmentIndex: 1, fragmentCount: 2, page: 2, effectiveStyle: style({ widows: 1, orphans: 1 }) }),
          block("mc1", { fragmentIndex: 0, fragmentCount: 2, page: 1, effectiveStyle: style({ columns: "2" }) }),
          block("mc2", { fragmentIndex: 1, fragmentCount: 2, page: 2, effectiveStyle: style({ columns: "2" }) }),
        ],
        textLines: [line("ok1", 0), line("ok2", 1), line("mc1", 0), line("mc2", 1)],
      }),
    },

    // ---------------------------------------------------------------- layout/orphan
    {
      name: "orphan-trigger",
      kind: "trigger",
      about: "layout/orphan",
      complication: "One line left at the foot of the page where orphans asks for two.",
      snapshot: snapshot({
        pages: [page(1), page(2)],
        blocks: [
          block("o1", { fragmentIndex: 0, fragmentCount: 2, page: 1, lines: [0] }),
          block("o2", { fragmentIndex: 1, fragmentCount: 2, page: 2, lines: [1, 2, 3] }),
        ],
        textLines: [line("o1", 0), line("o2", 1), line("o2", 2), line("o2", 3)],
      }),
    },
    {
      name: "orphan-clean-conforming",
      kind: "clean",
      about: "layout/orphan",
      complication: "Three lines at the foot; the request was two.",
      snapshot: snapshot({
        pages: [page(1), page(2)],
        blocks: [
          block("o1", { fragmentIndex: 0, fragmentCount: 2, page: 1, lines: [0, 1, 2] }),
          block("o2", { fragmentIndex: 1, fragmentCount: 2, page: 2, lines: [3, 4] }),
        ],
        textLines: [line("o1", 0), line("o1", 1), line("o1", 2), line("o2", 3), line("o2", 4)],
      }),
    },

    // ------------------------------------------- layout/unbreakable-block-too-tall
    {
      name: "too-tall-trigger",
      kind: "trigger",
      about: "layout/unbreakable-block-too-tall",
      complication: "A table at 1.4 times the page height that promises not to break.",
      snapshot: snapshot({
        blocks: [block("t1", { tag: "table", box: box(48, 48, 399, 848), effectiveStyle: style({ breakInside: "avoid" }) })],
      }),
    },
    {
      name: "too-tall-clean-fits",
      kind: "clean",
      about: "layout/unbreakable-block-too-tall",
      complication: "The same table at 0.9 times the page height. It fits, so it keeps its promise.",
      snapshot: snapshot({
        blocks: [block("t1", { tag: "table", box: box(48, 48, 399, 545), effectiveStyle: style({ breakInside: "avoid" }) })],
      }),
    },

    // ------------------------------------------------ layout/heading-at-page-bottom
    {
      name: "heading-bottom-trigger",
      kind: "trigger",
      about: "layout/heading-at-page-bottom",
      complication: "A heading as the last thing on the page, with nothing under it.",
      snapshot: snapshot({
        blocks: [block("h1", { tag: "h2", box: box(48, 630, 399, 20), lineHeight: 20 })],
      }),
    },
    {
      name: "heading-bottom-clean-followed",
      kind: "clean",
      about: "layout/heading-at-page-bottom",
      complication: "The heading has three lines of text under it on the same page.",
      snapshot: snapshot({
        blocks: [
          block("h1", { tag: "h2", box: box(48, 400, 399, 20), lineHeight: 20 }),
          block("p1", { box: box(48, 430, 399, 46) }),
        ],
      }),
    },

    // --------------------------------------------------------- layout/half-empty-page
    {
      name: "half-empty-trigger",
      kind: "trigger",
      about: "layout/half-empty-page",
      complication: "A page holding one continuation paragraph, netFill 0.05.",
      alsoFires: ["layout/orphaned-continuation-page"],
      snapshot: snapshot({
        pages: [page(1, { fill: { vertical: 0.2, topGap: 0.02, net: 0.05, area: 1 } })],
        blocks: [block("c1", { fragmentIndex: 1, fragmentCount: 2 })],
      }),
    },
    {
      name: "half-empty-trigger-foot-line",
      kind: "trigger",
      about: "layout/half-empty-page",
      complication:
        "A single line at the FOOT of the page: verticalFill reads 0.992, which would look " +
        "fuller than a fully set page. This fixture is the regression guard for the measure " +
        "that was replaced — netFill is 0.049 and reports correctly.",
      snapshot: snapshot({
        pages: [page(1, { fill: { vertical: 0.992, topGap: 0.94, net: 0.049, area: 1 } })],
      }),
    },
    {
      name: "half-empty-clean-full-page",
      kind: "clean",
      about: "layout/half-empty-page",
      complication:
        "A full page of one long paragraph: netFill 0.72, measured on a middle page set at " +
        "11pt/1.5 serif on A4 with 20 mm margins (Chromium 141, Paged.js 0.4.3). Net fill sums " +
        "glyph boxes, not line boxes, so a full page reads far below 1; full prose pages at that " +
        "line height measured 0.58–0.72, some below the 0.60 threshold, which is why the rule is " +
        "experimental.",
      snapshot: snapshot({ pages: [page(1, { fill: { vertical: 0.99, topGap: 0, net: 0.72, area: 1 } })] }),
    },
    {
      name: "half-empty-clean-parity-blank",
      kind: "clean",
      about: "layout/half-empty-page",
      complication:
        "A parity blank page, netFill 0. It would fire under ANY threshold — and the author " +
        "asked for it with break-before: right. A checker that reports it is unusable for books.",
      snapshot: snapshot({
        pages: [
          page(1, {
            blank: true,
            fill: { vertical: 0, topGap: 0, net: 0, area: 0 },
            firstSemanticBlockKey: null,
            incomingBreakCause: { kind: "parity", determinedBy: "page-blank", cascadeHint: null },
            outgoingBreakCause: { kind: "parity", determinedBy: "page-blank", cascadeHint: null },
          }),
        ],
      }),
    },

    // ------------------------------------------ layout/orphaned-continuation-page
    {
      name: "orphaned-continuation-trigger",
      kind: "trigger",
      about: "layout/orphaned-continuation-page",
      complication: "A page whose only content is a one-line continuation fragment.",
      alsoFires: ["layout/half-empty-page"],
      snapshot: snapshot({
        pages: [page(1, { fill: { vertical: 0.1, topGap: 0.02, net: 0.06, area: 1 } })],
        blocks: [block("c1", { fragmentIndex: 1, fragmentCount: 2 })],
      }),
    },
    {
      name: "orphaned-continuation-trigger-carried-child",
      kind: "trigger",
      about: "layout/orphaned-continuation-page",
      complication:
        "A <section> whose paragraph ends on page 1 and whose own 200 px SVG fills a third of " +
        "page 2; its next child, a break-inside: avoid figure, did not fit and opens page 3. Page " +
        "2 carries only the section's continuation, net fill 0.31, and the section goes on — so a " +
        "rule that only asks whether the page's last block ends there calls it full. It is not: page " +
        "3 opens with the fresh figure, not with text running on.",
      alsoFires: ["layout/half-empty-page"],
      snapshot: snapshot({
        pages: [
          page(1, { fill: { vertical: 0.99, topGap: 0, net: 0.34, area: 1 } }),
          page(2, { fill: { vertical: 0.33, topGap: 0, net: 0.31, area: 1 } }),
          page(3, {
            isLast: true,
            fill: { vertical: 0.9, topGap: 0, net: 0.8, area: 1 },
            outgoingBreakCause: { kind: "document-end", determinedBy: "document-boundary", cascadeHint: null },
          }),
        ],
        blocks: [
          block("section:0", { sid: "s-section", tag: "section", fragmentIndex: 0, fragmentCount: 3, page: 1, box: box(48, 48, 399, 600) }),
          block("lines", { page: 1, box: box(48, 48, 399, 600) }),
          block("section:1", { sid: "s-section", tag: "section", fragmentIndex: 1, fragmentCount: 3, page: 2, box: box(48, 48, 399, 200) }),
          block("section:2", { sid: "s-section", tag: "section", fragmentIndex: 2, fragmentCount: 3, page: 3, box: box(48, 48, 399, 500) }),
          block("figure", { tag: "figure", page: 3, box: box(48, 48, 399, 500) }),
          block("after", { page: 3, box: box(48, 548, 399, 48) }),
        ],
      }),
    },
    {
      name: "orphaned-continuation-clean-forced",
      kind: "clean",
      about: "layout/orphaned-continuation-page",
      complication:
        "The same page after a break the author forced from a STYLESHEET. Read back from the " +
        "computed style this looks like `auto`; the cause comes from the collector instead.",
      alsoFires: ["layout/half-empty-page"],
      snapshot: snapshot({
        pages: [
          page(1, {
            fill: { vertical: 0.1, topGap: 0.02, net: 0.06, area: 1 },
            incomingBreakCause: { kind: "forced", determinedBy: "pagedjs-break-attributes", cascadeHint: "stylesheet" },
          }),
        ],
        blocks: [block("c1", { fragmentIndex: 1, fragmentCount: 2 })],
      }),
    },
    {
      name: "orphaned-continuation-clean-more-follows",
      kind: "clean",
      about: "layout/orphaned-continuation-page",
      complication: "The continuation is followed by two further paragraphs on the same page.",
      snapshot: snapshot({
        pages: [page(1, { fill: { vertical: 0.9, topGap: 0.02, net: 0.62, area: 1 } })],
        blocks: [block("c1", { fragmentIndex: 1, fragmentCount: 2 }), block("c2"), block("c3")],
      }),
    },
    {
      name: "orphaned-continuation-clean-full-middle-page",
      kind: "clean",
      about: "layout/orphaned-continuation-page",
      complication:
        "One paragraph over four pages. Pages 2 and 3 carry nothing but its continuation and read " +
        "a net fill of 0.49 against the 0.50 threshold — the numbers of a real full page at " +
        "line-height 2.2, where glyph boxes cover less than half the line pitch. But the paragraph " +
        "goes on to the next page and opens it with running text, so each page stopped because its " +
        "next line did not fit: it is full. A rule that never asks whether the next page opens with " +
        "text running on reports both.",
      alsoFires: ["layout/half-empty-page"],
      snapshot: snapshot({
        pages: [
          page(1, { fill: { vertical: 0.99, topGap: 0, net: 0.46, area: 1 } }),
          page(2, { fill: { vertical: 0.99, topGap: 0, net: 0.49, area: 1 } }),
          page(3, { fill: { vertical: 0.99, topGap: 0, net: 0.49, area: 1 } }),
          page(4, {
            isLast: true,
            fill: { vertical: 0.99, topGap: 0, net: 0.73, area: 1 },
            outgoingBreakCause: { kind: "document-end", determinedBy: "document-boundary", cascadeHint: null },
          }),
        ],
        blocks: [0, 1, 2, 3].map((i) =>
          block(`long:${i}`, {
            sid: "s-long",
            fragmentIndex: i,
            fragmentCount: 4,
            page: i + 1,
            box: box(48, 48, 399, 18 * 32.27),
            lineHeight: 32.27,
            effectiveStyle: style({ lineHeight: 32.27 }),
            lines: Array.from({ length: 18 }, (_, k) => i * 18 + k),
          }),
        ),
        // Eighteen 32.27 px lines per page, glyph boxes 16 px tall and centred in each line box:
        // every page after the first OPENS with the paragraph's running text.
        textLines: [0, 1, 2, 3].flatMap((i) =>
          Array.from({ length: 18 }, (_, k) => ({
            blockKey: `long:${i}`,
            index: i * 18 + k,
            box: box(48, 48 + k * 32.27 + 8.13, 399, 16),
            visible: true,
            width: 399,
            wordBoxes: null,
          })),
        ),
      }),
    },

    // ---------------------------------------------------- layout/hyphen-across-page
    {
      name: "hyphen-trigger",
      kind: "trigger",
      about: "layout/hyphen-across-page",
      complication: "The paginator's own class on a block that hands over to the next page.",
      snapshot: snapshot({
        pages: [page(1), page(2)],
        blocks: [
          block("y1", { fragmentIndex: 0, fragmentCount: 2, classList: ["pagedjs_hyphen"] }),
          block("y2", { fragmentIndex: 1, fragmentCount: 2, page: 2 }),
        ],
      }),
    },
    {
      name: "hyphen-clean-compound-word",
      kind: "clean",
      about: "layout/hyphen-across-page",
      complication:
        "A compound word ending the page with its own hyphen (Ein- und Ausgang) and NO " +
        "pagedjs_hyphen class. A character comparison would fire here; the class does not.",
      snapshot: snapshot({
        pages: [page(1), page(2)],
        blocks: [
          block("y1", { fragmentIndex: 0, fragmentCount: 2 }),
          block("y2", { fragmentIndex: 1, fragmentCount: 2, page: 2 }),
        ],
        textRuns: [run("y1", "Ein- und Ausgang")],
      }),
    },

    // -------------------------------------------------- svg/text-overflows-viewport
    {
      name: "svg-overflow-trigger",
      kind: "trigger",
      about: "svg/text-overflows-viewport",
      complication: "A text whose x lies beyond the viewBox width.",
      snapshot: snapshot({
        blocks: [block("svg1", { tag: "figure" })],
        svg: [svgWith([svgText("out", 100, 100, { boxScreen: box(300, 60, 120, 12), clipState: "none" })])],
      }),
    },
    {
      name: "svg-overflow-clean-visible",
      kind: "clean",
      about: "svg/text-overflows-viewport",
      complication:
        "The same overhang with overflow: visible on the SVG. The glyphs ARE painted, so the " +
        "rule declines instead of reporting — and declining is visible in the coverage account.",
      snapshot: snapshot({
        blocks: [block("svg1", { tag: "figure" })],
        svg: [
          svgWith([svgText("out", 100, 100, { boxScreen: box(300, 60, 120, 12), clipState: "none" })], {
            overflow: "visible",
          }),
        ],
      }),
    },
    {
      name: "svg-overflow-clean-inside",
      kind: "clean",
      about: "svg/text-overflows-viewport",
      complication: "The same text inside an enlarged viewBox.",
      snapshot: snapshot({
        blocks: [block("svg1", { tag: "figure" })],
        svg: [svgWith([svgText("in", 100, 100, { boxScreen: box(60, 60, 120, 12), clipState: "none" })])],
      }),
    },

    // The four below exist because the screen is not the frame the browser clips in. Each one is
    // decided differently by a comparison of screen boxes: the first two were false cleans in 0.6.0,
    // the third a false error, and the fourth a false clean again.
    {
      name: "svg-overflow-trigger-rotated-frame",
      kind: "trigger",
      about: "svg/text-overflows-viewport",
      complication:
        "An ancestor rotates the SVG by 15 degrees. The label's screen envelope lies inside the " +
        "viewport's screen envelope — which, rotated, is far larger than the viewport — while in the " +
        "SVG's own frame the label ends 3 px past the right edge. Only the local comparison sees it.",
      snapshot: snapshot({
        blocks: [block("svg1", { tag: "figure" })],
        svg: [
          svgWith(
            [svgText("rotated-out", 100, 100, { boxScreen: box(211.02, 100.97, 42.25, 23.87), boxLocal: box(163, 30, 40, 14), clipState: "none" })],
            {
              viewportScreen: box(44.24, 29.8, 213.9, 129.04),
              viewportLocal: {
                viewport: box(0, 0, 200, 80), clips: [box(0, 0, 200, 80)],
                localToScreen: [0.965926, 0.258819, -0.258819, 0.965926, 64.95, 29.8], oracleDeltaPx: 0.00002, modelDeltaPx: null, uncertaintyPx: null,
              },
            },
          ),
        ],
      }),
    },
    {
      name: "svg-overflow-trigger-nested-viewport",
      kind: "trigger",
      about: "svg/text-overflows-viewport",
      complication:
        "A label in a nested <svg> runs 3 px past the nested viewport's right edge. The nested " +
        "SVG's client rect is the union of its CONTENT, so against that rectangle the label can " +
        "never overshoot; its viewport is x/y/width/height, and the outer viewport clips too.",
      snapshot: snapshot({
        blocks: [block("svg1", { tag: "figure" })],
        svg: [
          svgWith(
            [svgText("nested-out", 100, 100, { boxScreen: box(150, 130, 23, 14), boxLocal: box(130, 110, 23, 14), clipState: "none" })],
            {
              viewportScreen: box(150, 130, 23, 14),
              viewportLocal: {
                viewport: box(50, 50, 100, 60), clips: [box(50, 50, 100, 60), box(0, 0, 400, 200)],
                localToScreen: [1, 0, 0, 1, 20, 20], oracleDeltaPx: 0, modelDeltaPx: null, uncertaintyPx: null,
              },
            },
          ),
        ],
      }),
    },
    {
      name: "svg-overflow-trigger-visible-nested-clipped-outside",
      kind: "trigger",
      about: "svg/text-overflows-viewport",
      complication:
        "The nested <svg> has overflow: visible, so its own viewport does not clip — but the SVG " +
        "around it does, and the label ends 3 px past that one's edge. The record's own overflow " +
        "string says visible; the clip chain says clipped.",
      snapshot: snapshot({
        blocks: [block("svg1", { tag: "figure" })],
        svg: [
          svgWith(
            [svgText("chain-out", 100, 100, { boxScreen: box(340, 90, 83, 14), boxLocal: box(320, 70, 83, 14), clipState: "none" })],
            {
              overflow: "visible",
              clipped: true,
              viewportScreen: box(340, 90, 83, 14),
              viewportLocal: {
                viewport: box(300, 50, 100, 60), clips: [box(0, 0, 400, 200)],
                localToScreen: [1, 0, 0, 1, 20, 20], oracleDeltaPx: 0, modelDeltaPx: null, uncertaintyPx: null,
              },
            },
          ),
        ],
      }),
    },
    {
      name: "svg-overflow-clean-clip-margin",
      kind: "clean",
      about: "svg/text-overflows-viewport",
      complication:
        "overflow-clip-margin: content-box 10px. The label ends 5 px past the content box and is " +
        "drawn, because the clip edge is 10 px further out. The keyword form defeated parseFloat in " +
        "0.6.0, which then compared against the content box and reported an error.",
      snapshot: snapshot({
        blocks: [block("svg1", { tag: "figure" })],
        svg: [
          svgWith(
            [svgText("in-margin", 100, 100, { boxScreen: box(227, 82, 40, 14), boxLocal: box(165, 20, 40, 14), clipState: "none" })],
            {
              viewportScreen: box(62, 62, 200, 80),
              viewportLocal: {
                viewport: box(0, 0, 200, 80), clips: [box(-10, -10, 220, 100)],
                localToScreen: [1, 0, 0, 1, 62, 62], oracleDeltaPx: 0, modelDeltaPx: null, uncertaintyPx: null,
              },
            },
          ),
        ],
      }),
    },

    // ------------------------------------------------------------- svg/text-clipped
    {
      name: "svg-clipped-trigger-half",
      kind: "trigger",
      about: "svg/text-clipped",
      complication: "A clip path removing about half the glyph ink: 0.4492.",
      snapshot: snapshot({
        blocks: [block("svg1", { tag: "figure" })],
        svg: [svgWith([svgText("half", 2100, 3813)])],
      }),
    },
    {
      name: "svg-clipped-trigger-dilution",
      kind: "trigger",
      about: "svg/text-clipped",
      complication:
        "A small clipped target next to a large clean one. Under a shared mask the genuine " +
        "0.627 collapses to 0.0435 — below the threshold, so the defect would disappear. " +
        "Per-target measurement keeps it at 0.627. This is why the measure is per target.",
      snapshot: snapshot({
        blocks: [block("svg1", { tag: "figure" })],
        svg: [
          svgWith([
            svgText("small", 420, 1126),
            svgText("large", 12000, 12000, { clipState: "none" }),
          ]),
        ],
      }),
    },
    {
      name: "svg-clipped-clean-contained",
      kind: "clean",
      about: "svg/text-clipped",
      complication: "A clip path that contains the text entirely. A clip is not a defect per se.",
      snapshot: snapshot({
        blocks: [block("svg1", { tag: "figure" })],
        svg: [svgWith([svgText("whole", 3810, 3810)])],
      }),
    },
    {
      name: "svg-clipped-clean-unstable",
      kind: "clean",
      about: "svg/text-clipped",
      complication:
        "Two identical passes disagreed. The measurement is discarded, not averaged — an " +
        "averaged unstable value is an invented one.",
      snapshot: snapshot({
        blocks: [block("svg1", { tag: "figure" })],
        svg: [svgWith([svgText("wobbly", 420, 1126)], { inkStable: false })],
      }),
    },

    // ------------------------------------------------------- svg/text-ink-collision
    {
      name: "svg-collision-trigger-crossing",
      kind: "trigger",
      about: "svg/text-ink-collision",
      complication: "A 2 px line crossing a row of glyphs: 792 shared device pixels.",
      snapshot: snapshot({
        blocks: [block("svg1", { tag: "figure" })],
        svg: [
          svgWith([
            svgText("crossed", 5000, 5000, {
              clipState: "none",
              ink: { T: { ...ink(5000), intersectShapes: 792, missingInFull: 0 }, T0: ink(5000) },
            }),
          ]),
        ],
      }),
    },
    {
      name: "svg-collision-trigger-white-cover",
      kind: "trigger",
      about: "svg/text-ink-collision",
      complication:
        "An OPAQUE WHITE rectangle over the text. It carries no ink of its own, so the " +
        "intersection stays 0 while the text is wiped out — the case the collision band alone " +
        "cannot see, and the reason the occlusion band exists.",
      snapshot: snapshot({
        blocks: [block("svg1", { tag: "figure" })],
        svg: [
          svgWith([
            svgText("covered", 8263, 8263, {
              clipState: "none",
              ink: { T: { ...ink(8263), intersectShapes: 0, missingInFull: 8263 }, T0: ink(8263) },
            }),
          ]),
        ],
      }),
    },
    {
      name: "svg-collision-clean-line-in-gap",
      kind: "clean",
      about: "svg/text-ink-collision",
      complication:
        "A line running exactly through the gap BETWEEN two text lines. It crosses the shared " +
        "bounding box and not a single glyph — the case bounding-box overlap gets wrong in " +
        "2 of 8 fixtures. Ink measurement returns 0.",
      snapshot: snapshot({
        blocks: [block("svg1", { tag: "figure" })],
        svg: [
          svgWith([
            svgText("gap", 5000, 5000, {
              clipState: "none",
              ink: { T: { ...ink(5000), intersectShapes: 0, missingInFull: 0 }, T0: ink(5000) },
            }),
          ]),
        ],
      }),
    },

    // ------------------------------------------------------------ type/spaced-hyphen
    {
      name: "spaced-hyphen-trigger",
      kind: "trigger",
      about: "type/spaced-hyphen",
      complication: "Two spaced hyphens used as dashes in ordinary German prose.",
      snapshot: snapshot({
        blocks: [block("p1")],
        textRuns: [run("p1", "Der Bahnhof - direkt am Fluss - wurde saniert.")],
      }),
    },
    {
      name: "spaced-hyphen-clean-formula",
      kind: "clean",
      about: "type/spaced-hyphen",
      complication:
        "A minus sign in a formula. The orthography ruleset distinguishes hyphen from dash by " +
        "FUNCTION and says nothing at all about this case — mandatory fixture.",
      snapshot: snapshot({
        blocks: [block("p1")],
        textRuns: [run("p1", "Für x - y = 0 gilt die folgende Lösung.")],
      }),
    },
    {
      name: "spaced-hyphen-clean-code",
      kind: "clean",
      about: "type/spaced-hyphen",
      complication: "The same expression inside <code>.",
      snapshot: snapshot({
        blocks: [block("p1")],
        textRuns: [run("p1", "a - b", { ancestorTags: ["code", "p", "body"] })],
      }),
    },
    {
      name: "spaced-hyphen-clean-foreign-language",
      kind: "clean",
      about: "type/spaced-hyphen",
      complication:
        "An English span nested inside a German paragraph. The lang exclusion has to work on " +
        "the ancestor chain, which is the only place it can work.",
      snapshot: snapshot({
        blocks: [block("p1")],
        textRuns: [run("p1", "a - b", { lang: "en", ancestorTags: ["span", "p", "body"] })],
      }),
    },

    // ----------------------------------------------------------- type/straight-quotes
    {
      name: "straight-quotes-trigger",
      kind: "trigger",
      about: "type/straight-quotes",
      complication: "Typewriter quotes in German prose.",
      snapshot: snapshot({
        blocks: [block("p1")],
        textRuns: [run("p1", 'Er sagte "ja".')],
      }),
    },
    {
      name: "straight-quotes-clean-inch",
      kind: "clean",
      about: "type/straight-quotes",
      complication: "An inch mark after a digit. Legitimate, and the mandatory false-alarm case.",
      snapshot: snapshot({
        blocks: [block("p1")],
        textRuns: [run("p1", 'Ein 5" Bildschirm.')],
      }),
    },

    // ------------------------------------------------------------ type/short-last-line
    {
      name: "short-last-line-trigger",
      kind: "trigger",
      about: "type/short-last-line",
      complication: "A closing line of a three-character word: 12 px of a 399 px measure.",
      snapshot: snapshot({
        blocks: [block("p1", { lines: [0, 1] })],
        textLines: [line("p1", 0, 399), line("p1", 1, 12)],
      }),
    },
    {
      name: "short-last-line-clean-sixty-percent",
      kind: "clean",
      about: "type/short-last-line",
      complication: "A closing line filling 60 % of the measure.",
      snapshot: snapshot({
        blocks: [block("p1", { lines: [0, 1] })],
        textLines: [line("p1", 0, 399), line("p1", 1, 240)],
      }),
    },
    {
      name: "short-last-line-clean-centred",
      kind: "clean",
      about: "type/short-last-line",
      complication: "Centred text. A short closing line is the point of centring.",
      snapshot: snapshot({
        blocks: [block("p1", { lines: [0, 1], effectiveStyle: style({ textAlign: "center" }) })],
        textLines: [line("p1", 0, 399), line("p1", 1, 12)],
      }),
    },

    // ----------------------------------------------------- type/excessive-word-spacing
    {
      name: "word-spacing-trigger",
      kind: "trigger",
      about: "type/excessive-word-spacing",
      complication: "A justified column with one long unbreakable word: gaps at 4.8× the space.",
      snapshot: snapshot({
        blocks: [block("p1", { effectiveStyle: style({ textAlign: "justify" }), spaceWidth: 4.2, lines: [0] })],
        textLines: [
          {
            ...line("p1", 0),
            wordBoxes: [
              { ...box(48, 48, 40, 15), text: "Der" },
              { ...box(108, 48, 40, 15), text: "Bahnhof" },
            ],
          },
        ],
      }),
    },
    {
      name: "word-spacing-clean-explicit",
      kind: "clean",
      about: "type/excessive-word-spacing",
      complication:
        "The same column with word-spacing set by the author. The width is a stated intention; " +
        "reporting it back reports the author.",
      snapshot: snapshot({
        blocks: [
          block("p1", {
            effectiveStyle: style({ textAlign: "justify", wordSpacing: "20px" }),
            spaceWidth: 4.2,
            lines: [0],
          }),
        ],
        textLines: [
          {
            ...line("p1", 0),
            wordBoxes: [
              { ...box(48, 48, 40, 15), text: "Der" },
              { ...box(108, 48, 40, 15), text: "Bahnhof" },
            ],
          },
        ],
      }),
    },
    {
      name: "word-spacing-clean-hyphenated",
      kind: "clean",
      about: "type/excessive-word-spacing",
      complication: "The same column after hyphenation: gaps back to 1.4× the space.",
      snapshot: snapshot({
        blocks: [block("p1", { effectiveStyle: style({ textAlign: "justify" }), spaceWidth: 4.2, lines: [0] })],
        textLines: [
          {
            ...line("p1", 0),
            wordBoxes: [
              { ...box(48, 48, 40, 15), text: "Der" },
              { ...box(94, 48, 40, 15), text: "Bahn-" },
            ],
          },
        ],
      }),
    },

    // ------------------------------------------------------------- artifact/local-uri
    {
      name: "local-uri-trigger",
      kind: "trigger",
      about: "artifact/local-uri",
      complication:
        "A srcset candidate with a file: URI that the browser NEVER requested. Reading the " +
        "list of loaded resources would miss it entirely — which is why the rule reads uriRefs.",
      snapshot: snapshot({
        uriRefs: [
          {
            nodeKey: "img1",
            attribute: "srcset",
            rawValue: "file:///build/machine/logo@2x.png",
            resolvedUri: "file:///build/machine/logo@2x.png",
            scheme: "file",
            origin: "file://",
            requested: false,
            insideDistributionRoot: false,
          },
        ],
      }),
    },
    {
      name: "local-uri-clean-relative",
      kind: "clean",
      about: "artifact/local-uri",
      complication: "A relative path. It travels with the document.",
      snapshot: snapshot({
        uriRefs: [
          {
            nodeKey: "img1",
            attribute: "src",
            rawValue: "images/logo.png",
            resolvedUri: "images/logo.png",
            scheme: "",
            origin: "",
            requested: true,
            insideDistributionRoot: true,
          },
        ],
      }),
    },
    {
      name: "local-uri-clean-data",
      kind: "clean",
      about: "artifact/local-uri",
      complication: "A data: URI carries its own content and resolves anywhere.",
      snapshot: snapshot({
        uriRefs: [
          {
            nodeKey: "img1",
            attribute: "src",
            rawValue: "data:image/png;base64,iVBORw0K",
            resolvedUri: "data:image/png;base64,iVBORw0K",
            scheme: "data",
            origin: "",
            requested: true,
            insideDistributionRoot: true,
          },
        ],
      }),
    },
  ];
}
