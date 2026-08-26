# HTML reporting

The JSON report is breaklint's canonical record. The HTML report is a self-contained,
evidence-first projection for review, attachment to a build artifact and A4 printing.

## Information order

The first screen answers four questions before it shows implementation detail:

1. What verdict did the run reach?
2. What did that verdict do to the build gate?
3. How many errors, warnings and informational findings exist?
4. Did the measured coverage meet the configured floors?

The four operational states use different headings and sentences, not colour alone:

| Verdict | Heading | Exit |
|---|---|---:|
| `clean` | `Clean run` | 0 |
| `findings` | `Findings block this run` | 1 |
| `infrastructure` | `Checker failed` | 3 |
| `insufficient-coverage` | `Not enough was measured` | 4 |

Infrastructure and coverage failures explicitly say that the result is not clean. Findings still
present in either state are labelled as partial: they do not describe everything the checker might
have found after a trustworthy complete run.

The Coverage Trust summary follows the run verdict, not only the arithmetic of rows produced before
failure. An infrastructure run therefore always says `Not trustworthy`. If partial counters exist,
it reports them as partial measurement, for example `24 of 26 candidates measured before the
checker failed`; it never upgrades those counters to `Coverage met`.

The same verdict-first rule applies to exit 4. A zero-candidate rule has no per-rule floor shortfall
and is therefore represented as `ok: true` in canonical JSON, but a run in which no rule measured a
candidate is still `insufficient-coverage`. Its primary HTML summary says `Not established`, never
`Coverage met`. This preserves both truths instead of allowing a row-level arithmetic fact to
overwrite the run verdict.

## Finding grammar

Each finding is a vertical `article`, in this order:

```text
severity and experimental status
rule and page
complete explanation
document and measured source, if known
measured value and threshold
calibration and proof source
evidence status and ambiguity
```

An unknown source remains unknown. The HTML renderer does not invent a filename or line. Evidence
is clickable only when its path matches the relative page-artifact form minted by breaklint. Other
references remain visible as inert text.

## Responsive and print behaviour

- Findings never use a table or horizontal scrolling.
- Coverage uses per-document definition lists that collapse to one column on narrow screens.
- Body text remains 16 CSS pixels and long paths may wrap anywhere.
- Keyboard focus uses a visible three-pixel-equivalent outline.
- The report follows the operating-system light/dark preference and honours reduced motion.
- Print forces the light palette, uses an A4 page with 12 mm margins and keeps finding evidence in
  the normal vertical flow. Compact findings, labels and coverage records stay together. Coverage
  reflows to one full-width rule label followed by at most two value columns, so measured and
  not-measured values cannot be compressed into colliding columns. A finding taller than one page
  may still split instead of creating a clipped or missing continuation.
- The redundant screen footer is omitted from print so it cannot become an otherwise empty page.
- The clean-state empty-findings explanation remains available on screen but is omitted from print;
  the clean verdict already carries the same information and the duplicate block must not push one
  atomic coverage card onto a nearly empty terminal page.

## Trust and privacy boundary

The document contains inline CSS only. It has no scripts, external fonts, external stylesheets,
telemetry or network-loaded assets. Its Content Security Policy disables all resources except the
inline stylesheet and same-directory/data images. Paths still pass through the reporter-wide
redaction layer before HTML rendering.

The report can therefore be archived or opened offline. Keep the JSON alongside it when the full
machine-readable record is required.

## Reproducible render review

The report-surface gate has two explicit modes over the complete matrix in
`.artifacts/report-surfaces/`:

- `npm run test:report-surfaces` and `npm run test:report-surfaces:local` are the strict local
  human gate. They require the current source fingerprint, browser, operating system, architecture,
  runtime, render contract, stable artifact fingerprints and visible screen-pixel hashes to match
  the reviewed ledger exactly.
- `npm run test:report-surfaces:portable` is the Linux-CI technical gate. It renders and validates
  the current platform's complete matrix and requires a complete human-review ledger for the exact
  same source fingerprint. It deliberately does not compare Linux artifact or pixel fingerprints
  to another operating system and therefore makes no cross-environment human-review claim.

Both modes cover:

- four truthful verdict states;
- light and dark at 1440×1000, 768×1024 and 390×844;
- one real A4 PDF per state and an independently rasterized page set for each PDF.

