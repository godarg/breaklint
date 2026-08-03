# What is finished and what is not

This page exists because the alternative is worse. A layout checker whose green state means
nothing is more dangerous than no checker at all, so what has been measured and what has not is
stated here rather than left to be inferred from a passing test suite.

## Finished and verified without a browser

| | |
|---|---|
| 15 rules as pure functions over a snapshot | `src/rules/` |
| Mutation guard | 15/15 rules kill every mutant, each on a fixture that actually triggers it |
| False-alarm corpus | every clean fixture stays silent, every trigger fixture fires and is attributed correctly |
| Exit matrix | 27 rows over all five exit codes, all nine `failOn` rows and every precedence edge; each row asserts on exit code **and** verdict **and** `gateTriggeredBy` |
| Six output formats | each carries every mandatory counter, checked mechanically, including on a clean run |
| Licence gate | `dependencies` and `optionalDependencies`; a missing licence field fails |
| `npx breaklint --demo` | runs the real rule and reporter chain, exit 1, 8 findings across 8 rules |

## Not finished

**The live render path.** `src/acquire/render-run.ts` resolves the browser and enforces the
Paged.js version gate, and then stops with exit 3 and an infrastructure event naming the stage.
It does not return an empty snapshot and it never reports a clean document.

Still to build: the in-page measurement probe, the collector that reads the paginator's own
break attributes, and the evidence rasteriser with its PDF-against-PDF overlay check. The
mechanisms for all three are measured and documented; the wiring is not written.

**What that means for a reader today.** `--demo` shows what the rules do and what a report looks
like. It does not show the render path, and the report says so in its own `mode` and `source`
fields rather than leaving you to assume.

## What no amount of testing here establishes

Every threshold is uncalibrated. There is no corpus of real documents with human-checked truth
behind any of the fifteen numbers, so the fixtures show that each rule *does what it says*, not
that what it says is the right thing to say about a real document. That distinction is the
difference between a verified implementation and a validated one, and only the first is claimed.
