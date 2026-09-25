# breaklint as a CI gate in GitHub Actions

This page is for projects that build a printed product from HTML — a guide, a book, a print
edition — and want every pull request checked before the PDF is made. It describes the composite
Action at the root of this repository (`action.yml`) and gives a workflow you can copy.

What the Action does, in one run:

1. installs breaklint at the version its own ref pins, with the renderer peers
   `puppeteer-core@25.8.0`, `pagedjs@0.4.3` and `pdfjs-dist@6.2.108`, into the runner's temporary
   directory — or uses your project's own install;
2. hands breaklint the runner's Chrome, with the sandbox on (there is no way to turn it off);
3. runs breaklint once over the HTML paths you give it, and writes the canonical JSON report;
4. renders SARIF, JUnit and Markdown from that one report with breaklint's own reporters, appends
   the Markdown to the job's step summary, and prints the console report to the log;
5. ends the step with breaklint's own exit code, or passes it.

**What the findings are worth.** Two rules can fail a build by default:
`layout/unbreakable-block-too-tall` and `svg/text-overflows-viewport`. They compare two directly
measured quantities against a structural boundary (proof source A). Every other rule is a
heuristic whose threshold nobody has calibrated against real documents. Its findings are advice,
reported as warnings, and they gate only with `fail-on: warn`. The argument, and what no test here
establishes, is in [`limitations.md`](limitations.md).

## The workflow

Copy this to `.github/workflows/print-qa.yml` and replace the build step and the `paths`. Every
third-party action is pinned to a full commit SHA. Pin the breaklint Action the same way: to a
release tag, or better, to that tag's commit SHA. The Action exists from the first release whose
[changelog](../CHANGELOG.md) lists it.

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
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4.4.0
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
        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2
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
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4.4.0
      - uses: actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093 # v4.3.0
        with:
          name: breaklint-report
          path: ${{ runner.temp }}/breaklint-report
      - uses: github/codeql-action/upload-sarif@2892aa5e19bbd11bc0cff5427e3b750a04d9e3c2 # v4.38.2
        with:
          sarif_file: ${{ runner.temp }}/breaklint-report/breaklint.sarif
          category: breaklint
```

The `layout` job needs only `contents: read`. `security-events: write` appears in the upload job
and nowhere else. Code scanning must be available for the repository (it is for public
repositories; a private one needs GitHub Advanced Security), otherwise the upload step fails and
the `layout` job's result is unaffected.

## What each exit code does to the job

The step ends with breaklint's own exit code, so the log says `exit code 1` for findings and
`exit code 4` for a run that judged too little. The `exit-code` output carries the same number
for later steps, on every run including a failed one.

| exit | meaning | step, by default | can it be left ungated? |
|---|---|---|---|
| 0 | checked, coverage met, nothing reached the threshold | passes | — |
| 1 | at least one non-experimental finding reached the threshold | fails | yes: `fail-on-exit: 2,3,4` |
| 2 | invalid invocation: a path that is not there, a bad config or input | fails | no |
| 3 | infrastructure: no browser, a font that did not load, a crash | fails | no |
| 4 | nothing or too little was judged: coverage below its floor | fails | no |

2, 3 and 4 always fail the step. Each of them says that the requested check did not run or judged
too little, and a gate that passes on them is a green over nothing. `fail-on-exit: 1,2,3` is
refused with exit 2 before anything runs.

To report findings without failing the build while you adopt the tool, use
`fail-on-exit: 2,3,4`. The step then passes on exit 1, the log carries a warning annotation, and
the summary says the findings were not gated. That is different from `fail-on: never`, which
changes breaklint's own gate: breaklint then ends with 0 on findings, so the recorded exit code no
longer shows them either.

The Action adds two refusals of its own, both with breaklint's table. A step input that fails
validation is exit 2. An install that fails, a runner that cannot run the check (Windows, a Node
older than breaklint's `engines`, a `BREAKLINT_CHROME` that points nowhere), or a breaklint exit
0 or 1 without the report that says so is exit 3. Node's own exit code for an uncaught crash is
1, and it must not read as "findings".

## Inputs

| input | default | what it does |
|---|---|---|
| `paths` | required | HTML files, one path or bash glob per line, relative to the workspace. `**` matches across directories; hidden files and brace expansion are not matched; matches are sorted in byte order, and a file two patterns match is checked once. A pattern that matches nothing is passed on literally and ends with exit 2, exactly as in bash. |
| `fail-on-exit` | `1,2,3,4` | which exit codes fail the step; 2, 3 and 4 are mandatory |
| `fail-on` | breaklint's | `--fail-on`: `error`, `warn` or `never` |
| `profile` | breaklint's | `--profile`: `default` or `strict` |
| `config` | `./breaklint.config.json` if present | `--config`: path to a JSON config ([configuration](configuration.md)) |
| `allow-network` | none (offline) | `--allow-network`: one origin per line, e.g. a font host |
| `output-dir` | `$RUNNER_TEMP/breaklint-report` | where the reports and `evidence/` go |
| `chrome-path` | `$BREAKLINT_CHROME`, then `google-chrome` on `PATH` | absolute path to Chrome |
| `use-project-install` | `false` | `true` uses `node_modules/breaklint` from your own lockfile |
| `breaklint-tarball` | none | an `npm pack` tarball to install instead, e.g. a release candidate |

Unknown input names are refused with exit 2 if the runner passes them through; GitHub itself only
warns about them, so check the spelling of `with:` keys against this table.

## Outputs

| output | content |
|---|---|
| `exit-code` | breaklint's exit code as applied to the step |
| `verdict` | the report's `runVerdict`, or `usage`, `infrastructure` or `not-run` when there is no report |
| `report-json` | `breaklint.json`, the canonical report |
| `sarif-file` | `breaklint.sarif`, SARIF 2.1.0 for `upload-sarif` |
| `junit-file` | `breaklint.junit.xml` |
| `markdown-file` | `breaklint.md`, the uncut Markdown report |
| `evidence-dir` | evidence images and PDFs, when the run produced any |
| `output-dir` | the directory all of the above are in |
| `breaklint-version`, `chrome-path` | what ran, and with which browser |

Before breaklint runs, the Action deletes the four report files and `evidence/` from
`output-dir`, so a failed run never leaves an earlier run's SARIF to be uploaded as if it were
this one. A report
output is empty when breaklint wrote no report, which is why the workflow above tests
`report-json != ''` instead of hard-coding a path.

JSON is the canonical report; SARIF, JUnit and Markdown are lossy projections of it ([reporting](reporting.md)).
Keep the JSON when you keep anything.

## Several documents

One call with several patterns checks all of them in one run and one report. The run takes the
strongest verdict of any document; the JSON report, the SARIF results and the JUnit suites keep
each document apart:

```yaml
        with:
          paths: |
            dist/guide/*.html
            dist/handbook/**/*.html
