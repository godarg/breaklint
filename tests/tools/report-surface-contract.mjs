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

/**
 * A browser `--version` string is measurable when it names a product and a four-part version.
 * README.md supports "a Chromium-based browser", so the product word is not constrained to one
 * vendor: `Chromium 141.0.7390.37`, `Google Chrome 152.0.7977.64`, `Google Chrome for Testing …`
 * and `Microsoft Edge …` are all accepted. What is rejected is a string from which no exact build
 * can be read — a bare product name, a user-agent token such as `HeadlessChrome/141.…`, or a
 * three-part version. Until this pattern existed the verifier matched `/Chrome…/`, which rejected
 * every Chromium build and therefore made a review on one impossible to bind in either mode.
 */
export const BROWSER_VERSION_PATTERN = /^[A-Za-z][A-Za-z ]*? \d+\.\d+\.\d+\.\d+(?: |$)/u;

export function isMeasurableBrowserVersion(value) {
  return typeof value === "string" && BROWSER_VERSION_PATTERN.test(value);
}

/** Bumped when the fields entering the stable review-artifact fingerprint change shape. */
export const REVIEW_ARTIFACT_CONTRACT_VERSION = 4;
export const SCREEN_PIXEL_CONTRACT_VERSION = 1;
export const REVIEW_LEDGER_SCHEMA_VERSION = 6;
export const REQUIRED_BROWSER_RENDER_ARGS = Object.freeze([
  "--deterministic-mode",
  "--disable-gpu",
  "--disable-lcd-text",
  "--disable-skia-runtime-opts",
  "--font-render-hinting=none",
  "--force-color-profile=srgb",
  "--hide-scrollbars",
]);

/**
 * The declared review environment is what a review BINDS: the fields that decide which pixels a
 * reviewer saw. Values that change with an operating-system update or a Node patch release without
 * changing a single pixel — the kernel/Darwin release string, the exact Node version — are
 * recorded as observations beside it, not bound. A binding nobody can re-enter after one OS update
 * is not a reproducible environment.
 */
export const DECLARED_ENVIRONMENT_FIELDS = Object.freeze([
  "reviewArtifactContractVersion",
  "screenPixelContractVersion",
  "browser",
  "platform",
  "architecture",
  "nodeMajor",
  "deviceScaleFactor",
  "browserRenderArgs",
  "viewports",
  "themes",
  "print",
]);
export const OBSERVED_ENVIRONMENT_FIELDS = Object.freeze(["platformRelease", "node"]);

function assertUtc(value, message) {
  assert.match(value ?? "", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u, message);
  assert.equal(Number.isNaN(Date.parse(value)), false, message);
}

function assertUtcOrDate(value, message) {
  assert.match(value ?? "", /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)?$/u, message);
  assert.equal(Number.isNaN(Date.parse(value)), false, message);
}

const SHA256 = /^[a-f0-9]{64}$/u;

/**
 * Validates a render or review environment. `historical` accepts the contract-3 shape a round
 * recorded before this version existed (it bound `platformRelease` and the exact `node`); only the
 * current shape can bind a new review.
 */
export function assertReviewEnvironment(environment, label, { historical = false } = {}) {
  assert.ok(environment && typeof environment === "object", `${label}: environment missing`);
  assert.equal(environment.screenPixelContractVersion, SCREEN_PIXEL_CONTRACT_VERSION, `${label}: pixel contract drift`);
  if (historical) {
    assert.ok(Number.isSafeInteger(environment.reviewArtifactContractVersion) && environment.reviewArtifactContractVersion >= 3,
      `${label}: artifact contract version is not a recorded contract`);
  } else {
    assert.equal(environment.reviewArtifactContractVersion, REVIEW_ARTIFACT_CONTRACT_VERSION, `${label}: artifact contract drift`);
    assert.deepEqual(Object.keys(environment).sort(), [...DECLARED_ENVIRONMENT_FIELDS].sort(),
      `${label}: the declared review environment binds exactly ${DECLARED_ENVIRONMENT_FIELDS.join(", ")}`);
    assert.match(environment.nodeMajor ?? "", /^\d+$/u, `${label}: nodeMajor missing`);
  }
  for (const field of ["browser", "platform", "architecture"]) {
    assert.ok(typeof environment[field] === "string" && environment[field].length > 0, `${label}: ${field} missing`);
  }
  assert.equal(environment.deviceScaleFactor, 1, `${label}: device scale drift`);
  assert.deepEqual(environment.browserRenderArgs, [...REQUIRED_BROWSER_RENDER_ARGS], `${label}: deterministic browser arguments drift`);
  assert.deepEqual(environment.print?.contentViewportCssPx, { width: 703, height: 1123 }, `${label}: A4 content-width layout probe drift`);
  assert.equal(environment.print?.rasterDpi, 110, `${label}: print raster DPI drift`);
  assert.ok(isMeasurableBrowserVersion(environment.browser), `${label}: browser version is not measurable: ${JSON.stringify(environment.browser)}`);
  assert.match(environment.print?.rasterizer ?? "", /^pdftoppm version\s+\S+/u, `${label}: rasterizer version is not measurable`);
}

export function assertObservedEnvironment(observed, label) {
  assert.ok(observed && typeof observed === "object", `${label}: observed environment missing`);
  assert.deepEqual(Object.keys(observed).sort(), [...OBSERVED_ENVIRONMENT_FIELDS].sort(), `${label}: observed environment shape drift`);
  for (const field of OBSERVED_ENVIRONMENT_FIELDS) {
    assert.ok(typeof observed[field] === "string" && observed[field].length > 0, `${label}: observed ${field} missing`);
  }
}

