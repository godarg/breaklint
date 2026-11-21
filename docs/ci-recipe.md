# breaklint as a CI gate in GitHub Actions

For projects that build a printed product from HTML and want every pull request checked before
the PDF is made: the composite Action in `action.yml`, and a workflow to copy.

What the Action does, in one run:

1. installs breaklint at the version its own ref pins, with the renderer peers
   `puppeteer-core@25.16.0`, `pagedjs@0.4.3` and `pdfjs-dist@6.2.108`, into the runner's temporary
   directory — or uses your project's own install;
2. runs breaklint once over the HTML paths you give it with the runner's Chrome, and writes the
   canonical JSON report;
3. renders SARIF, JUnit and Markdown from that report, appends the Markdown to the job summary and
   prints the console report to the log;
4. ends the step with breaklint's own exit code, or passes it.

Two rules fail a build by default; every other rule is an uncalibrated warning that gates only
with `fail-on: warn` ([known limits](known-limits.md)).

## The workflow

Copy this to `.github/workflows/print-qa.yml`, replace the build step and the `paths`, and pin the
breaklint Action to a release tag or its commit SHA.

**Which breaklint a ref runs.** The Action installs the npm version named in that ref's
`package.json`, not the ref's code; before a release is on npm its tag fails with exit 3. To gate
on unpublished code, pass an `npm pack` tarball as `breaklint-tarball`.

```yaml
name: print QA

on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  layout:
    runs-on: ubuntu-latest
    outputs:
      sarif: ${{ steps.breaklint.outputs.sarif-file != '' }}
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version: 24

      # Your build: whatever turns your sources into the HTML you print.
      - run: ./build-print-html.sh

      - name: breaklint
        id: breaklint
        uses: godarg/breaklint@<release-tag-or-its-commit-sha>
        with:
          paths: |
            dist/print/**/*.html

      - name: keep the reports, pass or fail
        if: always() && steps.breaklint.outputs.report-json != ''
        uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2
        with:
          name: breaklint-report
          path: ${{ steps.breaklint.outputs.output-dir }}

  # Code scanning gets its own job, so that the job rendering your HTML in Chrome never holds
  # a token that can write security events. A fork's pull request gets a read-only token; the
  # condition skips the upload there instead of failing on it.
  code-scanning:
    needs: layout
    if: >-
      always() && needs.layout.outputs.sarif == 'true' &&
      (github.event_name != 'pull_request' ||
       github.event.pull_request.head.repo.full_name == github.repository)
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      - uses: actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8.0.2
        with:
          name: breaklint-report
          path: ${{ runner.temp }}/breaklint-report
      - uses: github/codeql-action/upload-sarif@2892aa5e19bbd11bc0cff5427e3b750a04d9e3c2 # v4.38.2
        with:
          sarif_file: ${{ runner.temp }}/breaklint-report/breaklint.sarif
          category: breaklint
```


Only the upload job holds `security-events: write`. Private repositories need GitHub Advanced
Security for code scanning.

## What each exit code does to the job

| exit | meaning | step |
|---|---|---|
| 0 | checked, coverage met, nothing reached the threshold | passes |
| 1 | a non-experimental finding reached the threshold | fails, unless `fail-on-exit: 2,3,4` |
| 2 | invalid invocation: a missing path, a bad config or input | always fails |
| 3 | infrastructure: no browser, a font that did not load, a crash | always fails |
| 4 | too little was judged: coverage below its floor | always fails |

`fail-on-exit: 2,3,4` reports findings without failing the build while you adopt the tool (the
step passes on exit 1 with a warning). `fail-on: never` instead changes breaklint's own gate, so
the exit code no longer shows findings.

The Action's path expansion requires Bash 4 or newer with globstar (GitHub's Ubuntu runner has
it; macOS `/bin/bash` 3.2 does not). Without it, a failed install, an unsupported runner or a
missing report, the Action ends with exit 3; an invalid input is exit 2.

