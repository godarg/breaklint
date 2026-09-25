# Releasing breaklint

Releases are published by GitHub Actions from an annotated version tag. A laptop never runs
`npm publish`. The tag starts the proof; it is not accepted as proof by itself.

## Release contract

For a release `X.Y.Z`, all of the following must refer to the same commit and the same package
bytes:

1. `origin/main` and annotated tag `vX.Y.Z`;
2. the successful `ci.yml` run queried by commit SHA;
3. the one tarball created by the release workflow;
4. both clean consumers, on Node 22.13 and Node 24;
5. npm `breaklint@X.Y.Z` and its `dist.integrity`;
6. the tarball and checksum files attached to the GitHub Release.

Any mismatch ends the workflow before or immediately after the outward action. A failed registry
verification is not called a successful release even if npm accepted the upload.

The public `v0.3.0` tag is a failed pre-publish attempt and must not be moved or reused. Run
`33317007301` stopped in both clean-consumer jobs before npm publication and before GitHub Release
creation because their real-document child process inherited the checkout CWD. Version 0.3.1 is the
published repair from this change set and binds the child CLI to the actual consumer CWD. Release
run `33320332110` completed the Node 22.13/24 consumer matrix, npm provenance verification and
GitHub Release creation on 2026-08-30.

0.6.0 is a minor pre-1.0 release by the same test this document applied to 0.5.0: the canonical
document report changes structure, so its stamp moves. In 0.6.0 Report 4 becomes Report 5 with the
optional `Finding.remediation`, and the agent context pack becomes 2 with one new required key and three new
finding-card keys. Snapshot stays 4 and Configuration Contract 1 is untouched. Readers accept
Report 4 and 5, so a stored artefact does not have to be migrated — but an optional property does
not let a schema-aware consumer distinguish the two shapes, and that is what a version is for.

0.5.0 is a minor pre-1.0 release because live document output moves to Report 4 and Snapshot 4,
and the installed package gains public producer, screen, comparison and report-bundle APIs.
Configuration Contract 1 remains separate and unchanged. Consumers of Report 3 must migrate when
adopting 0.5.0;
source identity, declared provenance and verified original positions are separate fields.
The screen report is its own version-1 contract and contains no document-page semantics.

The clean consumers also run `tests/tools/installed-api-contract.mjs` with their own installed
package: ESM, Node require(ESM), strict TypeScript, a real existing Playwright page and canonical
report-bundle output. Renderer peers remain optional for screen-only consumers.

## One-time repository prerequisites

- GitHub repository secret `NPM_TOKEN`, scoped to publishing this package.
- GitHub Actions allowed to request an OIDC identity token for npm provenance.
- The default branch is `main`; `ci.yml` runs on every push to it.

Never put the npm token in a file, a command-line argument, a log or a Markdown document. The
workflow passes it as `NODE_AUTH_TOKEN` only to the publish step.

## Before creating the tag

