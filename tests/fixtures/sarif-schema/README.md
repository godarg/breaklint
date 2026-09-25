# SARIF 2.1.0 JSON schema (test-only)

`sarif-2.1.0.json` is used by `tests/tools/report-format-checks.mjs` to validate the SARIF that
breaklint and the GitHub Action write. It is a test fixture: it is not in the npm package
(`package.json` `files` does not list `tests/`), it is never fetched at test time, and no code
path of the tool reads it.

| | |
|---|---|
| file | `sarif-2.1.0.json` |
| source | https://raw.githubusercontent.com/microsoft/sarif-sdk/15db5a7123e66eb39d637e07e3815b30c3f29c12/src/Sarif/Schemata/sarif-2.1.0.json |
| repository | microsoft/sarif-sdk, commit `15db5a7123e66eb39d637e07e3815b30c3f29c12` (the `main` branch on 2026-09-24) |
| licence | MIT, Copyright (c) Microsoft Corporation; the repository's licence file is copied unchanged as `LICENSE.sarif-sdk` |
| sha256 | `0de6555c956d0e2081bb40f0b877f275634cba28a6f8954e6d858a49138143d6` |
| licence file sha256 | `5ca93c6ae1bff4692a04550366277550eb7c149fcc639abd9ee51305d1836ca7` |

The bytes are unchanged. `report-format-checks.mjs` refuses to validate anything if the file's
sha256 differs from the value above, so an edit here cannot pass silently.

## Why this copy and not the OASIS one

The normative schema is published by OASIS with the SARIF 2.1.0 Errata 01 standard
(`https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json`,
sha256 `c3b4bb2d6093897483348925aaa73af03b3e3f4bd4ca38cef26dcb4212a2682e`). Its copyright notice
permits copying but not modification, and its repository states no open-source licence, so it
was not vendored. The copy maintained in Microsoft's SARIF SDK is MIT-licensed, which is
compatible with this repository's MIT licence. The copy `github/codeql-action` bundles for
`upload-sarif` carries the OASIS content under that repository's MIT licence; it was compared but
not used, because the licence of content copied from OASIS is not established by the repository
it was copied into.

## How this copy differs from the OASIS errata01 schema

Compared structurally on 2026-09-24; the checker makes up for the one difference that loosens it.

- It declares JSON Schema 2020-12 instead of draft-04 (Ajv 8 does not read draft-04 without an
  extra package).
- A `region` in the OASIS schema must carry `startLine`, `charOffset` or `byteOffset`; this copy
  drops that `anyOf`. **The checker restores it in memory** before compiling, so the constraint is
  enforced. The vendored file is not edited.
- GUID properties use `format: uuid` instead of the OASIS pattern. The checker implements `uuid`
  as that OASIS pattern (version 1 to 5, RFC 4122 variant). breaklint writes no GUIDs.
- `runs` may not be `null` here (OASIS allows it), and several enum-constrained properties omit a
  redundant `type: string`. Both are at least as strict as OASIS.

## Formats

The schema uses the formats `uri`, `uri-reference`, `date-time` and `uuid`. Ajv implements none of
them without `ajv-formats`, which is not a dependency of this repository, and would otherwise
ignore an unknown format in silence. `report-format-checks.mjs` therefore implements the four
itself (RFC 3986 syntax for the two URI formats, RFC 3339 for `date-time`), and the unit tests
include a document each format check must reject.
