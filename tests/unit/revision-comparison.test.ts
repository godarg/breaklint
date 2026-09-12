import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { it } from "node:test";
import { checkProducedDocuments, compareReports } from "../../src/index.ts";
import { identitiesForProducedOutput } from "../../src/source/identity.ts";
import { acquireProducedDocuments } from "../../src/source/producer.ts";
import type { Report } from "../../src/core/types.ts";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const fixture = `const fs=require('node:fs'),crypto=require('node:crypto');
const args=process.argv, root=args[args.indexOf('--run-root')+1], runId=args[args.indexOf('--run-id')+1];
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const body=fs.readFileSync(args[2]),font=fs.readFileSync(args[3]),code=fs.readFileSync(__filename);
for(const bytes of [body,font])fs.writeFileSync(root+'/blobs/'+sha(bytes),bytes);
const files=[{id:'@fixture/producer',sha256:sha(code),bytes:code.length}];
const read={path:'source.html',sha256:sha(body),bytes:body.length,role:'authoring'};
const fontRead={path:'fixture.ttf',sha256:sha(font),bytes:font.length,role:'asset'};
fs.writeSync(3,JSON.stringify({protocol:'studio-producer-record-v1',runId,producerId:'repair-fixture',complete:true,
expected:[read,fontRead],reads:[read,fontRead],outputs:[{path:'print.html',sha256:sha(body),bytes:body.length,pieces:[{kind:'copy',inputPath:'source.html',inputStart:0,inputEnd:body.length,outputStart:0,outputEnd:body.length}]}],options:{},code:{sha256:sha(Buffer.from(JSON.stringify(files))),files,dependencies:[]}}));`;
const fontBytes = readFileSync(new URL("../../node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf", import.meta.url));
const body = (height: number, anchor = 'id="repair-target"', text = "Label") => `<!doctype html><html><head><link rel="icon" href="data:,blank"><style>@font-face{font-family:BoundFixture;src:url(data:font/ttf;base64,${fontBytes.toString("base64")})}*{font-family:BoundFixture}@page{size:A4;margin:10mm}body{margin:0}</style></head><body><p>Geometry reference.</p><svg width="200" height="100" style="overflow:hidden"><text ${anchor} x="${height > 1000 ? -20 : 20}" y="50" font-size="20">${text}</text></svg></body></html>`;

it("logical identity ignores only the closed layout attributes, retains text and rejects duplicate anchors", () => {
  const identity = (text: string) => identitiesForProducedOutput({ outputPath: "print.html", output: Buffer.from(text), inputs: new Map([["source.html", Buffer.from(text)]]), inputRoles: new Map([["source.html", "authoring"]]), sourceOrigin: (_path, start, end) => ({ status: "exact-original-range", path: "source.html", start, end }) });
  const a = identity('<svg><text id="label" x="-10">A</text></svg>').bySid.bt000!;
  const b = identity('<svg><text id="label" x="20" style="font-size:10px">A</text></svg>').bySid.bt000!;
  assert.equal(a.status, "unique"); assert.equal(a.value, b.value);
  assert.notEqual(a.value, identity('<svg><text id="label" x="20">B</text></svg>').bySid.bt000!.value);
  assert.equal(identity('<p id="same">A</p><p id="same">B</p>').bySid.s0000!.status, "ambiguous");
  assert.equal(identity('<p id="same" data-source-id="first">A</p><p id="same">B</p>').bySid.s0000!.status, "ambiguous");
  assert.equal(identity('<!-- new leading line -->\n<svg><text id="label" x="20">A</text></svg>').bySid.bt000!.value, a.value);
  assert.equal(identity('<p>A</p>').bySid.s0000!.status, "unavailable");
});

