# Conservative figure checks, registered before measurement

Scope: source-derived standard figure/figcaption relations and local figure-labelled href existence, both warning and default-off. No runtime dependency, free-text number validation, guessed break cause, wrapper-as-body geometry, new production collector hooks or product bytes.

The hand-written MIT fixture oracle is `tests/fixtures/figures/expected.json`; its HTML and expected values precede implementation measurements. Captions support one authored img or inline svg body with one positively measured page and one visible caption. Multiple, hidden, unbound or multi-page bodies decline. Local references are aggregated per source block; exact fragment-only hrefs with Figure/Fig./Abbildung/Abb. plus a number are checked against all authored IDs. Duplicate targets decline, external links are outside scope.

Snapshot 6 adds an optional figure inventory. Snapshot 5 remains readable for old rules; missing inventory declines enabled new rules and cannot become a clean new check. Existing report 5 shape, identities, evidence and coverage accounting remain. A script-bearing or SID-less source is not a complete source/placement inventory.

Acceptance: independently authored trigger and clean cases; behavioral pre-fix red; fixed focused unit/typecheck/schema/doc gates; real built CLI and independent PDF-text placement witnesses for A4/Letter; targeted guard-removal mutants killed by finding/rule/target or decline assertions. No outcome is promised. New rule remedies remain untested until a genuine remedy pair is checked. Full release gates and fresh independent review belong to the integration freeze.

Files: src/measure/snapshot.ts; src/source/figure-index.ts; src/core/types.ts, enums.ts, engine.ts; src/rules/figure/**; src/rules/index.ts; src/config/contract.ts; focused tests/live fixtures, tests/fixtures/corpus.ts, tests/unit/snapshot.test.ts, examples/demo-snapshot.json; generated config/rule docs; docs/source-bound-findings.md, configuration.md, limitations.md. Versions/changelog/README/releasing/report surfaces belong to other owners.

Stop on unsafe or unmeasurable figure acquisition. Do not fabricate body placement or relax existing gates. Retain limitation and ship only independently proven functionality. Public input is self-authored; no paid corpus is copied. Builder runtime model: UNKNOWN.
