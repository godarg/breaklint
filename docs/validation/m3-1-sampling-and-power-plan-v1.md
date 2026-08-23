# M3-1 Sampling and Power Plan v1

Status: preregistered method; not an executed sampling result  
Applies to: `svg/text-clipped`, `svg/text-ink-collision`, and `svg/text-overflows-viewport`  
Predecessors: [corpus-contract-v1.md](./corpus-contract-v1.md), [oracle-contract-v1.md](./oracle-contract-v1.md)

## 1. Purpose and claim boundary

M3-1 separates a real end-to-end **process pilot** from a later **confirmatory calibration or structural-acceptance study**.

A process pilot may start with one rights-cleared real document. It can establish only that intake, byte freezing, target binding, blind annotation, split assignment, freeze evidence, and reporting can be executed. It cannot establish population performance, adequate power, calibrated thresholds, or claim maturity.

This plan does not change a production threshold, define a release gate, or authorize `calibrated: true`. The three rules, and all other breaklint rules, remain uncalibrated until a separately preregistered and externally evidenced study passes its own acceptance gate.

## 2. Units and dependence

The primary resampling and split unit is the closed **origin group**, not an individual target. Targets from the same source, document family, template, version chain, or material derivation are dependent even when their byte hashes differ.

Every report must present all of the following separately:

- target-level confusion and non-binary-label counts;
- document-level detection results;
- origin-group counts and origin-clustered uncertainty;
- prevalence by source class and required rule stratum;
- `ambiguous`, `abstain`, and `invalid_target` rates without silently removing them.

No target count may be described as an independent sample count unless the dependence assumption is justified. Confidence intervals for target-level measures use an origin-cluster bootstrap, with the origin group sampled as a whole. If too few origin groups exist for a defensible interval, the report says so and remains descriptive.

## 3. Pilot sampling

The M3-1 process pilot requires at least one real, artefact-specifically approved document, but no fulfilled quantity is asserted here. Selection is purposive for workflow coverage, not a random population sample. A pilot candidate should exercise as many of these mechanics as possible: multiple text targets, transformations, viewBox/viewport handling, clipping or masking, and stable target identity.

The pilot report must give the actual number of documents, origins, targets, binary labels, non-binary labels, and adjudications. Zero is a valid reported value. Synthetic fixtures may test machinery but never count as real documents or toward sample size.

## 4. Later confirmatory planning for the empirical rules

`svg/text-clipped` and `svg/text-ink-collision` are empirical-threshold rules. A future confirmatory plan must state its desired precision, expected prevalence, minimum acceptable sensitivity/precision, allocation to holdout, clustering assumptions, and anticipated non-binary rate before labels or outcomes are revealed.

For planning sensitivity only, a two-sided 95% binomial interval with a worst-case proportion of 0.5 and a desired half-width of 0.10 requires approximately 97 effectively independent observations in the relevant denominator:

`n = 1.96² × 0.5 × 0.5 / 0.10² ≈ 96.04`, rounded up to 97.

Applied symmetrically, this means 97 effectively independent positive and 97 effectively independent negative adjudicated targets per empirical rule. If the true proportion were 0.8, the analogous approximation is 62; at 0.9 it is 35. These are sensitivity values, not acceptance criteria.

An illustrative conservative recruitment adjustment is:

- design effect for within-origin dependence: 1.20;
- anticipated `ambiguous`/`abstain`/`invalid_target` share: 15%;
- resulting planning target: `ceil(97 × 1.20 / 0.85) = 137` adjudicated positives and 137 adjudicated negatives per empirical rule in the confirmatory holdout.

The values 1.20 and 15% are assumptions to be replaced by pilot estimates and justified before a confirmatory freeze. They are not evidence that 137 targets are sufficient, and they do not imply a document count. Required documents depend on target prevalence, targets per document, and the observed intra-origin dependence.

A possible later alternative is a one-sided 95% Wilson lower confidence bound. Illustratively, 43 successes among 48 trials yields a lower bound around 0.80, whereas 153 among 180 is needed when the observed rate is 0.85 to keep the lower bound around 0.80. A Founder-approved confirmatory protocol must choose the estimand and acceptance boundary; existing fixture values such as 0.8 or 0.9 are not automatically real-data gates.

## 5. Required strata

### 5.1 `svg/text-clipped`

Sampling must cover, with positive and negative examples where the concept permits:

- text genuinely clipped by a clip path;
- mask-mediated visibility and partial opacity;
- transformed and nested-transformed text;
- font-dependent ink extents and fallback-font variation;
- shared clips/masks applied to multiple targets;
- clip regions that fully contain the text;
- intentional visual cropping or decorative treatment;
- real boundary cases close to the current production threshold;
- cases whose semantics remain legitimately ambiguous.

Results are reported at target and document level. Boundary cases are retained; they are not removed to improve agreement or metrics.

### 5.2 `svg/text-ink-collision`

Sampling must cover:

- bounding-box proximity without ink collision;
- true crossings at different z-orders;
- thin grazing lines and hairline strokes;
- partial and full occlusion;
- pale or transparent overlays;
- opaque-white overlays and background-colored shapes;
- decorative overlaps without a semantic error;
- transformed text and shapes;
- real boundary cases around current geometry/opacity behavior;
- clear negatives with nearby but non-colliding geometry.

Results are reported at target and document level, with origin-clustered uncertainty.

### 5.3 `svg/text-overflows-viewport`

This rule remains a structural-validation rule. M3-1 must not optimize a threshold for it. Sampling instead covers reproducible boundary and acceptance behavior:

- clearly inside and clearly outside text extents;
- viewport dimensions that differ from `viewBox` dimensions;
- nested and chained transformations;
- technical tolerance at each boundary;
- an enlarged `viewBox` or viewport;
- documents with `overflow: visible`, which the current rule contract excludes;
- font-dependent extents and deterministic renderer conditions.

The output is an acceptance matrix and reproducibility analysis, not a threshold search.

## 6. Allocation and freeze

Development, tuning, and holdout are allocated only after origin, duplicate, derivation, template, and version groups have been closed. All members of a closed group enter exactly one split. The confirmatory holdout allocation, target set, renderer/environment declaration, and analysis plan are frozen before breaklint outcomes are computed or disclosed.

No holdout result may inform threshold selection in M3-1. A changed target, artefact, renderer, group assignment, sampling rule, or analysis plan requires a new contract/lineage version and a new external freeze receipt; it cannot be repaired by removing a difficult target.

## 7. Stop conditions and reporting

Sampling stops without a readiness claim if rights or privacy are unresolved, a required stratum cannot be identified without looking at breaklint output, origin dependence cannot be bounded, holdout labels or results leak, or an external freeze cannot be evidenced.

The pilot report must distinguish `planned`, `available`, `eligible`, `frozen`, `annotated`, `adjudicated`, and `evaluated`. It must never substitute a planned count for an observed count. M3-1 may honestly conclude **Infrastructure Complete / External Execution Blocked**.
