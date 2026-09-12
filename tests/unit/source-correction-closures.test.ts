/** Consumer-visible correction controls; all content, paths and programs are synthetic. */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, it } from "node:test";
import { checkProducedDocuments } from "../../src/index.ts";

const program = String.raw`
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const arg=n=>process.argv[process.argv.indexOf(n)+1],kind=arg('--case'),root=arg('--root'),runRoot=arg('--run-root');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex'),code=fs.readFileSync(__filename);
if(kind==='stderr'){process.stderr.write("ENOENT open '"+path.join(root,'private marker 💡.json')+"'\n"+'x'.repeat(20000));process.exit(7);}
const sources=[['author.html','authoring','<p>Authoring "quotation".</p>'],['dependency.html','dependency','<p>Dependency "quotation".</p>'],['asset.html','asset','<p>Asset "quotation".</p>'],['build/styles.css','dependency','p{color:rgb(1,2,3)}']];
const rows=sources.map(([p,role,text])=>{const b=Buffer.from(text);fs.writeFileSync(path.join(runRoot,'blobs',hash(b)),b);return {path:p,role,sha256:hash(b),bytes:b.length};});
const pieces=[],parts=[];let cursor=0;
const add=(text,inputPath)=>{const b=Buffer.from(text);parts.push(b);pieces.push(inputPath?{kind:'copy',inputPath,inputStart:0,inputEnd:b.length,outputStart:cursor,outputEnd:cursor+b.length}:{kind:'generated',outputStart:cursor,outputEnd:cursor+b.length});cursor+=b.length;};
add('<!doctype html><html><head><link rel="stylesheet" href="styles.css"></head><body>');
for(const [p,,text] of sources.slice(0,3))add(text,p);
add('<p>Generated "quotation".</p>');
if(kind==='absent'||kind==='favicon'||kind==='network')add('<script>const s=document.createElement("link");s.rel="stylesheet";s.href='+JSON.stringify(kind==='favicon'?'/favicon.ico':kind==='network'?'https://blocked.invalid/needed.css':'absent.css')+';document.head.append(s);</script>');
add('</body></html>');const html=Buffer.concat(parts);fs.writeFileSync(path.join(runRoot,'blobs',hash(html)),html);
const codeRow={id:'@producer/closure',sha256:hash(code),bytes:code.length};
fs.writeSync(3,JSON.stringify({protocol:'studio-producer-record-v1',runId:arg('--run-id'),producerId:'closure',complete:true,expected:rows,reads:rows,outputs:[{path:'build/print.html',sha256:hash(html),bytes:html.length,pieces}],options:{case:kind},code:{sha256:hash(JSON.stringify([codeRow])),files:[codeRow],dependencies:[]}}));
`;

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "breaklint-correction-")));
  const code = join(root, "producer.cjs"); writeFileSync(code, program);
  const input = (kind: string) => ({
    producer: {
      trust: "host-controlled-producer" as const, id: "closure", executable: process.execPath,
      argv: [code, "--case", kind, "--root", root], codeFiles: [{ id: "@producer/closure", path: code }],
      producerOptions: { case: kind },
    },
    options: { outputPaths: ["build/print.html"], config: {}, only: ["type/straight-quotes"],
      evidenceBinding: false, runRoot: join(root, `run-${kind}`), outDir: join(root, `report-${kind}`) },
  });
  return { root, input, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe("source correction closure controls", { concurrency: false }, () => {
  it("proves only the actual authoring leaf in a mixed copy/generated document", async () => {
    const f = fixture();
    try {
      const result = await checkProducedDocuments(f.input("mixed"));
      assert.equal(result.ok, true, result.ok ? "" : result.detail);
      if (!result.ok) return;
      const document = result.report.documents[0]!;
      assert.equal(result.report.exitCode, 0);
      assert.equal(document.findings.length, 4);
      assert.equal(document.sourceBinding.provenance.sourceRole, undefined, "no document-wide exact original claim");
      const originals = document.findings.map(finding => finding.originalSource);
      assert.equal(originals.filter(original => original.status === "verified").length, 1);
      const verified = originals.find(original => original.status === "verified")!;
      assert.equal(verified.location?.file, "author.html");
      assert.equal(verified.role, "exact-original-range");
      assert.equal(verified.integrity?.role, "authoring");
      for (const original of originals.filter(original => original !== verified)) {
        assert.equal(original.status, "unavailable"); assert.equal(original.role, "unknown");
        assert.equal(original.location, null); assert.equal(original.integrity, null);
      }
      const css = document.inputIdentity?.resources.find(resource => resource.resolvedUri === "artifact:/build/styles.css");
      assert.equal(css?.status, 200); assert.equal(css?.outcome, "loaded"); assert.match(css?.sha256 ?? "", /^[a-f0-9]{64}$/u);
      // Ambient icon failure is permitted; the same name used as a stylesheet is tested below.
      assert.equal(document.verdict, "clean");
    } finally { f.cleanup(); }
  });

  for (const kind of ["absent", "favicon", "network"]) {
    it(`retains typed failed request identity without ordinary findings: ${kind}`, async () => {
      const f = fixture();
      try {
        const result = await checkProducedDocuments(f.input(kind));
        assert.equal(result.ok, true, result.ok ? "" : result.detail);
        if (!result.ok) return;
        const document = result.report.documents[0]!;
        assert.equal(result.report.exitCode, 3); assert.equal(document.verdict, "infrastructure");
        assert.deepEqual(document.findings, []); assert.deepEqual(document.evaluations, []); assert.deepEqual(document.coverage, {});
        assert.ok(document.inputIdentity);
        const uri = kind === "favicon" ? "artifact:/favicon.ico" : kind === "network" ? "https://blocked.invalid/needed.css" : "artifact:/build/absent.css";
        const resource = document.resources?.find(resource => resource.resolvedUri === uri);
        assert.ok(resource, "full ResourceRecord must survive snapshot withdrawal");
        assert.equal(resource.outcome, "blocked"); assert.equal(resource.status, kind === "network" ? null : 403);
        assert.equal(resource.requestedUri, uri); assert.equal(resource.sha256, null);
        assert.ok(document.inputIdentity.resources.some(resource => resource.resolvedUri === uri && resource.outcome === "blocked"));
        assert.ok(document.infrastructure.some(event => event.kind === "source-acquisition-failed"));
      } finally { f.cleanup(); }
    });
  }

  it("publishes bounded host-authored errors for child, start, code and configuration failures", async () => {
    const f = fixture();
    try {
      const stderr = await checkProducedDocuments(f.input("stderr"));
      assert.equal(stderr.ok, false);
      if (!stderr.ok) { assert.match(stderr.detail, /producer exited 7/u); assert.ok(stderr.detail.length < 256); assert.doesNotMatch(stderr.detail, /private marker|ENOENT open|💡/u); }
      for (const kind of ["start", "code", "config"]) {
        const input = f.input(kind);
        if (kind === "start") input.producer.executable = join(f.root, 'missing "program" 💡');
        if (kind === "code") input.producer.codeFiles[0]!.path = join(f.root, 'missing "code" 💡');
        if (kind === "config") input.options.config = { unknown: f.root } as never;
        const result = await checkProducedDocuments(input);
        assert.equal(result.ok, false);
        if (!result.ok) { assert.ok(result.detail.length < 256); assert.equal(result.detail.includes(f.root), false); assert.doesNotMatch(result.detail, /missing|💡/u); }
      }
    } finally { f.cleanup(); }
  });

  it("rejects malformed producer calls and configuration before the producer can start", async () => {
    const f = fixture();
    try {
      const withSentinel = () => {
        const input = f.input("mixed"); const sentinel = join(f.root, `started-${Math.random().toString(16).slice(2)}`);
        input.producer.executable = process.execPath;
        input.producer.argv = ["-e", "require('node:fs').writeFileSync(process.argv[1], 'started')", sentinel];
        return { input, sentinel };
      };
      const malformed = [
        (input: ReturnType<typeof f.input>) => ({ ...input, ignored: true }),
        (input: ReturnType<typeof f.input>) => ({ ...input, options: { ...input.options, ignored: true } }),
        (input: ReturnType<typeof f.input>) => ({ ...input, options: { ...input.options, network: { mode: "unknown", allowed: [] } } }),
        (input: ReturnType<typeof f.input>) => ({ ...input, options: { ...input.options, evidenceBinding: "false" } }),
        (input: ReturnType<typeof f.input>) => ({ ...input, options: { ...input.options, revision: { repositoryRoot: f.root, ignored: true } } }),
      ];
      for (const mutate of malformed) {
        const { input, sentinel } = withSentinel();
        await assert.rejects(() => checkProducedDocuments(mutate(input) as never), TypeError);
        assert.equal(existsSync(sentinel), false, "malformed call must not launch the custom producer");
      }
      const { input, sentinel } = withSentinel();
      input.options.config = { ignored: true } as never;
      const invalidConfig = await checkProducedDocuments(input);
      assert.equal(invalidConfig.ok, false, "configuration remains a typed public failure");
      assert.equal(existsSync(sentinel), false, "invalid configuration must resolve before producer launch");
    } finally { f.cleanup(); }
  });
});
