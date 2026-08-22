# Configuration Contract v1

Configuration is a public input contract, not a bag of values. In `breaklint` 0.2.x every accepted
field has four obligations: it is validated, affects the run, appears in the canonical JSON report,
and carries the source that won during resolution. Anything unknown is rejected with exit 2 before
an input document is opened.

The default file is `breaklint.config.json`. A different JSON file can be selected with
`--config <file>`. JavaScript configuration is intentionally unsupported because loading it would
execute repository code inside the checking process.

## Complete example

```json
{
  "profile": "default",
  "failOn": "warn",
  "locale": "de-DE",
  "rules": {
    "layout/half-empty-page": false,
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

| profile | finding gate | coverage floors |
|---|---|---|
| `default` | `error` | by severity: error 1, warning 0.5, info 0 |
| `strict` | `warn` | 1 for every rule |

`strict` is a real preset, not a label. A config-file `failOn` can replace its warning gate and a
CLI `--fail-on` can replace the file. Coverage is different: `coverageFloors` can equal or raise
the active profile floor, never lower it. `strict` therefore cannot be made partially blind by a
file that asks for 0.9 or by a later `--profile default`; both invocations end with exit 2.

CLI rule selection is also explicit. `--only` replaces config-file enablement for the selected
set, then `--disable` can remove rules from that set. Empty lists and unknown rule ids are usage
errors.

## Rules and options

A rule value is either `true`, `false`, or an options object. The complete rule and option surface,
including types and defaults, is in the generated [JSON Schema](../breaklint.schema.json). Runtime
validation and that file derive from the same rule registry; an option cannot be added to one
without appearing in the other.

The two proof-source-A rules are deliberately limited to enablement:

- `layout/unbreakable-block-too-tall`
- `svg/text-overflows-viewport`

Their thresholds are structural boundaries rather than preferences. Any non-empty options object
for either rule is rejected. Profiles cannot change them either.

For `type/spaced-hyphen` and `type/straight-quotes`, `excludeTags` is a list of HTML tag names such
as `samp` or `span`. It is not a CSS selector list. Values are lower-cased, deduplicated and sorted
before use and fingerprinting. The older misleading name `excludeSelectors` is not accepted.

## What the JSON report proves

The canonical JSON report uses report schema 3 and records:

- `config.contractVersion`, currently 1;
- the selected profile and its `profileSource`, plus the finding gate and rule enablement;
- every effective rule option and coverage floor;
- a source for every effective leaf: `default`, `profile`, `config`, or `cli`;
- a 64-character SHA-256 `config.fingerprint`.

The selected profile is resolution metadata, not a second semantic input: its fully expanded
effects already appear as `failOn` and per-rule floors. It is therefore reported with its source
but excluded from `config.effective`. A `strict` profile and a completely expanded equivalent
default profile receive the same fingerprint.

The fingerprint is computed over canonicalised effective semantics with the domain prefix
`breaklint-effective-config-v1` and a NUL separator. It excludes provenance, output paths,
report format, observed runtime counters and absolute machine paths. Reordering object keys or
set-like values therefore does not change it; changing an effective option does.

Report schema and snapshot schema evolve independently. Configuration Contract v1 changes the
report to schema 3, while stored snapshots remain schema 2 because their structure did not change.

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
