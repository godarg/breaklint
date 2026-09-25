# Changelog

## Unreleased

Changes on `main` since the `v0.6.0` tag. Nothing below is in the published 0.6.0 package.

### Rule behaviour

- **`layout/unbreakable-block-too-tall`: a `position: running(...)` element placed in a side
  margin box (`@left-middle`, `@right-middle`) is no longer summed into a false `error`.** In
  0.6.0 the filter that keeps per-page margin-box clones out of the fragment sum tested only the
  vertical axis. A side margin box starts at a content-box `y`, so its clones passed that test and
  a short running element repeated on three or more pages could be reported as a block taller than
  the page (e46a1bf). The 0.6.0 section below claimed this exclusion held "by construction"; it
  held for the top and bottom margin boxes only.
- **The same rule's advice no longer claims the block "cannot fit unbroken on any page".** The
  finding message had already stopped making that all-pages claim from one measured page; the
  advice text in `Finding.remediation` now says the same thing (6af6008). Consumers that stored or
  compared advice text will see the new string.

### Fixed

- **A directory named `*.html` ends with exit 2 before Chrome starts, instead of exit 3.** The
  input type is decided by the name, so a directory called `chapter.html` passed the extension and
  existence checks, started Chrome and ended exit 3 `source-acquisition-failed` with "input
  capture failed: resource byte limit exceeded" — an infrastructure verdict with the wrong cause for
  a mistake in the invocation, where the README promised exit 2. Anything that is not a regular
  file is now `breaklint: input is not a regular file: <path>`, exit 2, no report.
  `tests/e2e/input-validation.test.ts` pins exit 2 and an empty stdout for an existing and a
  missing `.md`, a directory named `.html` (also after a valid path) and a missing `.html`.
- **`--help` described exit 4 as including "no input"**; a run without an input path is exit 2.
  The exit-2 line now names every usage case and says that no report is written.

### Documentation

- **`--out-dir <dir>` is documented and tested.** It was parsed, validated and applied — every
  live run writes its page PNGs and checked PDF there, by default into `./breaklint-report` in the
  working directory — and appeared in neither `--help`, the README nor `docs/configuration.md`, and
  no test named it. It is now in all three, `tests/e2e/input-validation.test.ts` pins its exit-2
  cases, and the live test `tests/live/cli-out-dir.test.ts` observes the evidence in the named and
  in the default directory (one more live test).
- The two documented blind spots of the community-intake secret tripwire — candidates shorter
  than 12 characters, and candidates containing a character outside `A-Z a-z 0-9 + / _ = . : % -`
  — are pinned on both sides of each boundary by `tests/e2e/community-intake-limits.test.ts`, so a
  detector change cannot make `docs/community-testing.md` wrong unnoticed.

- Naming an off-by-default rule in `rules` with only an options object enables it, exactly as
  `true` does. This was always the behaviour; it is now written down in `docs/limitations.md` and
  pinned by a contract test.
- **Stale contract statements corrected against the code.** The README said live reports use
  Report 4 (they use 5; readers accept 4 and 5), that `examples/demo.html` is the document behind the
  demo snapshot (no such file exists or ever did), that print uses a "verified" A4 layout (what is
  verified is the technical surface gate; the 0.6.0 human review did not pass) and that a live run
  needs `puppeteer-core@25.8.x` (the peer range is `>=25.8.0 <26`). `docs/source-bound-findings.md`
  listed the document report as 4 and the context pack as 1 (5 and 2). `docs/configuration.md` now
  says that any rule value other than `false` — an options object, even an empty one — enables a
  rule, and that `strict` also enables `layout/half-empty-page`; `tests/e2e/configuration-doc-claims.test.ts`
  pins both through the CLI. `docs/limitations.md` described a Paged.js exit 3 for a Markdown file;
  a non-`.html` name has ended with exit 2 before any renderer since 0.3.1, and Markdown text
  saved as `.html` is measured as HTML text (with no element in it, the run ends exit 3
  `geometry-cross-check-failed`).
- The shipped type declarations called `renderReport`'s input "a Report4" and
  `Finding.originalSource` "Report4's source/actionability truth"; `renderReport` reads document
  reports of schema 4 and 5 and screen reports, and `originalSource` has been part of every
  document report since schema 4. Comment-only; no type changed.
- **`SECURITY.md`** named 0.2.x as the supported line; only the latest published version receives
  fixes. It also said the sandbox claim was checked in the test suite, and no test checked it:
  `tests/unit/sandbox-boundary.test.ts` now pins the one browser launch, read with the TypeScript
  compiler's parser: an object literal of allow-listed keys (`executablePath`, `headless`,
  `userDataDir`, `args`, `detached`, `protocolTimeout`, `pipe`, `handleSIGINT`, `handleSIGTERM`,
  `handleSIGHUP`, `timeout`, `signal`, each with the reason it cannot touch the sandbox), no spread,
  no computed key and no key twice, with `args` the literal `[]` — and fails if any source, tool,
  test or workflow file names a sandbox-disabling switch.
- **The complete local gate is in `CONTRIBUTING.md`**, where `AGENTS.md` said it was and it was
  not: the `npm run` steps of `ci.yml` in CI's order, plus the packed-consumer checks.
  `docs/releasing.md` ran `test:real-document` before the build it needs, left out
  `make-mark-font --check`, `test:report-surface-mutants`, `docs:rules:check` and the packed
  consumer, and named 0.6.0 in its procedure; it is now version-neutral and complete.
  `tests/unit/workflow-gates.test.ts` holds both lists against the workflow. `CONTRIBUTING.md` no
  longer names schema numbers (it said Report 4 and Snapshot 3).
- **`docs/agent-contract.md` is now held against the code, and it contradicted it in six places.**
  It recommended removing `break-inside: avoid` for `layout/unbreakable-block-too-tall`, whose own
  advice says that clears the finding only by removing the rule's candidate; named an exit-2
  verdict `usage-error` (it is `usage`, and exit 2 writes no report); explained exit 4 as declined
  candidates only, with "unmeasured RTL runs" as an example (no rule declines on direction, and
  exit 4 also ends a run in which no rule measured anything, an empty input or incomplete required
  evidence); listed the research rules `svg/text-clipped` and `svg/text-ink-collision` among the
  rules that null `finding.source` (three released rules do); and named a `finding.id` that no
  finding carries. `tests/unit/agent-contract.test.ts` checks the exit table against
  `EXIT_CODE_BY_VERDICT`, every rule id against the registry, every `env/` id against `ENV_IDS` and
  the declaring rule, every field path against a real `--demo --format json` run, and every lever
  it proposes against the positive levers of that rule's `remediation.advice`; each of the six
  contradictions, reinserted, fails a named test. A decline list the page attributes to a rule
  must be that rule's complete coverage-relevant `declines`, so a rule that gains a reason fails
  the test until the page lists it.
- **The lever guard now also reads each rule page's Examples.** A lever counts as changed when the
  remedied example sets it to a new value, adds it or REMOVES it — deleting `break-inside: avoid`
  is the false repair the guard exists for. The remedied example of
  `layout/orphaned-continuation-page` changed `font-size`, which its advice does not propose; it now
  changes a preceding margin and `line-height`. The remedied example of
  `layout/unbreakable-block-too-tall` still uses `break-inside: auto`; that page is rewritten by
  another change of this release and is pending in the guard with exactly that one foreign lever,
  so anything added to the example fails, and the entry fails once it is no longer needed. A
  sentence proposes a lever clause by clause: "Delete …", "Drop …", "Strip …", "Change … to",
  "Override …", "Consider removing …", "You should remove …" and "Removing … fixes the finding"
  propose as "Remove …" does; a warning in one clause no longer exempts the others, a negation
  voids only when it negates the proposal verb ("does not fit" is not a warning) and then the list
  it opens, and a word inside a quoted span is not read as grammar. The reader is a heuristic, and
  `tests/unit/remediation-levers.test.ts` pins its contract sentence by sentence.
- **Erratum to 0.6.0.** The 0.6.0 entry that introduced `docs/agent-contract.md` says
  "`selfcheck:static` reads it, so its claims are held against the code". It did not:
  `selfcheck:static` scans that file for emoji, first-person wording, marketing words and
  uniqueness claims only, which is why the contradictions above shipped. The same entry's "five rules set
  `finding.source` unconditionally to null" counted two research rules.

