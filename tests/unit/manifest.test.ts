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

  it("`bin` and `exports` point inside the published set", () => {
    const published = pkg.files.map((f) => f.replace(/\/$/u, ""));
    for (const [name, target] of Object.entries(pkg.bin)) {
      const top = target.replace(/^\.\//u, "").split("/")[0]!;
      assert.ok(
        published.includes(top),
        `bin "${name}" points at ${target}, which is outside "files" — the installed command would not exist`,
      );
    }
    for (const [name, target] of Object.entries(pkg.exports)) {
      if (!target.startsWith("./") || target === "./package.json") continue;
      const top = target.replace(/^\.\//u, "").split("/")[0]!;
      assert.ok(published.includes(top), `exports "${name}" points at ${target}, which is outside "files"`);
    }
  });

  it("ROOT resolves to the repository, so the assertions above address the right tree", () => {
    assert.ok(existsSync(`${ROOT}package.json`), "the test is looking at the wrong directory");
  });
});
