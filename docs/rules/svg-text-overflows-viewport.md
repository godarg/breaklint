# `svg/text-overflows-viewport`

| | |
|---|---|
| severity | error |
| threshold | overshoot > 0 px, at a resolution of 0.01 px |
| proof source | A |
| calibrated | **no** |

## What is checked

A text element's painted ink lies outside its SVG's viewport and is not drawn.

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
LayoutUnit per edge, which is more than this rule resolves (0.6.0 declined every padded SVG). The clip is the content box when `overflow-clip-margin` is `content-box` (the user-agent
default on every SVG root), and otherwise the padding, border or content box it names grown by its
length — `10px` alone grows the **padding** box, and `padding-box` serialises as `0px`. The length
is the used one too: Chromium stores the margin as a LayoutUnit and serialises that (`10.3px` reads
`10.2969px`).

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

For a nested `<svg>` the viewport is its `x`/`y`/`width`/`height` in its parent's user space,
carried into the frame; its client rect is the union of its **content**, not its viewport, and was
never a clip edge. A text is drawn in full only inside its own viewport's clip and every enclosing
one, and the rule measures against all of them.

**The proof.** CDP's quads carried into the frame must be what the frame says they are —
rectangles, nested inside each other, the content box's corner at the origin — to 0.005 px, or the
SVG declines: that is what ties `getScreenCTM()` to the layout tree. The computed-style content box
must agree with the used one to 0.1 px, a units check that a device-pixel quad or a doubled zoom
would fail by the whole box. Every model error seen while building this disagreed by 5 px or more.

**The resolution.** Each frame carries a bound on how far its clip edges can sit from the
browser's (`SvgViewportLocal.uncertaintyPx`): the residual against CDP, the float32 quantisation of
the quads — CDP builds them in single precision, 0.0039 px at 100 000 px down a run — and the clip
margin's six-digit serialisation, plus arithmetic noise. An overshoot is reported only when it
exceeds the permitted one by more than **0.01 px** (`SVG_OVERSHOOT_EPSILON_PX`), and a frame whose
bound, with a target's own residual, does not fit inside that is declined, never measured with a
larger epsilon. So no finding is an artefact of the frame: a reported overshoot is a true one. The
price is a band of at most 0.02 px above the permitted overshoot in which a clipped label can come
out clean — the stated resolution of the rule, 1/50 of a CSS pixel of the glyph cell. It is not
configurable. Both boxes are compared unrounded; the screen box a finding carries keeps the
snapshot's 0.01 px grid.

**The value a finding reports** is the overshoot in that frame: CSS px of the SVG before its CSS
transforms and zoom, and — since the painted-ink bound below — the overshoot the ink is PROVEN to
reach (the lower bound), rounded down to 0.01 px. Up to 0.6.0 it was screen px, of the cell. For
an SVG with no CSS transform or zoom between it and the page the two are the same number; under
`zoom: 2` the frame value is half the screen distance.

Both halves of that are measured in `tests/fixtures/svg-text-geometry.html`. A label at 90 degrees
has a LOCAL box inside the viewport and a screen box outside it, so `getBBox()` alone reports
nothing there. A second label at 45 degrees separates four corners from two: its four-corner box
crosses the viewport edge by 15.82 px while its two-corner box stays 28 px inside. At exactly 90
degrees the two boxes coincide, which is why the first fixture cannot make that distinction and an
independent review was right to say the claim was unmeasured until the second one existed.

## What is compared: painted ink, bounded from both sides

What the clip removes is ink — the glyph outlines and, where one is painted, the stroke around
them. `getBBox()` of a `<text>` is neither side of it. It is the typographic cell (advance by
ascent plus descent, trailing letter-spacing included) united with the glyph bounds, so it is not
inside the ink: measured on Chromium 141, DejaVu Sans 12 px "100" has a cell 2 px above and 3 px
below its digits, and an axis tick at `y = height − 2` had its cell 1 px past the edge with every
pixel of its ink 2 px inside — up to this build the rule reported it as "not drawn". And it is not
around the ink once a stroke is painted.

The collector therefore sends raw facts and the bound is computed in Node
(`src/measure/svg-ink.ts`, snapshot field `SvgTextTarget.paint`), as two boxes in the SVG's frame:

