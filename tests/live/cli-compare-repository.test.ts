/**
 * `breaklint compare --repository` and `--fail-on-new` on real producer-bound reports.
 *
 * Three reports of one host producer are measured live across three Git commits of the same
 * source: clean (commit 1), a label pushed out of its SVG (commit 2, one finding with a unique
 * stable identity) and the repair (commit 3). They are written to disk and compared by the BUILT
 * CLI (`dist/cli/index.js`, compiled from this tree into a temporary package) as a child process.
 *
 * Two commits differ in HEAD, so the API confirms lineage only through a Git ancestry read in
 * the repository (`revision.repositoryRoot`). Without `--repository` the CLI cannot pass one: the
 * new finding stays "not-sufficiently-measured" and the repair is never "resolved". With it, the
 * same files give "new" and "resolved", and `--fail-on-new` turns the new finding into exit 1.
 */

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { checkProducedDocuments } from "../../src/index.ts";
import type { Report } from "../../src/core/types.ts";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const fontBytes = readFileSync(join(ROOT, "node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf"));
const producer = `const fs=require('node:fs'),crypto=require('node:crypto');
const args=process.argv, root=args[args.indexOf('--run-root')+1], runId=args[args.indexOf('--run-id')+1];
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const body=fs.readFileSync(args[2]),font=fs.readFileSync(args[3]),css=fs.readFileSync(args[4]),code=fs.readFileSync(__filename);
for(const bytes of [body,font,css])fs.writeFileSync(root+'/blobs/'+sha(bytes),bytes);
const files=[{id:'@fixture/producer',sha256:sha(code),bytes:code.length}];
const read={path:'source.html',sha256:sha(body),bytes:body.length,role:'authoring'};
const fontRead={path:'fixture.ttf',sha256:sha(font),bytes:font.length,role:'asset'};
const cssRead={path:'styles.css',sha256:sha(css),bytes:css.length,role:'dependency'};
fs.writeSync(3,JSON.stringify({protocol:'studio-producer-record-v1',runId,producerId:'repair-fixture',complete:true,
expected:[read,fontRead,cssRead],reads:[read,fontRead,cssRead],outputs:[{path:'print.html',sha256:sha(body),bytes:body.length,pieces:[{kind:'copy',inputPath:'source.html',inputStart:0,inputEnd:body.length,outputStart:0,outputEnd:body.length}]}],options:{},code:{sha256:sha(Buffer.from(JSON.stringify(files))),files,dependencies:[]}}));`;
/** x = -20 pushes the label out of its overflow:hidden SVG (one finding); x = 20 keeps it inside. */
const page = (outside: boolean) => `<!doctype html><html><head><link rel="icon" href="data:,blank"><link rel="stylesheet" href="styles.css"><style>@font-face{font-family:BoundFixture;src:url(data:font/ttf;base64,${fontBytes.toString("base64")})}*{font-family:BoundFixture}@page{size:A4;margin:10mm}body{margin:0}</style></head><body><p>Geometry reference.</p><svg width="200" height="100" style="overflow:hidden"><text id="repair-target" x="${outside ? -20 : 20}" y="50" font-size="20">Label</text></svg></body></html>`;

let stage = "";
let root = "";
let cli = "";
const reports: Record<"clean" | "broken" | "repaired", string> = { clean: "", broken: "", repaired: "" };

function compare(args: string[]) {
  return spawnSync(process.execPath, [cli, "compare", ...args], { cwd: root, encoding: "utf8", timeout: 60_000 });
}

function statuses(file: string): string[] {
  return (JSON.parse(readFileSync(file, "utf8")) as { results: { status: string }[] }).results.map((result) => result.status);
}

