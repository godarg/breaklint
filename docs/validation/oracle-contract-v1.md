# SVG Oracle Contract v1

Contract ID: `m3-0-oracle-v1`. A new interpretation of ground truth requires a new oracle version;
existing records are not rewritten in place.

## Common rules

An oracle addresses a target with a source-bound ID composed from a stable SVG-root key and an
author-provided text ID. M3-0 treats a canonical source signature as unverifiable and ineligible
until a separate source-binding implementation exists. A DOM ordinal, `data-bl-svg-target`,
run-local `nodeKey` or measurement fingerprint is not a stable target ID.

Permitted inputs are exact artifact bytes and hash, authored SVG semantics, independently observed
render geometry, neutral counterfactual evidence, blind human judgements, synthetic construction
truth and renderer/font/runtime identities. Forbidden inputs include a breaklint finding, production
decision, production threshold, `missingInk`, `collisionInk`, `occludedInk` or a label copied from a
rule report. Oracle dependencies are a closed `evidenceKinds` enum, not free text. Undeclared
`inputs`/`derivedFrom` fields and values such as `productionDecision`, `missing_ink` or `ruleOutput`
fail schema validation; free strings cannot certify independence.

Ambiguous, abstained and invalid targets remain non-binary. They are adjudicated or excluded and do
not enter a positive/negative metric denominator.

## Rule-specific truth

### `svg/text-clipped`

Positive truth means actual glyph ink is removed by a clip path or mask. Synthetic truth may come
from the literal authored boundary. Real truth requires blind judgement supported by neutral
clip-boundary and right-ink-edge evidence from an independently specified comparison. The current
0.05 threshold and the production `missingInk` value are not oracle inputs. Intentional or visually
indeterminate clipping is `ambiguous`, not automatically negative.

### `svg/text-ink-collision`

Positive truth means a non-text shape crosses glyph ink or an opaque shape visually removes it.
Permitted evidence includes the authored crossing/occlusion construction and independently rendered
target/shape views. Crossing, z-order, a 0.4 px hairline, pale colour, opaque-white occlusion, clean
separation, a glyph-free line gap, and the fixed-grid grazing-corner counterexample are separate
boundaries. Production pixel bands and the value 8 are prohibited as truth sources. A shape merely
sharing a bounding box is not a positive label.

### `svg/text-overflows-viewport`

Truth is an independent structural comparison of the source/render target geometry with the SVG
viewport after coordinate normalisation. Overshoot beyond zero is positive unless overflow is
visibly allowed. `overflow: visible` is an explicit exclusion. This rule has no threshold
optimisation mode: validation tests the boundary and geometry implementation.

## Renderer freeze and technical tolerances

Every evaluated render records the breaklint commit/version; exact Node, browser and Puppeteer
versions; browser executable digest where obtainable; Paged.js 0.4.3 and artifact hash; rasterizer
identity; headless mode; device scale/raster factor; viewport and page size; locale, timezone and
colour scheme; OS/version/architecture; resolved font system IDs and digests; custom-font hashes;
and network/resource policy. Missing required identity makes the render ineligible.

Only unavoidable rasterisation facts are technical tolerances: the lab uses an eight-channel-value
PNG delta and records device scale. These settings describe observation, not a semantic ground-truth
threshold. A renderer identity change requires a new freeze ID and explicit comparison; values are
never silently pooled.

## Invalid evidence

A fixture or document is invalid if bytes do not match the recorded hash, the target cannot be
bound to source, required renderer identity is absent, resources are unresolved, provenance/rights
or privacy are unknown, the renderer is unstable, construction truth is contradicted, or the oracle
depends on production output. In particular, the seven-fixture clipping evidence is invalid unless
G1 reproduces historical `|T| = 0` and the dilution fixture reproduces shared ratio `< 0.05` while
the independently known clipped target is `> 0.05`.

## Anti-self-confirmation control

The lab stores construction truth before its measurement fields and feeds observed masks to the
unchanged production rules only after truth is fixed. The readiness validator rejects forbidden
oracle dependencies at the schema boundary. Three controls inject `productionDecision`,
`missing_ink` and `ruleOutput` variants and must all exit 1.
