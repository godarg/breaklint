import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { parseDeclaredManifest, verifyDeclaredManifest } from "../../src/source/provenance.ts";

const digest = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const file = (path: string, bytes: Buffer | string) => ({ path, sha256: digest(bytes), bytes: Buffer.byteLength(bytes) });

describe("declared source manifests", () => {
  it("verifies byte-copy edges while retaining declared rather than producer-bound provenance", () => {
    const root = mkdtempSync(join(tmpdir(), "breaklint-source-"));
    try {
      mkdirSync(join(root, "src"));
      const source = Buffer.from("<p>author text</p>", "utf8");
      const output = Buffer.from(`<main>${source.toString("utf8")}</main>`, "utf8");
      writeFileSync(join(root, "src", "chapter.html"), source);
      writeFileSync(join(root, "print.html"), output);
      const start = output.indexOf(source);
      const manifest = {
        schemaVersion: 1, projectId: "test", documentId: "doc",
        producer: { id: "declared", version: "1", dependencies: [] },
        inputs: [file("src/chapter.html", source)], output: file("print.html", output),
        mappings: [{ outputStart: start, outputEnd: start + source.length, sourcePath: "src/chapter.html", sourceStart: 0, sourceEnd: source.length, sourceId: "chapter" }],
      };
      const result = verifyDeclaredManifest(root, Buffer.from(JSON.stringify(manifest)));
      assert.deepEqual(result, { ok: true, binding: "declared", copyIntegrity: "verified", diagnostics: [] });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("rejects an unused identical B mapping: byte equality is not a substitute for the checked edge", () => {
    const root = mkdtempSync(join(tmpdir(), "breaklint-source-"));
    try {
      const actualA = Buffer.from("A", "utf8"); const unusedB = Buffer.from("A", "utf8"); const output = Buffer.from("A", "utf8");
      writeFileSync(join(root, "a.txt"), actualA); writeFileSync(join(root, "b.txt"), unusedB); writeFileSync(join(root, "out.html"), output);
      const manifest = {
        schemaVersion: 1, projectId: "test", documentId: "doc", producer: { id: "declared", version: "1", dependencies: [] },
        inputs: [file("a.txt", actualA), file("b.txt", unusedB)], output: file("out.html", output),
        // The declaration can match B's bytes, but that never turns it producer-bound.
        mappings: [{ outputStart: 0, outputEnd: 1, sourcePath: "b.txt", sourceStart: 0, sourceEnd: 1, sourceId: "unused-b" }],
      };
      const result = verifyDeclaredManifest(root, Buffer.from(JSON.stringify(manifest)));
      assert.equal(result.ok, true);
      assert.equal(result.binding, "declared", "a manifest cannot claim an observed producer edge");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("fails closed on invalid UTF-8 and path traversal before a source root is used", () => {
    assert.throws(() => parseDeclaredManifest(Buffer.from([0xc3, 0x28])), /UTF-8/u);
    const manifest = { schemaVersion: 1, projectId: "x", documentId: "y", producer: { id: "z", version: "1", dependencies: [] }, inputs: [file("../secret", "x")], output: file("out.html", "x"), mappings: [] };
    assert.throws(() => parseDeclaredManifest(Buffer.from(JSON.stringify(manifest))), /schema/u);
  });

  it("rejects malformed revisions and duplicate producer/file identities before reading a root", () => {
    const base = {
      schemaVersion: 1, projectId: "x", documentId: "y",
      producer: { id: "z", version: "1", dependencies: [{ id: "shared", sha256: "a".repeat(64), bytes: 1 }, { id: "shared", sha256: "b".repeat(64), bytes: 1 }] },
      inputs: [file("input.html", "x")], output: file("out.html", "x"), mappings: [],
    };
    assert.throws(() => parseDeclaredManifest(Buffer.from(JSON.stringify(base))), /duplicate producer dependency/u);
    assert.throws(() => parseDeclaredManifest(Buffer.from(JSON.stringify({ ...base, producer: { ...base.producer, dependencies: [] }, revision: 42 }))), /revision/u);
    assert.throws(() => parseDeclaredManifest(Buffer.from(JSON.stringify({ ...base, producer: { ...base.producer, dependencies: [] }, delivery: file("out.html", "x") }))), /duplicate file/u);
  });
});
