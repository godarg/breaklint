/**
 * The collector: what the paginator did, recorded while it was doing it.
 *
 * It observes and never intervenes. Every number it produces comes from the tree Paged.js wrote or
 * from an argument Paged.js handed to a hook; nothing here changes a style, moves a node or forces
 * a relayout.
 *
 * THE HOOKS ARE COUNTED, AND THAT IS A BUILD REQUIREMENT RATHER THAN DIAGNOSTICS. Paged.js wires
 * handlers by bare METHOD-NAME EQUALITY — there is no interface, no registration list, no error for
 * a name it does not recognise. A typo in `afterPageLayout` is a silent no-op, and the result of a
 * silent no-op here is a document with no break tokens, every boundary classified `unknown`, and a
 * clean-looking report. The worst outcome a checker can produce is a green run that measured
 * nothing, so the run refuses when a hook it registered never fired.
 *
 * TOKENS ARE TAKEN AT DECISION TIME. `afterPageLayout` is handed the break token for the page it
 * just finished; that is the only moment it exists as an object rather than as an inference. This
 * is the half of Gemini's A4 that is actually available.
 *
 * THE OTHER HALF OF A4, AND WHY IT BECAME A CHECK INSTEAD OF A MOVE. A4 proposed reading the break
 * ATTRIBUTES at decision time too, closing the window in which an author script could alter them
 * between the layout decision and the reading. That cannot be done as proposed: the attributes
 * that classify the boundary after page `i` sit on the first node of page `i + 1`, which does not
 * exist yet when `afterPageLayout(i)` runs. So instead of moving the read, the collector takes a
 * SNAPSHOT of each page's first-node attributes at layout time and compares it with the values
 * read after pagination. A difference is not silently preferred one way or the other — it means
 * the tree changed under the measurement, and the run reports `document-not-quiescent`. The window
 * is not closed; it is made observable, which is the honest version of the same intent.
 *
 * RECONCILIATION IS BOUND TO NODE IDENTITY. Page numbers are useless as keys — Paged.js discards
 * and re-lays pages, so page 3 of the first attempt need not be page 3 of the result. Records are
 * kept only for page elements that are in the FINAL page list and still `isConnected`; anything
 * else is dropped and counted. Both halves matter: dropping without counting is a filter that
 * discards silently, which is a failure shape this project has already paid for once.
 */

import type { BreakCauseCascadeHint } from "../core/enums.ts";

/** One page as the collector saw it while the paginator was working. */
export interface CollectedPage {
  /** Position in the FINAL page list. Not a key — a result. */
  index: number;
  /**
   * Whether `afterPageLayout` ever reported this page.
   *
   * False means the page is in the final list and the paginator never told us about it — a page
   * inserted after `afterRendered`, or a per-page hook loss the global hook count cannot see
   * because other pages' hooks fired. Its boundaries are `unknown`, never inferred from whatever
   * attributes happen to sit on it.
   */
  reconciled: boolean;
  /** True when `afterPageLayout` handed out a break token for this page. */
  hasBreakToken: boolean;
  /** The break attributes of the page's first source-bearing node, read at layout time. */
  attributesAtLayout: { breakBefore: string | null; previousBreakAfter: string | null; page: string | null };
  /** The same, read after pagination finished. A mismatch means the tree moved. */
  attributesAfterRender: { breakBefore: string | null; previousBreakAfter: string | null; page: string | null };
  /** Source id of the first and last source-bearing node on the page. */
  firstSid: string | null;
  lastSid: string | null;
  /** `data-page` of the LAST source-bearing node, which is what the next boundary compares against. */
  lastNodePage: string | null;
  /** No author content at all: no source id, no visible text. */
  blank: boolean;
  /** The generation this page belongs to, so a re-laid page is distinguishable from a kept one. */
  epoch: number;
}

export interface CollectorResult {
  pages: CollectedPage[];
  /** How many times each registered hook fired. A zero anywhere is fatal. */
  hooks: Record<string, number>;
  /** Records whose page element was not in the final list or not connected. Counted, not hidden. */
  discardedRecords: number;
  /** Final pages the paginator never reported. Fatal for those pages' boundaries, not ignorable. */
  unreconciledPages: number;
  /** Pages whose attributes differed between layout time and after rendering. */
  attributeDrift: { index: number; field: string; atLayout: string | null; afterRender: string | null }[];
  /** Highest `epoch` seen. More than one means the paginator re-laid at least one page. */
  epochCount: number;
}

/** The hooks the collector registers, and therefore the hooks that must have fired. */
export const REQUIRED_HOOKS = ["beforePageLayout", "layoutNode", "renderNode", "afterPageLayout", "afterRendered"] as const;

/**
 * Which hooks never fired.
 *
 * Kept as a named function rather than inline so a unit test can drive it: a browser cannot be
 * asked to skip a hook, and this is exactly the branch whose absence would make everything else
 * meaningless.
 */
