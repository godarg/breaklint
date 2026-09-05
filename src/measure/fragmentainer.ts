/**
 * What Paged.js could not place, and why it makes the PDF disagree with the measurement.
 *
 * THE MECHANISM, MEASURED. Paged.js does not lay a page out by itself. It turns each
 * `.pagedjs_page_content` into a CSS multi-column fragmentainer — `column-width` equal to the
 * content width, `column-gap` equal to `margin-left + margin-right + bleed + 1000px`, and
 * `column-fill: auto` — and then moves what lands past the first column onto a new page. When it
 * fails to move something, that something stays in the second column. It is invisible: the
 * enclosing `.pagedjs_sheet` is `overflow: hidden`, and the second column starts one whole column
 * PITCH to the right of the page. Measured on the corpus this module was written for, the pitch is
 * `624 + 1192 = 1816 px`, and every residual element sat at exactly `contentLeft + 1816`.
 *
 * WHY THIS IS AN ACQUISITION CONCERN AND NOT A RULE. `page.pdf()` renders under PRINT media, where
 * Paged.js's own stylesheet re-sizes `.pagedjs_page` and `.pagedjs_sheet` to `height: 100%` of the
 * print box. That changes the fragmentainer's height, and content in the overflow column is
 * re-fragmented against the new height. For ordinary block content the reflow reproduces the same
 * boxes and nothing is observable. For an ATOMIC box — a table row, which cannot be split — the
 * row moves back into the first column, every ancestor's border box changes with it, and the
 * change is PERMANENT: sampled four times at 300 ms intervals after the PDF, the layout never
 * returned to its pre-PDF state.
 *
 * That is the whole of the measured difference between the six documents of the reference corpus
 * that could not be measured and the twelve that could. Not size, not inline script, not generated
 * content, not duplicate ids, not the number of tables: 6 of 6 failing documents had at least one
 * page carrying TABLE-display residue in an overflow column, and 0 of 12 passing documents did.
 * Two of the passing twelve carried residue of other kinds — a `<p>` and an `<em>` — and reflowed
 * identically, which is why the residue is REPORTED rather than being made fatal on its own.
 *
 * WHAT THE PROBE IS FOR. Without it the reconciliation between the snapshot and the PDF can say
 * only "the state changed", and it said exactly that: `freezeChanged: true` beside four zeroes and
 * three empty arrays. This names the cause at the element, with its source id, so the sentence the
 * user reads is about their table and not about the checker.
 */

import type { PageLike } from "../acquire/browser.ts";

/**
 * How many residual elements are collected at most.
 *
 * A cap in the PAGE, not in the reporter. One document of the reference corpus put 156 elements
 * into overflow columns across 7 pages; the event payload is projected onto one console line, and
 * a collection that grows with the document is the defect `report/infra.ts` exists to stop.
 */
export const MAX_RESIDUE_SAMPLE = 12;

/** One element Paged.js left in a column that is not on the page. */
export interface FragmentainerResidue {
  /** 1-based, in document order of `.pagedjs_page`. */
  page: number;
  /** 1 is the first column past the page, 2 the one after it. 0 never appears here. */
  column: number;
  tag: string;
  /** The computed `display`. `table-row` and friends are the atomic ones that move under print. */
  display: string;
  /** `data-bl-sid`, when source ids were injected. Null says "not attributable", not "no id". */
  sourceId: string | null;
  /** Collapsed and clipped, so the reader can recognise the element in their own document. */
  text: string;
}

export interface FragmentainerReport {
  /** Every page carrying residue, 1-based and ascending. */
  pages: number[];
  /** Total residual elements found, which may exceed `sample.length`. */
  count: number;
  /** Residual elements whose computed display is a table box. These are the ones that reflow. */
  atomicCount: number;
  sample: FragmentainerResidue[];
  /** The column pitch in px, so a reader can check the geometry in their own browser. */
  pitchPx: number | null;
}

/** Computed `display` values that cannot be split by a fragmentainer and therefore move whole. */
export const ATOMIC_DISPLAYS = [
  "table",
  "table-row",
  "table-cell",
  "table-row-group",
  "table-header-group",
  "table-footer-group",
  "table-caption",
] as const;

/**
 * The residue sentence, as one exported function.
 *
 * Exported for the same reason `divergenceDetail` is: the test that pins this wording must read
 * the producer rather than a copy of it. A copy is accurate and does not follow.
 */
