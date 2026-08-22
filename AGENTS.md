# breaklint repository contract

This file is the short operating contract for coding agents. Product claims, rule thresholds,
exit semantics, and release state remain single-sourced in the implementation and the linked
documents; do not copy their current values here.

## Read before changing behavior

- `README.md` for the public contract and supported workflow.
- `docs/status.md` and `docs/limitations.md` for the honest capability boundary.
- `docs/configuration.md` for Configuration Contract v1.
- The affected `docs/rules/*.md` page before changing a rule.
- `CONTRIBUTING.md` before adding a rule or changing a public schema.
- `SECURITY.md` before changing acquisition, browser, network or dependency boundaries.
- `.github/workflows/ci.yml` for the executable public gate inventory.

For Dargel-managed work, the accepted decision and narrowly applicable product contract under
`../Dargel Solutions/02_Products/Digital_Products/07_breaklint/` control scope and sequence. A
historical audit or proposed decision is evidence, not current authority. Stop and report a
conflict between an accepted decision, the normative contract, repository status and runtime.

## Invariants

- A clean exit is evidence that the requested checks actually ran. Never turn setup failure,
  insufficient coverage, or an idle checker into exit 0.
- Unknown configuration is rejected. A public option must be validated, applied, reported, and
  tested; otherwise it is not an option.
- Proof-source-A thresholds are not configurable. Coverage floors may only be raised.
- Runtime validation and `breaklint.schema.json` derive from the rule registry. Do not maintain a
  second hand-written rule or option table.
- Report and snapshot schemas evolve independently. Never raise a schema stamp without migrating
  and testing the artifact it names.
- JSON is the canonical report. Other reporters are deliberately lossy projections.
- Every rule accounts for candidates, measured objects, and declared non-measurement reasons.
- Preserve deterministic ordering and fingerprints. Normalize semantically set-like input before
  hashing it.

## Change procedure

1. State the public behavior and the failure case before editing.
2. Add or update a test that observes the real consumer-visible path.
3. For a bug fix or guardrail, demonstrate that the test fails when the protection is removed.
4. Run the focused tests while iterating, then the complete repository gate documented in
   `CONTRIBUTING.md`.
5. Update public documentation and the changelog in the same change.
6. Do not publish, tag, push, or weaken a gate without explicit maintainer approval.

Generated artifacts must be checked with their generator. For the configuration schema use
`npm run schema:write` to update it and `npm run schema:check` to prove it is current.