### Reporting

- **The context pack's repair option for `layout/unbreakable-block-too-tall` no longer proposes a
  false repair.** For a finding with a verified original source, `repair.options` in
  `context.json` and on the HTML bundle's finding card said "Adjust the verified block's break
  constraint or split its content; expected effect: the block can fit a page fragment". The
  rule's advice warns that the break constraint is the one lever that clears the finding without
  making the block fit. It now reads "Shorten the verified block or split its content into smaller
  sections deliberately; do not only remove its 'break-inside: avoid', which clears the finding
  without making the block fit; expected effect: the block no longer exceeds the content box of the
  page it is laid out on." Context pack schema unchanged (2): the field and its type are the same.
  `tests/unit/registry.test.ts` now checks every entry of that map against the levers its rule's
  advice proposes.

### Tooling

- **The release workflow names its version once, and CI checks that it is the right one.**
  `release.yml` carried the release version as a literal 28 times; the literal tag trigger is now
  the only one in an executable line, and every job derives `RELEASE_VERSION` and `PACKAGE_FILE`
  from the triggering tag after proving that the tag, the trigger, `package.json` and both root
  fields of `package-lock.json` agree. `npm run test:release-tag` now also runs
  `tests/tools/release-workflow-contract.mjs --check` on every CI run, so the 0.6.0 incident — a
  version bump whose tag started nothing because the trigger still named the previous release —
  fails on the pull request that causes it. The derive step must always run and must invoke the
  script: no `if:`, no `continue-on-error:`, and exactly `run: node
  tests/tools/release-workflow-contract.mjs --derive-env`. Its `--self-test` rejects a pin moved
  alone, a version moved alone, a lock moved alone, a wildcard, a leftover release literal, a job
  that reads the identity without deriving it and four ways of disarming the derive step, and
  accepts a coherent release-prep commit. Run against the tree
  of that incident (the parent of 9d53577) it reports "a push of v0.6.0 would start nothing".
- **The changelog is checked against git, in three states.** `tests/tools/changelog-contract.mjs`,
  also in `npm run test:release-tag`: after a release, any change under `src/` since the last tag
  requires a non-empty `## Unreleased` section that names every changed rule id; while a release is
  prepared, the version's heading must carry a date or exactly `TBD-at-tag`, and no
  `## Unreleased` section or "(unreleased)" status line may remain; at the tag commit, which the
  release workflow checks before packing anything, only a date is accepted, and a placeholder that
  reached the tag fails with the instruction to date it in a final commit and tag that commit. The
  tag commit of 0.6.0 shipped `## 0.6.0 — unreleased` in the published tarball, and the two
  post-tag rule changes above had no section to go into; run against those two commits the check
  fails on exactly those points. Without release tags, or in a shallow clone whose history is cut
  above them, it fails instead of passing. A rule id counts as named only as a whole token
  (`layout/orphan` is not named by `layout/orphaned-continuation-page`), a moved rule module must
  name its old id too, and a heading date must exist (2026-02-30 is refused). Its `--self-test`
  builds throwaway repositories for 23 states, including a shallow clone, a `TBD-at-tag` heading
  before the tag (accepted) and at the tag (rejected).
- **The README that ships is checked against the CLI that ships.** The published 0.6.0 README says
  "one of its seven findings" and `rules run: 13`; `npx breaklint --demo` from the same tarball
  prints five findings and `rules run: 12`. The only guard read the repository README and ran the
  source CLI. Its parser now lives in `tests/tools/readme-demo-contract.mjs`, shared by the unit
  test and by the packed-consumer steps of `ci.yml` (Node 24 and the Node 22.13 floor) and
  `release.yml` (both clean consumers and the registry readback), which run it over
  `node_modules/breaklint/README.md` and the installed `bin` in a child process. Each run also
  rejects three corrupted copies of that README against the same output. Installed from the
  registry, 0.6.0 fails it on all three counts it states.
- **The pagination-residue record is no longer a CI or release step.** Its binding has been
  historical since 2026-09-18 — five of the six private documents no longer exist at their
  recorded digests — so `npm run test:pagination-residue` printed `NO CLAIM` and exited 0 having
  read none of them, with or without an artifact root; the only thing the step could fail on was
  its own manifest. A step that exits 0 over zero documents is a green light over nothing, so it
  was retired from `ci.yml` and `release.yml`, and `tests/unit/workflow-gates.test.ts` fails if it
  returns while the script reads nothing. The script stays as a local check of the record. The
  class remains held in CI by the public `tests/fixtures/fragmentainer-residue.html` in the live
  suite. `docs/releasing.md`, `docs/limitations.md`, `docs/status.md` and the corpus README said
  the step printed `SKIPPED` and could be run in full before a release; neither was true.
- **Schema stamps in the shipped documents are checked against the built package.**
  `tests/unit/docs-truth.test.ts` compiles `dist/` into a staging package and reads the stamps by
  running it (`tests/tools/docs-truth.mjs`): the report stamp from its CLI's `--demo --format json`,
  the context-pack and comparison stamps from its public API, the readable set and the snapshot
  stamp from its enums. Every "Report N", "report schema N", "Snapshot N", "context pack N" and
  contract-table row in README, SECURITY.md, `docs/**` and CONTRIBUTING.md must equal them unless
  that mention is stated as history within its own sentence — an arrow on it, a released version
  joined to it by "from"/"until"/"since"/"before", by "in" plus a transition verb, or by a
  transition verb between the version and the mention, "legacy" directly before it, or the exact
  readable set. A version elsewhere in the paragraph, a common word such as "was" or "from the",
  "legacy" elsewhere in the sentence or an arrow elsewhere in a table row does not count. Against
  the documents of the previous commit it names every stale line the README, CONTRIBUTING.md,
  `docs/source-bound-findings.md`, `docs/status.md` and `docs/configuration.md` carried; four
  genuinely historical sentences in `docs/releasing.md` and `docs/status.md` now name their release.
  Two lines in `docs/reporting.md` are listed in `tests/tools/docs-truth-pending.jsonl` for the
  change that owns that page; each entry matches exactly one issue by file, kind, number and exact
  sentence, so a copy of the sentence or a stale claim added to it fails, and an entry that
  matches nothing fails. The same check runs in `ci.yml`'s packed clean-install step against the
  installed `node_modules/breaklint` — the README and docs a user installs, and the stamps of the
  code installed with them. In the release workflow it runs with `--release`, which refuses any
  pending entry: a tag must not ship a sentence the check knows is stale, so a non-empty pending
  list stops the release before anything is published and names the sentences to correct. A run
  that finds no document to read fails instead of passing. The four tools this change adds to the workflows —
  `docs-truth.mjs`, `changelog-contract.mjs`, `release-workflow-contract.mjs` and
  `readme-demo-contract.mjs` — refuse any argument they do not know with exit 2, so a misspelt
  `--release=no` or `--Release` cannot quietly run pull-request mode at a tag.
- **`npm run docs:rules:check` is a CI step.** `AGENTS.md` says generated artifacts are checked
  with their generator; the rule-page remediation blocks written by `tools/write-rule-docs.ts`
  were checked in CI only by a unit test that re-derives the same assertion, and the generator's
  own `--check` ran in no workflow. The release workflow runs it too, and its clean consumers and
  registry readback run the docs-truth check against the installed package; `docs/releasing.md`
  says the release workflow repeats the complete gate, and `tests/unit/workflow-gates.test.ts` now
  fails when `release.yml` leaves out any `npm run` gate step `ci.yml` runs, and when a
  packed-consumer job of either workflow stops running the README-demo or the docs-truth check
  (in `release.yml`, with exactly `--release`) in a way whose exit code reaches the job: invoked by
  `node` itself, nothing chained or piped after it, errexit on, and neither the step nor the job
  conditional or allowed to fail. The local gate lists
  in `CONTRIBUTING.md` and `docs/releasing.md` follow, and the same test keeps them equal to
  `ci.yml`.

## 0.6.0 — 2026-09-18

