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

export interface OverlayInstallation {
  marks: PlacedMark[];
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
export const OVERLAY_SOURCE = `(() => {
  const STYLE_LAYER = ${JSON.stringify(STYLE_LAYER)};
  const STYLE_MARK = ${JSON.stringify(STYLE_MARK)};

  window.__blOverlay = { layers: [], marks: [], detached: [] };

  window.__blOverlayInstall = () => {
    const marks = [];
    let staticPageAreas = 0, ordinal = 0;
    window.__blOverlay = { layers: [], marks: [], detached: [] };
    const pages = document.querySelectorAll(".pagedjs_page");
    pages.forEach((pageEl, pageIndex) => {
      const area = pageEl.querySelector(".pagedjs_page_content") || pageEl;
      if (getComputedStyle(area).position === "static") staticPageAreas++;
      const areaBox = area.getBoundingClientRect();
      const pageBox = pageEl.getBoundingClientRect();
      const layer = document.createElement("div");
      layer.className = "bl-overlay";
      layer.style.cssText = STYLE_LAYER;
      for (const el of pageEl.querySelectorAll("[data-bl-sid]")) {
        const rects = el.getClientRects();
        if (!rects.length) continue;
        const ord = ordinal++;
        const digits = String(ord).padStart(3, "0");
        for (const [suffix, side, rect, edge] of [
          ["A", "start", rects[0], "top"],
          ["E", "end", rects[rects.length - 1], "bottom"],
        ]) {
          const mark = document.createElement("span");
          mark.className = "bl-mark";
          mark.style.cssText = STYLE_MARK;
          const x = rect.x, y = edge === "top" ? rect.y : rect.bottom;
          mark.style.setProperty("left", (x - areaBox.x) + "px", "important");
          mark.style.setProperty("top", (y - areaBox.y) + "px", "important");
          mark.textContent = "BLSID" + digits + suffix;
          layer.appendChild(mark);
          // The node itself is remembered. Everything downstream walks these references and
          // never a selector, so an author element of the same class is invisible to us.
          window.__blOverlay.marks.push(mark);
          marks.push({
            token: mark.textContent,
            sid: el.getAttribute("data-bl-sid"),
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
      area.appendChild(layer);
      window.__blOverlay.layers.push(layer);
    });
    return { marks, layers: window.__blOverlay.layers.length, staticPageAreas };
  };

  // Stage 1: read the computed style of every mark back. Cheap, specific, and NOT conclusive —
  // it names the offending mark and the reason, which the raster comparison cannot. It is the
  // diagnosis in front of the closing check, not a substitute for it.
  window.__blOverlayReadback = () => {
    const violations = [];
    for (const mark of window.__blOverlay.marks) {
      const cs = getComputedStyle(mark);
      const box = mark.getBoundingClientRect();
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
      const allowed = mark.textContent.length * parseFloat(cs.fontSize) * 1.2 + 2;
      if (box.width > allowed) why.push("width=" + box.width.toFixed(2) + " > " + allowed.toFixed(2));
      if (why.length) violations.push({ token: mark.textContent, why: why.join(", ") });
    }
    return violations;
  };

  // Detach, not hide. A comparison over \`display:none\` leaves the layer in the tree, so an
  // author selector reacting to its PRESENCE — \`:has(.bl-overlay)\`, a sibling combinator —
  // keeps applying. Measured on this product: replacing the detach with a hide turned a case
  // that reports 84 711 differing pixels into one that reports 0 and kept a binding it should
  // have lost.
  window.__blOverlayDetach = () => {
    window.__blOverlay.detached = [];
    for (const layer of window.__blOverlay.layers) {
      if (!layer.parentNode) continue;
      window.__blOverlay.detached.push([layer, layer.parentNode, layer.nextSibling]);
      layer.remove();
    }
    return window.__blOverlay.detached.length;
  };

  window.__blOverlayRemove = () => {
    let n = 0;
    for (const layer of window.__blOverlay.layers) {
      if (layer.parentNode) { layer.remove(); n++; }
    }
    window.__blOverlay = { layers: [], marks: [], detached: [] };
    return n;
  };

  window.__blOverlayReady = true;
})()`;

async function call<R>(page: PageLike, name: string): Promise<R> {
  return page.evaluate<R>(`window.${name}()`);
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
  install: "__blOverlayInstall",
  readback: "__blOverlayReadback",
  detach: "__blOverlayDetach",
  remove: "__blOverlayRemove",
} as const;

export async function installOverlay(page: PageLike): Promise<OverlayInstallation> {
  await page.evaluate<void>(OVERLAY_SOURCE);
  return call<OverlayInstallation>(page, OVERLAY_GLOBALS.install);
}

export async function readbackViolations(page: PageLike): Promise<{ token: string; why: string }[]> {
  return call<{ token: string; why: string }[]>(page, OVERLAY_GLOBALS.readback);
}

export async function detachOverlay(page: PageLike): Promise<number> {
  return call<number>(page, OVERLAY_GLOBALS.detach);
}

export async function removeOverlay(page: PageLike): Promise<number> {
  return call<number>(page, OVERLAY_GLOBALS.remove);
}
