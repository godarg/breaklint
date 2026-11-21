# Configuration Contract v1

Configuration is a public input contract, not a bag of values. Under Configuration Contract v1,
introduced in 0.2.0, every accepted field has four obligations: it is validated, affects the run,
appears in the canonical JSON report, and carries the source that won during resolution. Anything
unknown is rejected with exit 2 before an input document is opened.

The default file is `breaklint.config.json`. A different JSON file can be selected with
`--config <file>`. JavaScript configuration is intentionally unsupported because loading it would
execute repository code inside the checking process.

## Screen checks

`checkPage(page, options)`, the API for an already opened Playwright page, takes its options in
code, not from this file. Its options (`trust`, `networkPolicy`, `scenario`, `output`, `failOn`,
`geometry`, `sourceBinding`) are a closed object validated the same way: unknown fields and
malformed values are rejected before the page is touched, and `SCREEN_OPTIONS_SCHEMA` is the
exported input schema. They are described in [`screen-checks.md`](screen-checks.md).

## Complete example

```json
{
  "profile": "default",
  "failOn": "warn",
  "locale": "de-DE",
  "documentTimeoutMs": 600000,
  "rules": {
    "layout/half-empty-page": true,
    "layout/widow": { "extraLines": 1 },
    "type/straight-quotes": { "excludeTags": ["samp"] }
  },
  "coverageFloors": {
    "layout/widow": 1
  }
}
```

The generated schema is shipped at `breaklint.schema.json` and exported by the package as
`breaklint/config.schema.json`. Associate it with `breaklint.config.json` in the editor's workspace
settings. Do not add a `$schema` property to the runtime file: the contract rejects unknown
top-level fields, and `$schema` is an editor annotation rather than a breaklint setting.

## Resolution and profiles

Every value resolves in this order, from weakest to strongest:

```
built-in defaults < selected profile < config file < command line
```

There are exactly two profiles:

| profile | finding gate | coverage floors | rules enabled |
|---|---|---|---|
| `default` | `error` | by severity: error 1, warning 0.5, info 0 | 12 of 17 rules; half-empty-page, both figure checks and both table checks are off |
| `strict` | `warn` | 1 for every rule | all 17 rules, including the five optional checks; experimental half-empty-page never gates |

A config-file `failOn` can replace a profile's gate, and `--fail-on` can replace the file.
Coverage is different: `coverageFloors` can equal or raise the active profile floor, never lower
it, so a file asking `strict` for 0.9 ends with exit 2.

CLI rule selection is also explicit. `--only` replaces config-file enablement for the selected
set, then `--disable` can remove rules from that set. Empty lists and unknown rule ids are usage
errors.

## Document time budget

One document has a default acquisition budget of 600000 ms (10 minutes). Set
`documentTimeoutMs` in the JSON file or pass `--document-timeout-ms <n>`; the CLI wins when both
are present. The value must be an integer from 30000 to 1800000 ms. Invalid values stop before
Chrome starts with exit 2. Exceeding the budget ends with exit 3 and names the
effective budget. A larger budget is not a page-count or memory guarantee.

## Rules and options

A rule value is either `true`, `false`, or an options object. `false` disables the rule; any other
value enables it — `true`, and equally an options object, including an empty one. For the rules that
run by default this is invisible; for any of the five off-by-default rules it means that
configuring an option also turns the rule on, and a
`{"rules": {"layout/half-empty-page": false}}` still turns it off under `strict`. The complete rule
and option surface, including types and defaults, is in the generated
[JSON Schema](../breaklint.schema.json). Runtime validation and that file derive from the same rule
registry; an option cannot be added to one without appearing in the other.

The two proof-source-A rules are deliberately limited to enablement:

- `layout/unbreakable-block-too-tall`
- `svg/text-overflows-viewport`

Their thresholds are structural boundaries rather than preferences. Any non-empty options object
for either rule is rejected. Profiles cannot change them either.

For `type/spaced-hyphen` and `type/straight-quotes`, `excludeTags` is a list of HTML tag names such
as `samp` or `span`. It is not a CSS selector list. Values are lower-cased, deduplicated and sorted
before use and fingerprinting. The older misleading name `excludeSelectors` is not accepted.

The optional table checks are `layout/table-header-not-repeated` (enablement only) and
`layout/table-column-drift` (`maxColumnDriftPx`, default 2 CSS px). The latter accepts a finite
non-negative number as a chosen warning tolerance. It does not relax the source-membership or
geometry requirements. For example:

```json
{
  "rules": {
    "layout/table-header-not-repeated": true,
    "layout/table-column-drift": { "maxColumnDriftPx": 2 }
  }
}
```

## What the JSON report proves

The canonical document JSON report uses report schema 5 and records:

- `config.contractVersion`, currently 1;
- the selected profile and its `profileSource`, plus the finding gate and rule enablement;
- every effective rule option and coverage floor;
- a source for every effective leaf: `default`, `profile`, `config`, or `cli`;
- a 64-character SHA-256 `config.fingerprint`.

The profile is reported with its source but excluded from `config.effective`, because its effects
already appear as `failOn` and per-rule floors. The fingerprint covers canonicalised effective
semantics only (domain prefix `breaklint-effective-config-v1`): reordering keys or set-like values
does not change it; changing an effective option does.

Report and snapshot schemas evolve independently. The document report is schema 5 (readers accept
4 and 5), snapshots are Snapshot 7 (readers accept Snapshot 5, 6 and 7), and the Configuration
Contract is v1. Unknown stamps and malformed data are refused; a stored snapshot without a figure
or table inventory declines the corresponding enabled checks.

`figure/caption-separated` and `figure/dangling-reference` are warning checks, off by default.
Their allowances `maxPageDistance` and `maxMissingTargets` default to 0 and accept safe integers
from 0 upward.

## Command-line output options

`--format`, `--out` and `--out-dir` are command-line options only; a config file cannot set them,
and they are not part of `config.effective` or the fingerprint, because they decide where and in
which projection a result is written rather than what is measured.

`--out-dir <dir>` is where a live run writes its evidence: one PNG per page and the checked PDF
(default `./breaklint-report`, created on first write; `--demo` writes nothing). A blank value is
exit 2. Every `evidence[].path` in the report is relative to it, so report and directory travel
together.

## Failure boundary

The following are exit 2 and do not produce a report:

- invalid JSON or a non-object root, including `null` and arrays;
- unknown top-level fields, profiles, rule ids or rule options;
- wrong value types, non-finite or negative option numbers;
- coverage outside 0..1 or below the active floor;
- a proof-source-A threshold override;
- a CSS selector supplied where `excludeTags` requires a tag name.

This fail-closed boundary is intentional. Ignoring a misspelled option would let CI report a clean
run under a configuration the caller did not actually receive.

## Schema maintenance

`breaklint.schema.json` is generated, checked in and shipped with the package:

```bash
npm run schema:write   # deliberately update it after a contract change
npm run schema:check   # fail if the checked-in artifact has drifted
```

Do not edit the schema by hand. `prepack` runs the drift check before building the package.