A minor rather than a patch for the reason `docs/releasing.md` gives for 0.5.0: the canonical
document report changes structure, so its schema stamp moves. **Report 4 → 5** and **agent context
pack 1 → 2**. Snapshot stays 4 and Configuration Contract stays 1.

### What a consumer has to do

- **Report 5 adds one optional property, `Finding.remediation`** — `{ advice: string, tested:
  boolean }`. Nothing was removed and nothing changed type. A reader that accepts Report 4 will
  usually accept Report 5 unchanged; a strict decoder that rejects unknown properties will not,
  which is the whole reason the stamp moved rather than staying at 4.
- **Stored Report-4 artefacts remain readable.** `READABLE_REPORT_SCHEMA_VERSIONS` is `[4, 5]`, and
  `compareReports`, `writeReportBundle` and `createContextPack` all accept both. A saved schema-4
  report is pinned in the suite to still produce a full context pack rather than the legacy stub.
  Only the emitter moved.
- **Context pack 2 gains a required key and three card keys.** The pack itself gains
  `whatWasNotMeasured`; each finding card gains `fingerprint`, `source` and `remediation`. A
  consumer that validates the pack against schema 1 must move to 2; there is no shape in which 1
  and 2 are distinguishable by inspection, which is why the stamp moved.
- **The context pack's own limits are unchanged, and no 100/1200 default ever shipped.** A schema
  bump invites the opposite assumption, and a draft of this work did briefly raise the defaults to
  `maxFindings: 100` / `maxTextPerField: 1200` and drop the input clamp — that draft was never
  released and is not in this version's history. Against the released 0.5.0, measured rather than
  asserted: `git show v0.5.0:src/api/context.ts` reads `?? 40` and `?? 400`, the current file reads
  the same, and both clamp a caller's value into range. For the same reason `repair.options` has
  nothing removed from it: `RuleMeta.remediation` is new in this release, so there was no generic
  advice in 0.5.0's `repair.options` to take out. What did change there is named above — the
  `layout/widow` and `layout/orphan` strings.
- **`whatWasNotMeasured[].candidateCount` is `null` in the screen profile.** `checkPage` records a
  two-rule candidate total, so a per-rule denominator does not exist there. `declinedCount` counts
  rule/target decisions in both profiles and stays comparable; `floor` was already null.

### Two default behaviours change, and one of them can newly fail a build

- **`layout/unbreakable-block-too-tall` now measures a split block over its fragments.** Until now
  it read the FIRST fragment and skipped the rest, on the stated ground that "the block's height is
  a property of the block" — which holds only while the block is unfragmented. Measured on
  2026-09-18 with a six-page `break-inside: avoid` section: the paginator split it into six
  fragments, fragment 0 measured 596.36 px against a 680.31 px page content box, and the document
  came back `clean` at exit 0. The one rule this tool gates on by default was silent about a block
  five and a half pages tall that had asked not to be broken. The same document now reports
  3759.70 px against 680.31 px and exits 1.
  **This can turn a green build red.** A project whose documents contain oversized
  `break-inside: avoid` blocks that the paginator was already splitting will see a new `error`.
  That is the correct outcome — the block never fitted — but it arrives without any change on the
  consumer's side, so it is named here rather than in a footnote. The change is conservative in the
  other direction: a block SHORTER than a page that is split only because it began low on one sums
  to less than a page and stays silent. Fragments are correlated by their authoring-source id; a
  block whose fragments carry none keeps the old first-fragment behaviour rather than guessing.
  A four-eyes review of that sum found a false positive before it shipped, and it is worth naming
  because the mechanism is not obvious: Paged.js implements `position: running(...)` by cloning the
  element into the margin box of every page, and the clone keeps the source id. Measured: an
  ordinary twelve-page document with a three-line running header reported thirteen "fragments" of an
  81.59 px header, 979.08 px against a 619.83 px page, as `severity: error`. A box now only counts
  towards the flow when it starts inside the content box of its page, which excludes a margin box by
  construction. The underlying `fragmentIndex`/`fragmentCount` fields of the snapshot still count
  those clones; repairing the collector is a separate change and is named in `docs/limitations.md`.
  A second independent review then found the other two ways the sum can lie, and both are closed.
  **A split block is only reported from the third fragment on.** Paged.js does not fragment
  natively — it produces separate DOM elements — and its own stylesheet unsets `margin` and
  `padding` at a split edge but not `border`, and without `!important`. Two fragments can therefore
  sum above the page for a block that fitted unsplit; from three on they cannot, because an
  intermediate fragment fills a whole content box and carries content before and after it. A
  two-fragment block records the FIRST fragment's box and is reported only if that alone exceeds
  the page, exactly as in 0.5.0 — so a block that really is too tall and happens to split into
  exactly two pieces is still not reported. `docs/limitations.md` names that gap rather than
  leaving a reader of the summed-height sentence above to assume the sum applies everywhere.
  **And the boundary is the page the block was laid out on.** The message used to end "It cannot fit
  on any page", which is an all-pages claim from one sample; comparing against the largest content
  box in the document was tried instead and is worse — in a document with a named landscape page it
  raises the bar for every block on the portrait pages and hides real ones. The finding now names
  the page and its content box and says the block did not fit *there*.
- **`layout/half-empty-page` is no longer active in the default profile.** Measured on a
  40-document corpus built to exercise it, it fired on 37 of them. Its quantity saturates —
  `netFill` sums line-box heights and so counts neither leading nor block margins, capping a fully
  set text page at about 0.686 against a threshold of 0.60 — so most of those 37 are pages a reader
  calls full. A warning that appears on nine documents in ten teaches its reader to skip warnings,
  and that cost is paid by the twelve rules that are right.
  Nothing is removed: the rule keeps its id, its page, its options and its place in the config
  schema, it is still `experimental` and still moves no exit code, and three unchanged paths turn
  it on — `profile: "strict"`, `rules: { "layout/half-empty-page": true }`, or
  `--only layout/half-empty-page`. The id is unchanged deliberately: it has been public since 0.5.0
  and lives in configurations, `--disable` invocations, stored reports and fingerprints. The
  threshold was NOT lowered instead; 0.60 is uncalibrated, and a second uncalibrated number would
  have moved the noise rather than accounted for it.
  A profile now decides WHICH rules run, not only how loudly they report. `profile: "strict"` is
  therefore no longer expressible as `default` plus `failOn: warn` plus full coverage floors — it
  also asks for the off-by-default rule, and the contract test that asserted the equivalence says
  so now.

### Thirteen rules now say what to change, and say when nobody checked

- Every rule carries `remediation.advice`: what in the source produces the finding and what
  concretely to change. It reaches the terminal, the HTML report and `Finding.remediation`.
- **All thirteen declare `tested: false`,** and the terminal and HTML say so at the finding. The
  flag is a claim about evidence, not confidence: it can only become true once a gate runs a
  trigger/remedied pair, holds the applied diff against the advice text, checks that no new finding
  arrived, and deletes its target before each run. No such gate ships yet. The previous shape let
  the engine stamp `tested: true` on every remediation it copied, which is how an unverified string
  reaches an agent as a verified one.
- Four advice texts were corrected because a measurement applied the lever each one NAMES, alone,
  to the original trigger document. In **three** of the four the named lever left the finding in
  place and something else in the remedied file had done the work; the fourth described the rule's
  scope wrongly rather than naming an ineffective lever. The four: `artifact/local-uri` (there is no distribution root; every absolute path
  is reported), `layout/unbreakable-block-too-tall` (removing `break-inside: avoid` removed the
  candidate, not the height), `svg/text-overflows-viewport` (`overflow: visible` makes the target
  non-applicable and silences the only rule that gates by default), `layout/hyphen-across-page`
  (the rule keys on the paginator's own hyphenation class, so `hyphens: none` alone leaves the
  finding in place).
- `type/excessive-word-spacing` advises `hyphens: auto` and `layout/hyphen-across-page` advises
  `hyphens: none`. Both texts now name the other rule and say the two pull in opposite directions
  and that neither threshold is calibrated. A human loses an evening to that; an agent on a
  two-attempt budget oscillates.
- **`repair.options` changed for `layout/widow` and `layout/orphan`.** They recommended adjusting
  "the widows setting" and "the orphans setting" — the one advice this project has measured to be
  inert on its own corpus. They now name `break-inside: avoid`, `break-before: page` and rewording,
  and they say which fragment the rule measures: `widow` the one that opens the next page, `orphan`
  the one that closes the page. Consumers reading `repair.options` will see different strings.