export function silentHooks(hooks: Readonly<Record<string, number>>): string[] {
  // `?? 0` rather than a truthiness test on a possibly-absent key: a hook name that is MISSING
  // from the record and one that fired zero times must both count as silent, and `undefined > 0`
  // and `0 > 0` are both false only by accident of coercion. Stated explicitly.
  return REQUIRED_HOOKS.filter((name) => (hooks[name] ?? 0) <= 0);
}

/**
 * The in-page collector.
 *
 * Registered BEFORE `new Paged.Previewer().preview()` runs, which the loader guarantees by
 * inserting this script ahead of the document's own pagination call. Everything it reads goes
 * through the captured primitives, so an author script replacing `querySelectorAll` cannot make
 * the collector see a different document from the one being rendered.
 */
export const COLLECTOR_SOURCE = `(() => {
  const P = window.__blPrimitives;
  const A = { before: "data-break-before", prevAfter: "data-previous-break-after", page: "data-page" };

  const state = {
    hooks: { beforePageLayout: 0, layoutNode: 0, renderNode: 0, afterPageLayout: 0, afterRendered: 0 },
    // Keyed by the page ELEMENT, never by a page number: the paginator discards and re-lays pages,
    // so a number is not an identity. A Map on the node survives that; an index does not.
    byElement: new Map(),
    order: [],
    epoch: 0,
    discarded: 0,
  };
  window.__blCollector = state;

  const sidOf = (el) => P.attr(el, "data-bl-sid");

  /**
   * The named page in force at a node — SELF OR NEAREST ANCESTOR.
   *
   * Measured, and this cost a real defect: a named region is usually declared on a container
   * ('section.chapter { page: chapter }'), and Paged.js puts 'data-page' on the SECTION. The
   * paragraphs inside it carry none. Reading the leaf node alone therefore sees null for every
   * page in the middle of the region — so LEAVING the region reads null against null, no change is
   * seen, and a boundary the paginator forced is reported as an overflow.
   *
   * Measured on a section spanning three pages: page 3's first node reported own: null and
   * ancestor: "chapter". needsPageBreak in the paginator resolves the same way. Found by an
   * adversarial cross-model audit and confirmed against the real paginator before it was fixed.
   */
  const pageNameAt = (el) => {
    if (!el) return null;
    const holder = P.closest(el, "[" + A.page + "]");
    return holder ? P.attr(holder, A.page) : null;
  };

  /** First and last nodes on a page that carry a source id, plus their break attributes. */
  const edges = (pageEl) => {
    const nodes = P.all(pageEl, "[data-bl-sid]");
    const first = nodes[0] || null;
    const last = nodes.length ? nodes[nodes.length - 1] : null;
    // Every read below goes through the captured primitives. An audit found this function calling
    // el.getAttribute and el.hasAttribute directly while the header of this file claimed
    // otherwise — and those two decide the break cause, so a replaced getAttribute returning
    // "page" would make every boundary in a document look forced.
    const attrs = (el) => ({
      breakBefore: P.hasAttr(el, A.before) ? P.attr(el, A.before) : null,
      previousBreakAfter: P.hasAttr(el, A.prevAfter) ? P.attr(el, A.prevAfter) : null,
      page: pageNameAt(el),
    });
    const content = P.all(pageEl, ".pagedjs_page_content")[0] || pageEl;
    const text = (P.text(content) || "").replace(/\\s+/g, " ").trim();
    return {
      firstSid: sidOf(first),
      lastSid: sidOf(last),
      attrs: attrs(first),
      lastNodePage: pageNameAt(last),
      // Blank means no author content: no source id AND no visible text. Both, because a page can
      // carry a paginator-generated wrapper with no sid while still showing text. Margin boxes sit
      // OUTSIDE .pagedjs_page_content, so a running header does not make a parity page look
      // occupied — which is intended: the blank page inserted by break-before: recto carries the
      // same running header as every other page.
      blank: nodes.length === 0 && text.length === 0,
    };
  };

  class BreaklintCollector extends Paged.Handler {
    beforePageLayout() { state.hooks.beforePageLayout++; }
    layoutNode() { state.hooks.layoutNode++; }
    renderNode() { state.hooks.renderNode++; }
    afterPageLayout(pageElement, page, breakToken) {
      state.hooks.afterPageLayout++;
      if (!pageElement) { state.discarded++; return; }
      const seen = state.byElement.get(pageElement);
      // A page element seen twice is a RE-LAY, not a second page. The record is replaced and the
      // generation counter moves, so the snapshot can say how many generations it took.
      if (seen) state.epoch++;
      else state.order.push(pageElement);
      const e = edges(pageElement);
      state.byElement.set(pageElement, {
        hasBreakToken: !!breakToken,
        attributesAtLayout: e.attrs,
        // The LEFT-hand edge fields are snapshotted too. An audit found the drift check covering
        // only the first node's three attributes, so an author handler that rewrote the PREVIOUS
        // page's last node to data-page="spoofed" produced a false forced while
        // attributeDrift stayed empty — the mutated field had never been recorded to compare
        // against. Everything the classifier reads is now compared.
        edgeAtLayout: { lastNodePage: e.lastNodePage, firstSid: e.firstSid, lastSid: e.lastSid, blank: e.blank },
        epoch: state.epoch,
      });
    }
    afterRendered() {
      state.hooks.afterRendered++;
      window.__blPaginated = true;
    }
  }
  Paged.registerHandlers(BreaklintCollector);

  /** Called after pagination. Reconciles against the FINAL page list and re-reads the attributes. */
  window.__blCollectorResult = () => {
    const finalPages = P.all(document, ".pagedjs_page");
    const finalSet = new Set(finalPages);
    let discarded = state.discarded;
    for (const el of state.order) {
      if (!finalSet.has(el) || !el.isConnected) discarded++;
    }
    const drift = [];
    let unreconciled = 0;
    const pages = finalPages.map((el, index) => {
      const rec = state.byElement.get(el);
      const e = edges(el);
      // A final page with NO layout record is not a page with default values. An audit found this
      // branch fabricating { hasBreakToken: false, attributesAtLayout: null, epoch: 0 } and
      // counting it nowhere, so a page inserted after afterRendered — or one whose hook was lost
      // while other pages' hooks still fired, which the global hook count cannot see — was
      // classified from its attributes as if the paginator had reported it. It is counted now, and
      // reconciled: false forces its boundaries to unknown rather than to a guess.
      if (!rec) unreconciled += 1;
      if (rec && rec.attributesAtLayout) {
        for (const field of ["breakBefore", "previousBreakAfter", "page"]) {
          if (rec.attributesAtLayout[field] !== e.attrs[field]) {
            drift.push({ index, field, atLayout: rec.attributesAtLayout[field], afterRender: e.attrs[field] });
          }
        }
      }
      if (rec && rec.edgeAtLayout) {
        for (const field of ["lastNodePage", "firstSid", "lastSid", "blank"]) {
          if (rec.edgeAtLayout[field] !== e[field]) {
            drift.push({ index, field, atLayout: String(rec.edgeAtLayout[field]), afterRender: String(e[field]) });
          }
        }
      }
      return {
        index,
        reconciled: !!rec,
        hasBreakToken: rec ? rec.hasBreakToken : false,
        attributesAtLayout: rec && rec.attributesAtLayout ? rec.attributesAtLayout : e.attrs,
        attributesAfterRender: e.attrs,
        firstSid: e.firstSid,
        lastSid: e.lastSid,
        lastNodePage: e.lastNodePage,
        blank: e.blank,
        epoch: rec ? rec.epoch : 0,
      };
    });
    return {
      pages,
      hooks: state.hooks,
      discardedRecords: discarded,
      unreconciledPages: unreconciled,
      attributeDrift: drift,
      epochCount: state.epoch + 1,
    };
  };
})()`;