```

For one report per document, and one code-scanning category per document, use a matrix and give
each upload its own `category`:

```yaml
    strategy:
      fail-fast: false
      matrix:
        document: [guide, handbook]
    steps:
      # …checkout, setup-node, build…
      - id: breaklint
        uses: godarg/breaklint@<release-tag-or-its-commit-sha>
        with:
          paths: dist/${{ matrix.document }}/**/*.html
```

and `category: breaklint-${{ matrix.document }}` on the upload, with an artifact name per matrix
entry. When one job calls the Action more than once, give each call its own `output-dir`; the
calls would otherwise replace each other's reports.

## Pull-request summaries and comments

The Markdown report is appended to the step summary on every run, with one closing line that
says how the exit code was applied. The summary is cut, with a note, below GitHub's 1 MiB limit;
the uncut file is the `markdown-file` output. This needs no permission.

A pull-request comment needs `pull-requests: write`, which a fork's pull request does not get.
If you want one for your own branches, post the file from a separate job that has that permission
and downloads the artifact, for example with `gh pr comment "$NUMBER" --body-file breaklint.md`.
Pass the number through `env:`, never by pasting `${{ … }}` into the script.

GitHub does not render JUnit itself. `breaklint.junit.xml` is for CI front-ends and test-report
tools that read it; its failure count includes infrastructure failures, and a rule that could not
measure is marked `skipped`, not passed.

## Caching

Chrome comes with the runner, so there is nothing to download for it. The install the Action
makes lives in `$RUNNER_TEMP` and is reused by later calls in the same job when the same bytes
are installed the same way. Across runs, what can be cached is npm's download cache, `~/.npm`:

- If your repository has a `package-lock.json`, `actions/setup-node` with `cache: npm` caches it.
- If it does not, cache the directory yourself, keyed on the workflow file that pins the Action,
  so a new pin starts a new cache:

```yaml
      - uses: actions/cache@0057852bfaa89a56745cba8c7296529d2fc39830 # v4.3.0
        with:
          path: ~/.npm
          key: breaklint-npm-${{ runner.os }}-${{ hashFiles('.github/workflows/print-qa.yml') }}
```

## Your own install instead

The Action installs breaklint and three peers at exact versions. Their own dependencies are
resolved when they are installed, because no lockfile is involved. For a fully pinned tree, add
breaklint and the peers to your `devDependencies`, commit the lockfile, run `npm ci` before the
Action, and set `use-project-install: true`:

```bash
npm i -D breaklint puppeteer-core@25.8.0 pagedjs@0.4.3 pdfjs-dist@6.2.108
```

breaklint looks for its peers from the working directory first. When the Action installs its own
copy but your workspace already has one of the peers (for example `pagedjs` from your PDF build),
that copy is used, and the Action says so in a warning. A `pagedjs` other than 0.4.3 then ends
the run with exit 3, as breaklint's version gate requires. Pin the peers in your project and use
`use-project-install: true`.

## Permissions and safety

- Give the checking job `contents: read` and nothing else. Only the upload job needs
  `security-events: write`.
- Do not run this on `pull_request_target` with the pull request's own code checked out. That
  combination runs untrusted HTML, including its scripts, in a job that holds a write token.
- breaklint executes the documents it checks, scripts included, in a fresh browser profile with
  the sandbox on and the network blocked unless `allow-network` names an origin. That protects
  against mistakes, not against an attack on the browser sandbox; see
  [Running foreign HTML](../README.md#running-foreign-html).
- The Action passes all inputs to its runner as one JSON environment variable and never pastes
  an input into a script. Paths are expanded by bash without evaluation, so `$(…)`, backticks and
  `;` in a pattern stay literal, and a path that starts with `-` is passed as `./-…` so it cannot
  become an option. breaklint's output is printed with workflow commands switched off, so text
  from a document cannot write annotations or outputs.

## What is not covered

- **Runners.** Tested on `ubuntu-latest`, in the `action` job of this repository's
  `.github/workflows/ci.yml`. macOS runners are untested. Windows is refused with exit 3, because
  breaklint does not support it.
- **Container jobs** (`container:`) are not measured. Chrome's sandbox and the cleanup of its
  processes depend on the container's init process; run the check on the runner itself.
- **Code-scanning display.** A finding without a source location is written to SARIF with a
  logical location only, and a finding in a generated file points at that file. Whether GitHub
  shows either as an alert has not been measured here; the SARIF file, the Markdown summary and
  the JSON report carry every finding either way.
- **Calibration.** No threshold is calibrated. See [`limitations.md`](limitations.md) and
  [`status.md`](status.md).
