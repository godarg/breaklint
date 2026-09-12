/**
 * The evidence overlay.
 *
 * The marks that bind a finding to a position in the PDF are placed in a per-page layer that is
 * attached AFTER pagination, at coordinates that were already measured. The author's block is
 * not touched: no `position`, no child node, no attribute.
 *
 * That is not fastidiousness. The earlier design put the marks inside the author's block and
 * set that block to `position: relative`, which makes it the containing block for absolutely
 * positioned descendants. Measured against a proper baseline, that moved an absolutely
 * positioned child by up to 197.82 px and changed 1 767 pixels of the delivered page — on a
 * document that had done nothing unusual. A checker that changes the layout it checks is no
 * longer measuring the document. The overlay changed no computed style field at all.
 *
 * Two consequences of attaching after pagination are worth stating, because they are the reason
 * for the design and not side effects:
 *
 *   - every fragment carries both marks, including the middle fragment of a block spanning
 *     three pages. The old design left exactly the continuation fragments unbindable that
 *     `layout/widow`, `layout/orphan` and `layout/orphaned-continuation-page` are about.
 *   - the page area is NOT positioned by this code. `.pagedjs_page_content` is already
 *     `position: relative`; measured, 0 of 4 areas were `static`. A precautionary intervention
 *     here would be an intervention nobody needs. If a future paginator changes that, it is an
 *     infrastructure fault (`env/page-area-static`), not a silent fix.
 *
 * Nothing here is found again by class name. The layers and marks are kept as node REFERENCES
 * in the page, and detaching, reading back and removing walk that list. The reason is a
 * measured failure mode rather than taste: a document containing `<div class="bl-overlay">` of
 * its own would have had that element removed from the tree — and then, because the removal
 * changes the picture, the binding would be dropped and the DAMAGED pdf delivered. A checker
 * that deletes author content on a name collision is worse than one that binds nothing.
 *
 * What this module does NOT claim: that the marks are invisible. An author selector that hits
 * every `span` hits the overlay mark too. Invisibility is not something to promise; it is
 * something to check, and the check is two stages — the property readback here, and the
 * PDF-against-PDF raster comparison in `evidence.ts`. The readback alone is not fail-closed;
 * measured over 18 hostile stylesheets it lets 9 through, and saying otherwise was the single
 * worst claim this design ever made.
 */

import type { PageLike } from "../acquire/browser.ts";

/** One mark as it was placed, in CSS pixels relative to its own paginated page box. */
export interface PlacedMark {
  /** `BLSID000A` / `BLSID000E`. Unique per document; this is what is looked for in the PDF. */
  token: string;
  /** The source id of the block this fragment belongs to. */
  sid: string;
  /** Running number over fragments in document order. A layout product — never an identity. */
  fragmentOrdinal: number;
  side: "start" | "end";
  page: number;
  xPx: number;
  yPx: number;
}

/** A requested anchor that the current Paged.js page cannot place without inventing a coordinate. */
export interface UnplacedMark {
  sid: string;
  page: number;
  side: "start" | "end";
  reason: "fragment-outside-page";
}

export interface OverlayInstallation {
  marks: PlacedMark[];
  /**
   * Source fragments reached from a page clone whose requested anchor did not belong to that
   * page's observed rectangle.  They remain explicitly unbound; coordinates are never clamped
   * into a page because that would fabricate a PDF location.
   */
  unplacedMarks: UnplacedMark[];
  layers: number;
  /** Pages whose content area was `static` — the case §11.4.1 treats as an infrastructure fault. */
  staticPageAreas: number;
}

const STYLE_LAYER =
  "all:initial!important;position:absolute!important;left:0!important;top:0!important;" +
  "width:0!important;height:0!important;overflow:visible!important;pointer-events:none!important;" +
  "display:block!important;opacity:1!important;visibility:visible!important;transform:none!important;" +
  "filter:none!important;mix-blend-mode:normal!important;background:none!important;border:0!important;" +
  "outline:0!important;box-shadow:none!important;clip-path:none!important;mask:none!important;" +
  "contain:none!important;isolation:auto!important";

