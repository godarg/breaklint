# Configuration Contract v1

Configuration is a public input contract, not a bag of values. Under Configuration Contract v1,
introduced in 0.2.0, every accepted field has four obligations: it is validated, affects the run,
appears in the canonical JSON report, and carries the source that won during resolution. Anything
unknown is rejected with exit 2 before an input document is opened.

The default file is `breaklint.config.json`. A different JSON file can be selected with
`--config <file>`. JavaScript configuration is intentionally unsupported because loading it would
execute repository code inside the checking process.

## Screen page adapter

`checkPage(page, options)` is a separate public API for an **already opened** Playwright page. It
does not import Playwright, navigate, change authentication or network policy, mutate the page, or
close the page. The caller owns the browser lifecycle and supplies the compulsory boundary:

```ts
const result = await checkPage(page, {
  trust: "host-controlled-page",
  networkPolicy: "host-owned",
  scenario: "signed-in-dashboard",
  output: { dir: "artifacts/breaklint", screenshot: "viewport" },
  geometry: {
    allowedScrollContainers: [{ selector: "[data-grid]", reason: "wide data grid" }],
    intentionalOverlays: [{ selector: "[role=dialog]", reason: "open modal" }],
  },
});
```

The option object is closed: unknown fields, unbounded target counts, malformed exception records,
and any trust/network value other than the two literals above are rejected before the adapter calls
the page. `SCREEN_OPTIONS_SCHEMA` is the matching exported input schema for tooling.

Screen reports are discriminated by `profileKind: "screen"`; they do not contain Paged.js pages or
PDF coordinates. They record the sanitized route, current viewport and scroll coordinate system,
browser version, before/stable/after capture signatures, actual PNG hash and dimensions, target
evaluations (including healthy, excluded, and not-measured targets), coverage counts, and typed
events. The first screen profile measures only unexpected horizontal overflow and content visibly
cut by rectangular `overflow: hidden` or `clip` ancestors. Ordinary vertical scrolling and general
visual occlusion are outside this measurement contract.

Visible source containers can optionally be verified against a host build receipt. This does not
accept a caller claim of being bound: breaklint captures the receipt and its declared root-relative
source/config/lock files before and after the screenshot, checks every digest and inventory digest,
then checks the rendered build ID meta element. A verified result is only
`verified-container-only` via `build-bound-component-container`; it is never an exact source-line
claim. Missing, stale, or changed proof remains declared/unknown with a typed event.

## Complete example

```json
{
  "profile": "default",
  "failOn": "warn",
  "locale": "de-DE",
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
| `default` | `error` | by severity: error 1, warning 0.5, info 0 | every rule except the off-by-default `layout/half-empty-page` |
| `strict` | `warn` | 1 for every rule | every rule, `layout/half-empty-page` included |

`strict` is a real preset, not a label. A config-file `failOn` can replace its warning gate and a
CLI `--fail-on` can replace the file. Coverage is different: `coverageFloors` can equal or raise
the active profile floor, never lower it. `strict` therefore cannot be made partially blind by a
file that asks for 0.9 or by a later `--profile default`; both invocations end with exit 2.

CLI rule selection is also explicit. `--only` replaces config-file enablement for the selected
set, then `--disable` can remove rules from that set. Empty lists and unknown rule ids are usage
errors.

## Rules and options

A rule value is either `true`, `false`, or an options object. `false` disables the rule; any other
value enables it — `true`, and equally an options object, including an empty one. For the rules that
run by default this is invisible; for the off-by-default `layout/half-empty-page` it means that
configuring an option also turns the rule on (see [limitations](limitations.md)), and a
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

## What the JSON report proves

The canonical document JSON report uses report schema 5 and records:

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

Report schema and snapshot schema evolve independently. The current source-bound report is schema 5, stored measurement snapshots are schema 5, and Configuration Contract remains v1. Each changes only when its own structure changes — including for an additive, optional field: an optional property does not let a schema-aware consumer tell the two shapes apart, and a strict decoder may reject it. Report schema 5 adds the optional `remediation` on a finding. Readers accept 4 and 5; only the emitter moved. Snapshot schema 5 adds two required block fields, the computed `display` and the count of margin-box copies (`marginCopies`); the engine judges only a snapshot of its own stamp and refuses any other (exit 3), and there is no reader for the previous snapshot shape, because the only stored snapshot, the `--demo` one, is migrated with the stamp.

## Command-line output options

`--format`, `--out` and `--out-dir` are command-line options only; a config file cannot set them,
and they are not part of `config.effective` or the fingerprint, because they decide where and in
which projection a result is written rather than what is measured.

`--out-dir <dir>` is the directory a live run writes its evidence into: one PNG per page and the
PDF it checked. It defaults to `./breaklint-report`, relative to the working directory, and is
created when a live run first writes evidence into it; `--demo` writes no evidence and creates
nothing. A
missing or blank value is exit 2. The report does not repeat the directory, but every
`evidence[].path` in it is relative to it, so the report and the directory travel together.
`tests/e2e/input-validation.test.ts` pins the exit-2 cases and `--help`, and
`tests/live/cli-out-dir.test.ts` observes the evidence landing in the named directory and in the
default one.

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
