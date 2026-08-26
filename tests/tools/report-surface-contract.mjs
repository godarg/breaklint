#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const REVIEW_INPUT_CONTRACT_VERSION = 1;
export const REVIEW_INPUT_DOMAIN = "breaklint-report-surface-review-input-v1";

/**
 * Every source that can change the rendered review subject or the gate judging it. Directories are
 * recursive by design: adding a reporter/rule file changes the contract instead of escaping it.
 */
export const REVIEW_INPUT_ROOTS = Object.freeze([
  ".github/workflows/ci.yml",
  "src/acquire/browser.ts",
  "src/config",
  "src/core",
  "src/report",
  "src/rules",
  "examples/demo-snapshot.json",
  "tests/fixtures/report-states.ts",
  "tests/tools/render-report-surfaces.mjs",
  "tests/tools/report-surface-mutations.mjs",
  "tests/tools/verify-report-surfaces.mjs",
  "tests/tools/report-surface-contract.mjs",
  "package.json",
  "package-lock.json",
]);

export const DEFAULT_REVIEW_INPUT_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../..",
);

function posix(path) {
  return path.split(sep).join("/");
}

function filesBelow(root, target) {
  const absolute = resolve(root, target);
  const stat = lstatSync(absolute);
  if (stat.isSymbolicLink()) throw new Error(`review input may not be a symlink: ${target}`);
  if (stat.isFile()) return [absolute];
  if (!stat.isDirectory()) throw new Error(`review input is neither file nor directory: ${target}`);
  return readdirSync(absolute, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name, "en"))
    .flatMap((entry) => filesBelow(root, join(target, entry.name)));
}

export function reviewInputFiles(root = DEFAULT_REVIEW_INPUT_ROOT) {
  const files = REVIEW_INPUT_ROOTS.flatMap((target) => filesBelow(root, target))
    .map((path) => ({ path, relativePath: posix(relative(root, path)) }))
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath, "en"));
  const duplicates = files.filter((file, index) => index > 0 && file.relativePath === files[index - 1].relativePath);
  assert.deepEqual(duplicates, [], "review-input roots overlap and hash a file twice");
  return files;
}

function frame(hash, value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value, "utf8");
  hash.update(Buffer.from(`${bytes.length}:`, "ascii"));
  hash.update(bytes);
  hash.update(Buffer.from("\0", "ascii"));
}

export function computeReviewInput(root = DEFAULT_REVIEW_INPUT_ROOT) {
  const hash = createHash("sha256");
  frame(hash, REVIEW_INPUT_DOMAIN);
  frame(hash, String(REVIEW_INPUT_CONTRACT_VERSION));
  const files = reviewInputFiles(root).map(({ path, relativePath }) => {
    const bytes = readFileSync(path);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    frame(hash, relativePath);
    frame(hash, bytes);
    return { path: relativePath, bytes: bytes.length, sha256 };
  });
  return { fingerprint: hash.digest("hex"), files };
}

export function assertCurrentReviewInput(expected, root = DEFAULT_REVIEW_INPUT_ROOT, label = "review input") {
  assert.match(expected, /^[0-9a-f]{64}$/u, `${label}: expected fingerprint is not SHA-256`);
  const current = computeReviewInput(root);
  assert.equal(
    current.fingerprint,
    expected,
    `${label}: current bound inputs ${current.fingerprint} do not match reviewed input ${expected}`,
  );
  return current;
}

/**
 * Real red control: reproduce the complete bound tree in a disposable root, mutate one byte-bound
 * source, then prove the same comparison used by the verifier rejects the former fingerprint.
 */
export function runReviewInputMutationControl(expected, root = DEFAULT_REVIEW_INPUT_ROOT) {
  const source = computeReviewInput(root);
  assert.equal(source.fingerprint, expected, "mutation control must start from the reviewed input");
  const temporaryRoot = mkdtempSync(join(tmpdir(), "breaklint-report-surface-contract-"));
  try {
    for (const file of source.files) {
      const destination = resolve(temporaryRoot, file.path);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, readFileSync(resolve(root, file.path)));
    }
    assert.equal(computeReviewInput(temporaryRoot).fingerprint, expected, "temporary control copy drifted before mutation");
    appendFileSync(resolve(temporaryRoot, "src/report/html-model.ts"), "\n// review-input-mutation-control\n");
    const mutated = computeReviewInput(temporaryRoot).fingerprint;
    assert.notEqual(mutated, expected, "bound input mutation left the fingerprint unchanged");
    assert.throws(
      () => assertCurrentReviewInput(expected, temporaryRoot, "mutation control"),
      /do not match reviewed input/u,
      "the verifier comparison accepted a pass after a bound input mutation",
    );
    return { before: expected, after: mutated, mutated: "src/report/html-model.ts" };
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const current = computeReviewInput();
  const control = runReviewInputMutationControl(current.fingerprint);
  process.stdout.write(
    `report-surface input contract: ${current.files.length} files, ${current.fingerprint}; ` +
      `mutation rejected (${control.after})\n`,
  );
}