/**
 * The closed roster of human review roles. A cell counts toward the human gate only when it passed
 * under one of these handles AND its round lists that handle as `kind: "human"`. The roster is a
 * code constant on purpose: a role is added or removed by a reviewed change to this file, never by
 * a ledger edit, so a reviewer (human or agent) cannot admit itself by writing the very ledger its
 * review is recorded in. `docs/reporting.md` names the roster and this procedure.
 */
export const HUMAN_REVIEW_ROLES = Object.freeze(["@Brand", "@Neo", "@Founder"]);

/**
 * What the roster check does NOT do, stated wherever a review result is shown. The ledger is a
 * file in the repository; the check proves that a rostered handle was written into it, not who
 * wrote it. Nothing here is signed.
 */
export const REVIEWER_AUTHENTICATION_NOTE =
  "The roster check proves only that a rostered handle (@Brand, @Neo or @Founder) was written into the ledger; " +
  "it does not authenticate a person. That a rostered human actually reviewed rests on repository access control " +
  "and on review of the ledger diff, not on this gate. Delegated AI receipt/model/image fields are " +
  "record bindings, not authentication of a provider or proof that the reviewer perceived the images.";

const AGENT_HANDLE = /^@[A-Za-z0-9][A-Za-z0-9_.-]{0,38}$/u;
const REVIEWER_FIELDS = Object.freeze({
  human: Object.freeze(["handle", "kind"]),
  agent: Object.freeze(["handle", "kind", "model"]),
  "delegated-ai": Object.freeze(["handle", "kind", "actual_model", "promptSha256", "outputSha256", "nativeReceipt", "receivedImages"]),
  "not-recorded": Object.freeze(["handle", "kind"]),
});

/** True only for a reviewer entry that is a rostered human role. */
export function isRosteredHuman(reviewer) {
  return reviewer?.kind === "human" && HUMAN_REVIEW_ROLES.includes(reviewer.handle);
}

