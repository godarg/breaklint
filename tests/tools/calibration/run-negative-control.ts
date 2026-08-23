#!/usr/bin/env node

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  instantiateNegativeControl,
  NEGATIVE_CONTROLS,
} from "../../fixtures/calibration/negative-controls.ts";
import { validateManifest } from "./readiness-validator.ts";

const ARTIFACT_ROOT = fileURLToPath(new URL("../../fixtures/calibration/", import.meta.url));

function main(): void {
  const id = process.argv[2];
  if (!id) {
    process.stderr.write(`usage: run-negative-control.ts <${NEGATIVE_CONTROLS.map((entry) => entry.id).join("|")}>\n`);
    process.exitCode = 2;
    return;
  }
  const control = NEGATIVE_CONTROLS.find((entry) => entry.id === id);
  if (!control) {
    process.stderr.write(`unknown negative control: ${id}\n`);
    process.exitCode = 2;
    return;
  }
  const kase = instantiateNegativeControl(control);
  const report = validateManifest(kase.manifest, {
    artifactRoot: ARTIFACT_ROOT,
    ...(kase.previousManifest ? { previousManifest: kase.previousManifest } : {}),
  });
  process.stdout.write(`${JSON.stringify({ controlId: id, expectedCode: control.expectedCode, report }, null, 2)}\n`);
  process.exitCode = report.exitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
