/**
 * Runs each live file in its own sacrificial node:test runner process.
 *
 * A real Puppeteer run can emit the native top-level suite verdict after every test and after-hook
 * completed, yet leave node:test's isolated file process waiting forever on its IPC pipe. Exit
 * code, TAP text and a scalar pass count are all insufficient boundaries here. The parent accepts
 * a file only after the structured event stream proves exactly one expected top-level suite pass,
 * the exact expected leaf denominator, and zero fail/skip/cancel/todo events. It then grants a
 * short natural-exit grace before terminating only that already-judged process group.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { finished } from "node:stream/promises";
import { run } from "node:test";
import { tap } from "node:test/reporters";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const CHILD_FLAG = "--structured-child";
const CHILD_RESULT_PREFIX = "BREAKLINT_LIVE_CHILD_RESULT ";
const FILE_TIMEOUT_MS = 600_000;
const JUDGED_EXIT_GRACE_MS = 750;
const TERMINATION_GRACE_MS = 2_000;

const DEFAULT_SPECS = [
  { file: "tests/live/evidence.test.ts", suite: "evidence path, live", leaves: 18 },
  { file: "tests/live/measure.test.ts", suite: "the measurement probe, live", leaves: 7 },
  { file: "tests/live/breaks.test.ts", suite: "the collector, live", leaves: 7 },
  { file: "tests/live/render-run.test.ts", suite: "the M2d live production chain", leaves: 25 },
];

function structuredChildResult(file, terminal, state) {
  return {
    file,
    terminal,
    topLevelPasses: state.topLevelPasses,
    topLevelFailures: state.topLevelFailures,
    leaves: state.leaves,
  };
}

async function runStructuredChild(file) {
  const state = {
    topLevelPasses: [],
    topLevelFailures: [],
    leaves: { pass: 0, fail: 0, skip: 0, cancelled: 0, todo: 0 },
  };
  let emittedTerminal = null;
  const emit = (terminal) => {
    if (emittedTerminal === terminal) return;
    // A fail arriving after a suite pass is material: this is precisely the false-green class
    // the wrapper exists to catch. Emit the second terminal marker; the parent rejects duplicates.
    if (emittedTerminal !== null && terminal !== "fail") return;
    emittedTerminal = terminal;
    process.stderr.write(`${CHILD_RESULT_PREFIX}${JSON.stringify(structuredChildResult(file, terminal, state))}\n`);
    const canaryExit = Number.parseInt(process.env.BREAKLINT_LIVE_CHILD_CANARY_EXIT_AFTER_PASS ?? "", 10);
    if (terminal === "pass" && Number.isInteger(canaryExit) && canaryExit > 0) {
      // Deliberately referenced: this canary must keep the child alive until it exits nonzero,
      // otherwise a naturally completed runner could make the negative control check nothing.
      setTimeout(() => process.exit(canaryExit), 100);
    }
  };

  const tests = run({
    files: [file],
    concurrency: 1,
    timeout: FILE_TIMEOUT_MS,
    execArgv: ["--experimental-strip-types"],
    setup(stream) {
      stream.on("test:pass", (data) => {
        const details = data.details ?? {};
        if (data.nesting === 0) {
          state.topLevelPasses.push({ name: data.name, type: details.type ?? null });
          emit("pass");
          return;
        }
        const skip = data.skip ?? details.skip;
        const todo = data.todo ?? details.todo;
        if (skip !== undefined && skip !== false) state.leaves.skip += 1;
        else if (todo !== undefined && todo !== false) state.leaves.todo += 1;
        else state.leaves.pass += 1;
      });
      stream.on("test:fail", (data) => {
        const details = data.details ?? {};
        if (data.nesting === 0) {
          state.topLevelFailures.push({
            name: data.name,
            type: details.type ?? null,
            failureType: details.error?.failureType ?? null,
          });
          emit("fail");
          return;
        }
        const failureType = String(details.error?.failureType ?? "");
        if (/cancel/u.test(failureType)) state.leaves.cancelled += 1;
        else state.leaves.fail += 1;
      });
    },
  });

  const report = tests.compose(tap);
  report.pipe(process.stdout);
  await finished(report);
  if (emittedTerminal === null) emit("incomplete");
}

function terminateGroup(child, signal) {
  if (!child.pid) return;
  if (process.platform !== "win32") {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // The group may have exited between the marker and the grace timer.
    }
  }
  try { child.kill(signal); } catch { /* already gone */ }
}