/**
 * Turn what the collector saw into the boundary facts the classifier consumes.
 *
 * Separate from both the collection and the classification, and pure, because this is where an
 * off-by-one lives: boundary `i` is between page `i` and page `i + 1`, and it reads the NEXT
 * page's attributes with the PREVIOUS page's token. Getting that backwards would classify every
 * document plausibly and every document wrongly.
 */
export function boundaryFactsFrom(
  pages: readonly CollectedPage[],
  cascadeHints: Readonly<Record<string, BreakCauseCascadeHint | null>> = {},
): {
  nextPageBlank: boolean;
  breakBefore: string | null;
  previousBreakAfter: string | null;
  pageBefore: string | null;
  pageAfter: string | null;
  hasBreakToken: boolean;
  sidBefore: string | null;
  sidAfter: string | null;
  cascadeHint: BreakCauseCascadeHint | null;
}[] {
  const facts = [];
  for (let i = 0; i + 1 < pages.length; i += 1) {
    const before = pages[i]!;
    const after = pages[i + 1]!;
    // A boundary between pages the paginator did not both report cannot be classified from
    // attributes: the evidence for it is missing, not merely negative. Stripping the signals
    // yields `unknown` through the normal path, which by §9 invariant 1 suppresses nothing —
    // the direction in which uncertainty is cheap.
    const known = before.reconciled && after.reconciled;
    facts.push({
      nextPageBlank: known ? after.blank : false,
      breakBefore: known ? after.attributesAfterRender.breakBefore : null,
      previousBreakAfter: known ? after.attributesAfterRender.previousBreakAfter : null,
      pageBefore: known ? before.lastNodePage : null,
      pageAfter: known ? after.attributesAfterRender.page : null,
      // The token belongs to the page BEFORE the boundary: it is what that page could not fit.
      hasBreakToken: known ? before.hasBreakToken : false,
      sidBefore: before.lastSid,
      sidAfter: after.firstSid,
      cascadeHint: (after.firstSid ? cascadeHints[after.firstSid] : null) ?? null,
    });
  }
  return facts;
}
