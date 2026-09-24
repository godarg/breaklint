# Releasing breaklint

Releases are published by GitHub Actions from an annotated version tag. A laptop never runs
`npm publish`. The tag starts the proof; it is not accepted as proof by itself.

## Release contract

For 0.6.0, all of the following must refer to the same commit and the same package bytes:

1. `origin/main` and annotated tag `v0.6.0`;
2. the successful `ci.yml` run queried by commit SHA;
3. the one tarball created by the release workflow;
4. both clean consumers, on Node 22.13 and Node 24;
5. npm `breaklint@0.6.0` and its `dist.integrity`;
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
document report changes structure, so its stamp moves. Report 4 becomes Report 5 with the optional
`Finding.remediation`, and the agent context pack becomes 2 with one new required key and three new
finding-card keys. Snapshot stays 4 and Configuration Contract 1 is untouched. Readers accept
Report 4 and 5, so a stored artefact does not have to be migrated — but an optional property does
not let a schema-aware consumer distinguish the two shapes, and that is what a version is for.

0.5.0 is a minor pre-1.0 release because live document output moves to Report 4 and Snapshot 4,
and the installed package gains public producer, screen, comparison and report-bundle APIs.
Configuration Contract 1 remains separate and unchanged. Consumers of Report 3 must migrate;
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

Run from a clean checkout with the supported Node line and all live prerequisites present:

```bash
npm ci --no-audit --no-fund
npm run test:secrets
npm run test:advisories
npm run test:release-tag
node tests/tools/registry-provenance-contract.mjs --self-test
npm run typecheck
npm run schema:check
npm test
npm run test:mutants
npm run test:real-document
npm run test:pagination-residue          # SKIPPED without BREAKLINT_RESIDUE_CORPUS_ROOT; see below
npm run test:licenses
BREAKLINT_LIVE_REPORT=.tmp/live-report.json BREAKLINT_LIVE_SUMMARY=.tmp/live-summary.json npm run test:live
npm run test:documented-figures
npm run test:report-surfaces:technical
npm run selfcheck
npm run build
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
outcome — `pass` or `fail` — and only a passing latest round with a human reviewer, bound to the
exact current inputs, turns the gate green.

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
stays red for 0.6.0 — but it is now red with a date, two named reviewers, an enumerated finding list
and an owner, instead of red and unread. The findings and their addressees are carried in the
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
`private_nonredistributable` material, and the gate says `SKIPPED` rather than claiming a
verification it did not perform. The class itself is held in CI by the public
`tests/fixtures/fragmentainer-residue.html`, which carries no product text.

Before a release, run the full gate once against the admitted bundle and read the six lines it
prints:

```bash
BREAKLINT_RESIDUE_CORPUS_ROOT=<unpacked-bundle> npm run test:pagination-residue
BREAKLINT_RESIDUE_CORPUS_ROOT=<unpacked-bundle> npm run test:pagination-residue:red-control
```

The red condition is not historical but re-derivable: the red control builds the parent of the
commit that introduced `src/measure/fragmentainer.ts` and asserts that both cases were already fatal
there and named no cause. Without the artifact root it still proves red-to-green on the public
fixture and skips the corpus case by name. It is a local gate rather than a CI step because it
compiles a second tree.

Then verify:

- `.github/workflows/release.yml` is pinned to this tag and this tarball. The trigger is the
  literal `tags: ["vX.Y.Z"]`, not a wildcard, and `PACKAGE_FILE` plus every version assertion in
  the file name the same version. **This step is the one that is easy to forget and silent when
  forgotten**: a tag pushed while the workflow still names the previous version starts nothing at
  all — no run, no error, no notification, and the tag sits on the remote looking done. Measured on
  2026-09-18: `v0.6.0` was pushed against a workflow still pinned to `v0.5.0`, nothing ran, and the
  tag had to be deleted and recreated. The pinning is deliberate — a wildcard would let any `v*`
  tag publish — but it belongs in this list.
- `package.json`, both root version fields in `package-lock.json` and `CHANGELOG.md` name the same
  version;
- README, security policy, status and limitations make no future-tense success claim;
- `git diff --check` is clean;
- an independent verifier has no open Blocker/High finding;
- the exact pushed main SHA has a successful `ci.yml` run.

## Publishing

Create and push an annotated tag only after main CI is green:

```bash
git tag -a v0.6.0 -m "breaklint 0.6.0"
git push origin v0.6.0
```

The release workflow then:

1. repeats the complete gate on Node 24;
2. scans Git history/worktree and proves both scanner rules with runtime canaries;
3. creates exactly one `breaklint-0.6.0.tgz`;
4. records its SHA-256 and SHA-512 SRI;
5. downloads those same bytes into Node 22.13 and Node 24 clean consumers;
6. proves the ref is an annotated tag (with a lightweight-tag negative control), then proves
   tag/version, exact `origin/main` SHA and successful main CI;
7. publishes that tarball with provenance;
8. waits until npm exposes the version, compares `dist.integrity`, binds the package digest and Git
   commit through the signed SLSA provenance, runs npm signature verification and installs the
   registry version in a final consumer;
9. creates the GitHub Release with the tarball and both identity records attached.

Do not rerun a partially successful publish blindly: npm versions are immutable. Inspect the npm
version, workflow logs and GitHub Release first. If npm already serves 0.6.0 but a post-publish
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
npm view breaklint@0.6.0 version dist.integrity
npm init -y
npm install breaklint@0.6.0 --no-audit --no-fund
npx breaklint --version
npx breaklint --demo
```

The version must be `0.6.0`; demo must produce real findings and exit 1. Import
`breaklint/config.schema.json` and rerun the installed Configuration Contract gate. The later status
commit records the completed release but is not retroactively part of the published tarball.