before(async () => {
  stage = mkdtempSync(join(tmpdir(), "breaklint-cli-repository-stage-"));
  copyFileSync(join(ROOT, "package.json"), join(stage, "package.json"));
  symlinkSync(join(ROOT, "node_modules"), join(stage, "node_modules"));
  execFileSync(process.execPath, [join(ROOT, "node_modules/typescript/bin/tsc"), "-p", join(ROOT, "tsconfig.build.json"), "--outDir", join(stage, "dist")], {
    cwd: ROOT, stdio: ["ignore", "pipe", "pipe"], timeout: 240_000,
  });
  cli = join(stage, "dist/cli/index.js");

  root = mkdtempSync(join(tmpdir(), "breaklint-cli-repository-"));
  mkdirSync(join(root, "source"));
  const source = join(root, "source", "source.html");
  const font = join(root, "source", "fixture.ttf");
  const css = join(root, "source", "styles.css");
  const program = join(root, "producer.cjs");
  writeFileSync(font, fontBytes); writeFileSync(css, "svg { color: black; }\n"); writeFileSync(program, producer);
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
  const commit = (message: string) => { git("add", "source", "producer.cjs"); git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", message); };
  git("init", "-q");
  let run = 0;
  const measure = async (name: keyof typeof reports): Promise<void> => {
    const result = await checkProducedDocuments({
      producer: { trust: "host-controlled-producer", id: "repair-fixture", executable: process.execPath, argv: [program, source, font, css], codeFiles: [{ id: "@fixture/producer", path: program }], producerOptions: {} },
      options: { outputPaths: ["print.html"], only: ["svg/text-overflows-viewport"], outDir: join(root, `run-${run++}`), evidenceBinding: false, revision: { repositoryRoot: root, sourcePrefix: "source" } },
    });
    if (!result.ok) throw new Error(result.detail);
    reports[name] = join(root, `${name}.json`);
    writeFileSync(reports[name], `${JSON.stringify(result.report, null, 2)}\n`);
  };
  writeFileSync(source, page(false)); commit("clean"); await measure("clean");
  writeFileSync(source, page(true)); commit("label pushed out"); await measure("broken");
  writeFileSync(source, page(false)); commit("repair"); await measure("repaired");
  const broken = JSON.parse(readFileSync(reports.broken, "utf8")) as Report;
  assert.equal(broken.findings.length, 1, `the broken commit must produce one finding: ${broken.runVerdict}`);
  assert.equal(broken.findings[0]!.stableIdentity.status, "unique");
  assert.equal((JSON.parse(readFileSync(reports.clean, "utf8")) as Report).findings.length, 0);
});

after(() => {
  if (stage) rmSync(stage, { recursive: true, force: true });
  if (root) rmSync(root, { recursive: true, force: true });
});

describe("compare --repository and --fail-on-new on producer-bound reports, live", () => {
  it("--repository passes the Git ancestry check through: a new finding and a repair across commits", () => {
    const withoutNew = compare([reports.clean, reports.broken, "--out", join(root, "new-without.json")]);
    assert.equal(withoutNew.status, 0, `${withoutNew.stdout}${withoutNew.stderr}`);
    assert.deepEqual(statuses(join(root, "new-without.json")), ["not-sufficiently-measured"]);
    const withNew = compare([reports.clean, reports.broken, "--repository", root, "--out", join(root, "new-with.json")]);
    assert.equal(withNew.status, 0, `${withNew.stdout}${withNew.stderr}`);
    assert.deepEqual(statuses(join(root, "new-with.json")), ["new"]);

    const withoutRepair = compare([reports.broken, reports.repaired, "--out", join(root, "repair-without.json")]);
    assert.equal(withoutRepair.status, 0, `${withoutRepair.stdout}${withoutRepair.stderr}`);
    assert.deepEqual(statuses(join(root, "repair-without.json")), ["not-sufficiently-measured"]);
    const withRepair = compare([reports.broken, reports.repaired, "--repository", root, "--out", join(root, "repair-with.json")]);
    assert.equal(withRepair.status, 0, `${withRepair.stdout}${withRepair.stderr}`);
    assert.deepEqual(statuses(join(root, "repair-with.json")), ["resolved"]);
  });

  it("--fail-on-new ends with exit 1 only when a result is new", () => {
    const failing = compare([reports.clean, reports.broken, "--repository", root, "--fail-on-new"]);
    assert.equal(failing.status, 1, `${failing.stdout}${failing.stderr}`);
    assert.match(failing.stderr, /1 new finding/u);
    // Without the ancestry read the same finding is not "new", so the flag has nothing to fail on.
    assert.equal(compare([reports.clean, reports.broken, "--fail-on-new"]).status, 0);
    // A repair is never a new finding.
    assert.equal(compare([reports.broken, reports.repaired, "--repository", root, "--fail-on-new"]).status, 0);
  });
});
