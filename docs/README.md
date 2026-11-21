# breaklint documentation

One line per page: what to read it for.

| page | read it for |
|---|---|
| [`../README.md`](../README.md) | install, the first run, and an overview of every rule |
| [`configuration.md`](configuration.md) | CLI options, profiles, `breaklint.config.json` and the configuration schema |
| [`screen-checks.md`](screen-checks.md) | `checkPage` in Playwright tests: options, screen rules, exceptions, source binding |
| [`rules/`](rules/) | one page per print rule: what it measures, its threshold, its declines and the repair advice |
| [`reporting.md`](reporting.md) | the JSON report, the other output formats, and `compare`, `context` and `bundle` |
| [`ci-recipe.md`](ci-recipe.md) | the GitHub Action: a workflow to copy, permissions, pinning and what each exit code does to a job |
| [`agent-contract.md`](agent-contract.md) | coding agents that read reports and repair documents: exit codes, stable fields, verified advice |
| [`source-bound-findings.md`](source-bound-findings.md) | the JavaScript API for document generators: producer-bound runs and exact source locations |
| [`revision-comparison.md`](revision-comparison.md) | confirming a repair across two commits with `compareReports` |
| [`known-limits.md`](known-limits.md) | what breaklint does not measure, and where it stops with exit 3 or 4 instead of guessing |
| [`community-testing.md`](community-testing.md) | reporting a page where breaklint and a careful reader disagree |
| [`../SECURITY.md`](../SECURITY.md) | running untrusted HTML, and reporting a vulnerability |
| [`../CHANGELOG.md`](../CHANGELOG.md) | what changed in each release, and how to upgrade |