function assertClosedFields(value, fields, label) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${label}: object missing`);
  assert.deepEqual(Object.keys(value).sort(), [...fields].sort(), `${label}: fields must be exactly ${fields.join(", ")}`);
}

/** A delegation records the explicit session authorization; ledger data cannot grant it. */
function assertDelegation(round, label) {
  assert.ok(round.delegation, `${label}: Founder delegation missing`);
  assertClosedFields(round.delegation, ["founder", "date", "sessionQuote", "release", "revoked"], `${label} delegation`);
  const delegation = round.delegation;
  assert.equal(delegation.founder, "@Founder", `${label}: delegation must name @Founder`);
  assert.match(delegation.date ?? "", /^\d{4}-\d{2}-\d{2}$/u, `${label}: delegation date missing`);
  assertUtcOrDate(delegation.date, `${label}: delegation date invalid`);
  assert.ok(typeof delegation.sessionQuote === "string" && delegation.sessionQuote.trim().length > 0, `${label}: delegation session quote missing`);
  assert.match(delegation.release ?? "", /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u, `${label}: delegation must name a concrete stable release version`);
  assert.equal(delegation.revoked, false, `${label}: delegation is revoked or not explicitly active`);
  assert.equal(round.record, "current", `${label}: a delegated review must be a current record`);
  if (round.reviewedAt !== null) {
    assert.ok(Date.parse(delegation.date) <= Date.parse(round.reviewedAt), `${label}: delegation postdates the review`);
  }
}

function assertDelegatedReviewer(reviewer, label) {
  assert.match(reviewer.handle ?? "", AGENT_HANDLE, `${label}: delegated AI handle is malformed`);
  assert.ok(!HUMAN_REVIEW_ROLES.includes(reviewer.handle), `${label}: a delegated AI cannot carry the human review role ${reviewer.handle}`);
  assert.ok(typeof reviewer.actual_model === "string" && reviewer.actual_model.trim().length > 0 && !/^(?:(?:UNKNOWN|UNBEKANNT)\b|n\/a$)/iu.test(reviewer.actual_model.trim()),
    `${label}: delegated AI actual_model must be recorded, not UNKNOWN, UNBEKANNT or n/a`);
  for (const field of ["promptSha256", "outputSha256"]) {
    assert.match(reviewer[field] ?? "", SHA256, `${label}: ${field} must be SHA-256`);
  }
  assertClosedFields(reviewer.nativeReceipt, ["path", "sha256", "imageCount"], `${label} native receipt`);
  assert.ok(typeof reviewer.nativeReceipt.path === "string" && reviewer.nativeReceipt.path.trim().length > 0, `${label}: native receipt path missing`);
  assert.match(reviewer.nativeReceipt.sha256 ?? "", SHA256, `${label}: native receipt SHA-256 missing`);
  assert.ok(Array.isArray(reviewer.receivedImages) && reviewer.receivedImages.length > 0, `${label}: received images missing`);
  assert.ok(Number.isSafeInteger(reviewer.nativeReceipt.imageCount) && reviewer.nativeReceipt.imageCount > 0, `${label}: native image count invalid`);
  assert.equal(reviewer.nativeReceipt.imageCount, reviewer.receivedImages.length, `${label}: native image count does not match received images`);
  const paths = new Set();
  for (const image of reviewer.receivedImages) {
    assertClosedFields(image, ["path", "sha256"], `${label} received image`);
    assert.ok(typeof image.path === "string" && image.path.length > 0, `${label}: received image path missing`);
    assert.match(image.sha256 ?? "", SHA256, `${label}: received image SHA-256 missing`);
    assert.ok(!paths.has(image.path), `${label}: duplicate received image ${image.path}`);
    paths.add(image.path);
  }
}

/**
 * A reviewer is named for what it is. `human` is one of the rostered role handles and nothing else;
 * `agent` carries the label of the model or tool that reviewed (and, optionally, a handle that is
 * not a human role) and is never counted as a human; `not-recorded` states that the record of the
 * time did not name the reviewer, instead of inventing a name afterwards. No other field is
 * accepted, so an agent cannot pass as a human by moving its model label into a field of its own.
 */
function assertReviewer(reviewer, label) {
  assert.ok(reviewer && typeof reviewer === "object", `${label}: reviewer entry missing`);
  assert.ok(Object.hasOwn(REVIEWER_FIELDS, reviewer.kind ?? ""), `${label}: reviewer kind must be human, agent or not-recorded; delegated-ai requires an explicit Founder delegation`);
  const allowed = REVIEWER_FIELDS[reviewer.kind];
  const unknown = Object.keys(reviewer).filter((field) => !allowed.includes(field));
  assert.deepEqual(unknown, [], `${label}: a ${reviewer.kind} reviewer carries only ${allowed.join(" and ")}; unknown field ${unknown.join(", ")}` +
    (reviewer.kind === "human" && unknown.includes("model") ? " (a human reviewer does not carry a model label)" : ""));
  if (reviewer.kind === "delegated-ai") {
    assertDelegatedReviewer(reviewer, label);
    assertClosedFields(reviewer, allowed, label);
  } else if (reviewer.kind === "human") {
    assert.ok(HUMAN_REVIEW_ROLES.includes(reviewer.handle),
      `${label}: ${JSON.stringify(reviewer.handle)} is not a rostered human review role (${HUMAN_REVIEW_ROLES.join(", ")}); ` +
        "the roster changes only by a reviewed code change to tests/tools/report-surface-contract.mjs");
  } else if (reviewer.kind === "agent") {
    assert.ok(typeof reviewer.model === "string" && reviewer.model.trim().length > 0, `${label}: an agent reviewer must name its model or tool`);
    if (reviewer.handle !== undefined && reviewer.handle !== null) {
      assert.match(reviewer.handle, AGENT_HANDLE, `${label}: agent handle is malformed`);
      assert.ok(!HUMAN_REVIEW_ROLES.includes(reviewer.handle), `${label}: an agent cannot carry the human review role ${reviewer.handle}`);
    }
  } else {
    assert.equal(reviewer.handle, null, `${label}: a not-recorded reviewer has no handle`);
  }
}

/** One handle names one reviewer of one kind within a round. */
function assertDistinctReviewers(reviewers, label) {
  const seen = new Map();
  for (const reviewer of reviewers) {
    const handle = reviewer?.handle;
    if (handle === undefined || handle === null) continue;
    assert.ok(!seen.has(handle),
      `${label}: reviewer handle ${handle} is listed more than once (${seen.get(handle)} and ${reviewer.kind}); one handle is one reviewer of one kind`);
    seen.set(handle, reviewer.kind);
  }
}

function findingTotal(findings) {
  return ["blocker", "high", "medium", "low"].reduce((sum, key) => sum + findings[key], 0);
}

function assertReviewCell(cellId, cell, round, label) {
  assert.ok(["pass", "fail", "not-reviewed"].includes(cell?.status), `${label}: ${cellId} status must be pass, fail or not-reviewed`);
  if (cell.status === "not-reviewed") return;
  const reviewer = round.reviewers.find((entry) => entry.handle && entry.handle === cell.reviewer);
  assert.ok(reviewer, `${label}: ${cellId} reviewer ${cell.reviewer} is not a reviewer of this round`);
  if (cell.status === "pass") {
    assert.ok(isRosteredHuman(reviewer) || reviewer.kind === "delegated-ai",
      `${label}: ${cellId} passed under ${cell.reviewer}, ${reviewer.kind === "human" ? "a human" : reviewer.kind === "agent" ? "an agent" : "a not-recorded"} reviewer; a pass is recorded only by a rostered human ` +
        `(${HUMAN_REVIEW_ROLES.join(", ")}), and an agent may record a failed cell or a round note but never a pass`);
  }
  assert.match(cell.reviewArtifactFingerprint ?? "", SHA256, `${label}: ${cellId} stable review fingerprint missing`);
  assertUtc(cell.reviewedAt, `${label}: ${cellId} reviewedAt is not an exact UTC timestamp`);
  assert.ok(typeof cell.note === "string" && cell.note.trim().length >= 12, `${label}: ${cellId} review note is missing`);
  assert.ok(Array.isArray(cell.reviewedArtifacts) && cell.reviewedArtifacts.length > 0, `${label}: ${cellId} names no reviewed artifact`);
  if (cellId.startsWith("screen/")) {
    assert.match(cell.reviewedRawSha256 ?? "", SHA256, `${label}: ${cellId} reviewed raw PNG SHA-256 audit trail missing`);
    assert.match(cell.reviewedNormalizedRgbaSha256 ?? "", SHA256, `${label}: ${cellId} reviewed RGBA SHA-256 missing`);
  } else if (cellId.endsWith("/pdf")) {
    assert.match(cell.reviewedRawSha256 ?? "", SHA256, `${label}: ${cellId} reviewed raw PDF SHA-256 audit trail missing`);
    assert.ok(Array.isArray(cell.reviewedPages) && cell.reviewedPages.length > 0, `${label}: ${cellId} reviewed no PDF page`);
  } else {
    assert.ok(Array.isArray(cell.reviewedRawSha256) && cell.reviewedRawSha256.every((value) => SHA256.test(value)),
      `${label}: ${cellId} reviewed raster SHA-256 audit trail is invalid`);
    assert.equal(cell.reviewedPages?.length, cell.reviewedRawSha256.length, `${label}: ${cellId} raster page review is incomplete`);
  }
}

/**
 * Ledger schema 6 adds a separate explicitly delegated AI sight-review kind. The original schema-5
 * rounds retain their original data and reviewer kinds; an ordinary agent never gains a pass.
 * Schema 5 introduced review ROUNDS instead of one all-pass record. Schema 4 could only say
 * `pass`: technical mode asserted every cell passed, so writing down the truthful outcome of the
 * 2026-09-18 review would have turned CI red, and the most important result this gate ever
 * produced existed only as prose. A round is `pass`, `fail` or `pending`; a failed round is valid
 * evidence and is kept, so the next round can be compared with it.
 *
 * Structural rules, all fail-closed:
 * - rounds are numbered 1..n in order; the last one is the current state of the human gate;
 * - within a round one handle names one reviewer of one kind;
 * - a cell that passed names a rostered human or an explicitly delegated AI reviewer;
 *   an agent may be recorded as a reviewer and may record a failed cell, never a passed one;
 * - rounds are reviewed in numbered order (non-decreasing reviewedAt), no historical or
 *   reconstructed record follows a current one, and a current round and each of its reviewed cells
 *   were reviewed at or after the render timestamp it binds;
 * - a passing LATEST round is a current record;
 * - a `pass` round names a rostered human or delegated AI reviewer, binds an input fingerprint, a render
 *   timestamp and an environment, records no blocker or high finding and carries a complete cell
 *   set in which every cell passed;
 * - a `fail` round records at least one finding or one failed cell;
 * - a `pending` round records no outcome-bearing cell;
 * - a round written after the fact from another record says so (`record:
 *   "historical-reconstruction"`) and names that record in `source`.
 */
/** How far a recorded review time may lie ahead of the verifying clock: clock skew, not a future. */
export const REVIEW_TIME_SKEW_MS = 10 * 60 * 1000;

export function validateReviewLedger(ledger, { cellCount = 32, now = Date.now() } = {}) {
  const latestAcceptable = now + REVIEW_TIME_SKEW_MS;
  const notInFuture = (value, what) => assert.ok(Date.parse(value) <= latestAcceptable,
    `${what} ${value} lies in the future (verifier clock ${new Date(now).toISOString()}); a review is recorded after it happened`);
  assert.equal(ledger?.schemaVersion, REVIEW_LEDGER_SCHEMA_VERSION, "human ledger schema drift");
  assert.ok(Array.isArray(ledger.rounds) && ledger.rounds.length > 0, "human ledger holds no review round");
  let previousReviewedAt = null;
  let currentSeen = false;
  for (const [index, round] of ledger.rounds.entries()) {
    const label = `human ledger round ${index + 1}`;
    assert.equal(round.round, index + 1, `${label}: rounds must be numbered in order`);
    assert.ok(["pass", "fail", "pending"].includes(round.outcome), `${label}: outcome must be pass, fail or pending`);
    assert.ok(["current", "historical", "historical-reconstruction"].includes(round.record), `${label}: record kind is invalid`);
    if (round.record === "historical-reconstruction") {
      assert.ok(typeof round.source === "string" && round.source.length > 0, `${label}: a reconstructed round must name its source record`);
    }
    assert.ok(Array.isArray(round.reviewers), `${label}: reviewers missing`);
    assertDistinctReviewers(round.reviewers, label);
    round.reviewers.forEach((reviewer, reviewerIndex) => assertReviewer(reviewer, `${label} reviewer ${reviewerIndex + 1}`));
    if (round.reviewers.some((reviewer) => reviewer.kind === "delegated-ai")) assertDelegation(round, label);
    assert.ok(typeof round.note === "string" && round.note.trim().length >= 12, `${label}: note missing`);
    for (const key of ["blocker", "high", "medium", "low"]) {
      assert.ok(Number.isSafeInteger(round.findings?.[key]) && round.findings[key] >= 0, `${label}: finding count ${key} is invalid`);
    }
    if (round.outcome !== "pending") assertUtcOrDate(round.reviewedAt, `${label}: reviewedAt is not a UTC timestamp or date`);
    if (round.binding !== null) {
      assert.ok(round.binding && typeof round.binding === "object", `${label}: binding must be an object or null`);
      assert.match(round.binding.reviewInputFingerprint ?? "", SHA256, `${label}: input fingerprint is invalid`);
      assertUtc(round.binding.renderManifestGeneratedAt, `${label}: render timestamp drift`);
      assertReviewEnvironment(round.binding.reviewEnvironment, `${label} environment`, { historical: round.record !== "current" });
    }
    const cells = round.cells === null ? null : Object.entries(round.cells ?? {});
    assert.ok(cells === null || cells.length > 0, `${label}: cells must be a record or null`);
    for (const [cellId, cell] of cells ?? []) assertReviewCell(cellId, cell, round, label);
    // Order and time, fail-closed: rounds are reviewed in the order they are numbered, a record
    // written after the fact never follows a current one, and a current round cannot have been
    // reviewed before the render it binds existed. Historical rounds keep their times as recorded
    // (round 1's cells predate its render timestamp by minutes; it is not rewritten).
    for (const [cellId, cell] of cells ?? []) if (cell.status !== "not-reviewed") notInFuture(cell.reviewedAt, `${label}: ${cellId} reviewed`);
    if (round.outcome !== "pending") {
      notInFuture(round.reviewedAt, `${label}: reviewed`);
      const reviewedAt = Date.parse(round.reviewedAt);
      assert.ok(previousReviewedAt === null || reviewedAt >= previousReviewedAt,
        `${label}: reviewed ${round.reviewedAt}, before the round it follows; rounds are reviewed in the order they are numbered`);
      previousReviewedAt = reviewedAt;
    }
    if (round.record === "current") {
      currentSeen = true;
    } else {
      assert.ok(!currentSeen, `${label}: a ${round.record} record cannot follow a current round`);
    }
    if (round.record === "current" && round.binding) {
      const renderedAt = Date.parse(round.binding.renderManifestGeneratedAt);
      if (round.outcome !== "pending") {
        assertUtc(round.reviewedAt, `${label}: a current round's reviewedAt must be an exact UTC timestamp`);
        assert.ok(Date.parse(round.reviewedAt) >= renderedAt,
          `${label}: reviewed ${round.reviewedAt}, before the render it binds (${round.binding.renderManifestGeneratedAt})`);
      }
      for (const [cellId, cell] of cells ?? []) {
        if (cell.status === "not-reviewed") continue;
        assert.ok(Date.parse(cell.reviewedAt) >= renderedAt,
          `${label}: ${cellId} reviewed ${cell.reviewedAt}, before the render it binds (${round.binding.renderManifestGeneratedAt})`);
      }
    }
    if (round.outcome === "pass") {
      assert.ok(round.reviewers.some((reviewer) => isRosteredHuman(reviewer) || reviewer.kind === "delegated-ai"), `${label}: a passing round must name a rostered human or delegated AI reviewer`);
      assert.ok(round.binding, `${label}: a passing round must bind inputs and environment`);
      assert.equal(round.findings.blocker + round.findings.high, 0, `${label}: a passing round cannot carry a blocker or high finding`);
      assert.ok(cells && cells.length === cellCount, `${label}: a passing round must cover all ${cellCount} cells`);
      assert.ok(cells.every(([, cell]) => cell.status === "pass"), `${label}: a passing round contains a cell that did not pass`);
      for (const field of ["screens", "pdfs", "rasterPages"]) {
        assert.ok(Number.isSafeInteger(round.physicalArtifactsReviewed?.[field]) && round.physicalArtifactsReviewed[field] > 0,
          `${label}: ${field} inventory is invalid`);
      }
    } else if (round.outcome === "fail") {
      assert.ok(findingTotal(round.findings) > 0 || (cells ?? []).some(([, cell]) => cell.status === "fail"),
        `${label}: a failed round must record a finding or a failed cell`);
    } else {
      assert.ok((cells ?? []).every(([, cell]) => cell.status === "not-reviewed"), `${label}: a pending round cannot carry a review outcome`);
    }
  }
  const latest = ledger.rounds.at(-1);
  // A pass is claimed only by a round recorded as it happened: a historical or reconstructed pass
  // moved to the end, or re-bound to today's render, is not a review of today's render.
  if (latest.outcome === "pass") {
    assert.equal(latest.record, "current", `human ledger round ${latest.round}: a passing latest round must be a current record, not ${latest.record}`);
  }
  return { rounds: ledger.rounds.length, latest };
}