const STYLE_MARK =
  "all:initial!important;position:absolute!important;color:transparent!important;" +
  // No fallback in this list, deliberately. A fallback would let the marks quietly land in
  // the document's own font again, which is the whole defect this font exists to remove —
  // and it would land there silently. With no fallback, a font that failed to load shows up
  // as a measurably different advance width, and the readback below turns that into a
  // violation instead of a wrong number.
  `font-family:"${MARK_FONT_FAMILY}"!important;` +
  "font-size:1px!important;line-height:0!important;pointer-events:none!important;display:inline!important;" +
  "opacity:1!important;visibility:visible!important;transform:none!important;filter:none!important;" +
  "mix-blend-mode:normal!important;background:none!important;border:0!important;outline:0!important;" +
  "box-shadow:none!important;text-shadow:none!important;-webkit-text-stroke:0!important;" +
  "text-decoration:none!important;letter-spacing:normal!important;word-spacing:normal!important;" +
  "white-space:pre!important;writing-mode:horizontal-tb!important;direction:ltr!important;" +
  "clip-path:none!important;mask:none!important;content-visibility:visible!important";

/**
 * `all: initial` comes FIRST and every declaration carries `!important`.
 *
 * `all` resets the properties nobody thought to list, which is precisely the difference between
 * this and an enumeration. An inline `!important` beats a stylesheet `!important` of the same
 * origin — measured at the real renderer, because the cascade order at this exact point is the
 * question half the procedure depends on. An inline declaration WITHOUT the priority loses.
 */
/**
 * The script installed into the page.
 *
 * Exported so a test can check that the names in `OVERLAY_GLOBALS` are the names this script
 * actually defines. Those two are a contract with no compiler between them: the constants are
 * TypeScript and this is a string the browser parses, so renaming one side alone produces a call
 * to a function that does not exist, and only the live suite would notice.
 */
import { MARK_FONT_FAMILY } from "./mark-font.ts";

const OVERLAY_CAPABILITY_MARKER = "__BREAKLINT_NODE_CAPABILITY__";

