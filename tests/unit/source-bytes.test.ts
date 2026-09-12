import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { captureBoundedSourceFile, decodeUtf8Strict } from "../../src/source/bytes.ts";

describe("bounded source byte capture", () => {
  it("captures one root-relative regular file and rejects protected, symlinked, and oversized paths before use", () => {
    const root = mkdtempSync(join(tmpdir(), "breaklint-bounded-source-"));
    const outside = mkdtempSync(join(tmpdir(), "breaklint-bounded-outside-"));
    try {
      mkdirSync(join(root, "nested"));
      writeFileSync(join(root, "nested", "document.html"), "<p>ok</p>");
      writeFileSync(join(root, ".env"), "temporary-test-value");
      writeFileSync(join(root, ".env.local"), "synthetic-nonsecret-canary");
      writeFileSync(join(root, "large.bin"), "0123456789");
      writeFileSync(join(outside, "outside.html"), "outside");
      symlinkSync(outside, join(root, "linked-parent"));
      assert.equal(captureBoundedSourceFile(root, "nested/document.html", 1024).toString(), "<p>ok</p>");
      assert.throws(() => captureBoundedSourceFile(root, ".env", 1024), /unsafe .*relative path/u);
      assert.throws(() => captureBoundedSourceFile(root, ".env.local", 1024), /unsafe .*relative path/u);
      assert.throws(() => captureBoundedSourceFile(root, "linked-parent/outside.html", 1024), /symlink/u);
      assert.throws(() => captureBoundedSourceFile(root, "large.bin", 5), /bounded regular file/u);
      assert.throws(() => decodeUtf8Strict(Buffer.from([0xc3, 0x28]), "temporary invalid bytes"), /UTF-8/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