function describeReviewer(reviewer) {
  if (reviewer.kind === "not-recorded") return "not recorded";
  if (reviewer.kind === "agent") return `${reviewer.handle ?? "unnamed"} (agent: ${reviewer.model})`;
  if (reviewer.kind === "delegated-ai") return `${reviewer.handle} (delegatedAI: ${reviewer.actual_model})`;
  return `${reviewer.handle} (${isRosteredHuman(reviewer) ? "human" : "unrostered, not a human role"})`;
}

/**
 * Who reviewed the latest round, by kind, and how many of its passing cells a rostered human
 * passed. `humanPass` is true only when the round passed and every cell passed under a rostered
 * human; nothing else may be reported as a human PASS.
 */
export function summarizeLatestRound(ledger) {
  const latest = ledger.rounds.at(-1);
  const byHandle = new Map(latest.reviewers.filter((reviewer) => reviewer.handle).map((reviewer) => [reviewer.handle, reviewer]));
  const cells = Object.values(latest.cells ?? {});
  const passing = cells.filter((cell) => cell.status === "pass");
  const humanPassing = passing.filter((cell) => isRosteredHuman(byHandle.get(cell.reviewer)));
  const humanPass = latest.outcome === "pass" && cells.length > 0 && humanPassing.length === cells.length;
  const delegatedPassing = passing.filter((cell) => byHandle.get(cell.reviewer)?.kind === "delegated-ai");
  const delegatedPass = latest.outcome === "pass" && delegatedPassing.length > 0 && humanPassing.length + delegatedPassing.length === cells.length;
  return {
    latest,
    reviewers: latest.reviewers.map(describeReviewer),
    passingCells: passing.length,
    humanPassingCells: humanPassing.length,
    humanPass,
    delegatedPassingCells: delegatedPassing.length,
    delegatedPass,
  };
}

