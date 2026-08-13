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

A rule may carry `error` only with a named proof source. There are three classes — a geometric
invariant between two directly measured quantities, a cited norm together with the cases it does
not cover, and a resolution invariant — and they are defined in
[`docs/limitations.md`](docs/limitations.md). Both current error rules are class A; no rule claims
B or C.

`defineRule` rejects `error` without a proof source, and rejects a proof source on anything that is
not an error. The registry refuses to load if the number of error rules is anything other than two,
and its message points at `docs/limitations.md`, where the argument for the number belongs. The
check does not read that file — it only makes the change deliberate, so write the argument before
you change the literal.
