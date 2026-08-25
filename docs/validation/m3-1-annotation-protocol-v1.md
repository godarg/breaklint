# M3-1 Blind Annotation Protocol v1

Status: executable protocol for packet v2; no annotation is asserted by this document
Ground-truth contract: [oracle-contract-v1.md](./oracle-contract-v1.md)

Packet v1 is retained as immutable historical process-pilot evidence and is not authorized for a real annotation session. Its source-subtree contexts retain editor/source metadata and its order is not independently reconstructable from the deliverable. Any future real session must use packet v2 or a stricter successor and pass the independent controls below before delivery.

## 1. Independence and roles

Every real target receives two annotations from two different real people. An agent, two model runs, two aliases, or two accounts controlled by one person do not qualify. Opaque public annotator IDs are backed by a private identity registry or equivalent Founder/reviewer evidence that proves human distinctness without publishing personal data.

Annotators work in separate sessions, cannot see each other's labels or rationales, and must not coordinate. If any labels differ, or either label is non-binary, a third distinct real person adjudicates. The adjudicator is also blind to breaklint outcomes and must not be either original annotator.

The absence of two verified people, or of a third person when adjudication is required, blocks execution. JSON identifiers never substitute for real identity evidence.

## 2. Frozen packet and blinding

The annotation packet is generated only from rights/privacy-cleared frozen artefact bytes and a frozen target manifest. The custodian's freeze binds the source artefact, contract/guideline versions, target identities, neutral rendering inputs, packet-bundle index, packet hash, and deterministic order hash; the annotator-facing packet exposes only opaque packet-local identities and the neutral context required for judgment.

**A blind context is delivered and opened standalone, as an `image/svg+xml` document, and is never embedded inline in an HTML page.** This is a delivery requirement, not a stylistic preference. The sanitizer's reference checks cover the channels an SVG document can use on its own; a review measured zero fetches from any accepted artefact in that mode, with a positive control fetching in the same run. Several HTML-only reference-bearing attributes — `poster`, `imagesrcset`, `srcset`, `background`, and `meta http-equiv="refresh"` — are **not** screened, because they are inert in a standalone SVG document; if such a context were pasted into an HTML page, they could fetch. The `sourceScope` value `embedded-inline-svg-only` describes where the *source* fragment was found in the original document; it is **not** permission to embed the delivered blind context inline. Anyone changing the delivery mode must re-audit `blindContextHasExternalAssetReference` for the HTML attribute surface first.

Annotators receive only the independently indexed `m3-1-annotation-packet-v2` deliverable. They receive no repository access and no source-document, intake-manifest, custodial-mapping, order seed, split-report, freeze-projection, or evidence-bundle access. The evidence deliverable `m3-1-pilot-v2` contains no blind-packet or blind-context bytes. Packet delivery and the absence of those additional access paths must be recorded per session; access to either deliverable together invalidates blinding. Public availability of the repository is not treated as permission for an annotator to inspect it during the assignment.

