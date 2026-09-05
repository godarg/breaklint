# Releasing breaklint

Releases are published by GitHub Actions from an annotated version tag. A laptop never runs
`npm publish`. The tag starts the proof; it is not accepted as proof by itself.

## Release contract

For 0.3.1, all of the following must refer to the same commit and the same package bytes:

1. `origin/main` and annotated tag `v0.3.1`;
2. the successful `ci.yml` run queried by commit SHA;
3. the one tarball created by the release workflow;
4. both clean consumers, on Node 22.13 and Node 24;
5. npm `breaklint@0.3.1` and its `dist.integrity`;
6. the tarball and checksum files attached to the GitHub Release.

Any mismatch ends the workflow before or immediately after the outward action. A failed registry
verification is not called a successful release even if npm accepted the upload.

The public `v0.3.0` tag is a failed pre-publish attempt and must not be moved or reused. Run
`33317007301` stopped in both clean-consumer jobs before npm publication and before GitHub Release
creation because their real-document child process inherited the checkout CWD. Version 0.3.1 is the
published repair from this change set and binds the child CLI to the actual consumer CWD. Release
run `33320332110` completed the Node 22.13/24 consumer matrix, npm provenance verification and
GitHub Release creation on 2026-08-30.

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

The technical surface gate reconstructs and verifies every current cell without claiming a human
look. `npm run test:report-surfaces` is the separate exact-environment human gate. It must stay red
when the bound inputs changed and no person reviewed the new artifacts; never refresh its ledger as
release ceremony. A real later review may rebind it with its actual reviewer and timestamp.

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

- `package.json`, both root version fields in `package-lock.json` and `CHANGELOG.md` name the same
  version;
- README, security policy, status and limitations make no future-tense success claim;
- `git diff --check` is clean;
- an independent verifier has no open Blocker/High finding;
- the exact pushed main SHA has a successful `ci.yml` run.

## Publishing

Create and push an annotated tag only after main CI is green:

```bash
git tag -a v0.3.1 -m "breaklint 0.3.1"
git push origin v0.3.1
```

The release workflow then:

1. repeats the complete gate on Node 24;
2. scans Git history/worktree and proves both scanner rules with runtime canaries;
3. creates exactly one `breaklint-0.3.1.tgz`;
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
version, workflow logs and GitHub Release first. If npm already serves 0.3.1 but a post-publish
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
npm view breaklint@0.3.1 version dist.integrity
npm init -y
npm install breaklint@0.3.1 --no-audit --no-fund
npx breaklint --version
npx breaklint --demo
```

The version must be `0.3.1`; demo must produce real findings and exit 1. Import
`breaklint/config.schema.json` and rerun the installed Configuration Contract gate. The later status
commit records the completed release but is not retroactively part of the published tarball.