- The coverage shortfall block no longer offers `--disable <rule>` in the same words for every
  rule. For a rule whose `error` severity is the only gate this tool has by default, the line now
  says what disabling it costs.

### Reports

- The terminal report opens with a verdict banner and an exit code, sorts findings by document,
  page, severity, rule and position on the page, and prints a coverage block.
- The HTML report carries a remediation box per finding, the untested sentence where it applies,
  and an itemised coverage shortfall block that names the verbatim decline reason and the options.
- **The printed report is longer: 43 page rasters across the four canonical states, up from 32**
  (clean 5, findings 12, infrastructure 13, insufficient-coverage 13). The remediation surface is
  what grew.
- **The printed report no longer ends on a page carrying a single coverage record.** Records do not
  fragment, so the terminal page receives the remainder of the pack, and which remainder that is
  depends on where the findings section above happens to end — measured: twelve pages, ninety-three
  non-whitespace characters on the last. The last two records are now bracketed in a container that
  may not break. The bracket changes no flow height and is inert for every other remainder.

### Documentation

- **One remediation text per rule, and a gate that keeps it that way.** `remediation.advice` in
  `src/rules/**` is what the CLI prints and what travels to every consumer as
  `Finding.remediation`; `docs/rules/<id>.md` is what a person reads. They were written separately,
  and measured on 2026-09-17, 10 of 13 pairs disagreed — the pages between them named eight levers
  the rules do not know, including "remove `break-inside: avoid`" for the one rule whose own advice
  explains why that clears the finding without fixing anything, and "leaving fewer trailing lines"
  for `layout/widow`, which measures the fragment that OPENS the next page. The rule is now the
  single source: each page carries the advice verbatim in a generated block, may add context around
  it, and may not propose a lever the rule does not name. `npm run docs:rules:write` regenerates,
  `npm run docs:rules:check` verifies, and `tests/unit/registry.test.ts` carries the same assertion
  so the unit suite fails on drift. Two doc-only levers were promoted into the rules because they
  are true and checkable from the code — `type/straight-quotes` now names the tags it never
  measures and its `excludeTags` option, `artifact/local-uri` now names an absolute URL on the
  publishing host. The rest were dropped rather than promoted, `text-wrap: pretty` among them:
  nothing in this repository has checked them.
- New `docs/agent-contract.md`: what an agent driving this tool can rely on. It states that no rule
  ships `calibrated: true`, that the fingerprint deliberately carries no page, ordinal, fragment
  index or node key — with the `ord:<n>` exception that applies to a page carrying no semantic
  block — and which five rules set `finding.source` unconditionally to null. `selfcheck:static`
  reads it, so its claims are held against the code.
- `docs/rules/layout-half-empty-page.md` replaces "fires on approximately 90 % of real-world
  documents" with what was measured: 37 of 40 on a corpus constructed for the purpose, and no
  real-world corpus measured at all.

### Apparatus

- Three print mutation controls — `broken-coverage`, `broken-trust-geometry` and
  `broken-terminal-density` — were declared in the renderer and run by nothing, so none of them had
  ever executed. Measured: the first two produce a genuine failing run and are now wired into
  `test:report-surface-mutants`; `broken-terminal-density` could not go red at all and is removed.
  The mutation runner now holds the renderer's allowlist against its own control list, so a control
  that nobody runs is a failing gate.
- New control `broken-tail-cohesion` releases the coverage tail bracket and forces four records per
  page, reproducing the underfilled terminal page exactly. It asserts the phase it reproduces, so a
  future rule count that no longer leaves a remainder of one fails loudly instead of going green.
- The report-surface render manifest carries its own version. Report 4 → 5 briefly moved that stamp
  too; it is back at 4, because the manifest's own structure did not change.
- **The pagination-residue record says that it is historical, instead of failing forever.** Its
  private half compares admitted digests against a bundle that is not in this repository. Measured
  on 2026-09-18: one of the seven admitted artifacts still exists at its recorded digest; the shared
  stylesheet and five of the six documents have changed since the measurement of 2026-09-06. The
  digests were not re-recorded — the expectations beside them were measured on the old bytes, and a
  drifted byte is a red gate, not a re-recorded expectation. The manifest now carries
  `binding.status: "historical"` with the re-measurement in it, and the gate prints a NO CLAIM line
  naming that reason, the same no-claim shape it already used for an absent artifact root. The class
  itself is unaffected: `tests/fixtures/fragmentainer-residue.html` is public and is what CI runs.
- **A cleanup verification read one errno as a verdict it does not carry.** `acquireProducedDocuments`
  closes the process group it owns and then proves it is gone with `kill(pgid, 0)`. Every answer
  except `ESRCH` was treated as "cannot verify" and failed the whole acquisition. Measured on
  darwin 25.6.0 over 20 acquisitions: 8 probes answered `EPERM` for a group this process had created
  and owned, and in all 8 the next probe — 0 ms or 10 ms later — answered `ESRCH` with the
  descendant dead. So 40 % of otherwise successful producer runs on a loaded developer machine
  reported `source/producer-incomplete`, which is the machine this tool is for. `EPERM` is now read
  as indeterminate and retried inside the bounded deadline it already had; an indeterminate answer
  that survives the deadline still fails the acquisition, and a group that is genuinely still there
  still fails as "survived bounded cleanup". The errno truth table is pinned in a unit test.
  Measured after: 0 of 24 spurious failures at a higher load than the 8-of-20 run.
- **Three unit tests bounded a subprocess start-up and reported the result as a product defect.**
  `source-boundary-regressions` raced a 700 ms and a 2 s acquisition budget against spawning a node
  process that spawns another, and read the descendant's pid file without checking it existed —
  under load the answer was `ENOENT`, which reads in the TAP output as a cleanup failure. The
  descendant now registers synchronously from its parent the moment it is spawned, the budgets are
  sized for what they wrap rather than for a stopwatch, and a missing registration says so instead
  of throwing. `render-run`'s cleanup-escalation test bounded a 5 s product wait at 8 s and failed
  at 8700 ms on a busy machine; the lower bound is the claim and is unchanged, the ceiling now only
  separates "waited" from "hung". Measured on this machine before the change: three full runs of
  that file, three red. After: three full runs, three green, the last at a higher load than any of
  the three that failed.
- **The `selfcheck:live` red control had an expiry date and reached it.** It multiplied the first
  finding card's own height with `transform: scaleY(20)`, so the injected fault was a multiple of
  the card's content. Once each card gained a remediation box, the same injection produced a card
  the paginator fragmented into nineteen pieces; the rule measured fragment 0 at 895.9 px against a
  1031.8 px page and the whole chain went green on a real fault. The injected height is now
  absolute, and the control additionally asserts that the block it reported is the one that was
  injected, at its whole height. Verified to go red on this release and on 0.5.0 alike, and
  verified to fail loudly when the injected height is put back below the page.

## 0.5.0 — 2026-09-13

- Add installed public producer, existing-page, comparison and canonical report-bundle APIs.
- Version live document Report/Snapshot contracts to 4; preserve separate Configuration Contract 1.
- Bind generated input bytes and verified original source ranges through bounded producer receipts; preserve unknown and ambiguous provenance.
- Preserve the exact diagnostic PDF and hash-bound page evidence; fix cross-page overlay marks that could change print scale. Required evidence gaps now prevent a clean claim.
- Add visible web overflow and clipping diagnostics with named scroll/overlay exceptions, bounded inventory and explicit unsupported paint/stability states.
- Compare positive target measurements under verified revision, configuration, resource and renderer conditions; reduced coverage is never a repaired finding.
- Add offline human cards and bounded untrusted AI context from the same JSON, with checked evidence assets and explicit omissions.
- Extend the Actions one-tarball release route to test ESM, require(ESM), TypeScript and a real Playwright consumer.
- Pre-release review corrections: withhold host paths after brackets in AI-context diagnostics, keep `$` sequences from document text literal in written HTML, refuse symlinked bundle files, require a positively measured baseline before a comparison reports `resolved`, and align the exported screen-options schema with runtime validation.