/**
 * Everything a passing latest round must be bound to besides the input fingerprint: the declared
 * environment, the matrix of cells, every cell's artifact fingerprint and screen pixels, the named
 * artifacts, the reviewed pages and the physical inventory. Throws on the first mismatch.
 */
function assertEnvironmentAndArtifactBinding(latest, manifest) {
  assert.ok(latest.binding, `latest review round ${latest.round} binds nothing`);
  assertReviewEnvironment(latest.binding.reviewEnvironment, "latest human review environment");
  assert.deepEqual(latest.binding.reviewEnvironment, manifest.reviewEnvironment,
    "strict local human review cannot transfer to a different declared browser/platform/render environment");
  assert.ok(latest.cells, `latest review round ${latest.round} records no cells`);
  assert.deepEqual([...Object.keys(latest.cells)].sort(), manifest.artifacts.map((artifact) => artifact.cell).sort(),
    "the human review ledger and current render matrix disagree");
  for (const artifact of manifest.artifacts) {
    const review = latest.cells[artifact.cell];
    assert.equal(review.reviewArtifactFingerprint, artifact.reviewArtifactFingerprint, `${artifact.cell}: strict local human review is bound to a different rendered artifact`);
    if (artifact.kind === "screen") {
      assert.equal(review.reviewedNormalizedRgbaSha256, artifact.pixels.normalizedRgbaSha256, `${artifact.cell}: strict local human review is bound to different visible screen pixels`);
      assert.deepEqual(review.reviewedArtifacts, [artifact.path, ...(artifact.tiles ?? []).map((tile) => tile.path)], `${artifact.cell}: reviewed screen artifacts are not named exactly`);
    } else if (artifact.kind === "pdf") {
      assert.deepEqual(review.reviewedPages, Array.from({ length: artifact.pages }, (_, index) => index + 1), `${artifact.cell}: PDF page review is incomplete`);
      assert.deepEqual(review.reviewedArtifacts, [artifact.path], `${artifact.cell}: reviewed PDF is not named exactly`);
    } else {
      assert.equal(review.reviewedRawSha256.length, artifact.pages.length, `${artifact.cell}: reviewed raster SHA-256 audit trail is incomplete`);
      assert.deepEqual(review.reviewedArtifacts, artifact.pages.map((page) => page.path), `${artifact.cell}: raster artifacts do not match the matrix contract`);
    }
  }
  assert.deepEqual(latest.physicalArtifactsReviewed, manifest.physicalArtifacts, "human ledger does not attest the complete physical artifact inventory");
}

