# M3-1 Source, Provenance, and Privacy Contract v1

Status: preregistered intake contract; no source is recorded as ingested by this document  
Applies to: every real-document candidate considered for M3-1

## 1. Fail-closed admission rule

Public availability is not a license. A document is eligible only after an artefact-specific reviewer records the exact bytes or immutable snapshot, source URL/locator, retrieval time, cryptographic hash, source class, origin/derivation group, rights basis, redistribution decision, privacy decision, and evidence references.

For live public content, the admitted source is always a specific immutable byte snapshot, never a mutable URL in the abstract. Evidence must either (a) capture the exact live response bytes and their identity at the recorded retrieval time, or (b) explicitly state that live-response byte identity was not captured. In case (b), a Founder-authorized first-party source or transformation may still be admitted, but its evidence must name the actual byte authority, source revision/blob where available, transformation, parent/derivation group, and authorization reference. It must not claim that a clean tracked source, export, extraction, or normalized derivative equals the mutable edge response.

Unknown, missing, contradictory, or merely assumed rights/privacy fields make the candidate ineligible. A URL, robots allowance, search-engine visibility, or ability to download does not by itself establish copying, processing, or redistribution rights.

An intake approval is not a ground-truth label and does not establish annotation, split, freeze, attestation, or calibration readiness.

## 2. Admissible source classes

- `first_party`: Dargel-owned or controlled material with a documented rights chain and an artefact-specific authorization for the intended processing and, if applicable, public redistribution.
- `public_domain`: the exact artefact is supported by a public-domain dedication or authoritative public-domain status evidence.
- `permissive_redistribution`: the exact artefact has a license that permits the intended copying, transformation, test use, and repository redistribution, with all attribution/share-alike/notice terms satisfied.
- `evaluation_only_authorized`: the exact artefact has express permission for evaluation but not redistribution. Its bytes must remain outside the public repository and require an approved private storage architecture.
- `private_authorized`: processing is expressly authorized and privacy-cleared, but the bytes are not public. This class is blocked in M3-1 until a Founder-approved private corpus store exists.

License compatibility is decided for the artefact bytes and embedded dependencies, not just the hosting page. Attribution, source notices, embedded fonts/images, database rights, and upstream terms must be checked separately where applicable.

## 3. Privacy and redaction

The reviewer records whether the bytes contain direct identifiers, contact data, account identifiers, telemetry, hidden metadata, personal names, user-generated content, special-category data, data about minors, client material, or secret-bearing locators.

The pilot excludes special-category data, data about minors, client/confidential documents without explicit permission, credentials, tokens, private paths, and material with an unclear lawful basis. Public professional names still require a documented necessity and minimization decision; they are not automatically privacy-free.

Redaction is allowed only before freeze and only when rights permit it. Redaction creates a new artefact with a new hash and a derivation link to the source. Source and redacted derivative remain in the same origin/derivation group and therefore the same split. The reviewer must assess whether redaction changes layout or rule-relevant geometry; an uncontrolled change makes the derivative ineligible for the intended evaluation.

Public manifests may contain hashes, non-sensitive source classes, rights decisions, opaque non-secret locators, and redacted evidence references. Names, email addresses, authorization messages, identity registries, private paths, credentials, and private document content remain outside the public repository.

## 4. Founder-authorized Dargel public sources

The Founder expressly authorized copying and use of public Dargel content for this corpus in the M3-1 session of 2026-08-23. The authorization reference to persist in source evidence is:

`founder-session-2026-08-23-m3-1-public-dargel-corpus-authorization`

This reference permits classification as `first_party` only after the particular public artefact passes rights-chain, embedded-dependency, privacy, target-binding, and immutable-snapshot review. It is not an external receipt and does not authorize paid/private build content, client content, credentials, or a privacy override.

Paid product build chapters and source bundles remain hard-excluded unless the Founder issues a separate artefact-specific authorization and a private storage decision. They must not be copied into the public breaklint repository.

## 5. Candidate register (pre-intake findings)

The entries below are candidates, not admitted corpus records. Hashes observed at audit time must be recomputed from the bytes actually considered for intake.

### P1 — Wikimedia Commons `Grua_maquina.svg`

- page: `https://commons.wikimedia.org/wiki/File:Grua_maquina.svg`
- original URL: `https://upload.wikimedia.org/wikipedia/commons/d/dd/Grua_maquina.svg`
- exact admitted candidate identity: SHA-256 `1c872e9de1250fbfa57994f66298e86b7b16f171f7270294aa0877f11e5173b4`, upstream SHA-1 `beb56d0513285101a290661fbc2dc915cb274019`, 52,354 bytes
- observed structure: self-contained SVG with 15 SVG text elements; no external asset or script was observed in the reviewed bytes
- rights authority: the identified uploader/author Wilfredor describes the artefact as own work and explicitly dedicates it under CC0; the reviewed file history is by the same author
- privacy: no sensitive personal data was observed in the SVG bytes; public author attribution remains in external provenance evidence and is not an annotator or trust identity
- proposed group: `origin_wikimedia_grua_maquina_wilfredor`
- suitability: real illustrated SVG with text for holdout workflow mechanics; no positive/negative rule label is presumed
- current decision: admitted candidate for a process-only holdout, with `calibrationEvidenceEligible: false`; this rights determination applies only to the exact hash above