## Inputs

| input | default | what it does |
|---|---|---|
| `paths` | required | HTML files, one path or bash glob per line, relative to the workspace; `**` crosses directories. A pattern that matches nothing ends with exit 2. |
| `fail-on-exit` | `1,2,3,4` | which exit codes fail the step; 2, 3 and 4 are mandatory |
| `fail-on` | breaklint's | `--fail-on`: `error`, `warn` or `never` |
| `profile` | breaklint's | `--profile`: `default` or `strict` |
| `config` | `./breaklint.config.json` if present | `--config`: path to a JSON config ([configuration](configuration.md)) |
| `allow-network` | none (offline) | `--allow-network`: one origin per line, e.g. a font host |
| `output-dir` | `$RUNNER_TEMP/breaklint-report` | where the reports and `evidence/` go |
| `chrome-path` | `$BREAKLINT_CHROME`, else `google-chrome` | absolute path to Chrome |
| `use-project-install` | `false` | `true` uses `node_modules/breaklint` from your own lockfile |
| `breaklint-tarball` | none | an `npm pack` tarball to install instead, e.g. a release candidate |


## Outputs

| output | content |
|---|---|
| `exit-code` | breaklint's exit code, or the Action's own 2 or 3; set on every run. An ungated exit 1 ends the step with 0 while `exit-code` stays 1. |
| `verdict` | the report's `runVerdict`, or `usage`, `infrastructure` or `not-run` without a report |
| `report-json` | `breaklint.json`, the canonical report |
| `sarif-file` | `breaklint.sarif`, SARIF 2.1.0 for `upload-sarif` |
| `junit-file` | `breaklint.junit.xml` |
| `markdown-file` | `breaklint.md`, the uncut Markdown report |
| `evidence-dir` | evidence images and PDFs, when the run produced any |
| `output-dir` | the directory all of the above are in |
| `breaklint-version`, `chrome-path` | what ran, and with which browser |

Earlier report files in `output-dir` are deleted before each run, and a report output is empty
when no report was written. JSON is canonical ([reporting](reporting.md)).

## Several documents

One call with several patterns checks all of them in one run and one report; the JSON, SARIF and
JUnit keep each document apart. For one report per document, run the Action in a matrix with a
code-scanning `category` and an artifact name per entry. A job that calls the Action more than
once needs a separate `output-dir` per call.

## Summaries, comments and JUnit

The Markdown report goes into the step summary on every run, cut below GitHub's 1 MiB limit. A
pull-request comment needs `pull-requests: write`; post `breaklint.md` from a separate job. JUnit
marks a rule that could not measure as `skipped`.

## Caching and your own install

Chrome comes with the runner. Across runs, cache npm's download cache: with a
`package-lock.json`, `actions/setup-node` with `cache: npm` does it; otherwise:

```yaml
      - uses: actions/cache@0057852bfaa89a56745cba8c7296529d2fc39830 # v4.3.0
        with:
          path: ~/.npm
          key: breaklint-npm-${{ runner.os }}-${{ hashFiles('.github/workflows/print-qa.yml') }}
```

For a fully pinned tree, add breaklint and the peers to your `devDependencies`, commit the
lockfile, run `npm ci` before the Action and set `use-project-install: true`:

```bash
npm i -D breaklint puppeteer-core@25.16.0 pagedjs@0.4.3 pdfjs-dist@6.2.108
```

A `pagedjs` other than 0.4.3 already in your workspace is used first and ends the run with exit 3.

## Permissions and safety

- Give the checking job `contents: read` and nothing else.
- Never run it on `pull_request_target` with the pull request's code checked out.
- breaklint executes the documents it checks. Its request interception is not a network block;
  see [SECURITY.md](../SECURITY.md).

## What is not covered

Tested on `ubuntu-latest`. macOS runners and container jobs are untested; Windows is refused with
exit 3.