Every v2 SVG context is rebuilt deterministically from the custodial source bytes under `m3-1-svg-blind-sanitizer-v2`. The sanitizer removes comments, RDF/DC/CC metadata, Inkscape/Sodipodi namespaces and attributes, editor named views, source-identifying document names, and authored IDs; IDs and internal references are replaced by neutral sequence-local IDs. It rejects processing instructions, document/entity declarations, `data:` URLs, private path or filename hints, unknown namespaces, and outcome hints in text or attributes. External references in attribute values are refused by allowlist: an attribute value may call only pure-geometry transform functions and `url()`, and **every `url()` opening must have a same-document `#fragment` target**, optionally quoted. The target is read to its closing parenthesis **or to the end of the attribute value**, so an unterminated `url(` is checked exactly like a terminated one. CSS escapes, CSS comments and character references in attribute values are refused outright. Parentheses must also balance, but that rule is now an independent cheap guard and **no guarantee depends on it**. The history is worth stating plainly, because it is the reason for the current construction: CSS closes an unterminated function at end-of-input, so `url(https://host/x` without a closing parenthesis is a complete `url()` to a browser and was invisible to every paren-terminated pattern; a review fetched from nine such attribute channels in a real browser. The balance rule was then introduced to make the target check total — and a further independent review defeated it, because balance is a *count* over the whole value while a `style` attribute is a *declaration list*: a stray `)` in one declaration rebalances the value while a later `url(` stays open, and a real browser fetched from four such channels. Decoupling the target check from the closing parenthesis is what actually closes that class. **Element-level and non-attribute reference channels — `href`, `xlink:href`, `src` and `@import` — are still refused by pattern, not by allowlist**, in `blindContextHasExternalAssetReference`; anyone adding a reference-bearing channel must re-audit that function rather than assume the attribute allowlist covers it. This attribute allowlist has now been defeated three times in succession, each time by a spelling its author had not enumerated — `url("https://host/x"/*c*/)`, `image-set("https://host/x" 1x)`, a bare unterminated `url(`, and a balance-compensating decoy paren. It should therefore **not** be read as a load-bearing guarantee. It is a defence in depth whose track record is poor. As with the outcome-hint check below, what actually protects a frozen packet is the independent custodial reconstruction from separately bound source bytes; the attribute checks reduce exposure, they do not establish it. **The outcome-hint check is a denylist and is explicitly NOT exhaustive.** It catches the documented keyword spellings; wordings such as `status: pass`, `conclusion: fail` or a bare `FAIL` are not caught, and no keyword list can be finished. What actually protects a frozen packet against injected outcome text is the independent custodial reconstruction from the separately bound source bytes described below — not this check. The independent pre-delivery verifier must reconstruct the expected bytes from the separately bound source artefact and require exact byte equality, content-sanitizer fixed-point equality, context path/hash/length equality, and schema validity. Rehashing attacker-chosen bytes is not a substitute for this reconstruction.

Each annotator receives equivalent content in the v2 deterministic neutral order. The custodial verifier independently reconstructs the order from the committed algorithm `sha256-seed-nul-target-id-v1`, the preregistered order seed, and the byte-bound source target IDs. It also verifies the source target-set commitment, packet target count, unique blind target IDs, contiguous neutral-order positions, ordered-ID commitment, and exact source-to-blind mapping. Duplicate substitution, omission, insertion, and post-freeze reordering fail the gate even if a producer recomputes every packet-local hash. The source mapping remains a custodial input and is never delivered to annotators. The order seed, however, is **preregistered in the public repository** and is therefore not secret: anyone with the committed bytes can reconstruct the full blind-target-to-source mapping, and an independent review did exactly that for all 192 targets. Blinding here rests on **procedural non-access** — the annotator is instructed not to consult the repository during the assignment, and packet delivery plus the absence of the other access paths is recorded per session — not on secrecy of the seed. Preregistration was chosen so the order cannot be re-rolled after the fact; that property is real, and confidentiality is not claimed. Any protocol that needs an unguessable order must draw the seed from an external randomness authority and hold it custodially instead.

File names, directory names, target order, colors, overlays, metadata, and instructions must not reveal:

- whether breaklint emitted a finding;
- a breaklint score, threshold, severity, rule result, or production label;
- development/tuning/holdout membership;
- another annotator's label or rationale;
- an outcome-revealing candidate-selection reason.

The packet may identify the rule concept and show the visual/contextual information needed for a human judgment. It must not show diagnostic overlays derived from the production result. Packet creation, session start, submission, adjudication, and outcome disclosure are separate timestamped events. Outcome disclosure must occur after both submissions and any required adjudication.

Before work begins, each annotator records that the packet hash and guideline version match and that no prohibited information is visible. Any blinding breach invalidates the affected session; it is not repaired by asking the annotator to ignore what they saw.

The current packet v2 remains process-pilot evidence: its seed is repository-preregistered rather than supplied by an external randomness authority, and its freeze has no externally governed receipt. These limitations block a real session until an independent human-session gate explicitly accepts the custody arrangement; they do not permit silent fallback to packet v1.

## 3. Common label set

Each target receives exactly one label and a target-specific rationale:

- `positive`: the rule-defined defect is visibly/structurally present under the guideline.
- `negative`: the rule-defined defect is absent.
- `ambiguous`: the evidence supports more than one defensible interpretation or the intended semantics cannot be determined.
- `abstain`: the annotator cannot make a competent judgment, with the reason recorded.
- `invalid_target`: the target binding, rendering, or supplied context is insufficient or wrong.

`ambiguous`, `abstain`, and `invalid_target` are never automatically mapped to positive or negative. Difficult cases stay in the audit trail and descriptive report. A rationale is mandatory for every label, not only disagreements.

