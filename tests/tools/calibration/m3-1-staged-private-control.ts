#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { canonicalJson, scanStagedPublicArtifacts } from "./m3-1-pilot.ts";

const mode = process.argv[2];
if (!(["--red", "--green"] as const).includes(mode as "--red" | "--green")) {
  process.stderr.write("usage: m3-1-staged-private-control.ts <--red|--green>\n");
  process.exitCode = 2;
} else {
  const repository = mkdtempSync(join(tmpdir(), "breaklint-m3-1-staged-control-"));
  execFileSync("git", ["init", "-q"], { cwd: repository });
  writeFileSync(join(repository, "private-document.svg"), "private bytes must never be staged");
  if (mode === "--red") {
    execFileSync("git", ["add", "private-document.svg"], { cwd: repository });
  } else {
    writeFileSync(join(repository, ".gitignore"), "private-document.svg\n");
    execFileSync("git", ["add", ".gitignore"], { cwd: repository });
  }
  const result = scanStagedPublicArtifacts(repository);
  process.stdout.write(canonicalJson({ control: "staged-private-document", mode, ...result }));
  if (!result.valid) process.exitCode = 1;
}