## 0.4.0 — 2026-09-05

A minor rather than a patch for one reason: on a document whose paginator left unplaceable
table content in an overflow column, `exitReason` changed from `checker-crashed` to
`render-unstable`. Exit code 3 in both cases, report schema unchanged.

### Content a paginator could not place is now named, not reported as a crash

The first run against a corpus that was not this repository's own: eighteen chapters of a shipped
HTML bundle. Twelve measured. Six ended `exit 3`, `checker-crashed`, with the payload
`{"freezeChanged":true,"mutationDelta":0,"sidMutationDelta":0,"sidIssues":[],"pageErrors":[],
"networkActivity":0,"inFlight":0,"pendingBodies":0}` — a fatal verdict with no cause a reader could
act on, and no fixture in this repository had ever produced it.

- **Measured what the six had that the twelve did not.** Not size, not inline script, not generated
  content, not duplicate ids, not the number of tables. Paged.js fragments a page by making
  `.pagedjs_page_content` a multi-column container whose pitch is the content width plus a gap of
  `margins + bleed + 1000px` — 1816 px on this corpus. Content it fails to move onto a new page
  stays in the second column, one pitch to the right, clipped out of sight by an `overflow: hidden`
  sheet. **6 of 6** failing documents had at least one page carrying a TABLE box there; **0 of 12**
  passing documents did. Two of the twelve carried residue of other kinds — a `<p>`, an `<em>` — and
  measured cleanly, which is why residue alone is reported and not made fatal on its own.
- **Why a table.** `page.pdf()` renders in print media, where Paged.js's own stylesheet re-sizes
  `.pagedjs_page` and `.pagedjs_sheet` to `height: 100%`. The fragmentainer height changes and the
  overflow column is re-fragmented. Ordinary block content reproduces its boxes; a table row cannot
  be split, so it moves back into the first column — and it stays moved. Sampled four times at
  300 ms after the PDF, the layout never returned to its pre-PDF state.
- The PDF reconciliation now reports `render-unstable` rather than an anonymous `checker-crashed`.
  Nothing crashed: the PDF does not reproduce the geometry the rules measured, which is the same
  statement `evidence.ts` already makes about a divergent mark page. The event names the freeze
  components that moved, the individual box entries with both values, and the residual elements with
  their source ids, pages and the column pitch.
- The geometry cross-check names the same cause. Measured on a reduced document: the in-page probe
  and CDP's layout tree disagreed by exactly one pitch, 1816.0000 px against a 0.05 px tolerance,
  and the sentence told the reader that this tool's own probe could not be trusted. It could.
- Added `tests/fixtures/fragmentainer-residue.html`, reduced from one of the six until no product
  text remained: no `@page`, no print stylesheet, no `break-inside`, no script — a default-letter
  page, a 68ch measure and a table that crosses a page boundary. That reduction is itself the
  measurement that nothing exotic is required, and it is what holds this class in CI.
- Added `corpus/public/pagination-residue-v1` as a **hash-only record**. The six documents are
  chapters of a paid product — 27 492 of that bundle's 69 017 words — and this repository is public
  and MIT, so their SHA-256 values, byte lengths, rights and privacy review and exact expected
  residue are public while their bytes are not. This is the `private_nonredistributable` shape
  `docs/validation/corpus-contract-v1.md` already defines: *"a hash-only public record documents
  existence without pretending that an unavailable artifact was verified."* Without
  `BREAKLINT_RESIDUE_CORPUS_ROOT` the gate prints `SKIPPED`, says how many documents it did not
  read, and makes no success claim; with it, nothing is softened — every admitted byte is hashed
  before Chrome starts and the per-document residue pages, counts and pitch are compared exactly.

### Named, with numbers: what a haloed SVG label costs

`env/svg-painted-bounds-unsupported` reads as an environment limit and is not one.
`docs/limitations.md` now carries the measurement: over the same eighteen documents, two chapters
measured 30/30 and 24/24 SVG `<text>` targets at coverage 1, while three declined 15, 17 and 3 —
exactly their count of `<text paint-order="stroke fill" stroke="var(--bg)">`, the ordinary halo that
keeps a diagram label legible over a line. `getBBox()` returns the fill outline, so the tool refuses
to judge an overflow against a box that describes different ink. The named next step is written down
too: the fill box and the fill box inflated by `stroke-width / 2` are a sound two-sided bound, and on
that corpus the halos are 2–4 px, so almost all 35 declined targets are decidable without an ink
pass.


## 0.3.1 — 2026-08-30

The first `v0.3.0` tag run stopped before publication: both clean consumers installed the optional
renderer peers correctly, but the real-document gate started their CLI with the repository checkout
as its working directory. Local and ordinary CI runs inherited the checkout's dev dependencies and
therefore hid that boundary error. Version 0.3.1 makes the child working directory mandatory and
passes it explicitly in the source and both installed-package gates; the failed tag is retained
rather than moved, and no `breaklint@0.3.0` package or GitHub Release was created.

### Real-document robustness before trust infrastructure

- Added a mandatory real-document gate over two frozen, rights- and privacy-reviewed public HTML
  artifacts. The third-party Project Gutenberg document was not authored for this repository; it
  produces exactly 9 pages, measures 9/13 rules and exits 0. The first-party Dargel document
  separately exercises absent-resource packaging: exactly 6 pages, 11/13 rules measured and Exit 0.
  Both admitted SHA-256 values, exact semantic counts and infrastructure contracts are pinned. The
  published 0.2.3 package is the recorded red control: the third-party document ends Exit 3 before
  producing a usable report. CI, the source release gate and both clean installed tarball consumers
  run both documents.
- Fixed the geometry oracle without widening its `0.05 px` tolerance. CDP's four-corner quad is now
  converted to an axis-aligned envelope using all corners; the former shortcut was wrong by 23 px
  on a rotated HTML block. SVG graphics descendants are excluded from the CSS-box cross-check
  because CDP includes stroke/paint extents while `getBoundingClientRect()` reports SVG geometry.
  Authored CSS can likewise reset a source block to an inline formatting box whose child-union has
  different CDP/GCR semantics; that box is excluded while its block children remain eligible. The
  two real corpus SVGs differed by up to 0.5477 px and 3.0656 px, and the third-party HTML exposed
  an 18 px inline-box difference. None was a tolerance problem.
- Standalone `.svg` and every other non-HTML input now fail deterministically with usage Exit 2
  before the renderer starts. Inline SVG in `.html`/`.htm` remains supported by the released SVG
  viewport rule. The previous path parsed arbitrary extensions as `/document.html` and failed late.
- A failed image decode is no longer an anonymous `checker-crashed` when the source explicitly
  declares positive `width` and `height` attributes and the browser measures a box exactly equal
  to both values. It
  becomes the named, non-fatal
  `image-content-unavailable` event with a non-identifying resource index and measured dimensions.
  Absolute file URLs and remote query strings are not persisted in the report. Missing authored
  dimensions, a differing or zero-size rendered box, and authored CSS overrides remain fatal because
  replacement text is not stable image geometry and the absent content can change layout.

### Thirteen released rules, not fifteen advertised definitions

- Withdrew `svg/text-clipped` and `svg/text-ink-collision` from the released registry, CLI config,
  generated schema, SARIF catalogue, community issue form and demo. Production acquisition has no
  ink pass and never wrote `inkCollected: true`; counting both rules was a capability claim over a
  path no document reached. Their modules and 78/78 real-renderer M3 lab remain explicitly
  research-only for a later, separately designed ink milestone.
- Migration from 0.2.x: a config that names either withdrawn rule ID now fails closed as invalid
  usage (Exit 2). Remove those keys; there is no replacement rule until a production pixel pass
  has an independent oracle and real-document coverage.
- Removed all hand-authored ink counts and `inkCollected: true` from the demo snapshot. `--demo`
  now reports seven real rule-chain findings, 13 rules run and 11 rules measured; it cannot display
  an SVG ink finding that live acquisition cannot create.
- Kept every released rule `calibrated: false`. No threshold, severity, structural proof-source-A
  threshold or calibration type changed.

### Plan and public truth

