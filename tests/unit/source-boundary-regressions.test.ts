/** Independent source-boundary regressions. Every input is synthetic and host-selected. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { acquireProducedDocuments, producedBytesForInternalRender } from "../../src/source/producer.ts";
import { checkProducedDocuments } from "../../src/index.ts";
import { discoverLocalAssets } from "../../src/acquire/render-run.ts";

const syntheticProducer = String.raw`
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const arg=n=>process.argv[process.argv.indexOf(n)+1],kind=arg('--case'),root=arg('--root'),runRoot=arg('--run-root');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const source=fs.readFileSync(path.join(root,'source.html')),code=fs.readFileSync(__filename);
const codeRow={id:'@producer/regression',sha256:hash(code),bytes:code.length};
const row={path:'source.html',sha256:hash(source),bytes:source.length,role:'authoring'};
const blob=b=>fs.writeFileSync(path.join(runRoot,'blobs',hash(b)),b);blob(source);
const copied=(target,input)=>({path:target,sha256:hash(source),bytes:source.length,pieces:[{kind:'copy',inputPath:input,inputStart:0,inputEnd:source.length,outputStart:0,outputEnd:source.length}]});
const record={protocol:'studio-producer-record-v1',runId:arg('--run-id'),producerId:'regression',complete:true,expected:[{...row}],reads:[{...row}],outputs:[copied('build/print.html','source.html')],options:{case:kind},code:{sha256:hash(JSON.stringify([codeRow])),files:[codeRow],dependencies:[]}};
if(kind==='chain')record.outputs=[copied('build/intermediate.html','source.html'),copied('build/print.html','build/intermediate.html')];
if(kind==='cycle')record.outputs=[copied('build/print.html','build/other.html'),copied('build/other.html','build/print.html')];
if(kind==='pieces-100000'||kind==='pieces-100001'){
 const count=Number(kind.slice(7)),bytes=Buffer.alloc(count,120);blob(bytes);
 record.outputs=[{path:'build/print.html',sha256:hash(bytes),bytes:count,pieces:Array.from({length:count},(_,i)=>({kind:'generated',outputStart:i,outputEnd:i+1}))}];
}
if(kind==='stderr-quoted') {process.stderr.write("ENOENT: open '"+path.join(root,'private marker.json')+"'");process.exit(7);}
if(kind==='dynamic-css'||kind==='dynamic-favicon-css'){
 const body=Buffer.from('<!doctype html><html><body><p>Visible paragraph.</p><script>const s=document.createElement("link");s.rel="stylesheet";s.href="absent.css";document.head.append(s);</script></body></html>'.replace('absent.css',kind==='dynamic-favicon-css'?'/favicon.ico':'absent.css'));blob(body);
 record.outputs=[{path:'build/print.html',sha256:hash(body),bytes:body.length,pieces:[{kind:'generated',outputStart:0,outputEnd:body.length}]}];
}
const emit=()=>fs.writeSync(3,JSON.stringify(record));
if(kind==='held-fd'||kind==='descendant'){
 // TWO facts about the descendant, written by two different processes on purpose.
 // 'nested.pid' comes from the PARENT, synchronously at spawn: the test then always knows which
 // pid to ask about, even when the child never got to run. 'nested.armed' comes from the CHILD,
 // after it has installed its SIGTERM handler: without it, a child terminated before that line
 // looks exactly like a SIGTERM-resistant child that was correctly escalated to SIGKILL, and the
 // escalation would stop being tested. The producer waits for the armed marker before emitting,
 // so the host cannot start cleaning up against a descendant that is not yet a descendant.
 const nestedScript="const fs=require('node:fs');process.on('SIGTERM',()=>{});fs.writeFileSync(process.argv[1],'armed');setInterval(()=>{},1000);";
 const nested=cp.spawn(process.execPath,['-e',nestedScript,path.join(root,'nested.armed')],{stdio:kind==='held-fd'?['ignore','ignore','ignore',3]:'ignore'});nested.unref();
 fs.writeFileSync(path.join(root,'nested.pid'),String(nested.pid));
 // 'descendant' returns a complete record and exits, so the host must clean the survivor on the
 // SUCCESS path. 'held-fd' stays alive holding FD3, so the host can only end on its timeout —
 // which is what that case is named for.
 const ready=()=>{
  if(!fs.existsSync(path.join(root,'nested.armed'))){setTimeout(ready,5);return;}
  emit();
  if(kind==='descendant')process.exit(0);
  setInterval(()=>{},1000);
 };
 ready();
}else emit();
`;

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "breaklint-source-regression-")));
  const program = join(root, "producer.cjs");
  writeFileSync(program, syntheticProducer);
  writeFileSync(join(root, "source.html"), '<!doctype html><html><body><p>Visible source paragraph with "quoted text".</p></body></html>');
  const producer = (kind: string) => ({
    trust: "host-controlled-producer" as const, id: "regression", executable: process.execPath,
    argv: [program, "--case", kind, "--root", root],
    codeFiles: [{ id: "@producer/regression", path: program }], producerOptions: { case: kind },
  });
  return { root, program, producer, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
function alive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch { return false; } }
/**
 * Reads the descendant pid the producer registered, and says so when it did not.
 * A bare readFileSync answered a missing file with ENOENT, which reads in the TAP output as a
 * failure of the cleanup under test. The two states are different findings: "the run never
 * created the descendant" means the case did not run, "the descendant is alive" means the
 * guarantee broke.
 */
