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
const controls = [
  { name: "broken-box-closure", sides: ["right"] },
  { name: "broken-partial-box-closure", sides: ["right"] },
  { name: "broken-left-box-closure", sides: ["left"] },
  { name: "broken-partial-both-box-closure", sides: ["left", "right"] },
];

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
          BREAKLINT_SURFACE_STATE: "insufficient-coverage",
        },
      },
    );
    const transcript = `${result.stdout}${result.stderr}`;
    assert.notEqual(result.status, 0, `${control.name}: mutation unexpectedly rendered green\n${transcript}`);
    assert.match(transcript, /coverage boxes have an open physical edge/u, `${control.name}: failed for the wrong reason\n${transcript}`);
    const measurements = [];
    for (const side of control.sides) {
      const match = new RegExp(`"${side}Coverage":(0(?:\\.\\d+)?),"${side}MaximumGapPx":([1-9]\\d*)`, "u").exec(transcript);
      assert.ok(match, `${control.name}: no measured open ${side} edge in genuine red run\n${transcript}`);
      assert.ok(Number(match[1]) < 0.98, `${control.name}: ${side} coverage did not cross the rejection threshold`);
      assert.ok(Number(match[2]) > 2, `${control.name}: ${side} gap did not cross the rejection threshold`);
      measurements.push(`${side}=${match[1]}/${match[2]}px`);
    }
    process.stdout.write(`${control.name}: expected red (exit ${result.status}); ${measurements.join(", ")}\n`);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
}
