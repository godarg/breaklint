/**
 * A report written to a pipe arrives whole, in every format, with its exit code.
 *
 * THE DEFECT. The entry point called `process.exit()` as soon as the report had been handed to
 * `process.stdout.write()`. On a pipe the kernel takes what fits into the pipe buffer and Node
 * queues the rest, and `process.exit()` discards the queue. Measured on Linux, Node 24 and 22,
 * source and built entry: a reader behind `| cat`, `| jq` or a slow uploader received a multiple
 * of the pipe buffer — usually 65 536 bytes, sometimes 131 072 — of a 340 000-byte report in all
 * six formats, and the exit code still said 1. The
 * shipped demo's own JSON (82 585 bytes) was already over the limit. `--out` and `> file` were
 * never affected, which is why every earlier gate, all of which wrote to a file, stayed green.
 *
 * WHAT THE ORACLE IS. The same CLI's `--out` file, with the three values that differ between two
 * runs of the same input normalised (run id, timestamps, durations). Every route below must
 * deliver those bytes; JSON and SARIF must also parse, and the CLI's own exit code must be the
 * demo's 1. A reader that closes early must end the run with exit 3 and one line on stderr —
 * never 0 or 1, which would state a verdict about a report nobody received, and never an
 * uncaught EPIPE, which Node turns into exit 1.
 *
 * THREE ROUTES, because they are three different kernel objects and cut at different sizes:
 *   - a real kernel pipe into `cat` (`sh -c '… | cat'`): the shell integration a user writes;
 *   - a real kernel pipe into a reader that pauses 20 ms after every chunk, so the writer is
 *     guaranteed to find the pipe full while it still has output queued;
 *   - Node's own `stdio: "pipe"`, which on Linux is a socketpair, not a pipe. Measured, it cut at
 *     146 176 bytes (once at 255 808), not 65 536 — which is why every fixture here is at least
 *     256 KiB and sized for about 420 KB: above the Linux pipe (64 KiB), the socketpair here and
 *     macOS's 16–64 KiB pipes alike.
 *
 * WHERE THE ≥ 256 KiB REPORT COMES FROM, and why no product hook was added for it. A live run
 * would need Chrome, which `npm test` does not have. The only renderer-free public path is
 * `--demo`, which reads the snapshot at `examples/demo-snapshot.json` next to the package it runs
 * from. So the test builds a private copy of the package — the source tree byte for byte, plus
 * `dist/` compiled from it by the pinned TypeScript — and puts a larger demo snapshot into that
 * copy's `examples/`: the shipped fixture with extra local-URI references, each of which the real
 * `artifact/local-uri` rule reports as a finding. The CLI code that runs is the code that ships,
 * reached through the documented `--demo` option, in the shape an installed package has; nothing
 * in `src/` knows this test exists. Each format gets the smallest count that clears 256 KiB with
 * margin, and the test asserts the floor rather than trusting the count, so a reporter that later
 * shrinks its output fails here loudly instead of turning the test vacuous.
 *
 * NO TIME BUDGET. Nothing here bounds how long a process takes to start or to finish: a slow
 * runner makes this test slower, not red.
 */

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
const FORMATS = ["json", "sarif", "junit", "markdown", "console", "html"] as const;
type Format = (typeof FORMATS)[number];
const MIN_BYTES = 256 * 1024;
/**
 * Extra references per format, for about 420 KB each. Measured: each reference adds ~6.5 KB of
 * JSON but only ~80 B of Markdown. The margin over 256 KiB is deliberate: Node's socketpair here
 * once held 255 808 bytes before the old entry point exited.
 */
const EXTRA_REFS: Record<Format, number> = { json: 55, sarif: 330, junit: 1150, markdown: 5300, console: 420, html: 220 };
/** For the early-close cases: large enough that the CLI is certainly still writing when the reader leaves. */
const EARLY_CLOSE_REFS = 400;
/** The demo ends 1 on purpose: its fixture contains findings. */
const DEMO_EXIT = 1;

const SLOW_READER = `import { createWriteStream } from "node:fs";
const out = createWriteStream(process.argv[2]);
process.stdin.on("data", (chunk) => {
  out.write(chunk);
  process.stdin.pause();
  setTimeout(() => process.stdin.resume(), 20);
});
process.stdin.on("end", () => out.end());
`;