- Split the former parked M3-1 plan: M3-1a covers rights-cleared corpus breadth and acquisition
  robustness and is active before governance; M3-1b retains blind human labels, adjudication,
  external attestation and externally controlled freeze and remains parked. The disabled
  attestation workflow stays disabled.
- Rewrote the current-state section and marked contradictory pre-release passages as historical.
  README, rule docs, limitations and generated schema now describe the same 13-rule,
  0/13-calibrated product contract. The coordinated website copy has a separate repository,
  work item and deployment gate; this package does not claim that deploy before it is live.
- Kept the 0.2.3 human report-surface ledger historical instead of restamping 32 cells without a
  person. The 0.3.1 release gate reconstructs all 32 current cells and verifies 59 physical
  artifacts (24 screens, 4 PDFs, 31 page rasters), decoded pixels, contrast, accessibility, print
  fragmentation and a pixel-mutation red control, while making no human-review claim.

## 0.2.3 — 2026-08-29

Released from annotated tag `v0.2.3` after the independent verifier passed the complete state with
no open Blocker/High finding. The Founder reviewed and accepted the 21 changed rendered views and
the complete PDF set, and the ledger is bound to that review. The tag workflow exercised one
checksum-bound tarball in clean Node 22.13.0 and Node 24 consumers before publishing those exact
bytes to npm with signed provenance and attaching them to the GitHub Release.

### Any document with an inline SVG can be checked

- **Fixed: a single inline `<svg>` made a document uncheckable.** The snapshot collector marked
  every SVG unmeasurable with `env/pixel-oracle-unavailable`; `svg/text-overflows-viewport` had
  not declared that reason, and an undeclared decline is a fatal `checker-crashed` — exit 3 on a
  clean two-page document holding one harmless label. Isolated at a minimal fixture: with the SVG,
  exit 3; without it, exit 0. Nothing in the suite reached the case, because not one live fixture
  contained an `<svg>`.
- **`svg/text-overflows-viewport` now measures.** SVG text geometry is collected as `getBBox()`
  normalised through `getScreenCTM()`, using all four transformed corners — under a rotation the
  min/max over one diagonal understates the extent in both axes, and this rule compares extents.
  The primitives are the ones captured before any author script runs. `svgRootKey`/`svgTextKey`
  existed unused and are now the identity of every target, joined in Node so no hash is computed
  inside the document under test.
- **Two decline classes left the coverage base.** `TOOL_CAPABILITY_ENV_IDS` names measurements
  this build cannot take; `NON_APPLICABLE_ENV_IDS` names questions that do not arise for a target
  (`overflow: visible`). Both stay in `notMeasured` with rule, reason and count; each rule's own
  measured-plus-declined-equals-candidates check still runs first. A decline naming a property of
  the INPUT still counts, which is what exit 4 is for, and `tests/unit/coverage-base.test.ts`
  holds both halves of that pair.
- **`inkCollected` separates two states the ink rules were conflating**: passes that do not exist
  in this build, and passes that ran and disagreed. They reported the second while the first was
  true. Snapshot schema 2 → 3; report schema unchanged at 3.
- **Failures are per target, not per SVG.** One unreadable `<text>` used to mark its whole SVG
  unmeasurable, discarding every box already measured there and taking an error rule with a
  coverage floor of 1 to exit 4. `unreadableTargets` (laid out, no readable box — counts against
  coverage) and `notRenderedTargets` (never laid out — not a target at all) replace that.
- **An element that is never painted is not a target.** Chrome answers `getBBox()` and
  `getScreenCTM()` for a `<text>` inside `<defs>` and yields a box 609.65 px outside the viewport,
  which a gating rule reported as an error about something nobody can see. The collector now asks
  `getBoundingClientRect` first. Found by building the fixture, not by reading the code.
- **Two identical labels are ambiguous, not identical.** Findings on `<text>` elements sharing one
  content-derived identity carry `ambiguity.groupSize` instead of quietly claiming to be one.
- **The live corpus now holds an inline SVG.** `tests/fixtures/svg-text-geometry.html` carries
  seven figures with seven different answers — inside, outside, rotated-out at 90 and at 45
  degrees, painted-anyway, a `<defs>` element that is not a target, and four ways to be laid out
  and still invisible — and `svg-in-viewport.html` carries the sound document that must end
  exit 0. Both run in the M2d live chain. Five of those cases exist because three independent
  reviews found the earlier ones insufficient; the 45-degree case is what binds the four-corner
  claim to a number.
- **A document whose SVGs are all inside their viewports has a fixture at last.**
  `tests/fixtures/svg-in-viewport.html` ends exit 0 — the claim this release is about, which no
  test held until a second independent review pointed out that the only SVG fixture ends exit 1
  by design and therefore cannot show that a sound document passes.
- **Three more ways to report a defect about something nobody can see, all closed.**
  `visibility: hidden`, `opacity: 0` and `fill: none` lay out normally and return a full client
  rect, so painting is now read from the computed style as well; a nested `<svg>` had its text
  collected twice and compared against the outer viewport; and the ambiguity group is counted
  across the document, because two structurally identical SVGs share one identity by design and
  the group was reported as 1 for exactly that collision.
- The stored demo snapshot moved to schema 3 with the new fields; `reason` is `null` rather than
  absent so it survives the JSON round trip the receipt schema requires; every `reviewedAt` in
  the report-surface ledger is the date of the review that actually happened, with the transfer
  in a field of its own.
- **Findings carry the page they are on.** All three SVG rules got it wrong: one looked the SVG's
  `nodeKey` up among the BLOCK keys, which never match, and fell back to page 1; the other two
  wrote `page: 1` outright. Nobody had noticed, because the gating rule had never produced a
  finding for anyone to read. The page is now a field on the record, set by the collector.
- **Complex SVG geometry now fails closed instead of guessing.** Text instantiated through
  `<use>`, paint bounds changed by clip paths, masks, filters, paint servers, text decoration or
  visible stroke, and SVG roots or transformed ancestors whose box geometry makes
  `getBoundingClientRect` a different box from the viewport are explicit coverage-relevant
  declines. They therefore end an error-rule run in exit 4 instead of disappearing as a silent
  false negative or becoming a false error finding. Solid fill text in an ordinary viewport
  remains measurable; alpha-zero paint is correctly excluded as not rendered.
- **The 500-target cap now counts potential paint targets, not definitions.** A separate 5,000
  element raw-DOM ceiling bounds classification work, while 501 never-instantiated `<defs>` texts
  beside one visible label no longer make the SVG unmeasurable.
- No threshold, severity or `calibrated` flag changed, and no rule was added or removed. The ink
  passes remain unimplemented (M3), so `svg/text-clipped` and `svg/text-ink-collision` still
  measure nothing — they now say so instead of ending the run. README, `docs/status.md`,
  `docs/limitations.md` and all three SVG rule pages state that plainly for the first time.

## 0.2.2 — 2026-08-26

Released as tag `v0.2.2`; this heading replaces an "Unreleased / planned patch version 0.2.2"
block that was never renamed when the tag went out.

### Verification truth and calibration safety

- Corrected the shipped Unit-test figure from the former 439-test Unit + E2E aggregate to the
  current measured 336-test Unit-only denominator. `npm test` now preserves the current 444-test
  aggregate and Unit-only run as separate TAP artefacts, so the
  CI documentation guard measures the field it names instead of accepting the aggregate by mistake.
- Retired executable SVG-source packets v1/v2 from new human annotation sessions after the
  preregistered repeated-channel stop criterion fired. A raster-only packet-v3 schema now requires
  declared renderer, asset/font, viewport, raster and blocked-fetch-positive-control bindings, while
  the real annotation CLI retires all legacy packet/pipeline creation and verification seams, the
  generic file-writing legacy pipeline module is removed, and v3 stays blocked until those
  declarations have an external verifier; no v3 renderer, packet, calibration or human annotation
  is claimed yet.
- Repaired historical v2 reconstruction without changing frozen bytes: URL targets are checked before
  the independent parenthesis balance; reference discovery, namespace/ID inspection and rewriting use
  parsed elements with located attributes rather than matching the whole document string; attribute
  stripping can no longer cross quoted markup boundaries; unknown namespaces are refused on opening
  and closing tags; and one-pass, Unicode-aware reference rewriting keeps prefix-equal IDs distinct.
  All three same-document `url()` quoting forms are asserted.
