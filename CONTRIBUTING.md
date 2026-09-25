# Contributing

## Adding a rule

Three files, and a test enforces all three:

1. `src/rules/<namespace>/<name>.ts` — a pure function over the snapshot.
2. A trigger fixture and at least one clean fixture in `tests/fixtures/corpus.ts`.
3. `docs/rules/<namespace>-<name>.md`.

## Two rules about tests

**Every fixture names its complication.** A fixture without the case that breaks the naive
implementation tests the naive implementation. The `complication` field is not documentation,
it is the reason the fixture exists.

**A mutant counts as killed only when an assertion on (count, rule id, target) fails.** An
assertion on the threshold alone kills two of five mutants, and the three survivors are the
dangerous ones: a rule that emits nothing, a rule with an inverted comparator, and a rule that
attributes its findings to the wrong id.

## Severity

A rule may carry `error` only with a named proof source. There are three classes — a geometric
invariant between two directly measured quantities, a cited norm together with the cases it does
not cover, and a resolution invariant — and they are defined in
[`docs/limitations.md`](docs/limitations.md). Both document-profile error rules are class A; no rule claims
B or C.

`defineRule` rejects `error` without a proof source, and rejects a proof source on anything that is
not an error. The registry refuses to load if the number of error rules is anything other than two,
and its message points at `docs/limitations.md`, where the argument for the number belongs. The
check does not read that file — it only makes the change deliberate, so write the argument before
you change the literal.

## Changing configuration

Configuration has one runtime source: rule ids, option names, option types and defaults come from
the rule registry. `breaklint.schema.json` is generated from that same registry. Do not add a
second hand-written option table or edit the generated schema directly.

Every public config field needs all of these in the same change:

1. fail-closed runtime validation, including unknown-key and wrong-type controls;
2. an observed effect in the engine or acquisition path;
3. one source entry for every effective report leaf;
4. deterministic normalisation before fingerprinting where order is not semantic;
5. a process-boundary exit-2 test and a positive behavior test;
6. an update to [`docs/configuration.md`](docs/configuration.md) and the changelog.

Run `npm run schema:write` after the registry changes and `npm run schema:check` before review.
Report and snapshot schema versions are separate: raise only the artifact whose structure changed,
and add a migration assertion for that artifact.

## Corpus gates

`.github/workflows/ci.yml` is the executable gate inventory; this section only says what the two
corpus gates need to run locally.

- `npm run test:real-document` — the admitted robustness corpus (`corpus/public/robustness-v1`),
  exact semantic reports of two published documents. Needs `npm run build` and a browser.
- `npm run test:corpus` — the self-authored closed-world corpus (`corpus/public/selfauthored-v1`).
  It verifies every file of the manifest by SHA-256 and length, runs each of the twenty documents
  through the built CLI in its own invocation under the default profile, and judges the JSON report
  against the frozen ground truth exactly as the corpus README's gate procedure defines it: exit
  set, page range, `mustFire`, `mustNotFire`, the closed world (a finding no entry accounts for
  fails), declines by count and the `measuredAlternative` all-or-nothing rule, and every expected
  file against the README's closed field list. It prints one row
  per document and exits 0 only when every document passed. Needs `npm run build` and a browser in
  which evidence binding works; `--no-evidence-binding` exists for local diagnosis on a renderer
  that cannot bind evidence, labels the run as not the gate, and is not used in CI. Its matcher and
  every fail-closed path are unit-tested on synthetic reports in `tests/unit/corpus-gate.test.ts`.

The truth under `corpus/public/selfauthored-v1/expected/` is never edited to make the gate pass;
the corpus README ("Changing the truth") says how an expectation that turns out to be wrong is
corrected, with a dated `expectationHistory` entry.

## Public consumers and source contracts

A public API change needs a packed installation check, including actual Playwright `Page` TypeScript assignability and rendered evidence copied from the installed package. Keep the document report, the measurement snapshot, the agent context pack, the report comparison, the configuration contract, the declared source manifest and the screen report distinct: each carries its own version stamp and moves only when its own structure changes. The current stamps are listed in [`docs/source-bound-findings.md`](docs/source-bound-findings.md), and `tests/unit/docs-truth.test.ts` fails when a shipped document or this file names a stamp that the freshly built package does not carry — unless that one mention is stated as history within its own sentence: an arrow on it ("Report 4 → 5"), a released version joined to it by "from", "until", "since" or "before", by "in" plus a transition verb, or by a transition verb such as "becomes", "moves", "stays" or "migrate" between the version and the mention; "legacy" directly before it; or the exact readable set ("readers accept Report 4 and 5"). This is a heuristic over English, not a parser: a sentence can take one of those forms and still be wrong, and a stamp named in a shape no pattern reads is not seen. The complete grammar and its known limits are in the header of `tests/tools/docs-truth.mjs`. A mention another change is still correcting may be listed in `tests/tools/docs-truth-pending.jsonl` on a pull request; the release workflow refuses any entry there. Source identities are not selectors; a unique author anchor and verified capture history are required for repair comparison. Tests must retain explicit nonmeasurement and genuine counterexamples for source mismatch, missing evidence and reduced coverage.

## The complete local gate

This is the gate `AGENTS.md` refers to. It is `.github/workflows/ci.yml` in the order CI runs it,
and `tests/unit/workflow-gates.test.ts` fails when the `npm run` steps below and the workflow's
disagree. Run it from a clean checkout on Node 24 with all live prerequisites present: Chrome,
poppler's `pdftoppm`, python3 with `fontTools`, gitleaks 8.30.1 on `PATH`, and network access for
the advisory audit and the packed-consumer install.

```bash
npm ci --no-audit --no-fund
npm run test:secrets
npm run test:release-tag
npm run test:advisories
node tools/make-mark-font.mjs --check
npm run typecheck
npm run schema:check
npm run docs:rules:check
npm test
npm run test:mutants
npm run test:licenses
BREAKLINT_LIVE_REPORT=.tmp/live-report.json BREAKLINT_LIVE_SUMMARY=.tmp/live-summary.json npm run test:live
npm run test:documented-figures
npm run build
npm run test:real-document
npm run test:report-surfaces:technical
npm run test:report-surface-mutants
npm run selfcheck
```

CI then checks the packed package, which no command above sees: it runs `npm pack`, installs the
tarball into an empty directory, and there requires `npx breaklint --version` to print the
`package.json` version, `npx breaklint --demo` to end with exit 1,
`tests/tools/readme-demo-contract.mjs --consumer .`,
`tests/tools/docs-truth.mjs --package node_modules/breaklint --pending tests/tools/docs-truth-pending.jsonl`
and `tests/tools/installed-config-contract.mjs` to pass, and — after installing the three renderer peers — `tests/tools/real-document-gate.mjs`
against the installed `dist/cli/index.js`. A second empty directory without the peers must end a
real run with exit 3 and an install command. The `node-floor` job repeats the packed checks on Node
22.13. Read those steps in `ci.yml` rather than a copy here.

Run `npm run docs:rules:write` after changing any rule's advice; `docs:rules:check` is the
generator's own drift check, and `tests/unit/registry.test.ts` repeats it inside `npm test`.
Read every exit code directly after its command: in `npm test | tail`, `$?` is the exit code of
`tail`.
