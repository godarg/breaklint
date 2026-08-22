# Releasing breaklint

Releases are published by GitHub Actions from an annotated version tag. A laptop never runs
`npm publish`. The tag starts the proof; it is not accepted as proof by itself.

## Release contract

For 0.2.0, all of the following must refer to the same commit and the same package bytes:

1. `origin/main` and annotated tag `v0.2.0`;
2. the successful `ci.yml` run queried by commit SHA;
3. the one tarball created by the release workflow;
4. both clean consumers, on Node 22.13 and Node 24;
5. npm `breaklint@0.2.0` and its `dist.integrity`;
6. the tarball and checksum files attached to the GitHub Release.

Any mismatch ends the workflow before or immediately after the outward action. A failed registry
verification is not called a successful release even if npm accepted the upload.

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
npm run typecheck
npm run schema:check
npm test
npm run test:mutants
npm run test:licenses
npm run test:live
npm run test:report-surfaces
npm run selfcheck
npm run build
```

Then verify:

- `package.json` and `CHANGELOG.md` name the same version;
- README, security policy, status and limitations make no future-tense success claim;
- `git diff --check` is clean;
- an independent verifier has no open Blocker/High finding;
- the exact pushed main SHA has a successful `ci.yml` run.

## Publishing

Create and push an annotated tag only after main CI is green:

```bash
git tag -a v0.2.0 -m "breaklint 0.2.0"
git push origin v0.2.0
```

The release workflow then:

1. repeats the complete gate on Node 24;
2. scans Git history/worktree and proves both scanner rules with runtime canaries;
3. creates exactly one `breaklint-0.2.0.tgz`;
4. records its SHA-256 and SHA-512 SRI;
5. downloads those same bytes into Node 22.13 and Node 24 clean consumers;
6. proves the ref is an annotated tag (with a lightweight-tag negative control), then proves
   tag/version, exact `origin/main` SHA and successful main CI;
7. publishes that tarball with provenance;
8. waits until npm exposes the version, compares `dist.integrity`, runs npm signature verification
   where supported and installs the registry version in a final consumer;
9. creates the GitHub Release with the tarball and both identity records attached.

Do not rerun a partially successful publish blindly: npm versions are immutable. Inspect the npm
version, workflow logs and GitHub Release first. If npm already serves 0.2.0 but a post-publish
verification failed, repair the release metadata or publish a new patch version; never move the tag
or overwrite evidence to make the old run look green.

## After the workflow

From a new temporary directory, independently verify the registry route:

```bash
npm view breaklint@0.2.0 version dist.integrity
npm init -y
npm install breaklint@0.2.0 --no-audit --no-fund
npx breaklint --version
npx breaklint --demo
```

The version must be `0.2.0`; demo must produce real findings and exit 1. Import
`breaklint/config.schema.json` and rerun the installed Configuration Contract gate. Only then update
`docs/status.md` from “prepared” to “released” in a later main commit. That later documentation
commit is not retroactively part of the published tarball and must say so plainly.
