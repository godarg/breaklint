# Reports and output formats

A breaklint run produces one canonical record, the JSON report. Every other format is a
projection of it for a particular reader: a person in a terminal, a reviewer opening a file, a CI
system or a coding agent. This page says what each format contains, how to produce it, and what it
leaves out.

## Choosing a format

`--format` selects one format per run; `--out <file>` writes it to a file instead of stdout.

| Format | For | Contains |
|---|---|---|
| `json` | scripts, archives, agents | the complete record: verdict, every finding, coverage per rule, declined candidates, events, configuration |
| `console` (default) | a terminal | verdict, counts, findings with measured value and threshold, up to three next checks |
| `html` | a reviewer, a build artifact, A4 print | the same facts as a self-contained offline page (see below) |
| `markdown` | pull-request comments, job summaries | counts per rule, each finding's message and the rule's remediation advice with its tested status |
| `sarif` | code-scanning dashboards | findings as SARIF results; `helpUri` links the rule page of the released version |
| `junit` | test dashboards | test cases with a failure per finding |

JSON is the truth. SARIF, JUnit and Markdown are deliberately lossy: they drop what their consumer
cannot represent, such as coverage floors or declined candidates. When a projection and the JSON
seem to disagree, read the JSON.

A live run also writes evidence to `--out-dir` (default `./breaklint-report`): one PNG per page and
the checked PDF. The JSON report records each evidence file's byte length and SHA-256.

## What every human-readable format shows first

Console, HTML and Markdown answer four questions before any detail:

1. What verdict did the run reach?
2. What did that verdict do to the build gate?
3. How many errors, warnings and informational findings exist?
4. Did the measured coverage meet the configured floors?

The four verdicts use different headings and sentences, not colour alone:

| Verdict | Heading | Exit |
|---|---|---:|
| `clean` | `Clean run` | 0 |
| `findings` | `Findings block this run` | 1 |
| `infrastructure` | `Checker failed` | 3 |
| `insufficient-coverage` | `Not enough was measured` | 4 |

Infrastructure and coverage failures say explicitly that the result is not clean. Findings that
exist in either state are labelled partial: they do not describe everything a complete run might
have found. An infrastructure run is always `Not trustworthy`; partial counters are reported as
partial ("24 of 26 candidates measured before the checker failed"), never as `Coverage met`. A run
in which no rule measured a candidate is `insufficient-coverage` and its summary says
`Not established`, even though each zero-candidate rule is `ok: true` in the JSON. A rule with a
real shortfall shows `Below required floor`.

**Next checks.** Up to three suggestions drawn from the report itself: an infrastructure or
coverage failure first, then individual coverage shortfalls, then rule groups ordered by severity
and rule id, experimental groups last. This is a reading order, not a diagnosis or a tested repair.

**Findings by rule** counts every finding without merging identities or claiming a common cause.
**Declined candidates** lists, by document, rule and scope, why candidates were not measured; the
counts sum `documents[].notMeasured[].count`. Entries without a rule are labelled `no rule`.
Declines stay visible when coverage meets its floor: meeting a floor does not erase what was not
measured.

## One finding

In the HTML report each finding is a vertical card, in this order:

```text
severity and experimental status
rule and page
complete explanation
document and measured source, if known
measured value and threshold
calibration and proof source
evidence status and ambiguity
```

An unknown source stays unknown; no filename or line is invented. Evidence is a link only when its
path has the relative page-artifact form breaklint writes; any other reference is shown as text.

Every rule declares remediation advice, and no test shows any of it removing its finding
(`remediation.tested: false`). The report says so once, under the Findings heading, with the count
it applies to; each remediation box then carries a short `untested` marker. Treat the advice as a
starting point and run breaklint again after any change.

## The HTML report

The HTML report is a self-contained file for review, attachment to a build artifact and A4
printing.

- **Offline and inert.** Inline CSS only: no scripts, external fonts, stylesheets, telemetry or
  network-loaded assets. Its Content Security Policy allows only the inline stylesheet and
  same-directory or `data:` images. Paths pass through the same redaction as every other reporter.
  Keep the JSON beside it when the full machine-readable record is needed.
- **Readable on any screen.** Findings never use a table or horizontal scrolling. Coverage is one
  aligned table per document that becomes a two-line grid per row on narrow screens. Body text is
  16 CSS px; long paths wrap after a slash; commands and rule ids never break where a break would
  change what is copied.
- **Accessible.** Named landmarks, a skip link to the main content, a contents navigation that
  links every section, a visible focus outline, light and dark themes from the operating system,
  and reduced motion honoured.
