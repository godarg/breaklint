/**
 * The packaging manifest as a checked object rather than a hopeful list.
 *
 * `package.json` used to promise `report.schema.json` and `breaklint.schema.json` in `files`, and
 * neither existed anywhere in the repository; `profiles/` was listed and empty. npm does not
 * complain about this — it silently packs what it finds — so the manifest could name anything at
 * all and every gate stayed green. An audit found it by running `npm pack --dry-run` and reading
 * the file list, which is exactly the kind of check that only happens if something schedules it.
 *
 * The `bin` and `exports` entries matter more than the `files` entries, because they are what
 * breaks at the consumer rather than merely being absent: a `bin` pointing at a path outside the
 * published set produces an installed package whose one documented command does not run.
 */

import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
  files: string[];
  bin: Record<string, string>;
  exports: Record<string, string | { types: string; default: string }>;
  types?: string;
  scripts: Record<string, string>;
  main?: string;
};

/** Flatten every supported public export condition; no target may evade the package checks. */
function entryTargets(): [string, string][] {
  const result: [string, string][] = Object.entries(pkg.bin);
  for (const [name, target] of Object.entries(pkg.exports)) {
    if (typeof target === "string") result.push([name, target]);
    else {
      assert.deepEqual(Object.keys(target), ["types", "default"], "root exports declare types before the runtime default");
      for (const [condition, path] of Object.entries(target)) {
        assert.equal(typeof path, "string");
        result.push([`${name}:${condition}`, path]);
      }
    }
  }
  if (pkg.main) result.push(["main", pkg.main]);
  if (pkg.types) result.push(["types", pkg.types]);
  return result;
}

/** Every `.ts` under a directory. Used to derive runtime data dependencies from the source. */
function walk(dir: URL): URL[] {
  const out: URL[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, dir);
    if (entry.isDirectory()) out.push(...walk(child));
    else if (entry.name.endsWith(".ts")) out.push(child);
  }
  return out;
}

/** `dist/` is a build product, so its ABSENCE before a build is normal and not what this checks. */
const isBuildProduct = (entry: string): boolean => entry === "dist/" || entry.startsWith("dist/");