Run from a clean checkout on Node 24 with all live prerequisites present — Chrome, poppler's
`pdftoppm`, python3 with `fontTools`, gitleaks 8.30.1 on `PATH` and network access — in this order,
which is the order `.github/workflows/ci.yml` runs them in (`tests/unit/workflow-gates.test.ts` fails
when the `npm run` steps below leave out or reorder one of CI's):

```bash
npm ci --no-audit --no-fund
npm run test:secrets
npm run test:release-tag
node tests/tools/registry-provenance-contract.mjs --self-test
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

`npm run build` comes before `test:real-document` because that gate runs `dist/cli/index.js`: in
the other order a clean checkout fails, and a used one tests a stale build. The registry-provenance
self-test runs in the release workflow rather than in `ci.yml`.

Then check the packed package the way CI does, because none of the commands above sees it:

```bash
repo=$PWD
tgz=$(npm pack --silent)
consumer=$(mktemp -d) && cd "$consumer" && npm init -y > /dev/null
npm i "$repo/$tgz" --no-audit --no-fund
npx breaklint --version                                  # prints the package.json version
npx breaklint --demo > demo.out; echo "exit $?"          # exit 1
node "$repo/tests/tools/readme-demo-contract.mjs" --consumer .
node "$repo/tests/tools/docs-truth.mjs" --package node_modules/breaklint --pending "$repo/tests/tools/docs-truth-pending.jsonl"
node "$repo/tests/tools/installed-config-contract.mjs"
npm i --no-audit --no-fund --save-exact pagedjs@0.4.3 pdfjs-dist@6.2.108 puppeteer-core@25.8.0
node "$repo/tests/tools/real-document-gate.mjs" --cli "$PWD/node_modules/breaklint/dist/cli/index.js" --cwd "$PWD"
cd "$repo"
```

Two of these need the tap and summary files the runs before them write, and are therefore easy to
skip in a hand-built chain: `test:documented-figures` reads `.tmp/unit.tap`, `.tmp/test.tap` and
the two `.tmp/live-*.json` files, so it only says anything after `npm test` and `test:live` have
both run. On 2026-09-18 a local chain omitted it and CI caught the drift instead — the gate worked,
the chain did not. And when a step in such a chain is piped (`npm test | tail`), `$?` is the exit
code of `tail`: read every return value directly after its command.

The technical surface gate reconstructs and verifies every current cell without claiming a human
look. `npm run test:report-surfaces` is the separate exact-environment human gate. It must stay red
when the bound inputs changed and no person reviewed the new artifacts; never refresh its ledger as
release ceremony. A real later review is recorded as a new round with its actual reviewers, date and
outcome — `pass` or `fail` — and only a passing latest round in which a rostered human role
(`@Brand`, `@Neo` or `@Founder`) passed every cell, bound to the exact current inputs, turns the
gate green. An agent's review may be recorded in a round, by kind and model, and never passes a
cell; the roster itself changes only by a reviewed code change (`docs/reporting.md`).
<!-- human-review-roles: @Brand, @Neo, @Founder -->
The roster check proves only that a rostered handle was written into the ledger; it does not
authenticate a person. Whether a rostered human really reviewed rests on repository access control
and on reviewing the ledger diff before it merges — check who committed it and that the round's
cells name the artifacts actually rendered — not on this gate.

The ledger is bound to the 0.2.3 input fingerprint from 2026-08-29. It was therefore red for
0.3.0, 0.3.1, 0.4.0 and 0.5.0 without anyone noticing, because CI runs the technical mode, which
skips the comparison by design. A gate nobody reads is a gate that rots.

**For 0.6.0 the review was actually carried out, on 2026-09-18, and it did not pass.** Two reviewers
looked at the current surfaces — the rendered screens across four report states, two themes and
three viewports, and all four A4 PDFs — and returned **FAIL** with one blocker, three high and four
medium findings. Nothing they found is caused by 0.6.0; it is the first honest inventory of a
surface that had gone four releases unexamined. The headline items: three of the four PDFs contain
pages filled to 29–45 %, the printed clean state loses its findings section and its footer
entirely, printed pages 2 onwards carry no page number or running head, the display and body font
stacks collapse to the same family on a Linux CI container, and six of the thirty-two cells — the
mobile screens — are rendered as single 390 x 15 000 px strips that no reviewer can actually judge.

The ledger was therefore **not** rebound. Binding it would have recorded a review outcome that did
not happen, which is the one thing this gate exists to prevent. The ledger format of the time
(schema 4) could not hold a failed review at all; since schema 5 the 2026-09-18 FAIL is round 2 of
the ledger itself, marked as a historical reconstruction from this record and carrying only what is
stated here — date, outcome, scope, finding counts and headline findings, with no reviewer handle,
per-cell outcome or binding invented after the fact (see `docs/reporting.md`).

**That leaves 0.6.0 in a third state this document did not provide for, and the decision to ship in
it was taken deliberately.** The release plan for this version pre-registered exactly two
acceptable endings for this gate — green, or struck from this document — and said in as many words
that a third is not a result. 0.6.0 ended in the third: red, reviewed, neither bound nor struck.
Decided by @Neo under the owner's delegation of 2026-09-18, on the ground that striking a gate in
the same run in which it produced eight findings would remove the one assertion that had just
proved its worth. It is recorded here as an override of a stop condition, not as a variant of
meeting it.

For the next release the choice is the original two, and it has to be made before the tag: either a
review that passes and rebinds the ledger, or a documented decision to drop the gate and the
paragraph above with it. `npm run test:report-surfaces`
stays red for 0.6.0 — but it is now red with a date, two reviewers (whose handles this record does
not name, so the ledger records them as `not-recorded`), an enumerated finding list and an owner,
instead of red and unread. The findings and their addressees are carried in the
release's follow-up register; they are surface work, and they are not repaired in a release that
already changes what the rules report.

The green real-document gate reads the rights/privacy-reviewed corpus manifest and binds exact
artifact hashes, source evidence, page/rule counts and the positive independent geometry-oracle
sample. Its one-time red condition is preserved in
`docs/validation/real-document-red-control-v0.2.3.json`; it was produced by installing the signed
registry package and running
`BREAKLINT_023_CLI=<0.2.3-package>/dist/cli/index.js npm run test:real-document:red-control` against
the exact same third-party bytes. It is historical evidence, not a network-dependent release step.

The pagination-residue record is the negative half of the same property: six real documents that
must NOT measure, and must say why — which elements a paginator left in an overflow column, on which
pages, and by how far. Their bytes are **not in this repository**: they are chapters of a paid
product, 27 492 of that bundle's 69 017 words, and this repository is public and MIT. What is public
is a hash-only record in the shape `docs/validation/corpus-contract-v1.md` defines for
`private_nonredistributable` material.

**That record is historical, and it is not a release step.** Re-measured on 2026-09-18, five of the
six documents and the shared stylesheet no longer exist at their recorded digests, so the private
half cannot be run by anybody. `npm run test:pagination-residue` therefore prints `NO CLAIM`, reads
none of the six documents — with or without `BREAKLINT_RESIDUE_CORPUS_ROOT` — and exits 0; what it
can still fail on is the internal consistency of its own manifest. It was a CI and release-workflow
step until that became clear, and a step that exits 0 having read zero documents is a green light
over nothing, so both steps were retired. `tests/unit/workflow-gates.test.ts` fails if either
workflow runs it again while it reads nothing. The script remains as a local check of the record.
The class itself is held in CI by the public `tests/fixtures/fragmentainer-residue.html` in the live
suite, which was reduced from one of the six and carries no product text. Re-admitting the corpus
against current bytes is a fresh admission with its own rights and privacy review.

The red control, `npm run test:pagination-residue:red-control`, builds the parent of the commit that
introduced `src/measure/fragmentainer.ts`, asserts that each case it can run was already fatal
there and named no cause, and that the current build names it. It is a local check rather than a CI
step because it compiles a second tree. Without an artifact root it skips the corpus case by name
and refuses to pass with zero cases, so its green result is a statement about the public fixture
only.

Then verify:

- `.github/workflows/release.yml` is pinned to this tag. The trigger is the literal
  `tags: ["vX.Y.Z"]`, not a wildcard — a wildcard would let any `v*` tag publish — and it is the
  only place the file names the version: every job derives `RELEASE_VERSION` and `PACKAGE_FILE`
  from the triggering tag with `tests/tools/release-workflow-contract.mjs --derive-env`. A stale
  pin is silent when it happens: a tag pushed while the workflow still names the previous version
  starts nothing at all — no run, no error, no notification, and the tag sits on the remote
  looking done. Measured on 2026-09-18: `v0.6.0` was pushed against a workflow still pinned to
  `v0.5.0`, nothing ran, and the tag had to be deleted and recreated. The pin is therefore no
  longer a manual check. `npm run test:release-tag` runs `release-workflow-contract.mjs --check`
  on every CI run and fails when the trigger, `package.json` and both root version fields of
  `package-lock.json` do not name one version, or when any other release literal is left in an
  executable line of the workflow. The release-prep commit moves the version, the lock and the pin
  together; a commit that moves only one of them fails on its pull request.
- `package.json`, both root version fields in `package-lock.json` and `CHANGELOG.md` name the same
  version. The changelog half is also checked, by `tests/tools/changelog-contract.mjs` in
  `npm run test:release-tag`: for a version with no tag yet, the first section must be
  `## X.Y.Z — YYYY-MM-DD` or exactly `## X.Y.Z — TBD-at-tag`, no `## Unreleased` section may
  remain, and `docs/status.md` must not call the version unreleased. At the tag commit — in the
  release workflow, because that commit is what npm serves — only a date is accepted: the
  published 0.6.0 tarball says `## 0.6.0 — unreleased`, and nothing checked it. A `TBD-at-tag`
  that reaches the tag stops the release workflow in its validation job, before anything is
  packed or published, with the instruction to date it (see Publishing). Between releases the
  same check requires a non-empty `## Unreleased` section naming every changed rule as soon as
  anything under `src/` differs from the last tag. It needs the tags: in a shallow clone without
  them it fails rather than passes;
- README, security policy, status and limitations make no future-tense success claim;
- `git diff --check` is clean;
- an independent verifier has no open Blocker/High finding;
- the exact pushed main SHA has a successful `ci.yml` run.

## Publishing

The release-prep commit carries the heading `## X.Y.Z — TBD-at-tag`, because the release date is
not known when it is written. Before tagging:

1. replace `TBD-at-tag` with the date, `## X.Y.Z — YYYY-MM-DD`, in a final commit on main — the
   only change in that commit;
2. let `ci.yml` go green on exactly that commit;
3. tag that commit, and no other.

Create and push the annotated tag only after main CI is green on the dated commit:

```bash
git tag -a vX.Y.Z -m "breaklint X.Y.Z"
git push origin vX.Y.Z
```

A tag on a commit that still says `TBD-at-tag` is refused by the release workflow's first job,
before anything is packed or published; the log names the heading and what to change. The same
holds for `tests/tools/docs-truth-pending.jsonl`: a pull request may carry an entry there while
the owner of that page corrects it, but the release workflow runs the docs check with `--release`,
which refuses any entry — the tagged commit must have an empty list. The clean consumers stop on
it before anything is published, and name the sentences to correct.

The release workflow then:

1. proves, in every job, that the triggering tag, the workflow's one literal pin, `package.json`
   and `package-lock.json` name one version, and derives the version and package file name from it;
2. repeats the complete gate on Node 24 — every `npm run` gate step of `ci.yml`, which
   `tests/unit/workflow-gates.test.ts` checks;
3. scans Git history/worktree and proves both scanner rules with runtime canaries;
4. creates exactly one `breaklint-X.Y.Z.tgz`;
5. records its SHA-256 and SHA-512 SRI;
6. downloads those same bytes into Node 22.13 and Node 24 clean consumers, which check the installed
   README's demo excerpt and the installed docs' schema stamps against the installed code;
7. proves the ref is an annotated tag (with a lightweight-tag negative control), then proves
   tag/version, exact `origin/main` SHA and successful main CI;
8. publishes that tarball with provenance;
9. waits until npm exposes the version, compares `dist.integrity`, binds the package digest and Git
   commit through the signed SLSA provenance, runs npm signature verification and installs the
   registry version in a final consumer;
10. creates the GitHub Release with the tarball and both identity records attached.

Do not rerun a partially successful publish blindly: npm versions are immutable. Inspect the npm
version, workflow logs and GitHub Release first. If npm already serves `X.Y.Z` but a post-publish
verification failed, repair the release metadata or publish a new patch version; never move the tag
or overwrite evidence to make the old run look green.

`npm publish <tarball>` does not populate the legacy `gitHead` registry field. The authoritative
source binding for this release route is therefore the signed SLSA statement: its package subject
must equal `dist.integrity`, and its resolved Git dependency must equal the annotated tag commit.
`npm audit signatures` then verifies the registry signature/attestation bundle. An absent
`gitHead` is acceptable only when all of those stronger checks pass; a present but contradictory
source identity is never ignored.

## After the workflow

From a new temporary directory, independently verify the registry route:

```bash
npm view breaklint@X.Y.Z version dist.integrity
npm init -y
npm install breaklint@X.Y.Z --no-audit --no-fund
npx breaklint --version
npx breaklint --demo
```

The version must be `X.Y.Z`; demo must produce real findings and exit 1. Import
`breaklint/config.schema.json` and rerun the installed Configuration Contract gate. The later status
commit records the completed release but is not retroactively part of the published tarball.

The GitHub Action (`action.yml`) installs `breaklint@<package.json version>` of the ref it is
called at, so `uses: godarg/breaklint@vX.Y.Z` works only from the moment the npm publish above
has succeeded, and a branch ref fails with exit 3 from the version bump until then. Announce or
move nothing that points users at the new tag's Action before `npm view breaklint@X.Y.Z` answers.