## 4. Rule guidelines

### 4.1 `svg/text-clipped`

Judge whether the visible ink of the identified text target is unintentionally removed by a clipping or masking boundary in the frozen rendering context.

- Label `positive` when meaningful text ink is actually cut off and the loss constitutes a presentation defect.
- Label `negative` when the text is fully visible, the clip/mask fully contains it, or an overlap does not remove text ink.
- Use `ambiguous` for defensible intentional cropping, uncertain design intent, marginal anti-aliasing/font effects, or a boundary whose semantic impact cannot be resolved.
- Use `abstain` when the necessary language, domain, accessibility, or rendering expertise is unavailable.
- Use `invalid_target` when the target identity does not correspond to the displayed text or the renderer/context is defective.

Inspect the text itself and relevant clip/mask context. Do not infer the answer from a calculated score. Record whether the judgment involves a clip path, mask, transform, font dependency, shared boundary, intentional treatment, or boundary case.

### 4.2 `svg/text-ink-collision`

Judge whether non-text visual ink intersects or occludes the identified text ink in a way that harms the text's legibility or intended presentation.

- Label `positive` for a material crossing or occlusion that constitutes a text presentation defect.
- Label `negative` for bounding-box proximity without ink contact, harmless background treatment, or intentional overlay that does not impair the text.
- Use `ambiguous` for hairline grazing, weak-opacity contact, unclear z-order/design intent, or a decorative overlap with disputed semantic impact.
- Use `abstain` when competent assessment is not possible.
- Use `invalid_target` when the binding or rendering context is defective.

The rationale records the relevant feature: crossing, z-order, hairline/grazing, partial/full occlusion, opacity/color, decorative overlap, transform, or bounding-box-only proximity.

### 4.3 `svg/text-overflows-viewport`

Judge the structural condition defined by the rule contract: whether the identified text lies outside the effective SVG viewport under the declared renderer and tolerance, while respecting the rule's `overflow: visible` exclusion.

- Label `positive` when the target crosses the effective viewport boundary under the declared structural interpretation.
- Label `negative` when it remains inside, including a correctly enlarged viewBox/viewport.
- Use `ambiguous` for unresolved viewport-versus-viewBox interpretation, marginal tolerance/font effects, or transform semantics that the supplied context cannot settle.
- Use `abstain` when competent structural assessment is unavailable.
- Use `invalid_target` for bad binding, absent required viewport data, or renderer/context failure.

This annotation validates structural behavior; it must not be used to tune a threshold.

## 5. Adjudication

Adjudication is required for every unequal label pair and every pair containing `ambiguous`, `abstain`, or `invalid_target`. The adjudicator receives the same frozen target context and current guideline, but not breaklint output. The adjudicator may see the two labels and rationales only after first recording that the production result remains hidden.

The adjudicator records a rationale and one of the same five labels. If uncertainty remains, the final label remains non-binary. No participant may delete a target, alter artefact bytes, change a target ID, or revise a prior submission after seeing outcomes. A genuinely invalid target causes a versioned correction and new lineage, not retrospective removal from a frozen holdout.

## 6. Agreement report

Before any outcome comparison, produce:

- the full 5-by-5 label contingency matrix;
- raw agreement;
- Cohen's kappa as the primary nominal agreement statistic;
- Krippendorff's alpha as a robustness statistic where computable;
- label prevalence for both annotators;
- `ambiguous`, `abstain`, and `invalid_target` rates;
- disagreement and adjudication counts;
- origin-cluster bootstrap confidence intervals when origin-group count permits them.

Statistics are descriptive when sample size or prevalence is inadequate. No case is removed merely to improve agreement. Any exclusions and missingness remain enumerated with reasons.

## 7. Audit and invalidation conditions

The public record may contain opaque role IDs, hashes, versions, timestamps, and decisions. The private identity proof remains outside the repository. A reviewer must be able to verify distinctness, session separation, packet equivalence, chronology, and blinding without needing access to breaklint outcomes.

A session is invalid if the second annotator is absent or identical, a prohibited outcome is visible, submission follows outcome disclosure, a required rationale is missing, a disagreement lacks adjudication, a non-binary label is coerced, packet/artefact hashes drift, or identity evidence cannot prove the required distinct people. Invalid sessions cannot support readiness.
