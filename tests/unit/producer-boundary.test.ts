import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  acquireProducedDocuments, cleanupOwnedGroup, OWNED_GROUP_BUDGETS, ownedGroupProbeState, resolveProducedSourceOrigin,
  type OwnedGroupOperations, type ProducerRecord,
} from "../../src/source/producer.ts";
import { checkProducedDocuments } from "../../src/index.ts";
import { CapturedResourceClosureError, capturedResourceClosure } from "../../src/acquire/render-run.ts";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");

describe("host-controlled producer FD3 boundary", () => {
  it("does not serve authoring leaves and fails a missing captured stylesheet before rendering", () => {
    assert.throws(
      () => capturedResourceClosure('<link rel="stylesheet" href="styles.css">', "build/print.html", []),
      (error: unknown) => error instanceof CapturedResourceClosureError && /build\/styles\.css/u.test(error.message),
    );
    const closure = capturedResourceClosure(
      '<a href="next.html">next</a><link rel="stylesheet" href="styles.css">',
      "build/print.html",
      [{ logicalPath: "build/styles.css", bytes: Buffer.from("p{}"), role: "dependency" }],
    );
    assert.deepEqual([...closure.keys()], ["/build/styles.css"]);
    const nested = capturedResourceClosure(
      '<link rel="stylesheet" href="styles.css">', "build/print.html",
      [
        { logicalPath: "build/styles.css", bytes: Buffer.from('@import/**/"theme.css"; p{}'), role: "dependency" },
        { logicalPath: "build/theme.css", bytes: Buffer.from("p{color:rgb(1,2,3)}"), role: "dependency" },
      ],
    );
    assert.deepEqual([...nested.keys()].sort(), ["/build/styles.css", "/build/theme.css"]);
  });

  it("accepts exactly one current complete record only after exit 0, EOF, code binding and copy bytes agree", async () => {
    const root = mkdtempSync(join(tmpdir(), "breaklint-producer-"));
    try {
      const code = "fixed producer module";
      const codeFile = join(root, "producer.py"); writeFileSync(codeFile, code);
      const digest = sha(code); const codeInventoryDigest = sha(`[{"id":"@producer/fixture","sha256":"${digest}","bytes":${Buffer.byteLength(code)}}]`); const body = "hello"; const bodyDigest = sha(body);
      const manifest = {
        schemaVersion: 1, projectId: "fixture-project", documentId: "fixture-document",
        producer: { id: "fixture", version: "declared-version", dependencies: [] },
        inputs: [{ path: "source.txt", sha256: bodyDigest, bytes: Buffer.byteLength(body) }],
        output: { path: "print.html", sha256: bodyDigest, bytes: Buffer.byteLength(body) },
        mappings: [{ outputStart: 0, outputEnd: Buffer.byteLength(body), sourcePath: "source.txt", sourceStart: 0, sourceEnd: Buffer.byteLength(body), sourceId: "fixture-source" }],
      };
      const script = `
        const fs=require('node:fs'); const crypto=require('node:crypto');
        const args=process.argv; const root=args[args.indexOf('--run-root')+1]; const runId=args[args.indexOf('--run-id')+1];
        const codeInventoryHash=args[1]; const codeFileHash=args[2]; const b=Buffer.from('${body}'); const h=crypto.createHash('sha256').update(b).digest('hex');
        fs.writeFileSync(root+'/blobs/'+h,b);
        const record={protocol:'studio-producer-record-v1',runId,producerId:'fixture',complete:true,
          expected:[{path:'source.txt',sha256:h,bytes:b.length,role:'authoring'}],reads:[{path:'source.txt',sha256:h,bytes:b.length,role:'authoring'}],
          outputs:[{path:'print.html',sha256:h,bytes:b.length,pieces:[{kind:'copy',inputPath:'source.txt',inputStart:0,inputEnd:b.length,outputStart:0,outputEnd:b.length}]}],options:{adapter:'fixture'},
          code:{sha256:codeInventoryHash,files:[{id:'@producer/fixture',sha256:codeFileHash,bytes:${Buffer.byteLength(code)}}],dependencies:[]}};
        const payload=JSON.stringify(record);
        fs.writeSync(3,args[3]==='nonfinite'?payload.replace('"options":{"adapter":"fixture"}','"options":{"n":1e400}'):payload);`;
      const result = await acquireProducedDocuments({ producer: {
        trust: "host-controlled-producer", id: "fixture", executable: process.execPath,
        argv: ["-e", script, codeInventoryDigest, digest], codeFiles: [{ id: "@producer/fixture", path: codeFile }], producerOptions: { adapter: "fixture" },
      }, manifest, options: { runRoot: join(root, "run") } });
      assert.equal(result.ok, true, result.ok ? "" : result.detail);
      if (result.ok) assert.ok(result.capability, `validated ${bodyDigest} output must yield opaque capability`);
      const nonFiniteOptions = await acquireProducedDocuments({ producer: {
        trust: "host-controlled-producer", id: "fixture", executable: process.execPath,
        argv: ["-e", script, codeInventoryDigest, digest, "nonfinite"], codeFiles: [{ id: "@producer/fixture", path: codeFile }], producerOptions: { n: null },
      }, options: { runRoot: join(root, "run-nonfinite") } });
      assert.equal(nonFiniteOptions.ok, false, "a non-finite FD3 options value must never canonicalize to a host null option");
      for (const dependency of [
        { id: "changed-id", sha256: "a".repeat(64), bytes: 1 },
        { id: "dependency", sha256: "b".repeat(64), bytes: 1 },
        { id: "dependency", sha256: "a".repeat(64), bytes: 2 },
      ]) {
        const rejected = await acquireProducedDocuments({ producer: {
          trust: "host-controlled-producer", id: "fixture", executable: process.execPath,
          argv: ["-e", script, codeInventoryDigest, digest], codeFiles: [{ id: "@producer/fixture", path: codeFile }], producerOptions: { adapter: "fixture" },
        }, manifest: { ...manifest, producer: { ...manifest.producer, dependencies: [dependency] } }, options: { runRoot: join(root, `run-${dependency.id}-${dependency.bytes}`) } });
        assert.equal(rejected.ok, false, `declared dependency ${dependency.id}/${dependency.sha256}/${dependency.bytes} must not match an empty receipt inventory`);
        if (!rejected.ok) assert.match(rejected.detail, /manifest.*record/u);
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("does not treat an imported manifest as a producer capability when the child record is forged", async () => {
    const root = mkdtempSync(join(tmpdir(), "breaklint-producer-"));
    try {
      const codeFile = join(root, "producer.py"); writeFileSync(codeFile, "producer");
      const script = `process.stdout.write('no FD3 record')`;
      const result = await acquireProducedDocuments({ producer: {
        trust: "host-controlled-producer", id: "fixture", executable: process.execPath,
        argv: ["-e", script], codeFiles: [{ id: "@producer/fixture", path: codeFile }], producerOptions: {},
      }, manifest: { forged: true }, options: { runRoot: join(root, "run"), timeoutMs: 1_000 } });
      assert.equal(result.ok, false);
      if (!result.ok) assert.match(result.detail, /JSON|record|EOF|incomplete/u);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("traces a produced range through actual pieces and does not turn generated text into an original", () => {
    const record: ProducerRecord = {
      protocol: "studio-producer-record-v1", runId: "run", producerId: "producer", complete: true,
      expected: [{ path: "source.txt", sha256: "a".repeat(64), bytes: 3, role: "authoring" }],
      reads: [{ path: "source.txt", sha256: "a".repeat(64), bytes: 3, role: "authoring" }],
      outputs: [{ path: "print.html", sha256: "b".repeat(64), bytes: 5, pieces: [
        { kind: "generated", outputStart: 0, outputEnd: 1 },
        { kind: "copy", inputPath: "source.txt", inputStart: 0, inputEnd: 3, outputStart: 1, outputEnd: 4 },
        { kind: "generated", outputStart: 4, outputEnd: 5 },
      ] }], options: {}, code: { sha256: "c".repeat(64), files: [], dependencies: [] },
    };
    assert.deepEqual(resolveProducedSourceOrigin(record, "print.html", 1, 4), {
      status: "exact-original-range", path: "source.txt", start: 0, end: 3, role: "authoring",
    });
    assert.deepEqual(resolveProducedSourceOrigin(record, "print.html", 0, 1), { status: "generated-or-unknown" });
  });

  it("runs the public API from a consumer cwd, with captured dependency routes and producer-bound source origins", async () => {
    const root = mkdtempSync(join(tmpdir(), "breaklint-produced-public-"));
    const consumer = mkdtempSync(join(tmpdir(), "breaklint-produced-consumer-"));
    const originalCwd = process.cwd();
    try {
      const producerCode = "fixed public producer module";
      const codeFile = join(root, "producer.js"); writeFileSync(codeFile, producerCode);
      const source = '<!doctype html><html><head><link rel="stylesheet" href="styles.css"></head><body><p>producer source</p></body></html>';
      const css = "p { color: rgb(1, 2, 3); }";
      const sourceDigest = sha(source); const cssDigest = sha(css); const codeFileDigest = sha(producerCode);
      const codeDigest = sha(`[{"id":"@producer/public-fixture","sha256":"${codeFileDigest}","bytes":${Buffer.byteLength(producerCode)}}]`);
      const script = `
        const fs=require('node:fs'); const crypto=require('node:crypto');
        const args=process.argv; const root=args[args.indexOf('--run-root')+1]; const runId=args[args.indexOf('--run-id')+1];
        const source=Buffer.from(${JSON.stringify(source)}); const css=Buffer.from(${JSON.stringify(css)});
        const hash=(b)=>crypto.createHash('sha256').update(b).digest('hex');
        for (const b of [source,css]) fs.writeFileSync(root+'/blobs/'+hash(b),b);
        const record={protocol:'studio-producer-record-v1',runId,producerId:'public-fixture',complete:true,
          expected:[
            {path:'source.html',sha256:hash(source),bytes:source.length,role:'authoring'},
            {path:'build/styles.css',sha256:hash(css),bytes:css.length,role:'dependency'}
          ],reads:[
            {path:'source.html',sha256:hash(source),bytes:source.length,role:'authoring'},
            {path:'build/styles.css',sha256:hash(css),bytes:css.length,role:'dependency'}
          ],outputs:[{path:'build/print.html',sha256:hash(source),bytes:source.length,pieces:[
            {kind:'copy',inputPath:'source.html',inputStart:0,inputEnd:source.length,outputStart:0,outputEnd:source.length}
          ]}],options:{adapter:'public-fixture'},
          code:{sha256:args[1],files:[{id:'@producer/public-fixture',sha256:args[2],bytes:${Buffer.byteLength(producerCode)}}],dependencies:[]}};
        fs.writeSync(3,JSON.stringify(record));`;
      process.chdir(consumer);
      const result = await checkProducedDocuments({
        producer: {
          trust: "host-controlled-producer", id: "public-fixture", executable: process.execPath,
          argv: ["-e", script, codeDigest, codeFileDigest],
          codeFiles: [{ id: "@producer/public-fixture", path: codeFile }], producerOptions: { adapter: "public-fixture" },
        },
        options: {
          outputPaths: ["build/print.html"], outDir: join(root, "report"), runRoot: join(root, "run"),
          config: {}, evidenceBinding: false,
        },
      });
      assert.equal(result.ok, true, result.ok ? "" : result.detail);
      if (result.ok) {
        assert.equal(result.report.source, "rendered");
        assert.equal(result.report.documents.length, 1);
        assert.equal(result.report.documents[0]!.path, "build/print.html");
        assert.doesNotMatch(result.report.documents[0]!.infrastructure.map((event) => event.detail).join("\n"), /paged\.js is not installed|no driver to speak/u);
        const stylesheet = result.report.documents[0]!.inputIdentity?.resources.find((resource) => resource.resolvedUri === "artifact:/build/styles.css");
        assert.deepEqual(stylesheet && { status: stylesheet.status, outcome: stylesheet.outcome }, { status: 200, outcome: "loaded" });
        const binding = result.report.documents[0]!.sourceBinding;
        assert.deepEqual(binding.input, {
          identityStatus: "verified", rawBytesSha256: sourceDigest, byteLength: Buffer.byteLength(source), encoding: "utf-8", complete: true,
        });
        assert.deepEqual(binding.files, [
          { file: "source.html", sha256: sourceDigest, byteLength: Buffer.byteLength(source), role: "authoring" },
          { file: "build/styles.css", sha256: cssDigest, byteLength: Buffer.byteLength(css), role: "dependency" },
        ]);
        assert.equal(binding.provenance.binding, "producer-bound");
        assert.equal(binding.provenance.codeSha256, codeDigest);
        assert.match(binding.provenance.optionsSha256 ?? "", /^[a-f0-9]{64}$/u);
      }
    } finally {
      process.chdir(originalCwd);
      rmSync(root, { recursive: true, force: true });
      rmSync(consumer, { recursive: true, force: true });
    }
  });
});

describe("owned process group probe", () => {
  /**
   * The truth table, pinned. `kill(pgid, 0)` answers with an errno and the whole cleanup decision
   * hangs off how that errno is read; the previous reading treated everything except ESRCH as
   * "cannot verify" and failed the acquisition on the first sample.
   *
   * The oracle is not this code: it is POSIX plus a measurement. POSIX gives ESRCH exactly one
   * meaning — no process in the group — so it is the only answer that may end the wait. The EPERM
   * row comes from 20 measured acquisitions on darwin 25.6.0 on 2026-09-18, in which 8 probes
   * answered EPERM for a group this process had created and owned, and in every one of the 8 the
   * next probe (0 ms or 10 ms later) answered ESRCH with the descendant dead. Transient, therefore
   * indeterminate, therefore retried inside the deadline it already had — not swallowed: an
   * indeterminate answer that survives the deadline still fails the acquisition.
   */
  it("reads only ESRCH as proof that the group is gone", () => {
    assert.equal(ownedGroupProbeState("ESRCH"), "absent");
    assert.equal(ownedGroupProbeState("EPERM"), "indeterminate");
    for (const foreign of ["EACCES", "EINVAL", "EAGAIN", "", undefined]) {
      assert.equal(ownedGroupProbeState(foreign), "unknown-errno", `${String(foreign)} must not be read as a verdict`);
    }
  });
});

/**
 * The retry and deadline paths of the owned-group cleanup, on a fake kernel and a fake clock.
 *
 * They used to live in closures that called `process.kill`, `Date.now` and `setTimeout` directly,
 * so they ran only when an environment happened to produce the errno — which on the machine that
 * measured the EPERM row it did in 8 of 20 acquisitions, and elsewhere never. The seam now carries
 * the kernel answers, the clock and the group's members; the budgets are the unchanged 500 ms and
 * 1 000 ms. Every test names the mutation that turns it red; each was applied and observed red.
 */
describe("owned process group cleanup: retry, deadline and zombie paths", () => {
  const PGID = 51_000;
  type Members = { pid: number; defunct: boolean }[] | null;
  function kernel(script: {
    /** errno answered by kill(-pgid, 0) on the n-th probe, or null for success. */
    probe: (n: number) => string | null;
    members?: Members;
    /** errno answered when a real signal is delivered, or null. */
    deliver?: (signal: NodeJS.Signals) => string | null;
  }) {
    let clock = 0;
    let probes = 0;
    const signals: NodeJS.Signals[] = [];
    const fail = (code: string): never => { throw Object.assign(new Error(code), { code }); };
    const operations: OwnedGroupOperations = {
      kill(target, signal) {
        assert.equal(target, -PGID, "the cleanup signalled something other than its own group");
        if (signal === 0) {
          const code = script.probe(probes++);
          if (code) fail(code);
          return;
        }
        signals.push(signal);
        const code = script.deliver?.(signal) ?? null;
        if (code) fail(code);
      },
      now: () => clock,
      // A cleanup that has lost its deadline polls forever. Stop it on the fake clock, far past the
      // real budget, so that mutant fails as a runaway instead of hanging the test process.
      async sleep(ms) {
        clock += ms;
        if (clock > 20 * (OWNED_GROUP_BUDGETS.termMs + OWNED_GROUP_BUDGETS.killMs)) throw new Error("runaway: the cleanup kept polling far past its budget");
        await new Promise((resolve) => setImmediate(resolve));
      },
      groupMembers: () => script.members === undefined ? null : script.members,
    };
    return { operations, signals, clock: () => clock, probes: () => probes };
  }
  const budgetMs = OWNED_GROUP_BUDGETS.termMs + OWNED_GROUP_BUDGETS.killMs;

  // Mutation "zombie counts as present" (probe ignores groupMembers): red, it survives cleanup.
  it("reads a group whose only members are proved zombies as gone, without a signal or a wait", { timeout: 2_000 }, async () => {
    const k = kernel({ probe: () => null, members: [{ pid: 51_001, defunct: true }, { pid: 51_002, defunct: true }] });
    await cleanupOwnedGroup(PGID, k.operations);
    assert.deepEqual(k.signals, []);
    assert.equal(k.clock(), 0);
  });

  // Mutation "some instead of every": red on the mixed row. Mutation "no SIGKILL escalation": red
  // on every row. Mutation "an empty member list means absent": red on the [] row.
  for (const [label, members] of [
    ["one live member beside a zombie", [{ pid: 51_001, defunct: true }, { pid: 51_002, defunct: false }]],
    ["no member information (every platform but Linux)", null],
    ["an empty member list after a successful kill(-pgid, 0)", []],
  ] as Array<[string, Members]>) {
    it(`keeps the group present with ${label}, escalates, and fails at the deadline`, { timeout: 2_000 }, async () => {
      const k = kernel({ probe: () => null, members });
      await assert.rejects(cleanupOwnedGroup(PGID, k.operations), /survived bounded cleanup/u);
      assert.deepEqual(k.signals, ["SIGTERM", "SIGKILL"]);
      assert.ok(k.clock() >= budgetMs, `gave up at ${k.clock()} ms, before the ${budgetMs} ms budget`);
    });
  }

  // Mutation "EPERM is fatal" (ownedGroupProbeState maps EPERM to unknown-errno): red, it throws
  // "could not be verified" on the first EPERM.
  it("retries EPERM inside the deadline and accepts the ESRCH that follows (retry path)", { timeout: 2_000 }, async () => {
    const answers: Array<string | null> = [null, "EPERM", "EPERM", "ESRCH"];
    const k = kernel({ probe: (n) => n < answers.length ? answers[n]! : "ESRCH", members: [{ pid: 51_001, defunct: false }] });
    await cleanupOwnedGroup(PGID, k.operations);
    assert.deepEqual(k.signals, ["SIGTERM"], "SIGKILL was sent although the group left inside the SIGTERM budget");
    assert.equal(k.probes(), 4);
    assert.equal(k.clock(), 2 * OWNED_GROUP_BUDGETS.pollMs);
  });

  // Mutation "deadline check removed": the loop never ends; the fake clock's runaway guard turns it red.
  // Mutation "indeterminate at the deadline read as absent": red, it resolves.
  it("fails an EPERM that outlives the deadline as unverifiable, after SIGKILL (deadline path)", { timeout: 2_000 }, async () => {
    const k = kernel({ probe: (n) => n === 0 ? null : "EPERM", members: [{ pid: 51_001, defunct: false }] });
    await assert.rejects(cleanupOwnedGroup(PGID, k.operations), /could not be verified/u);
    assert.deepEqual(k.signals, ["SIGTERM", "SIGKILL"]);
    assert.ok(k.clock() >= budgetMs, `gave up at ${k.clock()} ms, before the ${budgetMs} ms budget`);
  });

  // Mutation "unknown errno read as indeterminate": red, it waits out the budget and signals.
  it("fails at once on an errno outside the truth table, before any signal", { timeout: 2_000 }, async () => {
    const k = kernel({ probe: () => "EINVAL" });
    await assert.rejects(cleanupOwnedGroup(PGID, k.operations), /could not be verified/u);
    assert.deepEqual(k.signals, []);
    assert.equal(k.clock(), 0);
  });

  // Mutation "every delivery errno is fatal": red on EPERM/ESRCH. Mutation "every delivery errno
  // is tolerated": red on EIO.
  for (const code of ["EPERM", "ESRCH"]) {
    it(`tolerates ${code} when delivering SIGTERM and lets the probe decide`, { timeout: 2_000 }, async () => {
      const k = kernel({ probe: (n) => n === 0 ? null : "ESRCH", deliver: () => code, members: [{ pid: 51_001, defunct: false }] });
      await cleanupOwnedGroup(PGID, k.operations);
      assert.deepEqual(k.signals, ["SIGTERM"]);
    });
  }
  it("reports any other delivery errno as a termination failure", { timeout: 2_000 }, async () => {
    const k = kernel({ probe: () => null, deliver: () => "EIO", members: [{ pid: 51_001, defunct: false }] });
    await assert.rejects(cleanupOwnedGroup(PGID, k.operations), /termination failed/u);
  });
});
