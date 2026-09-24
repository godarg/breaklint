# Provenance of selfauthored-v1

## Who and when

Every file in this directory was authored for this repository by an AI agent operating in the
breaklint maintainer's session on 2026-09-24. Nothing here was collected, downloaded, scanned or
adapted from elsewhere.

## How the documents were made

- **Text.** All prose, headings, captions, table labels, code, list items and SVG labels were
  written for these documents. No third-party text was used: nothing was copied or paraphrased
  from papers, websites, books, manuals, standards or other corpora. Two documents are in German
  (sa06, sa15), the rest in English.
- **Names.** Every organisation, product, place, publication and project is invented and marked as
  fictional in the document's own imprint line. People appear only by role (chair, treasurer,
  station lead); no person is named. Domains are `example.org`.
- **Numbers and drawings.** Table values are invented; a few long tables were filled from seeded
  pseudo-random arithmetic. Chart and diagram coordinates were computed by small throwaway
  authoring scripts that emitted inline SVG; the scripts were not retained, and the committed HTML
  is the artefact. No image, font, stylesheet or script from anywhere else is included.
- **Form.** One self-contained `.html` file per document: inline `<style>`, inline `<svg>`, no
  `<script>`, no `<img>`, no `<link>`, no external resource of any kind, no inline `style`
  attributes. Only the generic families `serif`, `sans-serif` and `monospace` are used. Print CSS
  targets Paged.js 0.4.3: `@page` sizes A4 and Letter, two named landscape pages, margin boxes,
  `position: running()`, `string-set`, counters, `float: footnote`, `break-*`, `widows`/`orphans`.

## How the ground truth was made

The expected files were written from the construction of each document: which element was planted
where, with which explicit heights, line pitches, forced breaks and SVG coordinates, and what the
rule documentation (`docs/rules/*.md`, `docs/limitations.md`, the exit-code table in `README.md`,
`src/core/enums.ts`) says a correct tool must do with it.

**No breaklint output informed the ground truth.** No breaklint command, CLI, API, collector,
rule, engine or report code was run on any of these documents at any point during authoring, and
the expected files are committed before any such run. The source of the rules was read, never
executed, to understand what each rule's documentation refers to.

The construction facts were verified independently with `probe/construction-probe.mjs`, which
imports nothing from this repository's `src/`. It loads each document through a loopback server,
runs `new Paged.Previewer().preview()` from the pinned Paged.js 0.4.3 UMD bundle at a 1000 x 800
viewport, and reads:

- page boxes, content boxes, named pages and margin-box text;
- every fragment of every element with an `id` (a `data-probe-id` is stamped on the source before
  pagination and survives Paged.js cloning), plus its unpaginated height at the same content width;
- for every SVG `<text>`: the `getBBox()` box mapped through `getScreenCTM()` (four corners)
  against the clipping viewport of its nearest `<svg>` — for a nested `<svg>` that is its
  x/y/width/height mapped through the parent's CTM, because `getBoundingClientRect()` of a nested
  `<svg>` includes overflowing content — and an **ink box from pixels**: an isolated replica of the
  SVG is rendered on white at device scale 2, the label alone is shown with its fill forced black
  (and, for halo labels, a second pass with the stroke forced black), and the bounding box of
  non-white pixels is taken. The ink window extends 160 px beyond the viewport, so an overshoot
  reported as 160 px means at least 160 px;
- headings: space left below them and whether anything follows on their page;
- paragraph line boxes, `<use>` instance boxes, content left in the overflow column to the right
  of the content box, platform fonts per node (CDP `CSS.getPlatformFontsForNode`) and the PDF page
  count and sizes (poppler `pdfinfo`).

The classification rule for SVG labels was fixed before any document was finalised: a label is
**inside** only if the cell box (minus half the stroke width for halo labels), the fill ink and,
for halos, the painted ink are all at least 3 px inside every edge; it is **outside** only if cell
box and fill ink both overshoot the same edge by at least 3 px. Anything else was rejected as
ambiguous and the document was redrawn. Documents were iterated against the probe, never against
breaklint, until every construction fact held; the probe's condensed output on the final bytes is
`probe/construction-measurements.json`.

## Measurement environment

- Browser: Chromium 141.0.7390.37 (Playwright build chromium-1194), headless, sandbox on, run as
  an unprivileged user; Linux 6.18 x86_64. This is not the Chrome the project supports in CI; the
  truth does not depend on it, the recorded numbers do.
- Paged.js 0.4.3, puppeteer-core 25.8.0, pngjs 7.0.0, Node.js 24.21.0, poppler `pdfinfo` 24.02.0.
- Fonts on the machine (`fc-list`, 59 files): Bitstream Charter, Courier 10 Pitch, DejaVu Sans,
  DejaVu Sans Mono, DejaVu Serif, FreeMono, FreeSans, FreeSerif, IPAGothic, IPAPGothic,
  Liberation Mono, Liberation Sans, Liberation Serif, Loma, Noto Color Emoji, OpenSymbol, Unifont
  (five variants), WenQuanYi Zen Hei (three variants). Chromium resolved the generic families to
  **Liberation Serif** (`serif`), **Liberation Sans** (`sans-serif`) and **DejaVu Sans Mono**
  (`monospace`), measured per node through CDP; fontconfig on its own maps `serif` to DejaVu Serif.
  Findings that depend on metrics are therefore listed as `allowed`, never as `mustFire` or
  `mustNotFire`.
