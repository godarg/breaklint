# Known limits

What breaklint 0.11 does not measure, where it stops instead of guessing, and what its results do
not establish. Exit 3 means the checker could not finish; exit 4 that too little was measured.

## Results

- **Every threshold is uncalibrated.** Fixtures show that each rule does what it says; they do not
  show that what it says is right for your document. Every finding carries `calibrated: false`.
- **Only two rules fail a build by default**, the two whose boundary is not a chosen number:
  `layout/unbreakable-block-too-tall` and `svg/text-overflows-viewport`.
- **Remediation advice is untested.** No test shows a suggested change removing its finding. Run
  breaklint again after any repair.
- **Typography is checked in one language.** The `type/*` rules follow `locale` (default `de-DE`;
  `--locale en-US` for English) and skip text whose `lang` differs.

## Environment

- **Paged.js exactly 0.4.3.** The break cause is read from attributes Paged.js writes and does not
  guarantee as an interface. Any other resolved version ends with exit 3; no flag overrides it.
- **macOS and Linux.** Live runs rely on POSIX process groups. On Windows, `--demo` and the rule and
  reporter chain work, but a run over your own HTML does not; there is deliberately no `os` field
  that would block the install.
- **Fonts must load.** A missing font changes line and page breaks and can produce phantom
  findings, so a declared font that fails to load stops the run. Rendering varies across machines;
  page images are evidence, not a baseline.
- **Images.** A failed image decode is tolerated only when the HTML declares a positive `width` and
  `height` and the rendered box matches both; anything else stops the run.
- **Time and memory.** One document may take 600000 ms by default (`--document-timeout-ms`,
  30000–1800000); reaching it ends with exit 3. Expect roughly 16 MiB of memory per page.

## Untrusted HTML

The document's scripts run in Chrome. breaklint uses a fresh profile, keeps the browser sandbox
on, and blocks page requests to anything but its own loopback origin unless you allow an origin.
That interception is not an egress control: WebSocket, WebTransport and WebRTC connections and the
browser's own traffic (secure DNS, component updates) are not covered. Run documents you do not
trust in a container or network namespace without egress. Details: [SECURITY.md](../SECURITY.md).

## Input

Only `.html` and `.htm` paths are accepted (exit 2 otherwise). The content is not sniffed:
Markdown saved as `.html` is parsed as HTML and ends with exit 3.

## Print documents

- **Footnotes.** A document that uses Paged.js footnotes does not reach the rules: the paginator's
  per-run identifiers make the control run differ, and the run ends with exit 3.
- **Margin boxes and fixed elements.** Nothing printed in a page margin box (running headers and
  footers) is measured by block, line or page rules, and `position: fixed` elements are not
  measured at all.
- **Multi-column bodies and `display: contents` headings.** A print `column-count` or
  `column-width` on `body`, or a non-empty heading with `display: contents`, ends with exit 3:
  Paged.js can silently lose content in both cases.
- **Content the paginator could not place.** When Paged.js leaves content in an overflow column,
  the PDF no longer matches what was measured, and the run ends with exit 3 (`render-unstable`).
- **Oversized blocks split in two.** `layout/unbreakable-block-too-tall` sums the fragments of a
  block split into three or more pieces. A block split into exactly two pieces is reported only if
  the first piece alone exceeds the page.
- **SVG text.** Text with complex paint — `<use>` references, filters, masks, or a stroke "halo"
  that touches the viewport edge — and SVG roots with borders, padding, rounded clipping or
  rotating transforms are declined, not guessed. Because the viewport rule is an error rule that
  needs full coverage, one declined label ends the run with exit 4.
- **Figures and tables** are checked conservatively and only when enabled. Anything the checks
  cannot match exactly between source and pages — several bodies or captions, split images,
  missing source addresses, irregular `colspan`, `rowspan` in a table header, documents whose
  scripts change the DOM — is declined with its reason rather than judged. The decline names what was
  observed.

### The break cause of a page boundary

Widow, orphan and continuation-page checks need to know whether a page break was forced. breaklint
evaluates Paged.js' own break decision at the point where the next page starts. A break the
paginator forced (`break-before`, `break-after`, a change of named page) is the author's choice,
so the fragments next to it are declined as `env/forced-break` and counted against coverage. The
reason behind a forced break stays unknown. An element hidden with `display: none` that carries
`page:` still forces a break.

## Screen checks (Playwright)

Screen checks are uncalibrated; start in report mode.

- **Not rendered means not measured.** Hidden and off-viewport elements, the body of a closed
  `<details>`, content under `content-visibility: hidden`, and elements whose effective opacity is
  0 are excluded, never reported as fine.
- **No clean claim** with non-axis-aligned transforms, masks, clip paths, active animations (other
  than of shadows and box colours), capture drift, a font timeout or a truncated inventory.
- **Overflow** is measured on HTML boxes; SVG text is judged against its viewport, and clipping
  by an HTML ancestor is still reported.
- **Small text and touch targets** are measured in CSS pixels; scaling through an SVG `viewBox` or
  a transform is not taken into account.
- **Overlap between siblings** is off by default (`geometry.rules.siblingOverlap`), because
  intentional layering is common.
- **Source locations** point to a verified build container at best, never a JSX line.

## Repair comparison

A repair is confirmed only for findings with a stable identity, which producer-bound runs record;
findings of a plain CLI run compare as `unmatchable`. System or fallback fonts cannot prove a
repair, and reduced coverage is never a repair.

## Where the reasoning lives

The argument behind the two error rules and the record of each release's limits are maintainer
documents in the [source repository](https://github.com/godarg/breaklint/tree/v0.11.1/maintainers).
