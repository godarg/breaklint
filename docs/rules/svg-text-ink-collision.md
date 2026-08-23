# `svg/text-ink-collision`

| | |
|---|---|
| severity | warn |
| threshold | 8 device pixels on either band |
| proof source | — |
| calibrated | **no** |

## What is checked

A shape crosses or covers the glyphs of a text element.

## Why

Two bands: `collisionInk = |T ∩ S|` and `occludedInk = |T ∧ ¬F|`. The second exists because the first cannot see the practically most important case — an opaque **white** rectangle over the text carries no ink of its own, so the intersection stays 0 while the text is wiped out. Measured: collision 0, occlusion 8 263.

Bounding-box overlap is wrong in 2 of 8 collision fixtures; the clearest case is a line running exactly through the gap between two text lines. A fixed sampling grid misses too: a short thin line grazing a corner is hit 0 times at a 4 px step and, in the recorded reference environment, 51 times at 0.25 px. The portable contract gates `0` versus `> 0`; it does not pin 51 across renderers.

## Limits and known false alarms

**What this rule does not find:** the sub-pixel contact case — a shape close enough to touch a glyph optically without sharing a device pixel. The old contact band caught it through `isPointInStroke`, the circular oracle this design forbids. Dropping it was right and it cost recall. That loss is stated in the finding text, here, and in the README.

## Calibration

`calibrated: false`. The threshold has not been fitted to a corpus of real documents with
human-checked truth; no such corpus exists for this project. Every finding says so, and the
report says so in `measurement.calibrated`. That is the honest state, not a defect — but it is
also why this rule ships with the severity it has.

M3-0 runs the bounding-box gap, 0.4 px hairline, pale-colour and opaque-white occlusion boundaries
in real Chrome/Paged.js. It also reproduces the separate S9-D grazing-corner sampling
counterexample (portable gate: 4 px grid `0`; 0.25 px grid `> 0`, observed `51` in the reference run) without treating mere box contact as glyph truth.
The current eight-device-pixel bands remain unchanged and uncalibrated; no eligible real corpus or
frozen holdout exists. See [`../validation/oracle-contract-v1.md`](../validation/oracle-contract-v1.md).
Any future acceptance report must be derived from complete frozen-holdout target rows; a writable
aggregate confusion matrix is not claim evidence. Its collision/occlusion receipt is replayed
through the source-pinned unchanged registry `Rule.run`, including decline states, before any
prediction is compared with independent truth.
Contract-simulation receipts remain outside the real-evidentiary denominator. A later claim-grade
run additionally requires a separately supplied capture bundle and attestation bound to the exact
real-render receipt rows, plus an owner-approved external trust root that M3-0 does not possess.