it("the real host producer + renderer + Git revisions confirm a preserved target and fail closed on missing/hidden/reduced measurements", async () => {
  const root = mkdtempSync(join(tmpdir(), "breaklint-repair-git-"));
  try {
    mkdirSync(join(root, "source")); const source = join(root, "source", "source.html"); const program = join(root, "producer.cjs");
    const font = join(root, "source", "fixture.ttf"); writeFileSync(font, fontBytes);
    writeFileSync(program, fixture); writeFileSync(source, body(1300));
    const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" });
    git("init", "-q"); git("add", "source", "producer.cjs"); git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "baseline");
    const foreignSource = join(root, "foreign-source.html"); writeFileSync(foreignSource, body(100));
    const mismatched = await acquireProducedDocuments({ producer: { trust: "host-controlled-producer", id: "repair-fixture", executable: process.execPath, argv: [program, foreignSource, font], codeFiles: [{ id: "@fixture/producer", path: program }], producerOptions: {} }, options: { revision: { repositoryRoot: root, sourcePrefix: "source" } } });
    assert.equal(mismatched.ok, false, "a producer source copied from a different host path must not acquire the local revision");
    let run = 0;
    const check = async (): Promise<Report> => {
      const result = await checkProducedDocuments({ producer: { trust: "host-controlled-producer", id: "repair-fixture", executable: process.execPath, argv: [program, source, font], codeFiles: [{ id: "@fixture/producer", path: program }], producerOptions: {} },
        options: { outputPaths: ["print.html"], only: ["svg/text-overflows-viewport"], outDir: join(root, `report-${run++}`), evidenceBinding: false, revision: { repositoryRoot: root, sourcePrefix: "source" } } });
      if (!result.ok) throw new Error(result.detail); return result.report;
    };
    const before = await check(); assert.equal(before.findings.length, 1, JSON.stringify({ verdict: before.runVerdict, infra: before.documents[0]!.infrastructure, evaluations: before.evaluations })); assert.equal(before.findings[0]!.stableIdentity.status, "unique");
    const incompatibleObserved = structuredClone(before); incompatibleObserved.config.fingerprint = hash("foreign config");
    assert.equal((await compareReports(before, incompatibleObserved)).results[0]!.status, "not-sufficiently-measured", "two observations alone do not establish compatible persistence");
    const incompatibleRows = (await compareReports(before, incompatibleObserved)).results;
    assert.equal(incompatibleRows.length, 1, "an observed incompatible finding must not also become new");
    const duplicates = structuredClone(before);
    duplicates.documents[0]!.findings.push({ ...structuredClone(duplicates.documents[0]!.findings[0]!), runFindingId: "duplicate" });
    assert.equal((await compareReports(before, duplicates)).results[0]!.status, "unmatchable");
    const reducedScope = structuredClone(before); reducedScope.documents = [];
    assert.equal((await compareReports(before, reducedScope)).results[0]!.status, "not-sufficiently-measured");
    await assert.rejects(compareReports({ schemaVersion: 1, profileKind: "screen" } as unknown as Report, before), /requires document Report schema 4/u);
    writeFileSync(source, body(100)); const after = await check();
    assert.equal(after.findings.length, 0); assert.ok(after.evaluations.some(e => e.stableIdentity?.status === "unique" && e.predicate.violated === false));
    const repaired = await compareReports(before, after); assert.equal(repaired.results[0]!.status, "resolved", JSON.stringify({ repaired, fontBefore: before.documents[0]!.fontIdentity, fontAfter: after.documents[0]!.fontIdentity, resources: after.documents[0]!.inputIdentity, infra: after.documents[0]!.infrastructure, notMeasured: after.documents[0]!.notMeasured, coverage: after.documents[0]!.coverage }));
    const nowNew = await compareReports(after, before);
    assert.equal(nowNew.results.length, 1); assert.equal(nowNew.results[0]!.status, "new");
    const afterOnlyMismatch = structuredClone(before); afterOnlyMismatch.config.fingerprint = hash("incompatible-new");
    assert.equal((await compareReports(after, afterOnlyMismatch)).results[0]!.status, "not-sufficiently-measured");
    const missing = structuredClone(after); missing.documents[0]!.evaluations = [];
    assert.equal((await compareReports(before, missing)).results[0]!.status, "unmatchable");
    for (const mutation of [
      (r: Report) => { r.documents[0]!.evaluations.forEach(e => { e.status = "excluded"; e.reason = "rule/target-not-visible"; e.predicate.violated = null; }); },
      (r: Report) => { r.documents[0]!.targetInventory!.complete = false; r.documents[0]!.targetInventory!.omittedCount = 1; },
      (r: Report) => { r.config.activeRules = []; },
      (r: Report) => { r.documents[0]!.evaluations.forEach(e => { e.status = "not-measured"; e.predicate.violated = null; }); },
      (r: Report) => { delete r.documents[0]!.revision; },
      (r: Report) => { delete r.documents[0]!.fontIdentity; },
      (r: Report) => { r.documents[0]!.infrastructure = []; },
      (r: Report) => { delete r.documents[0]!.evidenceCoverage; },
    ]) {
      const copy = structuredClone(after); mutation(copy);
      assert.equal((await compareReports(before, copy)).results[0]!.status, "not-sufficiently-measured");
    }
    // A committed descendant needs an actual ancestry readback; matching opaque labels suffice only on the same measured base.
    git("add", "source"); git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "geometry repair");
    const descendant = await check();
    assert.equal((await compareReports(before, descendant)).results[0]!.status, "not-sufficiently-measured");
    assert.equal((await compareReports(before, descendant, { revision: { repositoryRoot: root } })).results[0]!.status, "resolved");
    writeFileSync(source, body(100, 'id="repair-target"', "replacement authored text")); const replaced = await check();
    assert.equal((await compareReports(before, replaced, { revision: { repositoryRoot: root } })).results[0]!.status, "unmatchable");
    const foreign = structuredClone(after); foreign.documents[0]!.comparisonScope!.projectId = hash("foreign");
    assert.equal((await compareReports(before, foreign)).results[0]!.status, "not-sufficiently-measured");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