- **an inner box the glyph ink provably reaches on every side.** For a label the canvas can be
  shown to reproduce, the label's own glyphs are filled into a detached canvas with the same
  computed font state, through the linear part of the text's CTM (a rotated label is rastered
  rotated), magnified to about 128 canvas px per em and never fewer than 8 per screen px, and the
  alpha channel is scanned for the first and last covered column and row. The raster edge is taken
  to lie within 2 canvas px of the outline either way: measured over 270 labels against a DPR-8
  screenshot, every edge lay within −0.61 / +1.36 canvas px. Glyph placement is compared with the
  SVG's at every word boundary and at the end; the SVG keeps advances in 1/64 device px, so each
  checkpoint may drift by that quantum per preceding glyph plus 0.05 px, more refuses the raster,
  and the drift that remains is added to the margin along the baseline. Canvas `measureText()`
  bounding boxes are not used: they are the rounded, hinted control box, measured up to 1.64 px
  outside the outlines, and an inner bound built on them could invent ink.
- **an outer box that provably contains every painted pixel**: the glyph box grown by the stroke
  pad k · stroke-width / 2, with k = max(1, `stroke-miterlimit`) for miter joins (the default limit
  4 gives 2 · stroke-width), 1 for round and bevel joins, and at least √2 for a dashed stroke with
  square caps. Measured over 320 stroked labels: miter reach 2.56 of sw/2 at limit 4 and 8.81 at
  10, round 1.06 (the 1/8 px screenshot rim), bevel 1.00, dashed square caps 1.375 — each within k.
  The pad is the largest over the `<text>` and every rendered `<tspan>`, `<textPath>` and `<a>`
  inside it, and a `spacingAndGlyphs` run stretches it by the run's measured scale.

A label the raster does not reproduce — tspans or other element children, x/y/dx/dy lists,
`textLength` other than a `spacingAndGlyphs` scale, a font property outside the
canvas's state, right-to-left text, a non-alphabetic baseline, white space the character count
does not confirm, an advance that disagrees with the canvas — gets **no inner box**, and its outer
box is the cell grown by 0.1 em of the largest font size plus one device px. That margin rests on
Chromium uniting the cell with the glyph bounds of the font it draws: measured, outlines reached
past `getBBox()` by at most 0.0039 em over 112 such labels and 0.033 em over 195 single runs. A font
whose ink escapes its own glyph bounds by more than that is outside what this bound claims. The
snapshot names the first condition that failed (`SvgTextPaint.inkDiagnostic`).

**The verdict is asymmetric by construction.** Against every clip rectangle:

- the rule reports only when the **lower** bound exceeds the permitted overshoot by more than the
  resolution (0.01 px): the inner box reaches past the edge, or the whole outer box lies beyond it
  ("lies entirely outside", made only for text with a character that can paint). The finding's
  value is that lower bound;
- it stays silent only when the **upper** bound exceeds the permitted overshoot by no more than the
  resolution — the same 0.02 px band the frame decision states, now for the ink: silent means no
  painted pixel reaches more than 0.02 px past the edge;
- the band between declines per target as `env/svg-painted-bounds-inconclusive`, counted against
  coverage, with both bounds in the evaluation (`viewport-overshoot`,
  `viewport-overshoot-upper-bound`).

No finding rests on ink that was not shown to be there, and no silence on ink that was not shown to
be absent. The stroke never enters the lower bound — a halo is usually the background colour, so a
clipped halo is not visibly lost ink; a haloed label is reported only for its glyphs. Consequences
worth knowing: a haloed chart label well inside its viewport is measured and silent (up to this
build every stroked label declined); a label whose glyphs end 1–2 px inside the edge its cell
crosses is silent; a miter-joined stroke whose glyphs are inside but whose miter tips may reach the
edge is the band. The bounds are geometric: screen rasterisation at DPR 1 moves glyph origins and
hinting by up to half a pixel, which a PDF does not carry, and the rule decides on the geometry.

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
coefficients, the SVGLength values, and `CSSStyleDeclaration.prototype.getPropertyValue` through
which every computed value is read by name — is captured before any author script runs, for the
same reason the rest of the geometry is: a document that replaces them could otherwise decide what
this rule sees. 0.6.0 read computed values through the property getters (`style.overflow`,
`style.overflowClipMargin`), which live on the prototype; a page that shadows them turns a clipped
label into a clean run (`tests/fixtures/svg-computed-style-spoof.html`).

Until 0.2.3 no geometry was collected at all. Every SVG arrived marked unmeasurable with a reason
this rule had not declared, which is a fatal `checker-crashed` by design — so any document holding
a figure ended in exit 3 rather than being checked.

## Limits and fail-closed cases