/**
 * The latest round's binding, in the same two halves the strict gate checks: the input fingerprint,
 * and the environment and artifacts (assertEnvironmentAndArtifactBinding). "Bound" in any line this
 * module prints means both halves, never the fingerprint alone.
 */
export function latestBindingStatus(ledger, manifest, currentFingerprint) {
  const latest = ledger.rounds.at(-1);
  const inputs = latest.binding?.reviewInputFingerprint === currentFingerprint;
  let environmentAndArtifacts = false;
  let reason = null;
  try {
    assertEnvironmentAndArtifactBinding(latest, manifest);
    environmentAndArtifacts = true;
  } catch (error) {
    reason = String(error?.message ?? error).split("\n")[0];
  }
  return { inputs, environmentAndArtifacts, bound: inputs && environmentAndArtifacts, reason };
}

/**
 * One line for logs and job summaries: what the review ledger currently says, by whom, and whether
 * it is bound to what is rendered now, in both halves of the strict gate's binding.
 */
export function describeLatestRound(ledger, manifest, currentFingerprint) {
  const { latest, reviewers, passingCells, humanPassingCells, humanPass, delegatedPass } = summarizeLatestRound(ledger);
  const counts = `${latest.findings.blocker} blocker, ${latest.findings.high} high, ${latest.findings.medium} medium, ${latest.findings.low} low`;
  const binding = latestBindingStatus(ledger, manifest, currentFingerprint);
  const who = reviewers.length > 0 ? reviewers.join(", ") : "none named";
  return `latest ${humanPass ? "human " : delegatedPass ? "delegatedAI " : ""}review round ${latest.round} is ${latest.outcome.toUpperCase()}` +
    `${latest.outcome === "pass" && !humanPass ? " but NOT a human pass" : ""} ` +
    `(${latest.reviewedAt ?? "not yet reviewed"}; ${counts}; ${latest.record} record; reviewers: ${who}; ` +
    `cells passed by a rostered human: ${humanPassingCells} of ${passingCells} passing); ` +
    `bound to the current render: inputs ${binding.inputs ? "yes" : "no"}; environment/artifacts ${binding.environmentAndArtifacts ? "yes" : "no"}`;
}

/**
 * The strict local human gate. It passes only when the LATEST round passed, every one of its cells
 * passed under a rostered human reviewer, it is a current record, and it is bound to exactly the
 * current inputs, the current declared environment, the current physical inventory and every
 * current cell fingerprint. An earlier passing round never carries forward over a later failed or
 * pending one.
 */
export function assessHumanGate(ledger, manifest, currentFingerprint) {
  validateReviewLedger(ledger, { cellCount: manifest.artifacts.length });
  const latest = ledger.rounds.at(-1);
  assert.equal(latest.outcome, "pass", describeLatestRound(ledger, manifest, currentFingerprint));
  assert.equal(summarizeLatestRound(ledger).humanPass, true, "the human-only gate requires every cell to pass under a rostered human");
  assert.equal(latest.binding.reviewInputFingerprint, currentFingerprint, "human review ledger is bound to a different source/input revision");
  assertEnvironmentAndArtifactBinding(latest, manifest);
  return latest;
}