const OVERLAY_TEMPLATE = `(() => {
  const P = window.__blPrimitives;
  const STYLE_LAYER = ${JSON.stringify(STYLE_LAYER)};
  const STYLE_MARK = ${JSON.stringify(STYLE_MARK)};
  const FONT_FAMILY = ${JSON.stringify(MARK_FONT_FAMILY)};
  const capability = P.randomToken();
  let stage = 0, unauthorizedCalls = 0;
  let state = { layers: [], marks: [], detached: [] };

  const install = () => {
    const marks = [];
    const unplacedMarks = [];
    let staticPageAreas = 0, ordinal = 0;
    state = { layers: [], marks: [], detached: [] };
    const pages = P.all(document, ".pagedjs_page");
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
      const pageEl = pages[pageIndex];
      const area = P.all(pageEl, ".pagedjs_page_content")[0] || pageEl;
      if (P.style(area, null).position === "static") staticPageAreas++;
      const areaBox = P.rect(area);
      const pageBox = P.rect(pageEl);
      const layer = P.create("div");
      P.setAttr(layer, "class", "bl-overlay");
      P.setCssText(layer, STYLE_LAYER);
      for (const el of P.all(pageEl, "[data-bl-sid]")) {
        const sid = P.attr(el, "data-bl-sid");
        // Paged.js may retain the next page's box in a node reached from this page clone.  The
        // next rect is physically elsewhere in the spread, so using it for this layer expands
        // the print overflow and lets Chrome shrink the whole PDF.  A rect is this fragment only
        // when its own anchor is in this page's observed box; do not translate or clamp it.
        const allRects = P.rects(el);
        // A hidden/nonrendered author target had no overlay before this repair.  Preserve that
        // exclusion; it is not a cloned adjacent-page fragment and must not poison bindings.
        if (!allRects.length) continue;
        const rects = allRects.filter((rect) =>
          rect.x >= pageBox.left && rect.x <= pageBox.right &&
          rect.y >= pageBox.top && rect.y <= pageBox.bottom,
        );
        if (!rects.length) {
          unplacedMarks.push(
            { sid, page: pageIndex + 1, side: "start", reason: "fragment-outside-page" },
            { sid, page: pageIndex + 1, side: "end", reason: "fragment-outside-page" },
          );
          continue;
        }
        const ord = ordinal++;
        const digits = String(ord).padStart(3, "0");
        for (const [suffix, side, rect, edge] of [
          ["A", "start", rects[0], "top"],
          ["E", "end", rects[rects.length - 1], "bottom"],
        ]) {
          const token = "BLSID" + digits + suffix;
          const x = rect.x, y = edge === "top" ? rect.y : rect.bottom;
          // Marks use a verified one-pixel glyph font, but before readback we reserve the whole
          // tolerance envelope that would still be accepted there.  If it cannot fit, a clamp
          // would create a false location and an overflow can make Chrome shrink every page.
          const relativeX = x - areaBox.x, relativeY = y - areaBox.y;
          const maxAdvance = token.length * 1.2 + 2;
          if (
            x < pageBox.left || x > pageBox.right || y < pageBox.top || y > pageBox.bottom ||
            relativeX < 0 || relativeY < 0 || relativeX + maxAdvance > areaBox.width || relativeY + 1 > areaBox.height
          ) {
            unplacedMarks.push({ sid, page: pageIndex + 1, side, reason: "fragment-outside-page" });
            continue;
          }
          const mark = P.create("span");
          P.setAttr(mark, "class", "bl-mark");
          P.setCssText(mark, STYLE_MARK);
          P.setStyle(mark, "left", (x - areaBox.x) + "px", "important");
          P.setStyle(mark, "top", (y - areaBox.y) + "px", "important");
          P.setText(mark, token);
          P.append(layer, mark);
          // The node itself is remembered. Everything downstream walks these references and
          // never a selector, so an author element of the same class is invisible to us.
          state.marks.push(mark);
          marks.push({
            token: P.text(mark),
            sid,
            fragmentOrdinal: ord,
            side,
            page: pageIndex + 1,
            // Reported against the PAGE box, because that is the box the PDF page corresponds
            // to. Placement is against the AREA box, because that is where the layer hangs.
            xPx: x - pageBox.x,
            yPx: y - pageBox.y,
          });
        }
      }
      P.append(area, layer);
      state.layers.push(layer);
    }
    return { marks, unplacedMarks, layers: state.layers.length, staticPageAreas };
  };

  // Stage 1: read the computed style of every mark back. Cheap, specific, and NOT conclusive —
  // it names the offending mark and the reason, which the raster comparison cannot. It is the
  // diagnosis in front of the closing check, not a substitute for it.
  const readback = () => {
    const violations = [];
    for (const mark of state.marks) {
      const cs = P.style(mark, null);
      const box = P.rect(mark);
      const rgba = /rgba?\\(([^)]+)\\)/.exec(cs.color);
      const parts = rgba ? rgba[1].split(",") : [];
      const alpha = parts.length === 4 ? parseFloat(parts[3]) : 1;
      const why = [];
      if (cs.position !== "absolute") why.push("position=" + cs.position);
      if (alpha !== 0) why.push("colour alpha=" + alpha);
      if (parseFloat(cs.fontSize) > 1.01) why.push("font-size=" + cs.fontSize);
      if (parseFloat(cs.opacity) !== 1) why.push("opacity=" + cs.opacity);
      if (cs.visibility === "hidden") why.push("visibility=hidden");
      if (cs.display === "none") why.push("display=none");
      // A nine-character mark at 1px measures about 5px wide, so an absolute 1px box threshold
      // would fire on the neutral case and switch binding off in every document in the world.
      // That happened, and its own red condition caught it: the check must fire on a mark that
      // was actually reached and stay silent on an untouched one.
      const token = P.text(mark);
      const allowed = token.length * parseFloat(cs.fontSize) * 1.2 + 2;
      if (box.width > allowed) why.push("width=" + box.width.toFixed(2) + " > " + allowed.toFixed(2));
      // Did the mark font actually apply? Two independent answers, because either alone can lie.
      // The computed family is what the cascade decided; a hostile stylesheet cannot change it
      // past an inline !important, but a font that failed to LOAD leaves the family standing and
      // silently paints with the fallback. So the advance width is measured too: every glyph in
      // this font is one em wide, which at 1px is one pixel per character.
      if (cs.fontFamily.indexOf(FONT_FAMILY) === -1) why.push("font-family=" + cs.fontFamily);
      else if (document.fonts && document.fonts.check && !document.fonts.check('1px "' + FONT_FAMILY + '"')) {
        why.push("mark font did not load");
      } else if (Math.abs(box.width - token.length * parseFloat(cs.fontSize)) > 1) {
        // Not a style question: this is the measurement that says the glyphs came from somewhere
        // else. It is the only signal that catches a font which is installed, reported and wrong.
        why.push("advance=" + box.width.toFixed(2) + " for " + token.length + " chars at " + cs.fontSize);
      }
      if (why.length) violations.push({ token, why: why.join(", ") });
    }
    return violations;
  };

  // Detach, not hide. A comparison over \`display:none\` leaves the layer in the tree, so an
  // author selector reacting to its PRESENCE — \`:has(.bl-overlay)\`, a sibling combinator —
  // keeps applying. Measured on this product: replacing the detach with a hide turned a case
  // that reports 84 711 differing pixels into one that reports 0 and kept a binding it should
  // have lost.
  const detach = () => {
    state.detached = [];
    for (const layer of state.layers) {
      const parent = P.parent(layer);
      if (!parent) continue;
      state.detached.push([layer, parent, P.next(layer)]);
      P.remove(layer);
    }
    return state.detached.length;
  };

  const remove = () => {
    let n = 0;
    for (const layer of state.layers) {
      if (P.parent(layer)) { P.remove(layer); n++; }
    }
    state = { layers: [], marks: [], detached: [] };
    return n;
  };

  const control = (token, action) => {
    if (token !== capability) {
      unauthorizedCalls += 1;
      throw new Error("unauthorized evidence-overlay control call");
    }
    const expected = ["install", "readback", "detach", "remove"][stage];
    if (action !== expected) throw new Error("evidence-overlay action out of sequence: " + action + " != " + expected);
    const value = action === "install" ? install()
      : action === "readback" ? readback()
      : action === "detach" ? detach()
      : remove();
    stage += 1;
    return { value, unauthorizedCalls };
  };
  P.publishOverlay(${OVERLAY_CAPABILITY_MARKER}, control);
  return capability;
})()`;

