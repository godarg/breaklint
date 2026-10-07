# Focused 0.9 completion plan

The maintainer authorized a focused completion on 2026-10-07, replacing the exhaustive
all-document, all-model audit process for this release. Historical failed reviews remain
in the progress log; they are not passing evidence for the smaller implementation.

## Scope and acceptance, registered before new measurements

1. Reduce a reproduced false alarm or add a useful source-bound check. Keep unsupported
   acquisition explicit and new heuristic checks at warning severity or disabled by default.
2. Show up to three deterministic next checks in human reports and show counted reasons for
   declined candidates even when coverage meets its floor. Retain every individual finding.
3. Allow an explicitly delegated AI sight review as its own review kind, bound to the complete
   physical artifact inventory. It must never be presented as a human review. Historical
   agent records do not become passing records. Nondelegated agent records still cannot pass.
4. Run the complete existing release gates, the 100% mutation contract, actual packed CLI/API
   consumers on Node 24 and 22.13, and a fresh independent Opus review with no open blocker/high.
5. Render and actually inspect all report surface cells and every physical A4 page. Preserve
   input, environment, artifact and pixel hash checks. Review only frozen inputs.
6. Release through CI and the annotated tag workflow, then measure registry integrity, release
   assets, provenance, clean demo and Action use. Connect the bilingual site and local consumers.

A hand-written fixture oracle must precede each new rule measurement. Each behavioral fix has
a failing pre-fix run, passing fixed run and protection-removal test. No runtime dependency is
added. JSON remains canonical. A changed serialized structure moves its own stamp with migration.

## Stop conditions and claims

Do not publish with an unresolved blocker/high, a failing technical gate, a clean exit for an
incomplete requested check, accepted unknown configuration, or missing source/evidence binding.
No threshold, timeout, tolerance or digest is relaxed to obtain green. Unproved new functionality
is removed from this release and remains in the open-work register.

This release does not claim calibration, a complete figure/reference/page-number model,
all-product precision/recall percentages, or a completed blind all-product A/B. Those studies
remain useful future work; the original numeric criteria were not measured to completion.
