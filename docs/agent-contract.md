# Breaklint for Autonomous Agents

This document is the operating contract for coding agents using breaklint to verify or repair documents.

> The most important thing an agent needs to know about breaklint is that silence is not approval, exit 0 is the only success, and the tool measures geometry — it does not understand typography or design intent. If your fix makes the document look worse to achieve a clean exit, you have misunderstood the assignment.

---

## 1. Exit Code Semantics

Always check the process exit code before inspecting findings. Never interpret missing findings as success unless the exit code is 0.

| Exit Code | Verdict | Meaning | Agent Action |
|:---:|:---|:---|:---|
| **0** | `clean` | All requested checks ran to required coverage floors and found zero gated defects. | **Success.** Document passes layout gates. |
| **1** | `findings` | One or more measured targets violated a configured rule threshold. | **Repair needed.** Inspect findings, locate source, apply remediation. |
| **2** | `usage-error` | Invalid CLI arguments, schema mismatch, or unparseable configuration. | **Fix invocation.** Do not edit document; correct CLI flags or config file. |
| **3** | `infrastructure` | Renderer crash, missing local asset, or geometry cross-check mismatch. | **Investigate setup.** Missing image, bad path, or renderer failure. |
| **4** | `insufficient-coverage` | Candidate elements were declined by the engine; coverage floor was not reached. | **Do NOT treat as clean.** Even if `findings: []`, checks did not run. |

### Critical Rule for Exit 4 (`insufficient-coverage`)
When breaklint exits with code 4, the report may show zero findings (`findings: []`). **This is not a clean pass.**
It means the engine could not measure enough elements to satisfy proof thresholds (e.g., SVG text inside unsupported transforms, unmeasured RTL runs). Inspect `whatWasNotMeasured` in `context.json` or `coverage` in `report.json` to find the unmeasured rule and environment reason (`reason`).

---

## 2. Stable vs. Ephemeral Contract Fields

Breaklint outputs canonical `report.json` and agent-focused `context.json`. Key on stable fields; never rely on ephemeral ones:

| Field | Stability | Purpose & Safe Usage |
|:---|:---:|:---|
| `finding.fingerprint` | **Stable** | Deterministic SHA-256 of rule id, key type and target key — and deliberately of *nothing else*. It contains no page number, no ordinal, no fragment index, no node key. That is what makes it survive a repair: if your edit moves a defect without removing it, the fingerprint does not change. See `src/core/fingerprint.ts` for the mutation battery that settled this. |
| `finding.source` | **Stable**, nullable | Mapped position in the authoring source. `null` whenever the node was produced by the paginator and has no authoring source — page-scoped findings are the common case. `offset`/`endOffset` are UTF-8 byte offsets; `line`/`column` follow `coordinateSystem`. A screen-profile finding carries a different `source` shape (`status`, `file`) and no line numbers. |
| `finding.remediation` | **Stable** | `advice` is the rule author's guidance. `tested` says whether a trigger/remedied document pair in this repository demonstrates that applying the advice removes the finding and introduces no new one. **Today every rule ships `tested: false`**: no such pair is part of this package and no gate re-runs one. Treat the advice as a starting point, not as a verified repair. |
| `finding.ruleId` | **Stable** | Canonical rule identifier (e.g., `type/straight-quotes`, `layout/widow`). |
| `finding.measurement` | **Semi-stable** | Measured value, operator, and threshold. Check `measurement.calibrated`. |
| `finding.id`, `runFindingId` | **Ephemeral** | Internal execution IDs bound to a specific process run. Do NOT match across runs. |
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
- **Consequence:** the rule fires on pages a reader would call full. It is `experimental` and never
  gates. The name promises a visual property; the measurement is a different quantity, and this
  paragraph is the only warning you get.
- **Agent Rule:** **never** inflate `font-size`, inject filler text, or stretch `line-height` to
  resolve `layout/half-empty-page`. If a page is the natural end of a document or section, leave it
  alone.

---

## 4. Repair Strategy and When to STOP

When iterating on document repairs:

### Safe Repair Actions
1. **Punctuation and micro-typography (`type/*`):** replace straight quotes with the curly pair for
   the configured locale — `&bdquo;`…`&ldquo;` for `de-DE`, `&ldquo;`…`&rdquo;` for `en-*`. The rule
   defaults to `de-DE`; check `--locale` before you substitute. Replace spaced hyphens ` - ` with
   `&mdash;` or `&ndash;`.
2. **Table Pagination (`layout/widow`, `layout/orphan` in tables):** If an orphan or widow occurs inside a fractured table row, apply `tr { break-inside: avoid; }`. *(Note: Paged.js does not implement CSS `widows` or `orphans` on paragraphs).*
3. **Headings at Bottom (`layout/heading-at-page-bottom`):** Apply `h1, h2, h3, h4 { break-after: avoid; }` or force `break-before: page;`.
4. **Oversized Blocks (`layout/unbreakable-block-too-tall`):** Remove `break-inside: avoid` from containers that exceed page height, or allow them to fragment.

### The STOP Rules (Mandatory Abandonment)
You must **STOP** and revert your edit immediately if:
1. **New Finding Introduced:** The edit resolves finding A but causes finding B on the same or subsequent pages (e.g., forcing a break creates a half-empty page or cascades content into an orphan).
2. **Visual Degradation:** The edit degrades typographical hierarchy, introduces awkward spacing, or alters document semantics.
3. **Two-Attempt Limit:** If a targeted change does not eliminate the finding after 2 iterations, revert to the baseline and report the finding as an unresolvable layout constraint.
4. **Exit 4 Encountered:** If your edit introduces an element that the renderer cannot measure, you have reduced coverage rather than fixing a defect. Revert.
