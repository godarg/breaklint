#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const RENDERER = resolve(ROOT, "tests/tools/render-report-surfaces.mjs");

/**
 * Every negative control the renderer knows. `expect` is the message a genuine red run must carry:
 * a control that fails for a different reason is not the control it claims to be.
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
    // The phase this control must reproduce, pinned: exactly one row on the continuation page.
    // Should the forced break stop producing it, the mutation could still exit 1 for another
    // reason — or go green — and this assertion is what says so out loud instead.
    phase: /"rows":1\}/u,
    phaseHint: "the forced break no longer leaves one row on a continuation page; re-derive the control from the current table",
  },
  { name: "broken-row-rule", state: "insufficient-coverage", expect: /coverage row rule is open/u, sides: ["left", "right"] },
  { name: "broken-right-row-rule", state: "insufficient-coverage", expect: /coverage row rule is open/u, sides: ["right"] },
  { name: "broken-left-row-rule", state: "insufficient-coverage", expect: /coverage row rule is open/u, sides: ["left"] },
  { name: "broken-both-row-rule", state: "insufficient-coverage", expect: /coverage row rule is open/u, sides: ["left", "right"] },
  { name: "broken-column-alignment", state: "findings", expect: /coverage column 3 misaligned/u },
  { name: "broken-header-repeat", state: "clean", expect: /long coverage table: continuation page lacks the table header/u },
  { name: "broken-flag-wrap", state: "insufficient-coverage", expect: /print\/insufficient-coverage: flag --disable layout\/widow split across [2-9] lines/u },
  { name: "broken-rule-id-wrap", state: "findings", expect: /rule id layout\/[a-z-]+ split across [2-9] lines/u },
  { name: "broken-untested-repeat", state: "findings", expect: /untested-advice caveat appears 8 times in the PDF/u },
  { name: "broken-untested-marker", state: "findings", expect: /untested marker is not set in body-text colour/u },
  {
    name: "broken-soft-contrast",
    state: "findings",
    expect: /WCAG AA contrast failed/u,
    phase: /"fg-muted\/soft":(?:[0-3]\.\d+|4\.[0-4]\d*)[,}]/u,
    phaseHint: "the control no longer drives muted text on the soft background below 4.5:1",
  },
  { name: "collapsed-display-font", state: "clean", expect: /display role resolved to [^\n]*not a declared serif face/u },
  { name: "accidental-display-font", state: "clean", expect: /display role resolved to DejaVu Sans, not a declared serif face/u },
];

/**
 * The riddle this closes: three named controls — broken-coverage, broken-trust-geometry and
 * broken-terminal-density — sat in the renderer's allowlist and in no control list, so none of them
 * had ever run. In a review they read as negative controls; measured, broken-terminal-density could
 * not go red at all and was removed. A control nobody runs is indistinguishable from a control that
 * does not work, so the renderer's control table and this list are held against each other.
 */
const listed = spawnSync(process.execPath, ["--experimental-strip-types", RENDERER, "--list-controls"], { cwd: ROOT, encoding: "utf8" });
assert.equal(listed.status, 0, `cannot read the renderer's control table\n${listed.stdout}${listed.stderr}`);
const declared = JSON.parse(listed.stdout);
assert.deepEqual(
  [...declared].sort(),
  controls.map((control) => control.name).sort(),
  "the renderer declares a mutation that no control runs, or this list names one the renderer does not know",
);

for (const control of controls) {
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
          BREAKLINT_SURFACE_CONTROL: control.name,
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