let pkg = "";
let entries: { name: string; argv: string[] }[] = [];

/** The shipped demo snapshot with `extra` more local-URI references in the private package copy. */
function writeDemo(extra: number): void {
  const demo = JSON.parse(readFileSync(join(REPO, "examples/demo-snapshot.json"), "utf8")) as {
    snapshot: { uriRefs: Record<string, unknown>[] };
  };
  const base = demo.snapshot.uriRefs[0];
  assert.ok(base, "the shipped demo snapshot has no uriRefs entry to extend");
  for (let i = 0; i < extra; i++) {
    const uri = `file:///build/machine/generated/asset-${String(i).padStart(5, "0")}-with-a-longer-name.png`;
    demo.snapshot.uriRefs.push({ ...base, rawValue: uri, resolvedUri: uri });
  }
  writeFileSync(join(pkg, "examples/demo-snapshot.json"), JSON.stringify(demo));
}

/** The values that legitimately differ between two runs over the same snapshot. */
function normalise(text: string): string {
  return text
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gu, "<run-id>")
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/gu, "<timestamp>")
    .replace(/("durationMs": ?)\d+/gu, "$10")
    .replace(/(\btime=")[\d.]+(")/gu, "$10$2");
}

function breaklintLines(stderr: string): string[] {
  return stderr.split("\n").filter((line) => line.startsWith("breaklint:"));
}

interface Delivery {
  code: number | null;
  bytes: Buffer;
  stderr: string;
}

/** The oracle: the same entry writing the same report to a file. */
function reference(entry: { argv: string[] }, format: Format): Delivery & { confirmation: string } {
  const file = join(pkg, `reference.${format}`);
  rmSync(file, { force: true });
  const run = spawnSync(process.execPath, [...entry.argv, "--demo", "--format", format, "--out", file], { encoding: "utf8" });
  return { code: run.status, bytes: readFileSync(file), stderr: run.stderr, confirmation: run.stdout };
}

/**
 * The CLI's stdout into a real kernel pipe, read by `reader`. The CLI's exit code is written to a
 * file inside the pipeline, because the status of a pipeline is its last command's.
 */
function throughKernelPipe(entry: { argv: string[] }, args: string[], reader: "cat" | "slow" | "head" | "closed"): Delivery {
  const received = join(pkg, "received.bin");
  const status = join(pkg, "status.txt");
  const stderrFile = join(pkg, "stderr.txt");
  for (const file of [received, status, stderrFile]) rmSync(file, { force: true });
  const sink = {
    cat: 'cat > "$BL_RECEIVED"',
    slow: '"$BL_NODE" "$BL_SLOW_READER" "$BL_RECEIVED"',
    head: 'head -c 100 > "$BL_RECEIVED"',
    // Reads nothing and exits at once, long before the CLI has started, let alone written.
    closed: ': > "$BL_RECEIVED"',
  }[reader];
  const shell = spawnSync("sh", ["-c", `{ "$@" 2> "$BL_STDERR"; echo $? > "$BL_STATUS"; } | ${sink}`, "sh", process.execPath, ...entry.argv, ...args], {
    env: {
      ...process.env,
      BL_RECEIVED: received,
      BL_STATUS: status,
      BL_STDERR: stderrFile,
      BL_NODE: process.execPath,
      BL_SLOW_READER: join(pkg, "slow-reader.mjs"),
    },
    encoding: "utf8",
  });
  assert.equal(shell.status, 0, `the pipeline itself failed: ${shell.stderr}`);
  return {
    code: Number(readFileSync(status, "utf8").trim()),
    bytes: readFileSync(received),
    stderr: readFileSync(stderrFile, "utf8"),
  };
}

/**
 * The CLI spawned by Node with `stdio: "pipe"` (a socketpair on Linux). `slow` pauses 20 ms per
 * chunk; `close-after-first-chunk` destroys the reading end as soon as anything arrives; `closed`
 * destroys it before the CLI can have written anything.
 */