describe("the packaging manifest names only things that exist", () => {
  it("every `files` entry exists in the repository", () => {
    for (const entry of pkg.files) {
      if (isBuildProduct(entry)) continue;
      assert.ok(
        existsSync(new URL(entry, new URL("../../", import.meta.url))),
        `package.json "files" lists ${entry}, which does not exist — npm packs silently around it`,
      );
    }
  });

  it("no `files` entry is an empty directory", () => {
    for (const entry of pkg.files) {
      if (isBuildProduct(entry) || !entry.endsWith("/")) continue;
      const dir = new URL(entry, new URL("../../", import.meta.url));
      assert.ok(
        readdirSync(dir).length > 0,
        `package.json "files" lists ${entry}, which is empty — it promises content that is not there`,
      );
    }
  });

  /**
   * Both halves matter, and the first version of this test only had the first.
   *
   * Being inside `files` means the file gets PACKED. It does not mean the file EXISTS — and a
   * build product cannot be checked by looking for it, because it is absent until `npm run build`.
   * The first version therefore compared only the top-level path segment and skipped anything
   * under `dist/`, which left it green over a real defect sitting in the manifest: `exports["."]`
   * named `./dist/index.js` while no `src/index.ts` existed, so `import … from "breaklint"` on an
   * installed package failed with ERR_MODULE_NOT_FOUND. An audit measured that pointing `exports`
   * at `./dist/this/does/not/exist.js` left the unit suite at 110/110.
   *
   * A `dist/` target is therefore checked against its SOURCE: `dist/cli/index.js` requires
   * `src/cli/index.ts`. That is verifiable without a build and fails for exactly the reason the
   * defect existed.
   */
  const sourceFor = (target: string): string => target.replace(/^\.\/dist\//u, "src/").replace(/(?:\.d\.ts|\.js)$/u, ".ts");

  it("the one documented command points at the CLI and nothing else", () => {
    // Measured: `bin` could be repointed at `dist/report/console.js` with the whole suite green —
    // the target was inside `files` and its source existed, so both earlier assertions passed,
    // and the installed command would have run a reporter module and done nothing. A package with
    // one documented command should pin where that command lives.
    assert.deepEqual(Object.keys(pkg.bin), ["breaklint"], "this package publishes exactly one command");
    assert.equal(pkg.bin.breaklint, "dist/cli/index.js", "the command is the CLI entry, not another module");
  });

  it("`bin`, `exports` and `main` point inside the published set", () => {
    const published = pkg.files.map((f) => f.replace(/\/$/u, ""));
    // `main` was not iterated at all by the first version: `"main": "./dist/nope.js"` stayed green
    // under a test titled "names only things that exist".
    for (const [name, target] of entryTargets()) {
      if (target === "./package.json" || target === "package.json") continue;
      const top = target.replace(/^\.?\/?/u, "").split("/")[0]!;
      assert.ok(
        published.includes(top),
        `"${name}" points at ${target}, which is outside "files" — it would not be packed`,
      );
    }
  });

  it("every `bin` and `exports` target has a source that produces it", () => {
    for (const [name, target] of entryTargets()) {
      if (target === "./package.json" || target === "package.json") continue;
      const normalised = target.startsWith("./") ? target : `./${target}`;
      if (normalised.endsWith(".json") && !normalised.startsWith("./dist/")) {
        assert.ok(
          existsSync(new URL(`../../${normalised.slice(2)}`, import.meta.url)),
          `"${name}" points at missing static artifact ${target}`,
        );
        continue;
      }
      assert.ok(
        normalised.startsWith("./dist/"),
        `"${name}" points at ${target}; this package publishes build products only`,
      );
      const source = sourceFor(normalised);
      assert.ok(
        existsSync(new URL(`../../${source}`, import.meta.url)),
        `"${name}" points at ${target}, but ${source} does not exist — the published entry point ` +
          `cannot be built, and an installed package would fail with ERR_MODULE_NOT_FOUND`,
      );
    }
  });

  it("publishes the generated Configuration Contract v1 schema at a stable export", () => {
    assert.equal(pkg.exports["./config.schema.json"], "./breaklint.schema.json");
    assert.ok(pkg.files.includes("breaklint.schema.json"), "the exported schema is not in the packed file set");
    const schema = JSON.parse(readFileSync(new URL("../../breaklint.schema.json", import.meta.url), "utf8")) as {
      $id?: string;
      additionalProperties?: boolean;
    };
    assert.equal(schema.$id, "https://dargel-solutions.de/schemas/breaklint/config-v1.json");
    assert.equal(schema.additionalProperties, false);
  });

  /**
   * The direction the first two versions of this file both missed.
   *
   * Everything above asks "does what is LISTED exist?". Nothing asked "is what is REQUIRED
   * listed?" — and those are different questions with different failure modes. An audit measured
   * the consequence: removing `examples/` from `files` left this suite at 164/164 while
   * `npm pack --dry-run` packed zero `examples` entries. `src/cli/index.ts` resolves
   * `../../examples/demo-snapshot.json` from `dist/cli/`, so the published `npx breaklint --demo`
   * — the one command the README and `--help` document — would have failed with ENOENT.
   *
   * The check is derived from the SOURCE rather than from a hand-written list, so a new runtime
   * dependency on a new directory is covered the day it is written.
   *
   * Red condition: drop any directory the shipped code reads at runtime from `files`.
   */
  it("every directory the shipped code reads at runtime is packed", () => {
    const published = new Set(pkg.files.map((f) => f.replace(/\/$/u, "")));
    const shipped = walk(new URL("../../src/", import.meta.url));
    const required = new Map<string, string>();
    for (const file of shipped) {
      const text = readFileSync(file, "utf8");
      // ONE shape, because one is what this codebase uses: a relative literal ending in a data
      // extension, e.g. `resolvePath(HERE, "../../examples/demo-snapshot.json")`.
      //
      // A first version carried a second pattern for `new URL("../../<dir>/…", import.meta.url)`
      // and described the two as "the two shapes that reach package data in this codebase".
      // Measured: that pattern yields ZERO directories over all of `src/`, and removing it leaves
      // this suite green. It was dead code documenting a coverage claim the live code never made.
      //
      // A specifier ending in .ts/.js is a source import — compiled into dist, needing no packing
      // of its own — so only data extensions count; treating imports as package data made an
      // earlier version of this scan demand that `core/` be listed in `files`.
      const pattern = /["'`](?:\.\.\/)+([A-Za-z0-9._-]+)\/[A-Za-z0-9._-]+\.(?:json|html|css|svg|txt|md)["'`]/gu;
      for (const m of text.matchAll(pattern)) {
        const dir = m[1]!;
        // `..` and `.` are path steps the greedy prefix can leave behind, not directories.
        if (dir === ".." || dir === ".") continue;
        if (dir === "src" || dir === "tests" || dir === "dist" || dir === "node_modules") continue;
        required.set(dir, file.pathname.replace(/^.*\/src\//u, "src/"));
      }
    }
    // The positive control names the dependency it must keep seeing. `size > 0` alone proves only
    // that SOMETHING was found and would stay green while the one real dependency became invisible.
    assert.ok(
      required.has("examples"),
      `the scan no longer sees examples/, which src/cli/index.ts reads for --demo; it found: ` +
        `${[...required.keys()].join(", ") || "nothing"}`,
    );

    // The limit, stated because it is real and a reader would otherwise assume more. This scan
    // sees LITERAL relative data paths. A path assembled at runtime — `"../../profiles/" + name +
    // ".json"`, a `path.join` with a variable segment, an extension not in the list above — is
    // invisible to it, and an audit demonstrated exactly that with a concatenated `profiles/`
    // path that left this suite green. Recorded as a gap rather than implied to be covered.
    for (const [dir, source] of required) {
      assert.ok(
        published.has(dir),
        `${source} reads ${dir}/ at runtime, but "files" does not pack it — the installed package ` +
          `would fail with ENOENT on the very command that needs it`,
      );
    }
  });

  it("ROOT resolves to the repository, so the assertions above address the right tree", () => {
    assert.ok(existsSync(`${ROOT}package.json`), "the test is looking at the wrong directory");
  });
});

/*
 * What npm shows and ships. The description is the one positioning sentence the 0.11.1 plan fixes
 * for package.json, GitHub, README line 1 and the website (Massnahmenplan 0.11.1 v02, guiding
 * decision 7); the keywords make the Playwright and print-CSS uses findable in npm search. The
 * package carries user documentation only: maintainer material (`maintainers/`, `planning/`)
 * never ships.
 */
describe("the npm listing and the shipped file set", () => {
  const listing = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
    description: string;
    keywords: string[];
    files: string[];
  };

  it("the description is the positioning sentence, word for word", () => {
    assert.equal(
      listing.description,
      "Find page-break and layout bugs in HTML-to-PDF output (Paged.js) and in your Playwright pages — measured on the rendered page, with source locations and CI-ready exit codes.",
    );
  });

  it("the keywords name the print and the Playwright uses", () => {
    const required = ["cli", "lint", "print-css", "playwright", "pdf-layout", "layout-testing", "css-paged-media", "github-action"];
    assert.deepEqual(required.filter((keyword) => !listing.keywords.includes(keyword)), [], "package.json keywords lack these");
    assert.equal(new Set(listing.keywords).size, listing.keywords.length, "a keyword is listed twice");
  });

  it("npm packs no maintainer material, whatever lands in maintainers/ or planning/", () => {
    // The real `files` field and the real npm, over a stand-in tree that HAS the directories a
    // later move creates: a check over today's tree alone could not see a pattern that would
    // pick them up tomorrow.
    const tree = mkdtempSync(join(tmpdir(), "breaklint-files-"));
    try {
      writeFileSync(join(tree, "package.json"), JSON.stringify({ name: "breaklint-files-probe", version: "0.0.0", files: listing.files }));
      for (const path of ["maintainers/releasing.md", "planning/finish.md", "docs/rules/example.md", "docs/configuration.md", "dist/index.js", "README.md"]) {
        mkdirSync(join(tree, path, ".."), { recursive: true });
        writeFileSync(join(tree, path), "x\n");
      }
      const run = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
        cwd: tree, encoding: "utf8", env: { ...process.env, npm_config_cache: join(tree, ".npm-cache"), npm_config_update_notifier: "false" },
      });
      assert.equal(run.status, 0, run.stderr);
      const packed = (JSON.parse(run.stdout) as { files: { path: string }[] }[])[0]!.files.map((file) => file.path);
      assert.ok(packed.includes("docs/rules/example.md") && packed.includes("dist/index.js"), `the probe packed too little to mean anything: ${packed.join(", ")}`);
      assert.deepEqual(packed.filter((path) => /^(maintainers|planning)\//u.test(path)), [], "npm would ship maintainer material");
    } finally {
      rmSync(tree, { recursive: true, force: true });
    }
  });
});