export function overlaySource(apparatusCapability: string): string {
  return OVERLAY_TEMPLATE.replace(OVERLAY_CAPABILITY_MARKER, JSON.stringify(apparatusCapability));
}

/** Static test surface; production supplies the per-page Node-held capability. */
export const OVERLAY_SOURCE = overlaySource("breaklint-static-test-capability");

const capabilities = new WeakMap<PageLike, string>();

async function call<R>(page: PageLike, action: "install" | "readback" | "detach" | "remove"): Promise<R> {
  const capability = capabilities.get(page);
  if (!capability) throw new Error("evidence-overlay capability is unavailable");
  const result = await page.evaluate<{ value: R; unauthorizedCalls: number }>(
    `window.${OVERLAY_GLOBALS.control}(${JSON.stringify(capability)}, ${JSON.stringify(action)})`,
  );
  if (result.unauthorizedCalls > 0) {
    throw new Error(`evidence-overlay control raced by author code: ${result.unauthorizedCalls} unauthorized call(s)`);
  }
  return result.value;
}

/**
 * The four in-page entry points, by name.
 *
 * Exported so a test can dispatch on them without transcribing them. A unit stub matched on
 * hand-copied literals, and renaming any of these left the whole suite at 175/175 while the stub
 * silently stopped recognising the call it exists to answer — a fake that keeps passing after it
 * has stopped faking the right thing.
 */
export const OVERLAY_GLOBALS = {
  control: "__blOverlayControl",
} as const;

export async function installOverlay(
  page: PageLike,
  apparatusCapability = "breaklint-static-test-capability",
): Promise<OverlayInstallation> {
  const capability = await page.evaluate<string>(overlaySource(apparatusCapability));
  capabilities.set(page, capability);
  return call<OverlayInstallation>(page, "install");
}

export async function readbackViolations(page: PageLike): Promise<{ token: string; why: string }[]> {
  return call<{ token: string; why: string }[]>(page, "readback");
}

export async function detachOverlay(page: PageLike): Promise<number> {
  return call<number>(page, "detach");
}

export async function removeOverlay(page: PageLike): Promise<number> {
  const removed = await call<number>(page, "remove");
  capabilities.delete(page);
  return removed;
}
