#!/usr/bin/env node

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { configSchema } from "../src/config/contract.ts";

const target = fileURLToPath(new URL("../breaklint.schema.json", import.meta.url));
const expected = `${JSON.stringify(configSchema(), null, 2)}\n`;

if (process.argv.includes("--check")) {
  let actual = "";
  try {
    actual = readFileSync(target, "utf8");
  } catch {
    process.stderr.write("breaklint.schema.json is missing; run npm run schema:write.\n");
    process.exitCode = 1;
  }
  if (actual !== expected) {
    process.stderr.write(
      "breaklint.schema.json has drifted from the runtime contract; run npm run schema:write and review the diff.\n",
    );
    process.exitCode = 1;
  }
} else {
  writeFileSync(target, expected, "utf8");
  process.stdout.write("wrote breaklint.schema.json from Configuration Contract v1\n");
}