/** Every assigned screen/tile or PDF page must occur in that reviewer's native image receipt. */
function assertDelegatedImageBinding(latest, manifest) {
  for (const reviewer of latest.reviewers.filter((entry) => entry.kind === "delegated-ai")) {
    const expected = new Map();
    const add = (image, label) => {
      assert.ok(typeof image?.path === "string" && image.path.length > 0, `${label}: manifest image path missing`);
      assert.match(image.sha256 ?? "", SHA256, `${label}: manifest image SHA-256 missing`);
      if (expected.has(image.path)) assert.equal(expected.get(image.path), image.sha256, `${label}: conflicting manifest image hashes`);
      expected.set(image.path, image.sha256);
    };
    for (const artifact of manifest.artifacts) {
      if (latest.cells[artifact.cell].reviewer !== reviewer.handle) continue;
      if (artifact.kind === "screen") {
        add(artifact, artifact.cell);
        for (const tile of artifact.tiles ?? []) add(tile, artifact.cell);
      } else if (artifact.kind === "pdf") {
        const raster = manifest.artifacts.find((entry) => entry.cell === artifact.cell.replace(/\/pdf$/u, "/raster-set") && entry.kind === "raster-set");
        assert.ok(raster && raster.pages.length === artifact.pages, `${artifact.cell}: complete PDF raster pair missing`);
        assert.deepEqual(raster.pages.map((page) => page.sha256), artifact.rasterPageVisualHashes, `${artifact.cell}: PDF raster hashes do not match`);
        for (const page of raster.pages) add(page, artifact.cell);
      } else {
        assert.equal(artifact.kind, "raster-set", `${artifact.cell}: unknown assigned artifact kind`);
        for (const page of artifact.pages) add(page, artifact.cell);
      }
    }
    const sort = (images) => images.sort((a, b) => a.path.localeCompare(b.path, "en"));
    const expectedImages = sort([...expected].map(([path, sha256]) => ({ path, sha256 })));
    assert.deepEqual(sort([...reviewer.receivedImages]), expectedImages, `${reviewer.handle}: received images do not match every assigned renderer PNG`);
  }
}

/** Historical delegations retain their scope; a latest delegated pass names this bound package. */
export function assertCurrentDelegationRelease(latest, reviewInputRoot = DEFAULT_REVIEW_INPUT_ROOT) {
  if (!latest.reviewers.some((reviewer) => reviewer.kind === "delegated-ai")) return;
  const candidate = JSON.parse(readFileSync(join(reviewInputRoot, "package.json"), "utf8"));
  assert.ok(typeof candidate.version === "string" && candidate.version.length > 0, "bound package version missing");
  assert.equal(latest.delegation?.release, candidate.version,
    `delegation release ${latest.delegation?.release ?? "missing"} does not match bound package version ${candidate.version}`);
}

/** Strict sight gate; delegatedAI is distinct from a human pass and never authenticates identity. */
export function assessSightGate(ledger, manifest, currentFingerprint, reviewInputRoot = DEFAULT_REVIEW_INPUT_ROOT) {
  validateReviewLedger(ledger, { cellCount: manifest.artifacts.length });
  const latest = ledger.rounds.at(-1);
  assert.equal(latest.outcome, "pass", describeLatestRound(ledger, manifest, currentFingerprint));
  assert.equal(latest.binding.reviewInputFingerprint, currentFingerprint, "sight review ledger is bound to a different source/input revision");
  assertEnvironmentAndArtifactBinding(latest, manifest);
  assertCurrentDelegationRelease(latest, reviewInputRoot);
  assertDelegatedImageBinding(latest, manifest);
  return { latest, reviewKind: summarizeLatestRound(ledger).humanPass ? "human" : "delegatedAI" };
}

// The printed page inventory is pinned rather than derived, so that a report which silently doubles in
// length is a failing gate and not a shrug. History: 32 page rasters; 43 in 0.6.0 when every finding
// gained a remediation box; 31 when coverage became one aligned table instead of thirteen six-label
// cards (measured per state: clean 5 -> 2, findings 12 -> 9, infrastructure 13 -> 10,
// insufficient-coverage 13 -> 10 on Chromium 141 / linux); 32 when the clean print kept its findings
// section (clean 2 -> 3); 26 when findings fragment between their units instead of taking one page
// each (findings 9 -> 7, infrastructure 10 -> 8, insufficient-coverage 10 -> 8). Tablet and mobile
// cells also ship viewport-height tiles, pinned the same way: 148, then 152 when two findings
// gained real-shaped evidence names that wrap on a phone (infrastructure and insufficient-coverage
// mobile 14 -> 15 tiles each). 27 page rasters when remediation and note text took the 72ch
// measure (findings 7 -> 8).
// The 2026-10-07 macOS measurement was clean 3/20, findings 9/48, infrastructure 9/50,
// insufficient-coverage 9/50 (page rasters/tiles). Its 30-page total was incorrectly used as a
// universal pin. The Linux diagnostic https://github.com/godarg/breaklint/actions/runs/37597727752
// measured clean 3/20, findings 8/48, infrastructure 9/50, insufficient-coverage 9/50 on
// 2026-10-07 with Google Chrome 154.0.8037.57, Node 24.21.0 and Poppler 24.02.0. Independent
// pdfinfo and PNG membership/hash/dimensions confirmed its 29 pages; the final universal pin was
// its only failure. Each supported platform now has a fixed per-state oracle. No manifest-derived
// expectation, range, or fallback can conceal a changed state split or a longer report.
// These preceding counts are the historical 0.9.0 matrix. The 0.10.0 presentation has six
// findings after its natural document ending is accepted, with clarified coverage wording and
// atomic printed run-fact label/value pairs. Independent pdfinfo, pypdf, physical PNG membership
// and SHA/dimension checks measured 3/8/8/8 pages and 158 viewport tiles on macOS on 2026-10-07.
// Linux run https://github.com/godarg/breaklint/actions/runs/37679854862 measured the same fixed
// per-state pages and tile count from the unchanged candidate, with native renderer/oracle exit0.
// The first diagnostic run timed out before rendering; it supplies no oracle and remains retained.
// The round7 HIGH repair records the previously missing handwritten widow decline and adds
// readable desktop tiles to every screen cell. Independent macOS filesystem/IHDR/pdfinfo/pypdf
// and Linux run https://github.com/godarg/breaklint/actions/runs/37686731564 measured 212 tiles
// and the same fixed3/8/8/8 pages on2026-10-07. The212 expectation is a physical observation,
// not a renderer-manifest-derived count. The preceding158 count remains historical evidence.
// 0.11.0 (G-148..G-151): explicit decline units, zero-candidate labels ("No candidates"),
// base-category tags, state-qualified finding gates, and mono slash-wrapped rule IDs in Next checks
// and Declined candidates measured 214 viewport tiles on macOS and 212 viewport tiles on Linux CI
// (ubuntu-latest run 44894380636, 2026-11-21), with unchanged 3/8/8/8 (27) PDF pages on both.
export const EXPECTED_PRINT_PAGES_BY_PLATFORM = Object.freeze({
  darwin: Object.freeze({ clean: 3, findings: 8, infrastructure: 8, "insufficient-coverage": 8 }),
  linux: Object.freeze({ clean: 3, findings: 8, infrastructure: 8, "insufficient-coverage": 8 }),
});
// 0.11.1: the tile TOTAL is no longer pinned. It is a change detector, not an oracle: Linux and
// macOS differ by two tiles on the same candidate, and every runner-image font change moved it on an
// unchanged report (PR runs 37594360825 and 44894380636). What the total stood for is checked as
// invariants instead: 24 distinct screen cells; every screen row covered by exactly one tile, in
// order, from the top to the page end; no tile listed twice; physical totals equal to the tiles and
// pages the artifacts list; and the fixed per-state printed page count above, which still makes a
// report that silently grows a page a failing gate. The verifier separately re-cuts every tile from
// the decoded full page and requires the gallery to present each one.
export const EXPECTED_SCREEN_CELLS = 24;