function registeredDescendant(root: string): number {
  const file = join(root, "nested.pid");
  assert.ok(existsSync(file), "the producer never registered an owned descendant — this run did not exercise group cleanup");
  // The armed marker is the positive control: it is written by the descendant itself, after its
  // SIGTERM handler is installed. Without it, "the pid is dead" proves nothing about escalation —
  // a child killed before it ever ran is dead too.
  assert.ok(
    existsSync(join(root, "nested.armed")),
    "the owned descendant never armed its SIGTERM handler — a dead pid here would not show SIGKILL escalation",
  );
  const pid = Number(readFileSync(file, "utf8"));
  assert.ok(Number.isSafeInteger(pid) && pid > 1, `registered descendant pid is not a pid: ${pid}`);
  return pid;
}
function killFixtureDescendant(root: string): void {
  try { const pid = Number(readFileSync(join(root, "nested.pid"), "utf8")); if (alive(pid)) process.kill(pid, "SIGKILL"); } catch {}
}

// Sequential: module-level filesystem instrumentation below must not overlap acquisition.
describe("independent source boundary regressions", { concurrency: false }, () => {
  it("keeps the original asset root across nested symlinks and admits an ordinary nested asset", () => {
    const f = fixture();
    try {
      const docRoot = join(f.root, "document"), outside = join(f.root, "outside");
      mkdirSync(join(docRoot, "local"), { recursive: true }); mkdirSync(join(outside, "sub"), { recursive: true });
      writeFileSync(join(docRoot, "local", "theme.css"), "p{color:navy}");
      writeFileSync(join(outside, "sub", "theme.css"), "p{color:rgb(11,22,33)}");
      symlinkSync(outside, join(docRoot, "linked"));
      const document = join(docRoot, "index.html");writeFileSync(document, "<p>Fixture</p>");
      const normal = discoverLocalAssets('<link rel="stylesheet" href="local/theme.css">', document);
      assert.equal(normal.get("/local/theme.css")?.bytes.toString(), "p{color:navy}");
      assert.throws(() => discoverLocalAssets('<link rel="stylesheet" href="linked/sub/theme.css">', document), /unsafe|symlink/u);
    } finally { f.cleanup(); }
  });

  it("accepts a genuine copy chain and rejects a two-output cycle", async () => {
    const f = fixture();
    try {
      const good = await acquireProducedDocuments({ producer: f.producer("chain"), options: { runRoot: join(f.root, "good") } });
      assert.equal(good.ok, true, good.ok ? "" : good.detail);
      if (good.ok) assert.deepEqual(producedBytesForInternalRender(good.capability).sourceOrigin("build/print.html", 0, 10), { status: "exact-original-range", path: "source.html", start: 0, end: 10, role: "authoring" });
      const bad = await acquireProducedDocuments({ producer: f.producer("cycle"), options: { runRoot: join(f.root, "bad") } });
      assert.equal(bad.ok, false);if (!bad.ok) assert.match(bad.detail, /cycle/u);
    } finally { f.cleanup(); }
  });

  it("accepts 100000 meaningful pieces and rejects 100001 under the FD3 byte cap", async () => {
    const f = fixture();
    try {
      const good = await acquireProducedDocuments({ producer: f.producer("pieces-100000"), options: { runRoot: join(f.root, "good") } });
      assert.equal(good.ok, true, good.ok ? "" : good.detail);
      if (good.ok) assert.equal(producedBytesForInternalRender(good.capability).outputs.get("build/print.html")?.length, 100000);
      const bad = await acquireProducedDocuments({ producer: f.producer("pieces-100001"), options: { runRoot: join(f.root, "bad") } });
      assert.equal(bad.ok, false);if (!bad.ok) assert.match(bad.detail, /piece limit/u);
    } finally { f.cleanup(); }
  });

  it("cleans an owned descendant before a successful acquisition returns", async () => {
    const f = fixture();
    try {
      // 30 s, not 2 s: the budget is not the subject here. What is measured is that a SUCCESSFUL
      // acquisition still closes the process group it owns. A budget tight enough for machine load
      // to exhaust it turns this into a test of the host's timeout path instead — which is the
      // next test — and reports a false defect in the one it claims to check.
      const result = await acquireProducedDocuments({ producer: f.producer("descendant"), options: { runRoot: join(f.root, "run"), timeoutMs: 30_000 } });
      assert.equal(result.ok, true, result.ok ? "" : result.detail);
      const pid = registeredDescendant(f.root);
      assert.equal(alive(pid), false, "owned descendant survived accepted producer result");
    } finally { killFixtureDescendant(f.root); f.cleanup(); }
  });

  it("completes timeout cleanup even when the API consumer immediately exits", () => {
    const f = fixture();
    try {
      const moduleUrl = new URL("../../src/source/producer.ts", import.meta.url).href;
      const consumer = `import {acquireProducedDocuments} from ${JSON.stringify(moduleUrl)}; const r=await acquireProducedDocuments({producer:${JSON.stringify(f.producer("held-fd"))},options:{runRoot:${JSON.stringify(join(f.root, "run"))},timeoutMs:10_000}});process.stdout.write(JSON.stringify(r));process.exit(r.ok?9:0);`;
      // The outer budget bounds a node start-up plus type stripping of the producer module, not
      // any behaviour of the product. At 5 s it was smaller than the load-time cost of what it
      // wraps and killed the child with status null; the assertion then read as a product failure.
      const child = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", consumer], { encoding: "utf8", timeout: 60_000 });
      assert.equal(child.status, 0, child.stderr);assert.equal(JSON.parse(child.stdout).code, "source/producer-incomplete");
      const pid = registeredDescendant(f.root);
      assert.equal(alive(pid), false, "host exited after failure while owned FD3 descendant remained alive");
    } finally { killFixtureDescendant(f.root); f.cleanup(); }
  });

  it("redacts quoted producer failure paths, including spaces", async () => {
    const f = fixture();
    try {
      const result = await checkProducedDocuments({ producer: f.producer("stderr-quoted"), options: { outputPaths: ["build/print.html"], outDir: join(f.root, "report"), runRoot: join(f.root, "run"), config: {}, evidenceBinding: false } });
      assert.equal(result.ok, false);
      if (!result.ok) { assert.doesNotMatch(result.detail, new RegExp(f.root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));assert.equal(result.detail.includes("private marker.json"), false); }
    } finally { f.cleanup(); }
  });

  it("retains one authoritative blob capture even after its backing pathname changes", () => {
    const f = fixture();
    try {
      const moduleUrl = new URL("../../src/source/producer.ts", import.meta.url).href;
      const runRoot = join(f.root, "run");
      const consumer = `import fs from 'node:fs';import {syncBuiltinESMExports} from 'node:module';import {createHash} from 'node:crypto';const originalOpen=fs.openSync,originalClose=fs.closeSync;const captured=new Map();let reads=0;fs.openSync=function(p,...args){const fd=originalOpen(p,...args);if(String(p).startsWith(${JSON.stringify(join(runRoot, "blobs"))}+'/')){reads++;captured.set(fd,String(p));}return fd;};fs.closeSync=function(fd){const p=captured.get(fd);originalClose(fd);if(p){captured.delete(fd);fs.writeFileSync(p,'replacement after authoritative capture');}};syncBuiltinESMExports();const {acquireProducedDocuments,producedBytesForInternalRender}=await import(${JSON.stringify(moduleUrl)});const r=await acquireProducedDocuments({producer:${JSON.stringify(f.producer("valid"))},options:{runRoot:${JSON.stringify(runRoot)}}});if(!r.ok)throw new Error(r.detail);const s=producedBytesForInternalRender(r.capability),b=s.outputs.get('build/print.html');process.stdout.write(JSON.stringify({reads,sha:createHash('sha256').update(b).digest('hex'),body:b.toString()}));`;
      // Same reasoning as above: a harness budget, not a product bound. See the note there.
      const child = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", consumer], { encoding: "utf8", timeout: 60_000 });
      assert.equal(child.status, 0, child.stderr);const observed = JSON.parse(child.stdout);
      const source = readFileSync(join(f.root, "source.html"));
      assert.equal(observed.reads, 1);assert.equal(observed.sha, createHash("sha256").update(source).digest("hex"));assert.equal(observed.body, source.toString());
    } finally { f.cleanup(); }
  });

  for (const kind of ["valid", "dynamic-css", "dynamic-favicon-css"]) {
    it(`reconciles browser resource outcomes and authoring status: ${kind}`, async () => {
      const f = fixture();
      try {
        const result = await checkProducedDocuments({ producer: f.producer(kind), options: { outputPaths: ["build/print.html"], outDir: join(f.root, "report"), runRoot: join(f.root, "run"), config: {}, evidenceBinding: false, only: ["type/straight-quotes"] } });
        assert.equal(result.ok, true, result.ok ? "" : result.detail);
        if (result.ok) {
          const doc = result.report.documents[0]!;
          if (kind === "valid") {
            // Name what happened instead. A bare "clean !== infrastructure" says nothing about
            // which event intervened, and this case has failed once under heavy load with no way
            // to tell a real regression from a renderer hiccup afterwards.
            const intervened = doc.infrastructure.map((event) => `${event.kind}: ${event.detail}`).join(" | ");
            assert.equal(doc.verdict, "clean", `verdict ${doc.verdict}; infrastructure: ${intervened || "none"}`);
            assert.equal(result.report.exitCode, 0, `exit ${result.report.exitCode}; infrastructure: ${intervened || "none"}`);
            assert.equal(doc.findings[0]?.originalSource.status, "verified");
            assert.equal(doc.findings[0]?.originalSource.integrity?.role, "authoring");
          } else {
            assert.notEqual(doc.verdict, "clean", `${kind} must not be clean after its required stylesheet was blocked`);
            assert.notEqual(result.report.exitCode, 0);
            assert.ok(doc.infrastructure.some(event => event.kind === "source-acquisition-failed" && event.detail.includes(kind === "dynamic-favicon-css" ? "favicon.ico" : "absent.css")));
          }
        }
      } finally { f.cleanup(); }
    });
    }
  });

  it("distinguishes an omitted deployment-root stylesheet from a missing local stylesheet", () => {
    const f = fixture();
    try {
      const docRoot = join(f.root, "document");
      mkdirSync(docRoot, { recursive: true });
      const document = join(docRoot, "index.html");
      writeFileSync(document, "<p>Fixture</p>");

      // A root URL is owned by the deployment origin. The frozen public corpus deliberately has
      // this shape: its standalone HTML is admitted while the site's deployment asset pack is not.
      // Discovery must leave the route absent so loopback can record its 403; it must not pretend
      // that a sibling filesystem leaf was declared by the source artifact.
      assert.doesNotThrow(() => discoverLocalAssets('<link rel="stylesheet" href="/styles.css"><script src="/assets/nav.js"></script>', document));

      // A document-relative stylesheet is a source-tree input and remains fail-closed when absent.
      assert.throws(() => discoverLocalAssets('<link rel="stylesheet" href="styles.css">', document), /required local resource|ENOENT/u);

      // Once a root stylesheet is actually present below the selected source root it is captured,
      // with the current immutable bytes rather than being treated as deployment-external.
      writeFileSync(join(docRoot, "styles.css"), "p{color:navy}");
      assert.equal(discoverLocalAssets('<link rel="stylesheet" href="/styles.css">', document).get("/styles.css")?.bytes.toString(), "p{color:navy}");
      writeFileSync(join(docRoot, "styles.css"), "p{color:maroon}");
      assert.equal(discoverLocalAssets('<link rel="stylesheet" href="/styles.css">', document).get("/styles.css")?.bytes.toString(), "p{color:maroon}");
    } finally { f.cleanup(); }
  });