function throughNodePipe(
  entry: { argv: string[] },
  args: string[],
  mode: "slow" | "close-after-first-chunk" | "closed" = "slow",
): Promise<Delivery> {
  return new Promise((resolve, reject) => {
    const cli = spawn(process.execPath, [...entry.argv, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    if (mode === "closed") cli.stdout.destroy();
    const closeAfterFirstChunk = mode === "close-after-first-chunk";
    const chunks: Buffer[] = [];
    let stderr = "";
    cli.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    cli.stdout.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      if (closeAfterFirstChunk) {
        cli.stdout.destroy();
        return;
      }
      cli.stdout.pause();
      setTimeout(() => cli.stdout.resume(), 20);
    });
    cli.once("error", reject);
    cli.once("close", (code) => resolve({ code, bytes: Buffer.concat(chunks), stderr }));
  });
}

/** Every way `got` falls short of the `--out` oracle, as sentences; empty when it was delivered. */
function shortfalls(route: string, format: Format, expected: Delivery, got: Delivery): string[] {
  const found: string[] = [];
  if (got.code !== DEMO_EXIT) found.push(`${format} via ${route}: the CLI exited ${got.code}; stderr: ${got.stderr}`);
  if (normalise(got.bytes.toString("utf8")) !== normalise(expected.bytes.toString("utf8"))) {
    found.push(`${format} via ${route}: ${got.bytes.length} of ${expected.bytes.length} bytes arrived, or they differ from --out`);
  } else if (format === "json" || format === "sarif") {
    try {
      JSON.parse(got.bytes.toString("utf8"));
    } catch (error) {
      found.push(`${format} via ${route} does not parse: ${String(error)}`);
    }
  }
  const diagnostics = breaklintLines(got.stderr);
  if (diagnostics.length > 0) found.push(`${format} via ${route} wrote a diagnostic: ${diagnostics.join(" | ")}`);
  return found;
}

