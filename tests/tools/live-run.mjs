/**
 * Runs the live suite and, only if it exited 0, promotes the measurement report.
 *
 * The report used to be written from the suite's `after` hook, which runs whether the assertions
 * passed or not. A file that records a run's numbers but not its verdict is not evidence of a
 * green run, and it was being cited as one.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, renameSync, rmSync } from "node:fs";

const target = process.env.BREAKLINT_LIVE_REPORT;
const partial = target ? `${target}.partial` : null;
if (partial && existsSync(partial)) rmSync(partial);

const child = spawn(
  process.execPath,
  [
    "--test",
    "--test-timeout",
    "600000",
    "--experimental-strip-types",
    // Named individually rather than globbed. A glob that matched nothing would run zero files,
    // exit 0, and leave no suite to report a missing prerequisite — the same green-over-nothing
    // shape the promotion check below exists to stop, one level further out.
    "tests/live/evidence.test.ts",
    "tests/live/measure.test.ts",
    "tests/live/breaks.test.ts",
  ],
  { stdio: "inherit" },
);
child.on("exit", (code) => {
  if (partial && existsSync(partial)) {
    // Exit 0 is not enough. A run whose prerequisites were declared optional skips every case and
    // still exits 0, and the report it leaves behind is a green verdict over nothing measured —
    // the mirror image of the defect this file was written to fix. A report with no cases is not
    // promoted, and the reason is said out loud.
    let cases = 0;
    let missing = [];
    try {
      const report = JSON.parse(readFileSync(partial, "utf8"));
      cases = Object.keys(report.cases ?? {}).length;
      missing = report.missingPrerequisites ?? [];
    } catch {
      cases = 0;
    }
    if (code === 0 && cases > 0) renameSync(partial, target);
    else {
      rmSync(partial);
      const why =
        code !== 0
          ? `the live suite exited ${code}`
          : `the live suite measured nothing (0 cases${missing.length ? `, missing: ${missing.join(", ")}` : ""})`;
      console.error(`breaklint: ${why}; no measurement report was written.`);
    }
  }
  process.exit(code ?? 1);
});
