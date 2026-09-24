#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const RENDERER = resolve(ROOT, "tests/tools/render-report-surfaces.mjs");
const rendererSource = readFileSync(RENDERER, "utf8");

/**
 * Every physical print control the renderer knows. `expect` is the message a genuine red run must
 * carry: a control that fails for a different reason is not the control it claims to be.
 */
const controls = [
  {
    name: "broken-coverage",
    state: "insufficient-coverage",
    expect: /print reflow contract failed/u,
  },
  {
    name: "broken-trust-geometry",
    state: "insufficient-coverage",
    expect: /print reflow contract failed/u,
  },
  {
    name: "broken-tail-cohesion",
    state: "findings",
    expect: /underfilled terminal coverage continuation/u,
    // The phase this control must reproduce, pinned. It releases the tail bracket and forces four
    // records per page against thirteen rules, so the terminal page carries exactly one. Should the
    // rule count stop leaving a remainder of one, the mutation would still run and still exit 1 for
    // the wrong reason — or go green — and this assertion is what says so out loud instead.
    phase: /"previousCoverageRecords":4,"terminalCoverageRecords":1/u,
    phaseHint: "the forced phase no longer leaves one record on the terminal page; " +
      "re-derive the nth-child stride in render-report-surfaces.mjs from the current rule count",
  },
  { name: "broken-box-closure", state: "insufficient-coverage", expect: /coverage boxes have an open physical edge/u, sides: ["right"] },
  { name: "broken-partial-box-closure", state: "insufficient-coverage", expect: /coverage boxes have an open physical edge/u, sides: ["right"] },
  { name: "broken-left-box-closure", state: "insufficient-coverage", expect: /coverage boxes have an open physical edge/u, sides: ["left"] },
  { name: "broken-partial-both-box-closure", state: "insufficient-coverage", expect: /coverage boxes have an open physical edge/u, sides: ["left", "right"] },
  {
    name: "broken-soft-contrast",
    state: "findings",
    expect: /WCAG AA contrast failed/u,
    phase: /"fg-muted\/soft":(?:[0-3]\.\d+|4\.[0-4]\d*)[,}]/u,
    phaseHint: "the control no longer drives muted text on the soft background below 4.5:1",
  },
];

/**
 * The riddle this closes: three named controls — broken-coverage, broken-trust-geometry and
 * broken-terminal-density — sat in the renderer's allowlist and in no control list, so none of them
 * had ever run. In a review they read as negative controls; measured, broken-terminal-density could
 * not go red at all and was removed. A control nobody runs is indistinguishable from a control that
 * does not work, so the allowlist and this list are now held against each other.
 */
const allowlist = /^if \(!\[(.+?)\]\.includes\(PRINT_MUTATION_CONTROL\)\)/mu.exec(rendererSource);
assert.ok(allowlist, "cannot read the renderer's mutation allowlist");
const declared = [...allowlist[1].matchAll(/"([^"]+)"/gu)].map((match) => match[1]).filter((name) => name !== "none");
assert.deepEqual(
  [...declared].sort(),
  controls.map((control) => control.name).sort(),
  "the renderer declares a print mutation that no control runs, or this list names one the renderer does not know",
);

for (const control of controls) {
  assert.ok(
    rendererSource.includes(`PRINT_MUTATION_CONTROL === "${control.name}"`),
    `${control.name}: renderer mutation branch is absent`,
  );
  const output = mkdtempSync(join(tmpdir(), `breaklint-${control.name}-`));
  try {
    const result = spawnSync(
      process.execPath,
      ["--experimental-strip-types", RENDERER],
      {
        cwd: ROOT,
        encoding: "utf8",
        env: {
          ...process.env,
          BREAKLINT_SURFACE_DIR: output,
          BREAKLINT_SURFACE_PRINT_CONTROL: control.name,
          BREAKLINT_SURFACE_STATE: control.state,
        },
      },
    );
    const transcript = `${result.stdout}${result.stderr}`;
    assert.notEqual(result.status, 0, `${control.name}: mutation unexpectedly rendered green\n${transcript}`);
    assert.match(transcript, control.expect, `${control.name}: failed for the wrong reason\n${transcript}`);
    if (control.phase) {
      assert.match(transcript, control.phase, `${control.name}: ${control.phaseHint}\n${transcript}`);
    }
    const measurements = [];
    for (const side of control.sides ?? []) {
      const match = new RegExp(`"${side}Coverage":(0(?:\\.\\d+)?),"${side}MaximumGapPx":([1-9]\\d*)`, "u").exec(transcript);
      assert.ok(match, `${control.name}: no measured open ${side} edge in genuine red run\n${transcript}`);
      assert.ok(Number(match[1]) < 0.98, `${control.name}: ${side} coverage did not cross the rejection threshold`);
      assert.ok(Number(match[2]) > 2, `${control.name}: ${side} gap did not cross the rejection threshold`);
      measurements.push(`${side}=${match[1]}/${match[2]}px`);
    }
    process.stdout.write(`${control.name}: expected red (exit ${result.status})${measurements.length > 0 ? `; ${measurements.join(", ")}` : ""}\n`);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
}