export function assertSurfaceInventory(inventory, platform) {
  assert.ok(Object.hasOwn(EXPECTED_PRINT_PAGES_BY_PLATFORM, platform), `unsupported report-surface platform: ${platform}`);
  const expectedPages = EXPECTED_PRINT_PAGES_BY_PLATFORM[platform];
  const artifacts = inventory?.artifacts ?? [];

  const screens = artifacts.filter((artifact) => artifact.kind === "screen");
  const screenCells = new Set(screens.map((artifact) => artifact.cell));
  assert.equal(screenCells.size, screens.length, `${platform}: a screen cell is listed more than once`);
  assert.equal(screens.length, EXPECTED_SCREEN_CELLS, `${platform}: the report-surface inventory must contain ${EXPECTED_SCREEN_CELLS} distinct screen cells, not ${screens.length}`);
  const seenImages = new Set();
  const once = (path, label) => {
    assert.ok(typeof path === "string" && path.length > 0, `${label}: image path missing`);
    assert.ok(!seenImages.has(path), `${label}: ${path} is listed more than once`);
    seenImages.add(path);
  };
  for (const artifact of screens) {
    once(artifact.path, artifact.cell);
    const height = artifact.dimensions?.height;
    assert.ok(Number.isSafeInteger(height) && height > 0, `${artifact.cell}: screen height missing`);
    assert.ok(Array.isArray(artifact.tiles) && artifact.tiles.length > 0, `${artifact.cell}: every screen row must be covered by exactly one tile; no tile is listed`);
    let covered = 0;
    for (const [index, tile] of artifact.tiles.entries()) {
      once(tile.path, `${artifact.cell} tile ${index + 1}`);
      assert.equal(tile.index, index + 1, `${artifact.cell}: tile ${index + 1} is numbered ${tile.index}; tiles are listed in order`);
      assert.ok(Number.isSafeInteger(tile.height) && tile.height > 0, `${artifact.cell}: tile ${index + 1} has no height`);
      assert.equal(tile.top, covered,
        `${artifact.cell}: tile ${index + 1} starts at row ${tile.top}, not at row ${covered}; every screen row must be covered by exactly one tile`);
      covered += tile.height;
    }
    assert.equal(covered, height, `${artifact.cell}: tiles end at row ${covered} of a ${height}-row page; every screen row must be covered by exactly one tile`);
  }

  const pdfs = artifacts.filter((artifact) => artifact.kind === "pdf");
  assert.equal(pdfs.length, 4, "the report-surface inventory must contain exactly four PDF cells");
  const actualPages = Object.fromEntries(pdfs.map((artifact) => [artifact.cell.split("/")[1], artifact.pages]));
  assert.deepEqual(actualPages, expectedPages, `${platform}: print page inventory must match every fixed state`);
  const rasterSets = artifacts.filter((artifact) => artifact.kind === "raster-set");
  assert.equal(rasterSets.length, 4, "the report-surface inventory must contain exactly four raster sets");
  for (const artifact of rasterSets) {
    const state = artifact.cell.split("/")[1];
    assert.equal(artifact.pages?.length, expectedPages[state],
      `${artifact.cell}: the raster set holds ${artifact.pages?.length} pages; its PDF state prints ${expectedPages[state]}`);
    for (const [index, page] of artifact.pages.entries()) once(page.path, `${artifact.cell} page ${index + 1}`);
  }

  const screenTiles = screens.reduce((sum, artifact) => sum + artifact.tiles.length, 0);
  const rasterPages = Object.values(expectedPages).reduce((sum, pages) => sum + pages, 0);
  assert.deepEqual(inventory.physicalArtifacts, { screens: EXPECTED_SCREEN_CELLS, screenTiles, pdfs: 4, rasterPages },
    `${platform}: the physical inventory must state exactly the ${EXPECTED_SCREEN_CELLS} screens, ${screenTiles} tiles, 4 PDFs and ${rasterPages} PDF page rasters the artifacts list`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const current = computeReviewInput();
  const control = runReviewInputMutationControl(current.fingerprint);
  process.stdout.write(
    `report-surface input contract: ${current.files.length} files, ${current.fingerprint}; ` +
      `mutation rejected (${control.after})\n`,
  );
}
