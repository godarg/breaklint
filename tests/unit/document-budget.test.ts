import assert from "node:assert/strict";
import { test } from "node:test";

import { parseArgs } from "../../src/cli/args.ts";
import { resolveConfig } from "../../src/config/resolve.ts";

test("document budget is accepted from CLI and config with CLI precedence", () => {
  const args = parseArgs(["--document-timeout-ms", "700000", "book.html"]);
  assert.equal(args.documentTimeoutMs, 700000);
  const config = resolveConfig({ file: { documentTimeoutMs: 480000 }, cli: args });
  assert.equal(config.documentTimeoutMs, 700000);
  assert.equal(config.sources["/documentTimeoutMs"], "cli");
});

test("document budget rejects malformed and out-of-range values", () => {
  for (const value of ["0", "12000", "1800001", "2.5", "1e5", "abc", "-5"]) {
    assert.throws(() => parseArgs(["--document-timeout-ms", value]), /document-timeout-ms/);
  }
  for (const value of [0, 12000, 1800001, 2.5, "600000"]) {
    assert.throws(() => resolveConfig({ file: { documentTimeoutMs: value }, cli: {} }), /documentTimeoutMs/);
  }
});
