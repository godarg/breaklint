# Contributing

## Adding a rule

Three files, and a test enforces all three:

1. `src/rules/<namespace>/<name>.ts` — a pure function over the snapshot.
2. A trigger fixture and at least one clean fixture in `tests/fixtures/corpus.ts`.
3. `docs/rules/<namespace>-<name>.md`.

## Two rules about tests

**Every fixture names its complication.** A fixture without the case that breaks the naive
implementation tests the naive implementation. The `complication` field is not documentation,
it is the reason the fixture exists.

**A mutant counts as killed only when an assertion on (count, rule id, target) fails.** An
assertion on the threshold alone kills two of five mutants, and the three survivors are the
dangerous ones: a rule that emits nothing, a rule with an inverted comparator, and a rule that
attributes its findings to the wrong id.

## Severity

A rule may carry `error` only with a named proof source: a geometric invariant between two
directly measured quantities, or a cited norm together with the cases the norm does not cover.
`defineRule` rejects anything else, and the registry fails if the count of error rules changes
without the argument being made in `docs/`.