function passValidation(marker, expected) {
  if (marker.terminal !== "pass") return `top-level terminal event was ${marker.terminal}`;
  if (marker.topLevelPasses.length !== 1) return `top-level pass count was ${marker.topLevelPasses.length}`;
  const top = marker.topLevelPasses[0];
  if (top.name !== expected.suite || top.type !== "suite") {
    return `top-level suite was ${JSON.stringify(top)}, expected ${JSON.stringify(expected.suite)}`;
  }
  if (marker.topLevelFailures.length !== 0) return `${marker.topLevelFailures.length} top-level failure(s)`;
  for (const key of ["fail", "skip", "cancelled", "todo"]) {
    if (marker.leaves[key] !== 0) return `${marker.leaves[key]} leaf ${key} event(s)`;
  }
  if (marker.leaves.pass !== expected.leaves) {
    return `leaf pass denominator was ${marker.leaves.pass}, expected ${expected.leaves}`;
  }
  return null;
}

async function runOneFile(expected) {
  const childEnv = { ...process.env };
  delete childEnv.NODE_TEST_CONTEXT;
  const child = spawn(process.execPath, [SELF, CHILD_FLAG, expected.file], {
    cwd: process.cwd(),
    detached: process.platform !== "win32",
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(process.stdout, { end: false });
  child.stderr.setEncoding("utf8");

  let stderrBuffer = "";
  let marker = null;
  let validationError = null;
  let judgedTimer = null;
  let escalationTimer = null;
  let hardTimedOut = false;
  let terminationAuthorized = false;
  let terminationInitiated = false;

  const beginTermination = (signal = "SIGTERM") => {
    terminationInitiated = true;
    terminateGroup(child, signal);
    if (!escalationTimer) {
      escalationTimer = setTimeout(() => terminateGroup(child, "SIGKILL"), TERMINATION_GRACE_MS);
      escalationTimer.unref();
    }
  };

  const consumeLine = (line) => {
    if (!line.startsWith(CHILD_RESULT_PREFIX)) {
      if (line) process.stderr.write(`${line}\n`);
      return;
    }
    if (marker !== null) {
      validationError = "structured child emitted more than one terminal marker";
      beginTermination();
      return;
    }
    try {
      marker = JSON.parse(line.slice(CHILD_RESULT_PREFIX.length));
      validationError = passValidation(marker, expected);
      terminationAuthorized = validationError === null;
    } catch (error) {
      validationError = `structured child marker was invalid JSON: ${String(error)}`;
    }

    // A green termination is allowed only after the complete structured predicate is true. A
    // red terminal event is also terminated for containment, but validationError keeps it red;
    // the same short grace lets its native `not ok` reach the reporter first.
    judgedTimer = setTimeout(() => beginTermination(), JUDGED_EXIT_GRACE_MS);
    judgedTimer.unref();
  };

  child.stderr.on("data", (chunk) => {
    stderrBuffer += chunk;
    while (true) {
      const newline = stderrBuffer.indexOf("\n");
      if (newline < 0) break;
      consumeLine(stderrBuffer.slice(0, newline).replace(/\r$/u, ""));
      stderrBuffer = stderrBuffer.slice(newline + 1);
    }
  });

  const hardTimer = setTimeout(() => {
    hardTimedOut = true;
    validationError = `no complete structured verdict within ${FILE_TIMEOUT_MS} ms`;
    beginTermination("SIGKILL");
  }, FILE_TIMEOUT_MS);
  hardTimer.unref();

  const processOutcome = await new Promise((resolve) => {
    child.once("error", (error) => resolve({ code: null, signal: null, error: String(error) }));
    child.once("close", (code, signal) => resolve({ code, signal, error: null }));
  });
  clearTimeout(hardTimer);
  if (judgedTimer) clearTimeout(judgedTimer);
  if (escalationTimer) clearTimeout(escalationTimer);
  if (stderrBuffer) consumeLine(stderrBuffer.replace(/\r$/u, ""));

  if (marker === null) validationError ??= "child exited without a structured terminal marker";
  if (processOutcome.error) validationError ??= processOutcome.error;
  if (hardTimedOut) validationError ??= "child exceeded its hard timeout";
  const parentTerminatedJudgedChild =
    terminationAuthorized && terminationInitiated &&
    (processOutcome.signal === "SIGTERM" || processOutcome.signal === "SIGKILL");
  if (
    !parentTerminatedJudgedChild &&
    (processOutcome.signal !== null || (processOutcome.code !== null && processOutcome.code !== 0))
  ) {
    validationError ??=
      `child ended naturally after its marker with code=${processOutcome.code}, signal=${processOutcome.signal ?? "none"}`;
  }
  return { marker, validationError, processOutcome };
}

function requestedSpecs() {
  const files = process.argv.slice(2);
  if (files.length === 0) return DEFAULT_SPECS;
  const leaves = Number.parseInt(process.env.BREAKLINT_LIVE_EXPECTED_LEAVES ?? "", 10);
  const suite = process.env.BREAKLINT_LIVE_EXPECTED_SUITE;
  assert.equal(files.length, 1, "explicit live-run regression mode accepts exactly one file");
  assert.ok(Number.isInteger(leaves) && leaves > 0, "explicit live-run mode needs BREAKLINT_LIVE_EXPECTED_LEAVES");
  assert.ok(suite, "explicit live-run mode needs BREAKLINT_LIVE_EXPECTED_SUITE");
  return [{ file: files[0], suite, leaves }];
}

async function runParent() {
  const specs = requestedSpecs();
  const target = process.env.BREAKLINT_LIVE_REPORT;
  const partial = target ? `${target}.partial` : null;
  const summaryTarget = process.env.BREAKLINT_LIVE_SUMMARY;
  const summaryPartial = summaryTarget ? `${summaryTarget}.partial` : null;
  if (target && existsSync(target)) rmSync(target);
  if (partial && existsSync(partial)) rmSync(partial);
  if (summaryTarget && existsSync(summaryTarget)) rmSync(summaryTarget);
  if (summaryPartial && existsSync(summaryPartial)) rmSync(summaryPartial);

  let passedLeaves = 0;
  let passedSuites = 0;
  let failure = null;
  for (const spec of specs) {
    const outcome = await runOneFile(spec);
    if (outcome.validationError !== null) {
      failure = `${spec.file}: ${outcome.validationError}`;
      break;
    }
    passedLeaves += spec.leaves;
    passedSuites += 1;
  }

  const suitePassed = failure === null && passedSuites === specs.length;
  let reportPassed = target ? false : true;
  if (partial && existsSync(partial)) {
    let cases = 0;
    let missing = [];
    try {
      const measurement = JSON.parse(readFileSync(partial, "utf8"));
      cases = Object.keys(measurement.cases ?? {}).length;
      missing = measurement.missingPrerequisites ?? [];
    } catch {
      cases = 0;
    }
    if (suitePassed && cases > 0) {
      renameSync(partial, target);
      reportPassed = true;
    } else {
      rmSync(partial);
      const why = !suitePassed
        ? failure
        : `the live suite measured nothing (0 cases${missing.length ? `, missing: ${missing.join(", ")}` : ""})`;
      process.stderr.write(`breaklint: ${why}; no measurement report was written.\n`);
    }
  } else if (target) {
    process.stderr.write("breaklint: the live suite produced no partial measurement report; no measurement report was written.\n");
  }

  const expectedLeaves = specs.reduce((sum, spec) => sum + spec.leaves, 0);
  process.stdout.write(
    `# structured live total: suites ${passedSuites}/${specs.length}, tests ${passedLeaves}/` +
      `${expectedLeaves}\n`,
  );
  if (!suitePassed) {
    process.stderr.write(`breaklint: structured test verdict is red (${failure}); process exit codes were not the oracle.\n`);
  }
  const accepted = suitePassed && reportPassed;
  if (accepted && summaryTarget && summaryPartial) {
    mkdirSync(dirname(summaryTarget), { recursive: true });
    writeFileSync(
      summaryPartial,
      `${JSON.stringify({
        contractVersion: "breaklint-live-summary-v1",
        suites: { passed: passedSuites, expected: specs.length },
        tests: { passed: passedLeaves, expected: expectedLeaves },
      }, null, 2)}\n`,
    );
    renameSync(summaryPartial, summaryTarget);
  }
  process.exitCode = accepted ? 0 : 1;
}

if (process.argv[2] === CHILD_FLAG) {
  const file = process.argv[3];
  assert.ok(file, "structured child needs one file");
  await runStructuredChild(file);
} else {
  await runParent();
}
