# Breaklint for Autonomous Agents

This document is the operating contract for coding agents using breaklint to verify or repair documents.

> The most important thing an agent needs to know about breaklint is that silence is not approval, exit 0 is the only success, and the tool measures geometry — it does not understand typography or design intent. If your fix makes the document look worse to achieve a clean exit, you have misunderstood the assignment.

Every rule id, verdict, `env/` reason, report field and repair lever this page names is held against the code by `tests/unit/agent-contract.test.ts`: the verdicts and exit codes against `src/core/enums.ts`, the ids against the rule registry, the fields against a real `--demo --format json` run, and the levers against each rule's own `remediation.advice`. Where this page and a rule's advice ever disagree, the advice is the source.

---

## 1. Exit Code Semantics

Always check the process exit code before inspecting findings. Never interpret missing findings as success unless the exit code is 0.

| Exit Code | Verdict | Meaning | Agent Action |
|:---:|:---|:---|:---|
| **0** | `clean` | Every requested rule measured its candidates to its coverage floor and nothing gated reached its threshold. | **Success.** Document passes layout gates. |
| **1** | `findings` | At least one non-experimental finding reached the gate set by `failOn`. | **Repair needed.** Inspect findings, locate source, apply remediation. |
| **2** | `usage` | Invalid invocation: unknown option, invalid or unknown configuration, a missing input path, or an input that is not a `.html`/`.htm` file. **No report is written** — nothing on stdout, nothing at `--out`. | **Fix invocation.** Do not edit the document; correct the command line or the config file. |
| **3** | `infrastructure` | The run could not measure: no renderer or driver, a font that failed to load, pagination aborted, a geometry cross-check that failed, an unstable render, a crashed checker. A failure before any document was measured (no renderer, for example) writes no report; a failure inside one document writes a report whose `documents[].exitReason` names it. | **Investigate setup.** Read stderr and `exitReason`; the document may be fine. |
| **4** | `insufficient-coverage` | Nothing or too little was judged. `documents[].exitReason` says which: a rule's declined candidates took it below its coverage floor (`<rule> below its coverage floor`), no rule measured a single candidate, the input was empty, or required evidence binding is incomplete. | **Do NOT treat as clean.** Even if `findings: []`, the checks did not run to completion. |

### Critical Rule for Exit 4 (`insufficient-coverage`)
When breaklint exits with code 4, the report may show zero findings (`findings: []`). **This is not a clean pass.**
Exit 4 does not require a decline: `--only layout/widow --disable layout/widow` leaves no rule to run and ends exit 4 with "no rule measured a single candidate". Where candidates were declined, `documents[].coverage` shows the rule below its floor and `documents[].notMeasured[].reason` names why, as an `env/` id. The two `error` rules require full coverage in the default profile, so one decline by either of them is enough: `layout/unbreakable-block-too-tall` declines on `env/multicolumn`, `env/vertical-writing` or `env/invalid-measurement` (a split block whose fragments cannot be joined by source id, or a printed block with no box of its own), and `svg/text-overflows-viewport` on `env/svg-not-inline`, `env/svg-no-text`, `env/svg-too-many-text-targets`, `env/svg-ctm-unavailable`, `env/svg-viewport-geometry-unsupported` or `env/svg-painted-bounds-unsupported`. Each list is complete for its rule; `tests/unit/agent-contract.test.ts` fails when a rule declares a coverage-relevant reason this page does not list. A target that is out of scope altogether — `env/svg-overflow-visible` — does not count against coverage.

**The CLI does not write a `context.json`.** `--format` offers `json | sarif | console | html | junit | markdown` and nothing else; the context pack exists only through the library call `writeReportBundle(report, {outDir})`, which writes `report.json`, `context.json`, `report.html`, `bundle.json` and the verified `assets/` together (see `docs/reporting.md`). If you are driving the CLI, `report.json` is your only machine-readable surface, and everything below that names a `context.json` field names a projection you must produce yourself.

---

## 2. Stable vs. Ephemeral Contract Fields

Breaklint's canonical output is `report.json`. `context.json` is a bounded projection of it, written only by `writeReportBundle` — never by the CLI. Key on stable fields; never rely on ephemeral ones:

| Field | Stability | Purpose & Safe Usage |
|:---|:---:|:---|
| `finding.fingerprint` | **Stable** | Deterministic SHA-256 of rule id, key type and target key — and deliberately of *nothing else*. It contains no page number, no fragment index and no node key, which is what makes it survive a repair: if your edit moves a defect without removing it, the fingerprint does not change. **One exception, and it is load-bearing:** a finding scoped to a page that carries no semantic block at all keys on `ord:<pageOrdinal>`, so for those the ordinal does participate and the fingerprint moves when pages shift. Those findings are marked `stableIdentity.status` other than `unique` — check it before you treat a fingerprint as an identity. See `src/core/fingerprint.ts` for the mutation battery that settled this. |
| `finding.source` | **Stable**, nullable | Mapped position in the authoring source. `null` whenever the node was produced by the paginator and has no authoring source. Three released rules set it unconditionally — `layout/half-empty-page`, `layout/orphaned-continuation-page` and `artifact/local-uri` — so for those you will never get a line number, and no amount of re-running will produce one. `--no-source-map` sets it null for every finding. `offset`/`endOffset` are UTF-8 byte offsets; `line`/`column` follow `coordinateSystem`. A screen-profile finding carries a different `source` shape (`status`, `file`) and no line numbers. |
| `finding.remediation` | **Stable** | `advice` is the rule author's guidance. `tested` says whether a trigger/remedied document pair in this repository demonstrates that applying the advice removes the finding and introduces no new one. **Today every rule ships `tested: false`**: no such pair is part of this package and no gate re-runs one. Treat the advice as a starting point, not as a verified repair. |
| `finding.ruleId` | **Stable** | Canonical rule identifier (for example `type/straight-quotes` or `layout/widow`). |
| `finding.measurement` | **Semi-stable** | Measured value, unit and threshold. Check `measurement.calibrated`. |
| `finding.runFindingId` | **Ephemeral** | Identifies the finding within one run only. Do NOT match across runs; a document finding has no other id field. |
| `finding.target.boxScreen` | **Ephemeral** | Absolute screen pixel coordinates. Shifts with any upstream content or styling changes. |

