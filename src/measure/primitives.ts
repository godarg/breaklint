/**
 * References to the measuring primitives, captured before any author script can reach them.
 *
 * THE ATTACK THIS CLOSES. Every geometry number in the freeze signature and in the snapshot comes
 * from `getBoundingClientRect`, `getComputedStyle` and `querySelectorAll`, called inside the
 * document being measured. A document that assigns its own function to
 * `Element.prototype.getBoundingClientRect` therefore does not have to change its layout to change
 * the measurement — it can report whatever it likes, and a frozen, drifting page would certify as
 * stable. The tool would print a clean report about a document it never saw.
 *
 * THE FIX AND ITS LIMIT, stated together because the limit is the honest part. This script is
 * installed with `Page.addScriptToEvaluateOnNewDocument`, which CDP runs after the document object
 * exists and BEFORE any script the document itself contains. It copies the primitives onto
 * `window.__blPrimitives` and calls them with the original receivers. An author script that later
 * replaces the prototype method changes what the DOCUMENT sees; it does not change the reference
 * captured here.
 *
 * What this does NOT do is make the measurement out-of-process. A design review proposed exactly
 * that — take everything through CDP and touch nothing in the page — and it is not achievable:
 * the SVG ink passes (§5.0), the `getScreenCTM()` normalisation (§11.3 component 4) and the word
 * boxes (§9) all require execution inside the page. A claim of full isolation would be an
 * unmeasured promise, so the reachable half is taken and the rest is cross-examined instead: a
 * sample of box geometry is checked against CDP's `DOM.getBoxModel`, which is an oracle from a
 * DIFFERENT source than the thing it judges — the browser's own layout tree rather than a
 * scriptable API surface.
 *
 * ORDERING IS THE WHOLE PROPERTY. Installed after the first author script has run, this file is
 * worth nothing at all: it would faithfully capture the replacement. There is a live test that
 * makes that concrete rather than leaving it as a comment.
 */

/**
 * The script CDP evaluates on every new document, before the document's own scripts.
 *
 * `Function.prototype.call` is captured too, and used explicitly — a document that replaces
 * `call` itself could otherwise intercept every invocation below. There is no defence against a
 * document that replaces `Reflect`, `Object.getOwnPropertyDescriptor` and the prototype chain in
 * a worker before this runs, and none is claimed: this raises the cost of the attack, and the
 * raster comparison in `evidence.ts` remains the check that does not run in the page at all.
 */
export const PRIMITIVES_SOURCE = `(() => {
  const call = Function.prototype.call;
  const rectFn = Element.prototype.getBoundingClientRect;
  const rectsFn = Element.prototype.getClientRects;
  const styleFn = window.getComputedStyle;
  const qsaFn = Element.prototype.querySelectorAll;
  const docQsaFn = Document.prototype.querySelectorAll;
  const sliceFn = Array.prototype.slice;

  Object.defineProperty(window, "__blPrimitives", {
    value: Object.freeze({
      rect: (el) => call.call(rectFn, el),
      rects: (el) => call.call(rectsFn, el),
      style: (el, pseudo) => call.call(styleFn, window, el, pseudo),
      all: (root, selector) => {
        const fn = root === document ? docQsaFn : qsaFn;
        return call.call(sliceFn, call.call(fn, root, selector));
      },
      installed: true,
    }),
    writable: false,
    configurable: false,
    enumerable: false,
  });
})()`;

/**
 * Whether the primitives survived to measurement time.
 *
 * Checked rather than assumed: if the install failed, or a document managed to delete the binding,
 * every number after this point would come from whatever the document wanted. The measurement then
 * refuses. `installed: true` on a frozen, non-configurable property is not proof against a
 * determined attacker who ran before CDP — it is proof that the ordinary failure (the script never
 * ran, because the CDP session was not the one that loaded the document) is caught.
 */
export const PRIMITIVES_CHECK = `(() => {
  const p = window.__blPrimitives;
  if (!p || p.installed !== true) return { ok: false, reason: "the primitive references were never installed" };
  const d = Object.getOwnPropertyDescriptor(window, "__blPrimitives");
  if (!d || d.writable === true || d.configurable === true) {
    return { ok: false, reason: "the primitive references are replaceable, so they prove nothing" };
  }
  return { ok: true, reason: "" };
})()`;

export interface PrimitivesStatus {
  ok: boolean;
  reason: string;
}