### P2 — Dargel Kleingewerbe public product page

- public URL: `https://dargel-solutions.de/produkte/kleingewerbe-gruenden/`
- observed format: HTML containing four inline SVG elements and 31 SVG text elements
- observed live-response SHA-256 at an earlier audit: `099453c07c7960c4d94d5bf835f0d197f2e059e12dcb88f54399a60cf843d786`; this is mutable-edge evidence only and is not asserted to equal the admitted tracked-source snapshot
- first-party source reviewed at commit: `d4508c428f9f97914c91a7bdf4fb3a9b45c5d210`
- observed local source blob/SHA-256: `a65318a75d66834eb8cf64fb27c1309cb0c2fecf` / `703acb5a78a6d3cd91133192938df218356034308440d9cbdf9764c2f9805df3`
- byte authority and lineage: the admitted candidate is the clean tracked first-party source at the recorded blob/commit, under the Founder authorization reference; the public URL proves publication context, not byte equality. Any extraction, ID enrichment, or normalization is a separately hashed derivative in the same origin/derivation group
- rights basis: `first_party`, conditional on the Founder authorization reference in section 4 and embedded-dependency review
- privacy: public product content, but the exact snapshot still requires metadata, identifier, and contact-data review
- proposed group: `origin_dargel_kleingewerbe_product_family`; translations, site variants, extracted SVGs, and ID-normalized derivatives stay in this group
- suitability: real first-party rendering; currently no SVG-root or text IDs and no observed clip/mask elements, so it does not satisfy the M3-0 author-ID target binding without a separately contracted binding mechanism or a declared derivative
- current decision: priority first-party candidate for intake mechanics, conditional on target-binding eligibility; never describe an ID-enriched derivative as unchanged source bytes

Other potentially authorized first-party pages include:

- `https://dargel-solutions.de/produkte/ai-first-operating-playbook/`
- `https://dargel-solutions.de/en/products/orchestrating-ai-agents/`

Each requires its own immutable snapshot, hash, embedded-rights/privacy review, target-binding decision, and distinct origin-family analysis before admission.

### P3 — Our World in Data life-expectancy SVG

- URL: `https://ourworldindata.org/grapher/life-expectancy.svg`
- rights reference: `https://ourworldindata.org/faqs`
- observed structure: SVG with 26 text nodes, transformations, some IDs, but no root ID or observed clipping/masking
- rights issue: the chart identifies CC BY/attribution while underlying sources include Riley, Zijdeman, Human Mortality Database, and UN World Population Prospects; dataset-specific and third-party terms require artefact-level reconciliation
- privacy: low apparent sensitivity, but personal surnames and metadata still require review
- proposed group: `origin_owid_life_expectancy_grapher`
- suitability: viewport/transformation mechanics; current target-binding limitation and mutable endpoint
- current decision: reserve candidate; lower priority than a clean first-party or conclusively permissive artefact

## 6. Hard exclusions

- Paid Dargel build chapters and bundles, including previously observed P01/P02/P05 build artefacts, are not public-corpus candidates. Their commercial availability or Founder ownership does not replace the separate authorization/storage gate.
- `05_Marketing/Campaigns/PeerPush_breaklint/breaklint-screenshot.svg` is excluded from annotation because it embeds breaklint findings, scores, or thresholds and would contaminate the oracle.
- Medium article HTML and general website/essay SVGs that contain no SVG text targets are unsuitable for the three-rule pilot, even if rights are clear.
- W3C `masking-path-01-b.svg` may be useful as a permissive synthetic/conformance fixture, but it must not count as a real document or real-corpus evidence.
- Any client document, private correspondence, analytics export, user upload, paid source file, unclear-license download, secret-bearing locator, or artefact with unresolved privacy status is excluded.
- An agent-generated, rewritten, or simulated document may test infrastructure but cannot replace a real source.

## 7. Evidence and recheck

Before copying any candidate, record retrieval time, final resolved URL, response media type, byte length, SHA-256, license text/version/URL, author/rightsholder evidence, required notices, privacy scan result, reviewer identity, decision time, origin/derivation group, and immutable evidence references. Mutable web endpoints require a frozen snapshot; an audit-time hash is not a future intake hash. If the live response itself is not the admitted snapshot, evidence must explicitly disclaim live-byte identity and bind the admitted first-party source/transform lineage instead.

Any source change, redirect, license change, embedded dependency, or privacy finding reopens review. A missing or unclear fact results in `ineligible`, never an inferred approval.