---

## 3. Proof source, not calibration

Every finding includes `measurement.calibrated`. **Every released rule ships `calibrated: false`.**
There is no `calibrated: true` in this package; an agent keying on that value will never match one.
A warning never establishes an objective defect, and no threshold here has been calibrated against
a corpus of real documents with human-checked truth. Never sacrifice document design or readability
to satisfy one.

What separates the two `error` rules from the eleven warnings is `measurement.proofSource`, not
calibration: their threshold is structural — zero occurrences, or the page box itself — rather than
chosen. `svg/text-overflows-viewport` and `layout/unbreakable-block-too-tall` are the two, and they
are the only rules that gate by default. See `docs/limitations.md` for what "uncalibrated" carries.

### `layout/half-empty-page` saturates
- **What it measures:** `netFill` merges the client rectangles of the page's text runs and of its
  replaced elements (`img`, `svg`, `canvas`, `video`, `table`), clips them to the content box, and
  divides the summed band height by the content box height (`src/measure/snapshot.ts`). Half-leading
  falls between the bands and no element margin ever enters the rectangles, so the quantity is
  systematically smaller than the fill a reader perceives. A page of prose at `line-height: 1.5`
  reaches at most about 0.686 — against a threshold of 0.60.
- **Consequence:** the rule fires on pages a reader would call full — measured on a 40-document
  corpus built to exercise it, 37 of 40. It is `experimental`, never gates, and since 0.6.0 is not
  active in the default profile, so a default run does not emit it at all. The name promises a
  visual property; the measurement is a different quantity, and this paragraph is the only warning
  you get.
- **Agent Rule:** **never** inflate `font-size`, inject filler text, or stretch `line-height` to
  resolve `layout/half-empty-page`. If a page is the natural end of a document or section, leave it
  alone. You will only see this rule at all if the run asked for it (`profile: "strict"`,
  `rules: { "layout/half-empty-page": true }`, or `--only`).

---

## 4. Repair Strategy and When to STOP

When iterating on document repairs:

### Safe Repair Actions
Each item names only levers its rule's own `remediation.advice` proposes; the advice in the finding is the full text.

1. **Punctuation (`type/straight-quotes`):** replace straight quotes with the curly pair for the
   configured locale — `&bdquo;`…`&ldquo;` for `de-DE`, `&ldquo;`…`&rdquo;` for `en-*`. The rule
   defaults to `de-DE`; check `--locale` before you substitute.
2. **Dashes (`type/spaced-hyphen`):** replace a spaced hyphen ` - ` with a spaced en dash
   (`&ndash;`) or an unspaced em dash (`&mdash;`).
3. **Split paragraphs and table rows (`layout/widow`, `layout/orphan`):** inside a table row, keep
   the row together with `tr { break-inside: avoid; }`. For a paragraph, prevent the split with
   `break-inside: avoid`, force an earlier break with `break-before: page`, or reword the text.
   *(Note: CSS `widows` and `orphans` do take effect on paragraphs: Paged.js never reads them, but the
   browser applies them through its own fragmentation inside Paged.js's flow. Each value is also its
   rule's threshold, so changing it is not a fix.)*
4. **Headings at the bottom (`layout/heading-at-page-bottom`):** add `break-after: avoid` to the
   heading, or insert `break-before: page` before it.
5. **Oversized blocks (`layout/unbreakable-block-too-tall`):** make the block shorter — split its
   content into smaller sections deliberately, or reduce its padding, font size or contained rows.
   Do not remove its `break-inside: avoid` to clear the finding: the finding then disappears only
   because the rule has no candidate, while the block is exactly as tall and is still broken.

### The STOP Rules (Mandatory Abandonment)
You must **STOP** and revert your edit immediately if:
1. **New Finding Introduced:** The edit resolves finding A but causes finding B on the same or subsequent pages (e.g., forcing a break creates a half-empty page or cascades content into an orphan).
2. **Visual Degradation:** The edit degrades typographical hierarchy, introduces awkward spacing, or alters document semantics.
3. **Two-Attempt Limit:** If a targeted change does not eliminate the finding after 2 iterations, revert to the baseline and report the finding as an unresolvable layout constraint.
4. **Exit 4 Encountered:** If your edit introduces an element that the renderer cannot measure, you have reduced coverage rather than fixing a defect. Revert.