- **Printable.** Print uses the light palette on A4 with 12 mm margins. A finding splits only
  between its parts, and a part that starts a new page is labelled with its finding number and
  rule. Every page carries "Page N of M"; every page from the second carries a running head with
  the verdict, exit code and run id. A clean report prints its findings section too, with
  "0 findings". Chrome before 131 prints no page numbers.

The report ships no font file. It declares three system-font roles with different generic
families — a serif for headings, a sans-serif for body text, a monospace for identifiers and
values — so the hierarchy survives a missing face. Rendering is therefore deliberately not
identical across operating systems.

## Context packs, bundles and comparisons

Three subcommands, and the matching API functions, work on finished reports. They accept a
canonical document report — readers accept Report 4 and 5 — and `context` and `bundle` also
accept the separate screen-report profile (readers accept Screen 1 and 2). They never acquire
documents, start a browser, or turn report strings into commands.

```sh
breaklint context report.json --out context.json
breaklint bundle report.json --out-dir review --evidence-dir breaklint-report
breaklint compare before.json after.json --out comparison.json
```

```ts
import { createContextPack, renderReport, writeReportBundle } from "breaklint";

const context = createContextPack(report, { maxFindings: 40 });
const html = renderReport(report, { theme: "dark" });
const bundle = writeReportBundle(report, {
  outDir: "./breaklint-report",
  evidenceDir: "./run/evidence",
});
```

**`context`** writes a bounded projection for an AI agent or another reader. It names the run,
whether its finding selection is complete and why entries were omitted, carries an
untrusted-data notice and a fixed vocabulary of operations (`inspect-source`, `inspect-evidence`,
`recheck-after-repair`), and keeps at most 30 typed diagnostics plus an omitted count. It contains
no shell commands and no document-controlled executable parameters; host-local path tokens are
withheld. For each matched target it keeps the report's status, reason, measurements and
violation value rather than rebuilding a judgement from prose. `--max-findings` and `--max-text`
bound its size; a value above the limit is reduced, and the CLI says so on stderr.

**`bundle`** writes `report.json` (unchanged, canonical), `context.json`, `bundle.json` and
`report.html` into a new or empty directory. A PNG or PDF from `--evidence-dir` becomes a link
only when it is a regular file below that directory and its byte length and SHA-256 match the
report's record; anything else is shown as unavailable evidence, never as a stale image.
`bundle.json` lists every copied file with its digest. Without `--evidence-dir` no evidence is
copied, and the CLI says so. A report from an older schema is shown as legacy and receives no
new source or repair claim. Screen reports keep their own route, viewport and CSS coordinate
semantics and never gain page or PDF claims.

**`compare`** matches the findings of two document reports and writes a comparison in which each
result is `new`, `persisting`, `resolved`, `unmatchable` or `not-sufficiently-measured`. A finding
can be matched only when it carries a stable identity, which producer-bound runs
(`checkProducedDocuments`) record; findings of a plain CLI run compare as `unmatchable`. Reduced
coverage, a missing target or a disabled rule never becomes `resolved`. To confirm a repair across
two commits, pass `--repository <dir>` so the ancestry can be read; it has no effect on reports
without a verified revision. A comparison passed to `context` or `bundle` with `--comparison` is
kept unchanged. [`revision-comparison.md`](revision-comparison.md) describes the matching in detail.

### Exit codes of the subcommands

| Exit | Meaning |
|---:|---|
| 0 | the output was written completely |
| 1 | `compare --fail-on-new` only: at least one result is `new` |
| 2 | invalid invocation or input: unknown option, a file that is not a breaklint report of a readable version, an output that would overwrite an input, a non-empty bundle directory |
| 3 | the output could not be written, or the after report of `compare` is `infrastructure` |
| 4 | `compare` only: the after report is `insufficient-coverage`, or findings exist and none carries a stable identity, so nothing can be matched |

A before report that ended `infrastructure` or `insufficient-coverage` produces a warning on
stderr and does not change the exit code. `breaklint compare --help`, `context --help` and
`bundle --help` print the same table.

## Screen reports

`checkPage()` produces a screen report: a separate profile with its own schema, in CSS
coordinates (`css-viewport-pixels` for viewport captures, `css-document-pixels` for full-page
captures) and without page or PDF claims. The HTML renderer, `context` and `bundle` accept it.
[`screen-checks.md`](screen-checks.md) describes the checks.

## Related pages

- [`configuration.md`](configuration.md) — the CLI and JSON configuration contract.
- [`agent-contract.md`](agent-contract.md) — how a coding agent reads exit codes and reports.
- [`known-limits.md`](known-limits.md) — what breaklint does not measure.