- Closed the physical right edge of every print coverage card. Chrome reported the declared border in
  computed style but omitted it from paged PDF output around the float-based print layout; a tokenized
  child-border edge now survives rasterization without depending on printed backgrounds; a separate
  background-disabled A4 probe verifies that property on both the ordinary and strong-left-border
  variants. Independent renderer/verifier passes require all 15 cards in each report state to have complete
  visible left and right edges. Whole-edge, one-sided partial-edge and simultaneous two-sided
  partial-edge mutations run as genuine expected-red CI subprocesses and must all fail for the
  measured side or sides.

## 0.2.1 — 2026-08-25

### Real-corpus validation infrastructure

- Added a public, rights- and privacy-reviewed process-pilot corpus with immutable document and
  rule-target hashes, origin-strict development/tuning/holdout assignments, a blind annotation
  packet, a holdout freeze projection and deterministic verification reports.
- Added fail-closed contracts and checks for source intake, human identity separation,
  multi-valued annotation and adjudication, split leakage, external freeze receipts and
  GitHub-OIDC/Sigstore-backed attestation verification. Local fixtures and caller-supplied trust
  material cannot create claim readiness.
- Added a machine-readable bridge to the existing M3-0 readiness vocabulary. It records the
  verified intake and split facts while keeping every calibration, capture and claim gate false
  until the missing renderer, oracle, human annotation, external receipt and acceptance evidence
  actually exist.
- This infrastructure changes no runtime rule, threshold, severity, package version or published
  surface. All fifteen rules remain `calibrated: false`; no calibration claim is authorized.
- Community intake now screens the issue TITLE as well as the body for credential patterns; a hit in either field
  classifies the report `sensitive-warning` and the public dashboard replaces the title with
  `Sensitive content withheld`. Markdown escaping is not redaction, so the title is withheld rather than escaped.
- Added blind packet v2 with deterministic SVG metadata sanitization, fail-closed content checks,
  independently reconstructed context bytes, target-set commitments and custodial neutral-order
  verification. Packet v1 and its freeze remain unchanged historical evidence; the linked local
  sequence-2 freeze is not an external receipt or authorization for human annotation.

### Open community QA intake

- Added an open, unpaid community-testing guide and structured GitHub intake for public or
  disposable reproductions. No application or tester selection is required.
- Added a data-only intake classifier and dashboard workflow. Submitted content is never executed;
  reports with missing declarations or sensitive-data patterns fail closed into explicit labels.
- Governed sections now have exact cardinality and normalization-aware duplicate detection;
  sensitive-input detection covers unquoted/provider/auth/URL/token forms without echoing payloads.
- Community reports remain non-blind product QA. They are not human calibration annotations,
  external holdout receipts, trust roots or authority to change thresholds, version or release.

### Reproducibility and dependency disposition

- Live measurement reports now create missing parent directories before their atomic partial-file
  write, so the documented fresh-checkout command works without pre-created local state.
- Documentation figures in `docs/status.md` carry a machine-readable marker, and a drift guard
  (`tests/tools/documented-figures.mjs`) compares it against separate measured Unit and aggregate
  TAPs, the accepted structured live-test denominator, live-report shape and both S1 raster oracles.
  `npm test` preserves `.tmp/unit.tap` and `.tmp/test.tap`; the live CI and release steps atomically
  write the structured verdict and measured browser report, then invoke `npm run test:documented-figures`
  against the real `docs/status.md`. The synthetic unit test remains the negative-control harness,
  while the release gate now rejects stale published figures from measured evidence.
- Paged.js 0.4.3 remains pinned after review: the obsolete polyfill chain is not reached by the
  measured browser-bundle path and no known advisory was found. The risk acceptance expires on
  2026-11-24 or earlier on an upstream, advisory or integration trigger.

## 0.2.0 — 2026-08-22

### Configuration Contract v1

- Configuration is now fail-closed: unknown top-level fields, profiles, rules and rule options,
  invalid types or ranges, proof-source-A overrides and lowered coverage floors end with exit 2
  before any input document is opened.
- `default` and `strict` are real profiles. Resolution is defaults < profile < config < CLI;
  `strict` gates warnings and requires full coverage for every active rule. A later
  `--profile default` cannot weaken a strict config-file floor.
- Coverage floors may be raised or kept equal, never lowered. The same resolved floor is passed to
  the engine and recorded in the report.
- Canonical JSON reports use schema 3 and carry Configuration Contract version 1, every effective
  value, provenance for every leaf and a deterministic SHA-256 fingerprint. Stored snapshots stay
  on schema 2 because their format did not change. The selected preset is reported with its source
  but excluded from the semantic hash, so a fully expanded equivalent config hashes identically.
- `breaklint.schema.json` is generated from the same rule registry as runtime validation, shipped
  in the package and guarded against drift during tests and `prepack`.
- The misleading type-rule option `excludeSelectors` is replaced by `excludeTags`, matching its
  actual HTML-ancestor-tag semantics. Tag names are validated, lower-cased and deduplicated.
- A short repository constitution in `AGENTS.md`, the full contract in
  `docs/configuration.md`, process-boundary CLI tests and independent fingerprint reproduction
  document and enforce the new trust boundary.
- The packed-consumer gate now runs the complete config contract on Node 22.13 and Node 24:
  exported schema, valid report, provenance, independent hash and four fail-closed controls.

### Live-gate truth

- The live runner now consumes structured `node:test` failure events. A suite-level `after`-hook
  failure can be printed as `not ok` while Node still exits 0 and reports zero scalar failures;
  that state no longer promotes a measurement report.
- A failed rerun removes both its partial report and any stale report already present at the
  explicitly requested output path, so an older green artefact cannot survive under a red run's
  name.
- Renderer cleanup now has one shared ownership order for the product path and the live evidence
  harness: the rasterizer target receives a bounded head start before browser-wide shutdown. This
  removes the race between `Target.closeTarget` and `Browser.close` without suppressing lifecycle
  errors.
- Deterministic regressions cover both the cleanup order and a green test body followed by a red
  suite hook.
- The deliberately blocked R6 rasterizer probe now owns a sacrificial browser process and joins
  its pending CDP operation before exit. The live runner also isolates every live file: it accepts
  only one structured top-level suite pass, the exact 18/7/7/25 leaf denominators and zero
  fail/skip/cancel/todo events. A process that lingers after that complete verdict is terminated
  only after a bounded natural-exit grace; an early exit, wrong denominator or after-hook failure
  remains red.

### HTML Report Surface v2

- The HTML report now has four status-true states: clean, blocking findings, checker failure and
  insufficient coverage. Exit 3 and 4 explicitly say that the run is not clean.
- Findings use semantic vertical articles instead of a wide table. Severity, rule, document,
  source, measurement, threshold, calibration, proof source, evidence and ambiguity remain
  available at mobile widths and in A4 print.
- Light, dark and print consume one token layer. The report remains script-free, self-contained
  and offline; only tool-shaped relative evidence references become links.
- A deterministic render gate covers 24 screen surfaces, four A4 PDFs and four independently
  rasterized PDF page sets. It checks layout invariants, real computed WCAG AA contrast, hashes,
  dimensions and a 32-cell visual review ledger without using volatile container-byte equality as
  a portable oracle.
- The human-review pass is bound to a SHA-256 fingerprint over 47 current inputs, the exact
  browser/platform/render environment and independently reconstructed stable fingerprints for all
  32 cells. Exact PNG/PDF hashes remain the audit trail of the 62 files actually reviewed; visible
  PDF equivalence is bound to all 34 independently rasterized pages. A real temp-copy source
  mutation invalidates the old pass, and an unreviewed fingerprint fails with all cells pending.
- Checker-failure reports never call partial measurement trusted coverage. Existing counts remain
  visible as partial evidence under `Not trustworthy`.
- breaklint now checks its own final HTML report through the real browser, paginator, evidence and
  both proof-source-A rules. A deliberately oversized unbreakable finding card is the red control.

### Release integrity and runtime

- The supported runtime starts at Node 22.13 and is tested again on Node 24. The browser peer is
  `puppeteer-core >=25.8.0 <26`; both the runtime and full development graphs audit to zero known
  advisories after removal of the vulnerable `extract-zip` chain.