describe("the CLI delivers its whole report through a pipe (G-01)", () => {
  before(() => {
    pkg = mkdtempSync(join(tmpdir(), "breaklint-pipe-integrity-"));
    cpSync(join(REPO, "src"), join(pkg, "src"), { recursive: true });
    cpSync(join(REPO, "package.json"), join(pkg, "package.json"));
    symlinkSync(join(REPO, "node_modules"), join(pkg, "node_modules"));
    mkdirSync(join(pkg, "examples"));
    writeFileSync(join(pkg, "slow-reader.mjs"), SLOW_READER);
    // The built entry, compiled from the same source by the pinned compiler and the build config
    // `npm pack` uses, and reached through a symlink the way npm installs a `bin`.
    const build = spawnSync(
      process.execPath,
      [join(REPO, "node_modules/typescript/bin/tsc"), "-p", join(REPO, "tsconfig.build.json"), "--outDir", join(pkg, "dist")],
      { encoding: "utf8" },
    );
    assert.equal(build.status, 0, `the package did not build: ${build.stdout}${build.stderr}`);
    mkdirSync(join(pkg, ".bin"));
    symlinkSync(join(pkg, "dist/cli/index.js"), join(pkg, ".bin/breaklint"));
    entries = [
      { name: "source entry", argv: ["--experimental-strip-types", join(pkg, "src/cli/index.ts")] },
      { name: "built entry through a bin symlink", argv: [join(pkg, ".bin/breaklint")] },
    ];
  });
  after(() => {
    if (pkg) rmSync(pkg, { recursive: true, force: true });
  });

  for (const format of FORMATS) {
    it(`${format}: every route delivers the --out bytes and keeps the exit code`, async () => {
      writeDemo(EXTRA_REFS[format]);
      const failures: string[] = [];
      for (const entry of entries) {
        const expected = reference(entry, format);
        assert.equal(expected.code, DEMO_EXIT, `${entry.name} --out exited ${expected.code}: ${expected.stderr}`);
        assert.ok(
          expected.bytes.length >= MIN_BYTES,
          `the ${format} fixture is too small to prove anything: ${expected.bytes.length} B < ${MIN_BYTES} B`,
        );
        const args = ["--demo", "--format", format];
        // Every route is run and judged before the assertion, so a red run names each route that
        // lost bytes and how many arrived, not only the first.
        failures.push(
          ...shortfalls(`${entry.name}, kernel pipe into cat`, format, expected, throughKernelPipe(entry, args, "cat")),
          ...shortfalls(`${entry.name}, kernel pipe into a slow reader`, format, expected, throughKernelPipe(entry, args, "slow")),
          ...shortfalls(`${entry.name}, Node pipe with a slow reader`, format, expected, await throughNodePipe(entry, args)),
        );
      }
      assert.deepEqual(failures, [], failures.join("\n"));
    });
  }

  it("a reader that closes early ends the run with exit 3 and one line on stderr", async () => {
    writeDemo(EARLY_CLOSE_REFS);
    const args = ["--demo", "--format", "json"];
    const failures: string[] = [];
    for (const entry of entries) {
      const expected = reference(entry, "json");
      assert.ok(expected.bytes.length > 4 * MIN_BYTES, `the early-close fixture is only ${expected.bytes.length} B`);
      const cases: [string, Delivery][] = [
        [`${entry.name}, kernel pipe into head -c 100`, throughKernelPipe(entry, args, "head")],
        [`${entry.name}, Node pipe destroyed after the first chunk`, await throughNodePipe(entry, args, "close-after-first-chunk")],
      ];
      for (const [route, got] of cases) {
        // The premise first: a reader that got everything did not close early, and the case
        // would then test nothing at all.
        assert.ok(got.bytes.length < expected.bytes.length, `${route}: the reader received everything, so nothing was tested`);
        const lines = breaklintLines(got.stderr);
        if (got.code !== 3) {
          failures.push(`${route}: exited ${got.code}; 0 or 1 is a verdict about a report nobody received. stderr: ${got.stderr}`);
        }
        if (lines.length !== 1 || !/could not write to stdout \(E[A-Z]+\).*exit 3/u.test(lines[0]!)) {
          failures.push(`${route}: expected exactly one breaklint line naming the stdout failure, got: ${JSON.stringify(got.stderr)}`);
        }
        if (/Unhandled 'error' event|node:events/u.test(got.stderr)) failures.push(`${route}: the write failure crashed the process`);
      }
    }
    assert.deepEqual(failures, [], failures.join("\n"));
  });
  it("with --out, a reader that closed before the confirmation line keeps the verdict and the file", async () => {
    // The report goes to the file first and is complete before stdout is touched; stdout carries
    // only a one-line confirmation. Losing that line loses nothing the verdict rests on, so the
    // exit code stays the run's own and stderr says what was lost. Exit 3 would state that the
    // report was not delivered, which is false here.
    writeDemo(EXTRA_REFS.json);
    const target = join(pkg, "delivered-to-file.json");
    const args = ["--demo", "--format", "json", "--out", target];
    const failures: string[] = [];
    for (const entry of entries) {
      const expected = reference(entry, "json");
      // The positive half: with stdout intact, the confirmation arrives and nothing is reported.
      assert.match(expected.confirmation, /^breaklint: json report written to /u, `${entry.name}: no confirmation line`);
      assert.deepEqual(breaklintLines(expected.stderr), [], `${entry.name}: a diagnostic on an intact stdout`);
      for (const [route, run] of [
        [`${entry.name}, kernel pipe whose reader exited at once`, () => Promise.resolve(throughKernelPipe(entry, args, "closed"))],
        [`${entry.name}, Node pipe destroyed before the CLI wrote`, () => throughNodePipe(entry, args, "closed")],
      ] as const) {
        rmSync(target, { force: true });
        const got = await run();
        assert.equal(got.bytes.length, 0, `${route}: the reader received the confirmation, so nothing was tested`);
        if (got.code !== DEMO_EXIT) failures.push(`${route}: exited ${got.code}, not the verdict's ${DEMO_EXIT}; stderr: ${got.stderr}`);
        const written = readFileSync(target, "utf8");
        if (normalise(written) !== normalise(expected.bytes.toString("utf8"))) {
          failures.push(`${route}: the report file holds ${written.length} of ${expected.bytes.length} bytes, or differs`);
        }
        const lines = breaklintLines(got.stderr);
        if (
          lines.length !== 1 ||
          !/could not write the confirmation line to stdout \(E[A-Z]+\); the report file was written in full/u.test(lines[0]!)
        ) {
          failures.push(`${route}: expected exactly one line naming the lost confirmation, got: ${JSON.stringify(got.stderr)}`);
        }
      }
    }
    assert.deepEqual(failures, [], failures.join("\n"));
  });
});
