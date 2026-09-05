# pagination-residue-v1 — a hash-only corpus record

**There are no documents in this directory, and that is the point.**

## What this records

Six real documents on which breaklint cannot produce a report, and must say why. Each carries at
least one page where Paged.js left a table box in an overflow column of the multi-column
fragmentainer it builds out of `.pagedjs_page_content` — content it could not place on a page,
sitting one whole column pitch to the right, invisible behind an `overflow: hidden` sheet. Because
`page.pdf()` renders in print media with a re-sized fragmentainer, an unsplittable table row is
laid out somewhere else there and stays moved. The PDF then does not reproduce the geometry the
rules measured, so the state is withdrawn and the run ends in exit 3 — `render-unstable`, with the
elements, their source ids, the pages and the pitch named.

Measured over the eighteen chapters of the bundle these six came from: **6 of 6** documents with
table residue could not be measured, **0 of 12** without it failed. Two of the twelve carried
residue of other kinds — one `<p>`, one `<em>` — and measured cleanly, because ordinary block
content re-fragments to the same boxes.

## Why the bytes are not here

They are chapters of a paid product. Together they are 27 492 of that bundle's 69 017 words, and
this repository is public and MIT-licensed. The product's own licence architecture deliberately
keeps delivered bytes out of its public companion repository; copying 39.8 % of its running text
into an MIT repository would cut straight across that, and a public Git history is not revocable.

`docs/validation/corpus-contract-v1.md` already defines the shape for this: a redacted public
record keeps the artifact path null and is therefore ineligible on its own, while an authorised
private run supplies an opaque path below an external artifact root, and the validator reads those
bytes and verifies the recorded SHA-256. *"A hash-only public record documents existence without
pretending that an unavailable artifact was verified."*

## What CI actually runs

`tests/fixtures/fragmentainer-residue.html`. It was reduced from the `index` document below until
nothing of the product remained, and it still reproduces the class: no `@page`, no print
stylesheet, no `break-inside`, no script — a default-letter page, a 68ch measure and a table that
crosses a page boundary. That fixture, not this record, is the regression protection, and it must
stay that way: a gate that can only run on bytes most contributors cannot obtain is not a gate.

Without an artifact root the corpus gate prints `SKIPPED` and makes no success claim. It never
reports the six as verified when it has not read them.

## Running the full gate

Unpack the admitted bundle somewhere outside this repository and point the gate at it:

```bash
BREAKLINT_RESIDUE_CORPUS_ROOT=/path/to/unpacked-bundle npm run test:pagination-residue
```

The directory must contain the six documents named in `manifest.json[].externalArtifact` and the
shared `styles.css`, at the top level. Every file is checked against its recorded SHA-256 before
Chrome starts; a byte that drifted is a red gate, not a re-recorded expectation.

The red control works the same way. Without a root it proves red-to-green on the public fixture
alone, which is sufficient:

```bash
npm run test:pagination-residue:red-control
```

## What this record is not

Not calibration evidence. Not an external trust root. Not a claim that anyone but the admitting
party has seen these bytes.