- Gitleaks 8.30.1 is checksum-pinned. CI and release scan complete history and the worktree, then
  prove the scanner with generated secret and absolute-home-path canaries.
- The release workflow creates one tarball, binds it with SHA-256 and SHA-512 SRI, gives those exact
  bytes to both clean consumers and npm, verifies registry integrity, and attaches the package plus
  checksums to the GitHub Release. An annotated tag must equal `package.json`, resolve to
  `origin/main` and have a successful main CI run for the same commit before publishing; a real Git
  process-boundary canary proves that a lightweight tag is rejected before the ref is peeled.
- The paginator is installed over the browser-driver boundary after authored loading. This lets
  breaklint inspect CSP-bearing HTML without disabling the document's CSP and changing author
  script semantics.

## 0.1.0 — 2026-08-14

First published version. What it is: a measurement chain that runs end to end and states, in every
finding, what it measured and against which threshold. What it is not: a calibrated instrument. No
threshold in this release has been checked against a corpus of real documents with human-labelled
truth, and `uncalibrated` therefore appears in the type, in every finding and on every rule page.

### The check itself

- Fifteen rules as pure functions over a snapshot, with a mutation guard that kills every mutant
  on a fixture that actually triggers the rule.
- Two rules can fail a build by default, twelve are advisory under `--fail-on warn`, and
  `layout/half-empty-page` is experimental and never moves an exit code.
- Six output formats — json, sarif, console, html, junit, markdown — each carrying every mandatory
  counter, including on a clean run.
- Exit precedence with a 28-row matrix over all five exit codes, asserting exit code, verdict and
  gate reason together.
- `npx breaklint --demo` runs the real rule and reporter chain over a stored snapshot: exit 1,
  eight findings across seven rules, no browser required.

### The live path

- A run over real HTML loads each document from an owned loopback origin, enforces the renderer
  and paginator gates, waits at the resource boundary, paginates, collects and validates the
  snapshot, runs the rule engine and attaches the evidence outcome to the report.
- Paged.js is pinned to exactly 0.4.3, because the break cause is read from attributes the
  paginator writes into the tree and does not guarantee as an interface. Any other resolved
  version stops the run with exit 3, and no flag overrides that.
- `checker-crashed` is a real fault path, not a placeholder: driver resets, injected boundary
  failures, apparatus races and unverified cleanup all produce it and are exercised by the exit
  matrix.
- The document is loaded by navigating to a loopback origin rather than via `setContent`, and both
  reasons were measured rather than assumed.

### Evidence

- `pdfjs-dist` rasterises the produced PDF on a second page of the same browser instance, served
  over a loopback origin, so no browser-wide file-access switch is needed.
- Invisible marks are placed after pagination, and the binding is decided by comparing the marked
  PDF against a baseline PDF taken BEFORE the overlay existed — not by detaching it again, because
  a document that mutates itself when the layer arrives leaves that change in both PDFs.
- Verified against real Chrome, real Paged.js, and poppler as an independent rasteriser.
  `npm run test:live` fails rather than skips when a prerequisite is missing.
- Not every infrastructure event ends a run. `mark-style-overridden` and `mark-raster-diff` mean
  the evidence was lost, not that the document could not be measured; a page whose own marks all
  miss does end it.
- The `Δy` reference is bounded, not only the residual around it. A displacement shared by every
  mark on a page was previously invisible by construction — the reference absorbed it, and the page
  reported a maximum deviation of zero for a displacement of any size.
- Declaring a page divergent, which ends the run, needs three refound pairs rather than two. At two
  a median is a mean, so one extraction outlier beside one correct mark aborted the run on a sound
  document. A two-pair page that binds nothing is `unverified` instead.

### The apparatus was measuring its own footprint

- **Evidence binding never worked on Linux, and the first public CI run is what said so.** (The
  fix below is measured in a Linux container, not yet on the x86_64 CI runner — the numbers
  reproduced there within a few pixels of the runner's, which is what identifies the mechanism,
  not what closes the platform.) The
  marks are text, and text pulls glyphs from a font. Set in the same font as the document's own
  prose, the marks ENLARGED the font subset Chrome embeds — measured on the neutral fixture,
  17 584 bytes of font program against 15 508, different hash, same name. A different font program
  rasterises differently: pdfjs, which installs embedded fonts through the browser's own text
  machinery, reported 1116 differing pixels between the marked PDF and its baseline, while poppler
  reported 0 on the same two files. The overlay check read that as contamination and withheld the
  evidence for every document. The pixels were never in the document; they were the shadow of the
  measuring apparatus.

  The marks now have a font of their own — seventeen characters, one rectangle each, generated by
  `tools/make-mark-font.mjs` and carried as a constant. It cannot enlarge anyone's subset because
  no document will ever set type in it.

- Two things about that font were wrong on the first attempt, and both are worth keeping:

  Its glyphs were empty, which looked strictly better — invisibility that does not depend on a
  colour a hostile stylesheet might reach. Chrome emits no drawing operation for a glyph with
  nothing to draw, so the font never reached the PDF at all, the tokens vanished from the text
  stream, and not one mark bound. The raster comparison went to a perfect 0 while the evidence
  went to nothing, which from the outside is indistinguishable from success.

  And it was registered by the overlay, through a `<style>` element. That is a new node in a
  document that has already been measured and frozen, which is exactly what this product's own
  tamper detection exists to catch — nine cases of the live chain went red, correctly. Moved to
  the FontFace API it stopped being a node and started being a resource load, which the network
  guard refused, also correctly. It now goes in with the rest of the apparatus, before the
  document exists. The apparatus does not get an exemption from the rules it enforces.

- **The readback measures that the font arrived, rather than trusting that it did.** With the
  registration removed, the computed `font-family` still reads back as ours while the glyphs come
  from somewhere else — measured at 5.13px for a nine-character token instead of 9px. The advance
  width is what catches it, and a mark font that did not arrive now drops the binding instead of
  quietly reporting the old wrong number.

- **A blank-page assertion was measuring one platform's line breaking.** Every evidence page had
  to carry more than 500 inked pixels or the rasteriser was declared broken. On Linux, Liberation
  Serif is wider than the macOS serif these fixtures were written against, so a fixture paginates
  to three pages and the third holds the two words that no longer fit: 169 pixels, and a green
  suite turned red for a document that was fine. The threshold is gone. A sparse page is now
  allowed exactly when poppler — which shares no code with the product — finds it sparse too, and
  a page that is blank here and inked there still fails, which is the case the check exists for.

### Gates that were missing and are now there

- **The tool now runs when it is installed.** npm links a `bin` as a symlink, so node is handed
  the link path while the module reports the path of the real file. The entry guard compared the
  two with `path.resolve`, which never touches the filesystem — so every installed copy did
  nothing at all: no output, no findings, exit 0. For a checker that is the worst available
  failure, because a build gate reads exit 0 as a clean document. Both sides are resolved through
  the filesystem now, and the gap that hid it is closed at two levels: an end-to-end test invokes
  the CLI through a symlink on the SOURCE, which reproduces the mechanism on every `npm test`, and
  a CI step packs the tarball, installs it into a foreign directory and runs `npx breaklint` there
  — which is the artefact and the path a user actually takes. The first alone would not have
  caught it in the form it shipped; saying otherwise was the same mistake one level up.

- The reason reported for an exit names the event that caused it. A run without a snapshot used to
  name whichever event arrived first, so a fatal exit could be attributed to a kind that cannot
  cause one.
- Every infrastructure kind has its fatality asserted individually, against a list written out in
  the test rather than derived from the list under test.
- `package.json` no longer lists files that do not exist, and a test checks that it cannot.

### Known limits in this release

- No threshold is calibrated. The implementation is verified, not validated.
- Windows is not supported; process termination rests on POSIX process groups. The termination and
  profile-cleanup path is measured on macOS, and an equivalent Linux measurement is still missing.
- Input identity is bounded: the report records the HTML hash, observed resource status, bytes,
  hashes and redirects, renderer and platform data and resolved font families, but not
  platform-stable system font identifiers.
- SVG ink passes against the real renderer, and the wider corpus work, are unfinished.
  `docs/status.md` states what has been measured and what has not.