export function residueDetail(report: FragmentainerReport): string {
  if (report.count === 0) return "";
  const pages = report.pages.length > 4
    ? `${report.pages.slice(0, 4).join(", ")} and ${report.pages.length - 4} more`
    : report.pages.join(", ");
  const tags = [...new Set(report.sample.map((r) => r.tag))].slice(0, 4).join(", ");
  const atomic = report.atomicCount > 0
    ? ` ${report.atomicCount} of them are unsplittable table boxes, which move whole when the ` +
      "fragmentainer is re-sized."
    : "";
  return (
    `Paged.js left ${report.count} element(s) (${tags}) in an overflow column of page(s) ` +
    `${pages} — content it could not place on a page.${atomic}`
  );
}

const RESIDUE_TEMPLATE = `(() => {
  const P = window.__blPrimitives;
  const ATOMIC = ${JSON.stringify(ATOMIC_DISPLAYS)};
  const LIMIT = ${MAX_RESIDUE_SAMPLE};
  const pages = P.all(document, ".pagedjs_page");
  // Two lists, joined atomic-first at the end. A single list filled in document order is what this
  // collector did first, and on the largest document of the reference corpus -- 156 residual
  // elements across 7 pages, 82 of them table boxes -- the first 12 in document order contained no
  // table box at all. The report then said "82 unsplittable table boxes" and showed the reader
  // twelve spans. The cap must not be allowed to hide the elements that decide the outcome.
  const atomicSample = [], otherSample = [];
  const pageNumbers = [];
  let count = 0, atomicCount = 0, pitchPx = null;
  for (let index = 0; index < pages.length; index += 1) {
    const contents = P.all(pages[index], ".pagedjs_page_content");
    if (contents.length === 0) continue;
    const content = contents[0];
    const style = P.style(content, null);
    // Paged.js sets both inline in 'Page.create'. A document that has not been paginated by it has
    // no fragmentainer and therefore no residue to report -- not zero residue, no question.
    const columnWidth = parseFloat(style.columnWidth);
    const columnGap = parseFloat(style.columnGap);
    if (!(columnWidth > 0) || !(columnGap > 0)) continue;
    const pitch = columnWidth + columnGap;
    pitchPx = pitch;
    const origin = P.rect(content).x;
    let onThisPage = 0;
    for (const el of P.all(content, "*")) {
      // Our own source-id marks are zero-height spans this tool injected. They follow the text
      // they mark into the overflow column and would otherwise be reported as the document's
      // content -- measured: 4 of them on a page whose only real residue was one paragraph.
      if (P.attr(el, "class") === "bl-mark") continue;
      const box = P.rect(el);
      if (box.width === 0 || box.height === 0) continue;
      // A box that STRADDLES the boundary is a fragmented element with part of itself still on the
      // page; the residue is the part past it, which is reported through its own descendants. Only
      // a box that STARTS past the first column is entirely off the page.
      if (box.x < origin + pitch - 1) continue;
      count += 1;
      onThisPage += 1;
      const display = P.style(el, null).display;
      const atomic = ATOMIC.indexOf(display) !== -1;
      if (atomic) atomicCount += 1;
      const into = atomic ? atomicSample : otherSample;
      if (into.length < LIMIT) {
        into.push({
          page: index + 1,
          column: Math.floor((box.x - origin) / pitch),
          tag: el.tagName,
          display: display,
          sourceId: P.attr(el, "data-bl-sid"),
          text: P.text(el).replace(/\\s+/g, " ").trim().slice(0, 60),
        });
      }
    }
    if (onThisPage > 0) pageNumbers.push(index + 1);
  }
  const sample = atomicSample.concat(otherSample).slice(0, LIMIT);
  return { pages: pageNumbers, count: count, atomicCount: atomicCount, sample: sample, pitchPx: pitchPx };
})()`;

/** Static test surface and the production source; this probe needs no capability, it only reads. */
export const FRAGMENTAINER_RESIDUE_SOURCE = RESIDUE_TEMPLATE;

/** Read the residue of one live, paginated page. */
export async function fragmentainerResidue(page: PageLike): Promise<FragmentainerReport> {
  return page.evaluate<FragmentainerReport>(FRAGMENTAINER_RESIDUE_SOURCE);
}
