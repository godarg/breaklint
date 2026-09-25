# `svg/text-overflows-viewport`

| | |
|---|---|
| severity | error |
| threshold | overshoot > 0 px, at a resolution of 0.01 px |
| proof source | A |
| calibrated | **no** |

## What is checked

A text element lies outside its SVG's viewport and is not drawn.

## Why

The second rule carrying `error`. Two directly measured boxes, a structural boundary. Both are brought into **one coordinate system** before comparison: the viewport coordinate system of the outermost `<svg>` — CSS px, origin at its content-box corner, before any CSS transform or zoom. `getBBox()` returns the text's own user-space coordinates, and on a transformed group local (60, 0) is absolute (284.57, 70.78) — an error of 235.46 px. Comparing a local box against an absolute viewport is a different measurement, not an approximation.

The browser clips SVG content in exactly that system and applies the CSS transform and zoom that carry it to the screen only afterwards. Containment is invariant under that affine map, so it is decided there — not between screen rectangles, which under a rotation are only envelopes and can put a clipped label "inside".

## How the boxes are obtained

**The text box.** The collector reads each `<text>`'s `getBBox()` and carries it through
`getCTM()` — the text's matrix into its nearest viewport's coordinate system — and, for a text in a
nested `<svg>`, through the enclosing viewports' `getCTM()` chain into the outermost frame. It takes
**all four** transformed corners rather than two opposite ones. Under a rotation the min/max over a
single diagonal is smaller than the real extent in both axes, and this rule compares extents. The
same corners through `getScreenCTM()` give the screen box a finding reports as its position; the
two must agree (the local matrix carried to the screen is the text's own `getScreenCTM()`, to
0.005 px, and within what the frame's error bound leaves of the resolution), or the target cannot
be placed and declines as unreadable. The local box is stored unrounded.

**The clip rectangles.** For an outermost SVG the boxes are the USED ones: CDP
`DOM.getBoxModel()` — the browser's layout tree, read out of process — gives the content, padding
and border quads on the screen, and the collector carries them back into the frame through
`getScreenCTM() · getCTM()⁻¹` of the SVG. Layout snaps boxes to 1/64 px and computed style does
not: a padding of `2.7px` lays out as 2.6875, so a border-box SVG 317.389 px wide has a used content
box 312 px wide against a computed 311.975. A clip rebuilt from computed values is off by up to a
LayoutUnit per edge, which is more than this rule resolves (0.6.0 declined every padded SVG). The
clip is the content box when `overflow-clip-margin` is `content-box` (the user-agent default on
every SVG root), and otherwise the padding, border or content box it names grown by its length —
`10px` alone grows the **padding** box, and `padding-box` serialises as `0px`. The length is the
used one too: Chromium stores the margin as a LayoutUnit and serialises that (`10.3px` reads
`10.2969px`).

**The painted clip.** Chromium does not clip where layout puts that rectangle. It paints the
SVG's content at its border-box origin rounded to a whole CSS px of the document, and clips at the
clip rectangle with each edge rounded the same way (half up), in CSS px of the document whatever
the device scale. Measured on Chromium 141 through Paged.js at a device scale of 8, over 18 SVGs
on fractional positions: every painted clip edge where that model puts it, to the pixel. The clip
the rule compares against is therefore the snapped rectangle less the snapped origin, carried into
the frame. Against the unsnapped one, labels within about 0.6 px of the edge came out on the wrong
side in both directions (`tests/fixtures/svg-pixel-snapping.html`: a drawn label 0.04 px past the
layout edge, a clipped one 0.21 px inside it). The model holds only where the SVG's paint offset is
in the document's space; under a CSS transform, `will-change`, a fixed or sticky position, or a
scrolled ancestor it was not measured, and an SVG whose own viewport clips there declines (a
nested viewport's clip is drawn with the content and moves with it). An edge that lies within the
margin's serialisation of a half pixel cannot be rounded with certainty and declines as
`frame-imprecise`.

What clips depends on the kind of SVG, measured on Chromium 141 by painting a large rectangle
inside each viewport:

- an outermost SVG clips on `hidden`, `clip`, `auto` and `scroll`, and on any pair of the
  scroll-container values — `overflow-x: visible; overflow-y: hidden` computes to `auto hidden`
  and clips both axes;
- a **nested** `<svg>` clips on `hidden`, `clip` and `scroll` at its viewport, but not on `auto`
  (property or attribute), which paints like `visible`;
- **paint containment** — `contain: paint`, `strict` or `content`, or `content-visibility: auto`
  — clips an outermost SVG exactly where the same clip margin puts an overflow clip, with
  `overflow: visible` too. On a nested SVG it clips nothing.

For a nested `<svg>` the viewport is placed where the browser's own `getScreenCTM()` puts it,
carried into the frame, and sized by its computed width and height. Measured on Chromium 141: the
nested SVG's screen CTM in its parent's space is `translate(x, y)` times the viewBox transform of
that size, the computed width and height are the used ones — a CSS `width` overrides the
attribute, `auto` resolves to the parent viewport's size — and a CSS `x` moves neither the CTM nor
the painting. The CTM must be exactly that, or the SVG declines: with a `viewBox` its scale holds
the computed size against the browser's own placement; without one the CTM is a translation and
the size rests on the computed value alone. Its client rect is the union of its
**content**, not its viewport, and was never a clip edge. A text is drawn in full only inside its
own viewport's clip and every enclosing one, and the rule measures against all of them.

**The proof.** CDP's quads carried into the frame must be what the frame says they are —
rectangles, nested inside each other, the content box's corner at the origin — to 0.005 px, or the
SVG declines: that is what ties `getScreenCTM()` to the layout tree. The computed-style content box
must agree with the used one to 0.1 px, a units check that a device-pixel quad or a doubled zoom
would fail by the whole box. Every model error seen while building this disagreed by 5 px or more.

**The resolution.** Each frame carries a bound on how far its clip edges can sit from the
browser's (`SvgViewportLocal.uncertaintyPx`): the residual against CDP, the float32 quantisation of
the quads — CDP builds them in single precision, 0.0039 px at 100 000 px down a run — the clip
margin's six-digit serialisation and, where a nested viewport clips, the serialisation of its
width and height scaled into the frame, plus 0.001 px of arithmetic noise. An overshoot is
reported only when it exceeds the permitted one by more than **0.01 px**
(`SVG_OVERSHOOT_EPSILON_PX`). A frame whose bound plus another 0.001 px exceeds that is declined
(`frame-imprecise`), and so is a target whose own residual does not fit beside the frame's bound;
neither is measured with a larger epsilon. So no finding is an artefact of the frame: a reported
overshoot is a true one. The
price is a band of at most 0.02 px above the permitted overshoot in which a clipped label can come
out clean — the stated resolution of the rule, 1/50 of a CSS pixel of the glyph cell. It is not
configurable. Both boxes are compared unrounded; the screen box a finding carries keeps the
snapshot's 0.01 px grid.

**The value a finding reports** is the overshoot in that frame: CSS px of the SVG before its CSS
transforms and zoom. Up to 0.6.0 it was screen px. For an SVG with no CSS transform or zoom between
it and the page the two are the same number; under `zoom: 2` the frame value is half the screen
distance.

Both halves of that are measured in `tests/fixtures/svg-text-geometry.html`. A label at 90 degrees
has a LOCAL box inside the viewport and a screen box outside it, so `getBBox()` alone reports
nothing there. A second label at 45 degrees separates four corners from two: its four-corner box
crosses the viewport edge by 15.82 px while its two-corner box stays 28 px inside. At exactly 90
degrees the two boxes coincide, which is why the first fixture cannot make that distinction and an
independent review was right to say the claim was unmeasured until the second one existed.

**A `<text>` that is not painted is not a target.** Chrome answers `getBBox()` and
`getScreenCTM()` for an element inside `<defs>` and yields a box 609.65 px outside the viewport —
this rule would report an error about something that is never painted. The collector asks
`getBoundingClientRect` first, and an element with an empty rect is neither a candidate nor a
decline. The same holds for `visibility: hidden`, `opacity: 0` and a `<text>` with neither fill
nor stroke — those lay out normally and return a full rect, so they are read from the computed
style instead. Fully transparent computed paint is excluded by the same rule. Every one of them
is the `<defs>` case through another door; `checkVisibility` is one input, not a paint oracle.

**A nested `<svg>` belongs to its own record.** `querySelectorAll` reaches into it from the outer
element, which collected the same label twice and compared it against the outer viewport rather
than the one that actually clips it. Each record takes only the targets whose nearest `<svg>`
ancestor is itself — and is then measured against its own clip and the clips of the SVGs around it.

Every primitive involved — `getBBox()`, `getCTM()`, `getScreenCTM()`, the matrix and rectangle
coefficients, the SVGLength values, `assignedSlot`, `scrollLeft`/`scrollTop`, and
`CSSStyleDeclaration.prototype.getPropertyValue` through which every computed value is read by
name — is captured before any author script runs, for the same reason the rest of the geometry is:
a document that replaces them could otherwise decide what this rule sees. They are invoked through
a captured `Reflect.apply`, not `Function.prototype.call`, so a page that replaces `call` does not
reach them either. 0.6.0 read computed values through the property getters (`style.overflow`,
`style.overflowClipMargin`), which live on the prototype; a page that shadows them — or, in round 2
of 0.7.0, replaces `Function.prototype.call` — turns a clipped label into a clean run
(`tests/fixtures/svg-computed-style-spoof.html`).

Until 0.2.3 no geometry was collected at all. Every SVG arrived marked unmeasurable with a reason
this rule had not declared, which is a fatal `checker-crashed` by design — so any document holding
a figure ended in exit 3 rather than being checked.

## Limits and fail-closed cases

Where nothing clips — no clipping overflow on the SVG or any enclosing SVG, no paint
containment, no clip-path, mask, mask-box image or `url()` filter on the outermost SVG, no clipping
HTML ancestor inside the page area, no slot assignment — the glyphs are painted after all, and the
rule declines rather than
reports. Those targets are not counted against coverage either: the question does not arise for
them, and one such figure would otherwise take an error rule with a coverage floor of 1 below its
floor and end the run in exit 4. The decline stays in `notMeasured`.

A `<text>` whose screen box cannot be read — no CTM, or `getBBox()` throwing on a target with no
rendered geometry — declines with `env/svg-ctm-unavailable` and DOES count against coverage: that
is a target this rule ought to have judged and could not.

`getBBox()` also omits painted geometry introduced or removed by visible stroke, a paint server,
text decoration, clip path, mask or filter. Text instantiated through `<use>` is inside a closed
instance tree. A `rotate` attribute on the text or any of its `<tspan>`s turns each glyph about its
own origin, and with `lengthAdjust="spacingAndGlyphs"` Chromium 141 draws ink 2.25 px beyond the
`getBBox()` cell: the box stops being the ink's outer bound. Those cases decline per target with
`env/svg-painted-bounds-unsupported`; they stay in the denominator, so the rule ends in exit 4
rather than inventing a box or silently losing the candidate. Per-glyph `x`, `y`, `dx` and `dy`
lists and `textPath` were measured to keep the ink inside the cell and are measured.

Border, padding, `overflow-clip-margin` in every serialised form and zoom — on the SVG or any
ancestor — are measured, not declined; so are 2D CSS transforms and the individual
`rotate`/`scale`/`translate` properties where the SVG itself does not clip (its viewport clips
nothing the frame must snap). Up to 0.6.0 each of them declined the whole record. What still
declines the
whole record with `env/svg-viewport-geometry-unsupported`, counted against coverage, is geometry
this build does not reconstruct:

- a rounded clip: a corner radius larger than border plus padding on both axes, so the clip is not
  the rectangle compared against; and any radius together with a clip margin other than the
  default;
- a 3D transform, perspective or motion path on the SVG or an ancestor;
- `overflow-x: visible` with `overflow-y: clip` (or the reverse) on an outermost SVG — on
  Chromium 141 that clips one axis only, at the padding box — and any mixed pair on a nested one;
- a `contain` or `content-visibility` value the collector does not know;
- a clip-path, mask, `url()` filter or legacy `clip` on the outermost SVG, whatever its overflow:
  it cuts drawn text wherever it lies, so the SVG is clipped, not exempt (0.6.0 called it
  non-applicable when the SVG's overflow was visible). This is decided by an allow-list: `clip-path`,
  `mask-image`, `mask`, `-webkit-mask-box-image-source` and `mask-border-source` must be `none`,
  `filter` `none` or a list of CSS filter functions without `url()`, and `clip` `auto` (an empty
  value, a property the browser does not have, counts as absent); any other value —
  including one never seen before — is a clip (round 2 of 0.7.0 read `-webkit-mask-box-image` as
  no clip at all);
- an outermost SVG whose own viewport clips, under a CSS transform, the individual transform properties,
  `will-change`, or a fixed or sticky position, on it or an ancestor (`pixel-snapping-unmodelled`),
  or below a scrolled ancestor (`scrolled-ancestor`): the painted clip is snapped in a space the
  frame does not model;
- an SVG that is, or lies below, an element assigned to a `<slot>` (`shadow-tree`): it is drawn in
  a shadow tree whose clips neither the collector's parent walk nor the CDP walk visits, so it
  declines whatever its own overflow says;
- an HTML ancestor inside the page area that clips — overflow, paint containment, clip-path, mask —
  unless it is a rectangular overflow or containment clip whose content box, on CDP's quad,
  contains the SVG's own clip. Every such clip contains the ancestor's content box, so then nothing
  drawn inside the SVG's clip is cut by it. An SVG with no clip of its own under a clipping
  ancestor, a rounded ancestor clip and an ancestor clip-path decline. The page box and the sheet
  above the page area are the block rules' business;
- a nested `<svg>` with a transform, with a clip margin, rotated or skewed within the outer frame,
  whose computed width or height is not a px length, whose `viewBox` or `preserveAspectRatio` this
  code does not parse, or whose screen CTM is not `translate(x, y)` times the viewBox transform of
  its computed size (`nested-lengths-disagree`);
- an `<svg>` inside a `<foreignObject>`, which the foreignObject and the enclosing SVG clip too;
- an SVG whose frame CDP does not confirm, whose computed content box is not the used one to
  0.1 px, whose error bound does not fit the resolution (quads more than 262 144 px down a run), or
  for which CDP gives no box model. Only a record with no potential target at all — every `<text>`
  unrendered, no `<use>` — is not declined for that, because there is nothing its viewport could
  clip that this rule judges.

The snapshot names which case applied (`SvgRecord.viewportDiagnostic`); the report carries the
coverage reason.

**An SVG inside a shadow root is not collected.** The collector enumerates the document's own
elements, and `querySelectorAll` does not enter shadow trees: an `<svg>` a custom element renders
in its shadow root is neither a candidate nor a decline, so a clipped label there goes unjudged and
uncounted. A light-DOM SVG slotted into a shadow tree is collected and declined (`shadow-tree`).

**A label flush with the edge is not a finding.** A label ending exactly on the viewport edge —
`textLength` set to the full width of the viewBox, so the box ends on the edge by construction —
measures 0 and stays clean, as does one within the 0.01 px resolution. 0.6.0 compared screen boxes
rounded to two decimals against that grid; the frame boxes are now compared unrounded against the
stated resolution above.

**What a finding measures is the typographic cell, not the ink.** `getBBox()` is advance by
ascent plus descent; a label whose cell crosses the edge while its glyphs stay inside is reported.
The live fixtures therefore use a glyph whose ink fills its cell. Replacing the cell by an ink
bound is separate, later work.

## Calibration

`calibrated: false`. The threshold has not been fitted to a corpus of real documents with
human-checked truth; no such corpus exists for this project. Every finding says so, and the
report says so in `measurement.calibrated`. That is the honest state, not a defect — but it is
also why this rule ships with the severity it has.

M3-0 classifies this rule as `structural-validation`, not empirical threshold optimisation. The lab
reproduces outside, enlarged-viewBox and `overflow: visible` cases against an independent geometry
implementation and then exercises the unchanged production decision. The zero boundary is
unchanged, and `calibrated: false` remains unchanged. See
[`../validation/architecture.md`](../validation/architecture.md).
Any future structural acceptance report must likewise be derived from complete target-level
outcomes. The validator obtains finding/clean/declined from the source-pinned unchanged registry
`Rule.run` over the receipt-bound boxes and overflow state; this does not introduce a tunable
threshold.
Contract-simulation rows cannot make the structural claim ready. A claim-grade run still requires
a separately supplied capture bundle and attestation bound to the exact real-render receipt and
frozen renderer, plus an owner-approved external trust root that M3-0 does not possess.

## Remediation

<!-- begin generated remediation: svg/text-overflows-viewport -->
Text rendered inside an SVG extends outside the SVG viewport bounds and is clipped. Enlarge the SVG 'viewBox' or its width/height, or adjust the <text> coordinates ('x', 'y', 'text-anchor'). 'overflow: visible' on the container also clears the finding, but it does not move the text: the viewport then no longer clips, the target becomes non-applicable and this rule stops measuring it. Use that only where the overflow is intended.
<!-- end generated remediation: svg/text-overflows-viewport -->

## Examples

### Firing case (trigger)

```html
<svg viewBox="0 0 100 100" width="100" height="100">
  <!-- Text x=140 extends well beyond the 100px viewBox width -->
  <text x="140" y="50" font-size="14">Clipped Text Outside Viewport</text>
</svg>
```

### Non-firing case (remedied)

```html
<!-- Enlarge viewBox or reposition text so it sits within the viewport -->
<svg viewBox="0 0 300 100" width="300" height="100">
  <text x="20" y="50" font-size="14">Contained Text Inside Viewport</text>
</svg>
```