Where nothing clips — no clipping overflow on the SVG or any enclosing SVG, no paint
containment, no clip-path, mask or `url()` filter on the outermost SVG, no clipping HTML ancestor
inside the page area — the glyphs are painted after all, and the rule declines rather than
reports. Those targets are not counted against coverage either: the question does not arise for
them, and one such figure would otherwise take an error rule with a coverage floor of 1 below its
floor and end the run in exit 4. The decline stays in `notMeasured`.

A `<text>` whose screen box cannot be read — no CTM, or `getBBox()` throwing on a target with no
rendered geometry — declines with `env/svg-ctm-unavailable` and DOES count against coverage: that
is a target this rule ought to have judged and could not.

Paint this build does not bound declines per target with `env/svg-painted-bounds-unsupported`,
whether it is set on the `<text>` or on a rendered descendant: a paint server (`url(...)`),
`text-shadow`, text decoration, a clip path, mask or filter (also on an ancestor inside the SVG), a
stroke width that is a percentage or `calc()`, `vector-effect: non-scaling-stroke`, an unknown line
join or cap, and a stroke on a `spacingAndGlyphs` run the raster did not reproduce. Text
instantiated through `<use>` is inside a closed instance tree and declines the same way. Up to this
build a descendant's paint was not read at all, so a `<tspan>` with a shadow was measured as bare
glyphs. A `rotate` attribute on the text or any of its `<tspan>`s turns each glyph about its own
origin, and with `lengthAdjust="spacingAndGlyphs"` Chromium 141 draws ink 2.25 px beyond the
`getBBox()` cell, so neither the cell nor the raster bounds it: it declines the same way, first and
with that one reason. These targets stay in the denominator, so the rule ends in exit 4 rather than
inventing a box or silently losing the candidate. Per-glyph `x`, `y`, `dx` and `dy` lists and
`textPath` were measured to keep the ink inside the cell; they are bounded by the cell and its
overhang margin.

Border, padding, `overflow-clip-margin` in every serialised form, 2D CSS transforms, the
individual `rotate`/`scale`/`translate` properties and zoom — on the SVG or any ancestor — are
measured, not declined. Up to 0.6.0 each of them declined the whole record. What still declines the
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
  non-applicable when the SVG's overflow was visible);
- an HTML ancestor inside the page area that clips — overflow, paint containment, clip-path, mask —
  unless it is a rectangular overflow or containment clip whose content box, on CDP's quad,
  contains the SVG's own clip. Every such clip contains the ancestor's content box, so then nothing
  drawn inside the SVG's clip is cut by it. An SVG with no clip of its own under a clipping
  ancestor, a rounded ancestor clip and an ancestor clip-path decline. The page box and the sheet
  above the page area are the block rules' business;
- a nested `<svg>` with a transform, with a clip margin, rotated or skewed within the outer frame,
  or whose computed `x`/`y`/`width`/`height` disagree with its attributes — CSS sizes a nested SVG
  (measured: a `width` rule overrides the attribute for the clip), so the attributes no longer
  describe its viewport;
- an `<svg>` inside a `<foreignObject>`, which the foreignObject and the enclosing SVG clip too;
- an SVG whose frame CDP does not confirm, whose computed content box is not the used one to
  0.1 px, whose error bound does not fit the resolution (quads more than 262 144 px down a run), or
  for which CDP gives no box model. Only a record with no potential target at all — every `<text>`
  unrendered, no `<use>` — is not declined for that, because there is nothing its viewport could
  clip that this rule judges.

The snapshot names which case applied (`SvgRecord.viewportDiagnostic`); the report carries the
coverage reason.

**A label flush with the edge is not a finding.** A label ending exactly on the viewport edge —
`textLength` set to the full width of the viewBox, so the box ends on the edge by construction —
has a lower bound at or inside the edge, so it is never reported. 0.6.0 compared screen boxes
rounded to two decimals against that grid; the frame boxes are now compared unrounded against the
stated resolution above, on both bounds. Whether such a label is silent depends on its ink: one
whose GLYPH INK ends within the raster margin of the edge (a block glyph filling its cell) has an
upper bound past the resolution and declines as `env/svg-painted-bounds-inconclusive`; one whose
side bearing keeps its ink further inside is silent. An exact box (a receipt projection) ending on
the edge is silent, as in the frame decision.

**What a finding measures is ink, not the typographic cell.** Up to this build a label whose
cell crossed the edge while its glyphs stayed inside was reported; it is now silent when the outer
ink box is inside, and declined as inconclusive when only the cell crossing is known.
`tests/fixtures/svg-ink-slack.html` holds three such labels (exit 1 with findings of 1.00, 0.50
and 9.00 px before, exit 0 now, patched Chromium 141 without evidence binding).

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

