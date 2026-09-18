# `artifact/local-uri`

| | |
|---|---|
| severity | warn |
| threshold | occurrences: 0 permitted |
| proof source | — |
| calibrated | **no** |

## What is checked

A `file:` URI or an absolute build-machine path remains in the artefact.

## Why

**Downgraded from `error`.** An earlier version claimed proof class A, which demands a *geometric* invariant between two measured quantities; a URI scheme is not one, and a local reference can be intentional. Proof class C — a resolution invariant — describes what this rule would need, and no spike supports it. A proof class that exists only on paper is not a proof.

## Limits and known false alarms

Reads `uriRefs`, which holds every URI-bearing attribute and every CSS `url()` from DOM and CSSOM **whether or not the browser fetched it**. Reading the loaded-resource list instead would miss a `srcset` candidate the browser never chose and a rule that never applied — precisely the references that survive to bite someone later.

`data:` URIs and relative paths are not local URIs.

## Calibration

`calibrated: false`. The threshold has not been fitted to a corpus of real documents with
human-checked truth; no such corpus exists for this project. Every finding says so, and the
report says so in `measurement.calibrated`. That is the honest state, not a defect — but it is
also why this rule ships with the severity it has.

## Remediation

Replace absolute filesystem paths with relative URLs, packaged assets, or public production URLs. An absolute path resolves only on the machine that built the file.

## Examples

### Firing case (trigger)

```html
<p>
  <a href="file:///example/project/notes.txt">Local document notes</a>
</p>
```

### Non-firing case (remedied)

```html
<p>
  <a href="notes.txt">Relative document notes</a>
</p>
```

