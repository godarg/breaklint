/**
 * Runs the live suite and, only if it exited 0, promotes the measurement report.
 *
 * The report used to be written from the suite's `after` hook, which runs whether the assertions
 * passed or not. A file that records a run's numbers but not its verdict is not evidence of a
 * green run, and it was being cited as one.
 */
import { spawn } from "node:child_process";
import { existsSync, renameSync, rmSync } from "node:fs";

const target = process.env.BREAKLINT_LIVE_REPORT;
const partial = target ? `${target}.partial` : null;
if (partial && existsSync(partial)) rmSync(partial);

const child = spawn(
  process.execPath,
  ["--test", "--test-timeout", "600000", "--experimental-strip-types", "tests/live/evidence.test.ts"],
  { stdio: "inherit" },
);
child.on("exit", (code) => {
  if (partial && existsSync(partial)) {
    if (code === 0) renameSync(partial, target);
    else {
      rmSync(partial);
      console.error(`breaklint: the live suite exited ${code}; no measurement report was written.`);
    }
  }
  process.exit(code ?? 1);
});
