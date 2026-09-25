/**
 * Two structures Paged.js 0.4.3 builds itself, recognised narrowly enough that a document cannot
 * borrow the recognition.
 *
 * Both recognisers are in-page payload fragments (strings evaluated through the captured
 * primitives, like `SNAPSHOT_SOURCE` and the collector), and both answer one question about the
 * page tree the paginator left behind. They are separate from the payloads that use them so that
 * the unit suite can run them over a recorded page tree (`tests/fixtures/paged-dom.ts`).
 *
 * 1. THE FOOTNOTE CALL. For a `float: footnote` element Paged.js' `footnotes.js` moves the note
 *    into the footnote area of the page area and inserts, where the note was, a call it builds
 *    from nothing:
 *
 *        <a class="…note's classes…" data-footnote-call="R" data-ref="R"
 *           data-data-counter-footnote-increment="1" href="#note-R"></a>
 *
 *    and it gives the note `id="note-R"`, `data-note="footnote"` and `data-footnote-marker="R"`,
 *    where `R` is the note's `data-ref` — a random UUID drawn per run by `parser.js` unless the
 *    author wrote a `data-ref` of their own. The paired control run of `CONTROL_SIGNATURE_SOURCE`
 *    reads every `href` as a resource, so the call's `href` differed between the injected run and
 *    the control run of every document with a footnote, and the run stopped as
 *    `injection-interference` (exit 3).
 *
 *    A call is recognised only as the whole pair: an empty <a> carrying exactly those four
 *    attribute values for one `R`, AND a note carrying `R` in `data-ref`, `data-footnote-marker`
 *    and `id="note-R"` with `data-note="footnote"`, as a direct child of a footnote area's inner
 *    content inside a page area. The shape of the `href` alone, its `#note-` prefix or the call's
 *    attributes alone recognise nothing: a document can write all of those, and cannot write a
 *    note into a footnote area that Paged.js did not put there without also being a footnote.
 *    What a recognised call is excused from is the SPELLING of its `href`; the signature records
 *    it by ordinal instead (`pagedjs-footnote-call:1`, `:2`, …), so a run with a different number
 *    of calls still differs. And `#note-R` is a same-document fragment: nothing is ever fetched
 *    for it, so no resource can hide behind the excuse.
 *
 * 2. THE EMPTY PAGE AREA. A page Paged.js inserts for parity (`break-before: right`, `left`,
 *    `recto`, `verso`, and the blank last page it may add) is created from the page template and
 *    never laid out: its page area holds exactly the template's empty containers,
 *
 *        .pagedjs_area > .pagedjs_page_content                    (no child element)
 *        .pagedjs_area > .pagedjs_footnote_area
 *                        > .pagedjs_footnote_content > .pagedjs_footnote_inner_content  (none)
 *
 *    with whitespace text between them. `pageAreaEmptySource` answers whether a page's area is
 *    exactly that — every element in it is one of those containers in its template position,
 *    no text node carries anything but whitespace, and none of them (nor the area) generates
 *    `::before`/`::after` content. The margin boxes are outside the area by construction, so a
 *    running header or a page number never makes an area non-empty, and no coordinate is read to
 *    decide it. This is the DOM half of the blank-page decision in `evidence.ts`; the other half
 *    looks at the delivered PDF, because generated content and backgrounds are painted without
 *    ever becoming a DOM node.
 */

import { FOOTNOTE_AREA_SELECTOR, PAGE_AREA_SELECTOR } from "./collector.ts";

export { FOOTNOTE_AREA_SELECTOR };

/** The note a footnote call points at: a direct child of a footnote area's inner content. */
export const FOOTNOTE_NOTE_SELECTOR =
  `${FOOTNOTE_AREA_SELECTOR} > .pagedjs_footnote_content > .pagedjs_footnote_inner_content > [data-note]`;

/**
 * In-page: `(P) => Map<Element, number>` — every recognised Paged.js footnote call in document
 * order, mapped to its 1-based ordinal. See the header for what "recognised" requires.
 */
export const PAGED_FOOTNOTE_CALLS_SOURCE = `((P) => {
  const notes = new Set();
  for (const note of P.all(document, ${JSON.stringify(FOOTNOTE_NOTE_SELECTOR)})) {
    const ref = P.attr(note, "data-ref");
    if (!ref || P.attr(note, "data-note") !== "footnote") continue;
    if (P.attr(note, "data-footnote-marker") !== ref || P.attr(note, "id") !== "note-" + ref) continue;
    notes.add(ref);
  }
  const calls = new Map();
  for (const call of P.all(document, ${JSON.stringify(`${PAGE_AREA_SELECTOR} a[data-footnote-call]`)})) {
    const ref = P.attr(call, "data-footnote-call");
    if (!ref || !notes.has(ref)) continue;
    if (P.attr(call, "data-ref") !== ref || P.attr(call, "href") !== "#note-" + ref) continue;
    if (P.attr(call, "data-data-counter-footnote-increment") !== "1") continue;
    if (P.children(call).length !== 0) continue;
    calls.set(call, calls.size + 1);
  }
  return calls;
})`;

/**
 * In-page: `(P, pageEl) => boolean` — the page's area is exactly Paged.js' empty page template.
 * False for a page with no area or more than one.
 */
export const PAGE_AREA_EMPTY_SOURCE = `((P, pageEl) => {
  const areas = P.all(pageEl, ${JSON.stringify(PAGE_AREA_SELECTOR)});
  if (areas.length !== 1) return false;
  const hasClass = (el, name) => (P.attr(el, "class") || "").split(/\\s+/u).indexOf(name) !== -1;
  const generates = (el) => {
    for (const pseudo of ["::before", "::after"]) {
      const content = P.style(el, pseudo).content;
      if (content && content !== "none" && content !== "normal") return true;
    }
    return false;
  };
  // children of one container: only whitespace text and, in order, exactly the named containers
  const holds = (el, names) => {
    if (generates(el)) return null;
    const found = [];
    for (const child of P.children(el)) {
      const type = P.nodeType(child);
      if (type === 3) { if ((P.text(child) || "").trim() !== "") return null; continue; }
      if (type === 8) continue;
      if (type !== 1) return null;
      found.push(child);
    }
    if (found.length !== names.length) return null;
    for (let i = 0; i < names.length; i += 1) if (!hasClass(found[i], names[i])) return null;
    return found;
  };
  const top = holds(areas[0], ["pagedjs_page_content", "pagedjs_footnote_area"]);
  if (!top || !holds(top[0], [])) return false;
  const footnoteArea = holds(top[1], ["pagedjs_footnote_content"]);
  if (!footnoteArea) return false;
  const footnoteContent = holds(footnoteArea[0], ["pagedjs_footnote_inner_content"]);
  return !!footnoteContent && !!holds(footnoteContent[0], []);
})`;