That is 32 review cells. The generated manifest records raw SHA-256, byte size, raster dimensions,
PDF page geometry, DOM invariants and the exact browser/platform/render environment. Every screen
PNG is also decoded to eight-bit straight RGBA. Fully transparent pixels have their invisible RGB
channels canonicalized to zero; SHA-256 is then computed over the normalized RGBA bytes. The
verifier independently decodes and normalizes the file and rejects a one-channel mutation of one
visible pixel. The exact deterministic Chrome launch arguments—software rasterization, fixed sRGB,
disabled LCD text and deterministic compositor mode—are part of the recorded review environment.
Generated PNG/PDF evidence remains ignored by Git; the generator and the human review ledger are
versioned.

The review gate deliberately keeps two distinct bindings:

- `reviewedRawSha256` in the ledger is the historical audit trail for the exact files the named
  reviewers opened. `renderManifestGeneratedAt` identifies that historical render; neither value
  is treated as a portable equivalence oracle after a fresh render.
- `reviewArtifactFingerprint` is the strict local transfer gate. It binds the current source/input
  fingerprint, matrix cell, browser/platform/render contract and visible geometry/semantics. Screen
  cells additionally bind their decoded normalized RGBA hash. Print cells bind every independently
  rasterized A4 page by visual hash and dimensions. Raw PDF container bytes are excluded from that
  equivalence decision because browser-generated metadata may change while every visible page
  remains identical.

The verifier independently reconstructs the current source/input fingerprint, every stable artifact
fingerprint and every screen RGBA hash. A local human PASS transfers only when those fingerprints,
pixels and the complete review environment are identical. It also runs two negative controls:
changing one bound input in a temporary tree must invalidate the source fingerprint, and changing
one visible RGBA channel must invalidate the screen fingerprint. A new or changed bound source
therefore returns the ledger to `pending` until the complete local matrix has been rendered and
reviewed again. Portable CI still fails on changed source, incomplete ledger, malformed historical
review evidence or any technical defect in its own current matrix; it simply does not mislabel that
Linux render as the already human-reviewed local render.

Print verification is outcome-level as well as structural. The renderer measures the actual print
layout at the A4 content width, requires the Coverage Trust verdict to remain on one line, fit completely inside its own
card and have zero bounding-box overlap with the neighbouring summary card. It limits coverage
values to two columns and rejects overflow. Each rasterized page is then checked independently: a coverage record
that starts a page must begin with its complete top border, and a page may not begin with a detached
coverage value. Every wide coverage card must also have continuous visible left and right raster
edges. This is an outcome check rather than a computed-style assertion: Chrome can report a physical
right border on a paged `flow-root` containing floats while omitting that edge from the PDF. The
renderer associates every `RULE`/`RESULT` PDF text pair with its nearest long horizontal raster
strokes and measures both physical sides between those frame rows. The verifier independently
projects the A4 content edges, finds the enclosing full-width raster rows around each text pair,
remeasures both full-height sides and cross-checks the renderer geometry. Neither oracle relies on
a global count of anonymous card-like rectangles or a fixed card-height band. Both require at least
98% edge coverage and reject any contiguous gap longer than two raster rows. The raster DPI is pinned
to 110 in both oracles. The inner repair is a real child border rather than a background fill. A
separate technical A4 probe renders the insufficient-coverage state with `printBackground: false`,
including its strong-left-border warning card, and both oracles must still measure all 15 cards as
closed; this probe is not an additional human-review cell. The complete visible contract is bound to
the review fingerprint. A CI mutation runner executes four genuine failing renderer processes for a
missing whole right edge, a missing whole left edge, a missing lower right fifth and simultaneously
missing lower fifths on both sides, and requires the named side or sides to cross both rejection
thresholds. A
deliberately fragment-prone print mutation must likewise make the gate fail.

The terminal-page density gate uses report structure rather than a global pixel quota. It rejects
empty non-cover pages. When the final page continues an atomic sequence of coverage cards, it must
carry at least half as many cards as the preceding coverage page, rounded up, unless its visible
raster ink reaches the corresponding proportional depth. This permits genuinely short reports and
tall individual cards while blocking the reproducible four-cards-plus-one nearly empty continuation.
