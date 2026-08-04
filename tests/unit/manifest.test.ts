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
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
  files: string[];
  bin: Record<string, string>;
  exports: Record<string, string>;
  scripts: Record<string, string>;
};

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
  const sourceFor = (target: string): string => target.replace(/^\.\/dist\//u, "src/").replace(/\.js$/u, ".ts");

  it("`bin` and `exports` point inside the published set", () => {
    const published = pkg.files.map((f) => f.replace(/\/$/u, ""));
    for (const [name, target] of Object.entries({ ...pkg.bin, ...pkg.exports })) {
      if (target === "./package.json" || target === "package.json") continue;
      const top = target.replace(/^\.?\/?/u, "").split("/")[0]!;
      assert.ok(
        published.includes(top),
        `"${name}" points at ${target}, which is outside "files" — it would not be packed`,
      );
    }
  });

  it("every `bin` and `exports` target has a source that produces it", () => {
    for (const [name, target] of Object.entries({ ...pkg.bin, ...pkg.exports })) {
      if (target === "./package.json" || target === "package.json") continue;
      const normalised = target.startsWith("./") ? target : `./${target}`;
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

  it("ROOT resolves to the repository, so the assertions above address the right tree", () => {
    assert.ok(existsSync(`${ROOT}package.json`), "the test is looking at the wrong directory");
  });
});
