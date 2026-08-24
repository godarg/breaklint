import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";

import {
  buildBlindPacket,
  buildBlindPacketV2,
  buildBlindContextArtifacts,
  buildBlindContextArtifactsV2,
  buildFreezeProjection,
  buildPilotReport,
  buildPublicIntakeManifest,
  canonicalJson,
  deriveStableTargetId,
  enumerateSvgTextTargets,
  ingestPublicArtifact,
  PINNED_M3_1_TRUST_POLICY,
  PINNED_M3_1_TRUST_POLICY_SHA256,
  scanStagedPublicArtifacts,
  sanitizeBlindSvgContextV2,
  validateAnnotationChronology,
  validateAnnotationWorkflow,
  validateStrictSplits,
  verifyExternalTrust,
  verifyBlindPacketV2Custodial,
  verifyBlindPacketV2Public,
  verifySanitizedBlindSvgContextV2,
  type ExternalAttestationProof,
  type ExternalFreezeReceipt,
} from "../tools/calibration/m3-1-pilot.ts";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u;
const INITIAL_TRUST_BASELINE = { previousAccepted: null, evaluationStartedAt: "2026-08-24T00:00:00Z" } as const;

function compileSchema(name: string) {
  const schema = JSON.parse(readFileSync(new URL(`../../schemas/calibration/${name}.schema.json`, import.meta.url), "utf8")) as object;
  return new Ajv2020({ allErrors: true, strict: true, formats: { "date-time": ISO_DATE_TIME } }).compile(schema);
}

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "breaklint-m3-1-unit-"));
  writeFileSync(join(root, "public.svg"), '<svg id="root"><text id="label">Public</text></svg>');
  return root;
}

describe("M3-1 additive public-pilot infrastructure", () => {
  it("hashes immutable public bytes and derives stable identities", () => {
    const root = fixtureRoot();
    const request = {
      artifactRoot: root,
      artifactPath: "public.svg",
      sourceLocator: "source_public_fixture_0001",
      sourceCapturedAt: "2026-08-23T00:00:00Z",
      sourceCaptureMode: "founder-authorized-source-snapshot" as const,
      firstPartySourceSnapshot: { commitSha: "1".repeat(40), blobSha1: "2".repeat(40), commitTime: "2026-08-22T00:00:00Z" },
      provenanceClass: "public-first-party" as const,
      rightsBasis: "first-party-founder-authorized" as const,
      privacyClass: "reviewed-no-personal-data" as const,
      privacyApproved: true as const,
      redistributionApproved: true as const,
      provenanceEvidenceSha256: SHA_A,
      rightsEvidenceSha256: SHA_A,
      privacyEvidenceSha256: SHA_A,
      originGroupId: "origin_group_public_fixture_0001",
      duplicateGroupId: "duplicate_group_public_fixture_0001",
      derivationGroupId: "derivation_group_public_fixture_0001",
      templateGroupId: "template_group_public_fixture_0001",
      versionGroupId: "version_group_public_fixture_0001",
    };
    const first = ingestPublicArtifact(request);
    const second = ingestPublicArtifact(request);
    assert.deepEqual(first, second);
    assert.match(first.documentId, /^doc_[a-f0-9]{32}$/u);
    assert.equal(first.byteLength, 51);

    const targetId = deriveStableTargetId({
      artifactSha256: first.artifactSha256,
      svgRootKey: "author-id:root",
      sourceIdentity: "author-id:label",
      ruleId: "svg/text-clipped",
    });
    assert.match(targetId, /^target_[a-f0-9]{32}$/u);
    assert.equal(targetId, deriveStableTargetId({ artifactSha256: first.artifactSha256, svgRootKey: "author-id:root", sourceIdentity: "author-id:label", ruleId: "svg/text-clipped" }));
  });

  it("rejects path escapes, symlinks, disclosure-prone locators and unclear rights", () => {
    const root = fixtureRoot();
    symlinkSync(join(root, "public.svg"), join(root, "linked.svg"));
    const base = {
      artifactRoot: root,
      artifactPath: "public.svg",
      sourceLocator: "source_public_fixture_0001",
      sourceCapturedAt: "2026-08-23T00:00:00Z",
      sourceCaptureMode: "founder-authorized-source-snapshot" as const,
      firstPartySourceSnapshot: { commitSha: "1".repeat(40), blobSha1: "2".repeat(40), commitTime: "2026-08-22T00:00:00Z" },
      provenanceClass: "public-first-party" as const,
      rightsBasis: "first-party-founder-authorized" as const,
      privacyClass: "reviewed-no-personal-data" as const,
      privacyApproved: true as const,
      redistributionApproved: true as const,
      provenanceEvidenceSha256: SHA_A,
      rightsEvidenceSha256: SHA_A,
      privacyEvidenceSha256: SHA_A,
      originGroupId: "origin_group_public_fixture_0001",
      duplicateGroupId: "duplicate_group_public_fixture_0001",
      derivationGroupId: "derivation_group_public_fixture_0001",
      templateGroupId: "template_group_public_fixture_0001",
      versionGroupId: "version_group_public_fixture_0001",
    };
    assert.throws(() => ingestPublicArtifact({ ...base, artifactPath: "../public.svg" }), /safe relative path/u);
    assert.throws(() => ingestPublicArtifact({ ...base, artifactPath: "linked.svg" }), /symlink/u);
    assert.throws(() => ingestPublicArtifact({ ...base, sourceLocator: "https://example.test/file?token=secret" }), /opaque locator/u);
    assert.throws(() => ingestPublicArtifact({ ...base, rightsBasis: "unclear" as never }), /rights basis/u);
    assert.throws(() => ingestPublicArtifact({ ...base, privacyApproved: false as never }), /privacy approval/u);
  });

  it("preserves authored IDs and derives byte-bound structural source signatures when IDs are absent", () => {
    const bytes = Buffer.from('<html><body><svg><text>Anonymous target</text><text id="authored">Authored target</text></svg></body></html>');
    const ruleIds = ["svg/text-clipped", "svg/text-ink-collision", "svg/text-overflows-viewport"] as const;
    const first = enumerateSvgTextTargets(bytes, [...ruleIds]);
    const second = enumerateSvgTextTargets(bytes, [...ruleIds]);
    assert.deepEqual(first, second);
    assert.equal(first.length, 6);
    assert.match(first[0]!.svgRootKey, /^structural-path:/u);
    assert.match(first[0]!.sourceIdentity, /^source-signature:[a-f0-9]{64}$/u);
    assert.deepEqual(first.slice(0, 3).map((target) => target.ruleId), ruleIds);
    assert.equal(first[3]!.sourceIdentity, "author-id:authored");
    assert.deepEqual(first.slice(3).map((target) => target.ruleId), ruleIds);
    assert.notEqual(first[0]!.targetId, first[1]!.targetId);

    const intakeRoot = fixtureRoot();
    const intake = ingestPublicArtifact({
      artifactRoot: intakeRoot,
      artifactPath: "public.svg",
      sourceLocator: "source_public_fixture_0002",
      sourceCapturedAt: "2026-08-23T00:00:00Z",
      sourceCaptureMode: "synthetic-fixture-construction",
      provenanceClass: "synthetic-first-party",
      rightsBasis: "first-party-founder-authorized",
      privacyClass: "synthetic-no-personal-data",
      privacyApproved: true,
      redistributionApproved: true,
      provenanceEvidenceSha256: SHA_A,
      rightsEvidenceSha256: SHA_A,
      privacyEvidenceSha256: SHA_A,
      originGroupId: "origin_group_public_fixture_0002",
      duplicateGroupId: "duplicate_group_public_fixture_0002",
      derivationGroupId: "derivation_group_public_fixture_0002",
      templateGroupId: "template_group_public_fixture_0002",
      versionGroupId: "version_group_public_fixture_0002",
    });
    const manifest = buildPublicIntakeManifest({
      manifestId: "intake_manifest_synthetic_0001",
      createdAt: "2026-08-23T10:00:00.000Z",
      documents: [{ ...intake, mediaType: "image/svg+xml", publicRelativePath: "m3-1/synthetic.svg", targets: enumerateSvgTextTargets(readFileSync(join(intakeRoot, "public.svg")), [...ruleIds]) }],
    });
    assert.equal(manifest.claimEligible, false);
    assert.equal(manifest.captureAttestorTrustValid, false);
    assert.equal(manifest.calibrated, false);
    assert.match(createHash("sha256").update(JSON.stringify(manifest)).digest("hex"), /^[a-f0-9]{64}$/u);
    const validate = compileSchema("public-intake-manifest-v1");
    assert.equal(validate(manifest), true, JSON.stringify(validate.errors));
  });

  it("builds a deterministic blind packet and rejects oracle leakage", () => {
    const targets = [
      { documentId: `doc_${"1".repeat(32)}`, artifactSha256: SHA_A, svgRootKey: "author-id:root", structuralPath: "/html[0]/body[0]/svg[0]/text[0]", sourceIdentity: "author-id:a", ruleId: "svg/text-clipped" as const },
      { documentId: `doc_${"2".repeat(32)}`, artifactSha256: SHA_B, svgRootKey: "author-id:root", structuralPath: "/html[0]/body[0]/svg[0]/text[1]", sourceIdentity: "author-id:b", ruleId: "svg/text-ink-collision" as const },
    ];
    const boundTargets = targets.map((target) => ({ ...target, targetId: deriveStableTargetId(target) }));
    const contextsByTargetId = Object.fromEntries(boundTargets.map((target, index) => [target.targetId, { artifactPath: `blind-context/context_${String(index + 1).repeat(24)}.svg`, artifactSha256: String(index + 1).repeat(64), byteLength: 32, mediaType: "image/svg+xml" as const, targetLocator: { mode: "context-structural-path" as const, structuralPathWithinContext: target.structuralPath.slice(target.structuralPath.indexOf("/text")) }, renderingContract: { mode: "browser-native-isolated-svg" as const, externalAssetsFetched: false as const, sourceScope: "exact-svg-document" as const, sourceByteTreatment: "exact-source-subtree-plus-inert-packet-comment" as const, limitations: ["Synthetic neutral test context only."] } }]));
    const first = buildBlindPacket({ packetId: "blind_packet_public_pilot_0001", orderSeed: "order_seed_public_pilot_0001", targets: boundTargets, contextsByTargetId });
    const second = buildBlindPacket({ packetId: "blind_packet_public_pilot_0001", orderSeed: "order_seed_public_pilot_0001", targets: [...boundTargets].reverse(), contextsByTargetId });
    assert.deepEqual(first, second);
    assert.equal(first.blinded, true);
    assert.equal(first.humanExecutable, true);
    assert.equal(first.custodialMappingRequired, true);
    assert.deepEqual(first.deliveryContract, { annotationBundleOnly: true, repositoryAccessPermitted: false, sourceManifestAccessPermitted: false, splitAccessPermitted: false });
    assert.equal(JSON.stringify(first).includes(boundTargets[0]!.documentId), false);
    assert.equal(JSON.stringify(first).includes(boundTargets[0]!.artifactSha256), false);
    assert.equal(JSON.stringify(first).includes(boundTargets[0]!.targetId), false);
    assert.equal(JSON.stringify(first).includes('"split"'), false);
    assert.equal(JSON.stringify(first).includes("threshold"), false);
    const validate = compileSchema("blind-packet-v1");
    assert.equal(validate(first), true, JSON.stringify(validate.errors));
    assert.throws(
      () => buildBlindPacket({ packetId: "blind_packet_public_pilot_0001", orderSeed: "order_seed_public_pilot_0001", targets: [{ ...boundTargets[0]!, finding: true } as never], contextsByTargetId }),
      /oracle-leaking field/u,
    );
    assert.throws(
      () => buildBlindPacket({ packetId: "blind_packet_public_pilot_0001", orderSeed: "order_seed_public_pilot_0001", targets: [{ ...boundTargets[0]!, targetId: `target_${"0".repeat(32)}` }], contextsByTargetId }),
      /does not match byte-bound source identity/u,
    );
    assert.throws(() => buildBlindPacket({ packetId: "blind_packet_public_pilot_0001", orderSeed: "order_seed_public_pilot_0001", targets: boundTargets, contextsByTargetId: {} }), /context is missing/u);
  });

  it("extracts only exact inline SVG contexts and rejects external assets", () => {
    const bytes = Buffer.from('<html><body><p>not packet context</p><svg><text id="label">Inline</text></svg></body></html>');
    const target = enumerateSvgTextTargets(bytes, ["svg/text-clipped"])[0]!;
    const extracted = buildBlindContextArtifacts(bytes, "text/html", [{ ...target, documentId: `doc_${"1".repeat(32)}` }]);
    assert.equal(extracted.artifacts.length, 1);
    assert.equal(extracted.artifacts[0]!.bytes.toString("utf8"), '<svg><!-- isolated annotation context; source subtree otherwise byte-exact --><text id="label">Inline</text></svg>');
    const context = extracted.contextsByTargetId[target.targetId]!;
    assert.equal(context.renderingContract.sourceScope, "embedded-inline-svg-only");
    assert.ok(context.renderingContract.limitations.some((entry) => entry.includes("not claimed as a faithful site render")));
    assert.throws(
      () => buildBlindContextArtifacts(Buffer.from('<svg><image href="https://example.test/private.png"/><text>Target</text></svg>'), "image/svg+xml", [{ ...enumerateSvgTextTargets(Buffer.from('<svg><image href="https://example.test/private.png"/><text>Target</text></svg>'), ["svg/text-clipped"])[0]!, documentId: `doc_${"2".repeat(32)}` }]),
      /external asset fetch/u,
    );
    assert.throws(
      () => buildBlindContextArtifacts(Buffer.from('<svg><style>text{font:url(../font.woff2)}</style><text>Target</text></svg>'), "image/svg+xml", [{ ...enumerateSvgTextTargets(Buffer.from('<svg><style>text{font:url(../font.woff2)}</style><text>Target</text></svg>'), ["svg/text-clipped"])[0]!, documentId: `doc_${"3".repeat(32)}` }]),
      /external asset fetch/u,
    );
  });

  it("deterministically sanitizes editor metadata, comments and authored IDs", () => {
    const source = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" inkscape:version="1.2" sodipodi:docname="private-source.svg" data-generator="Private Export Tool 7"><!-- Created with Inkscape --><sodipodi:namedview inkscape:window-x="1912"/><defs><linearGradient id="source-gradient"/></defs><rect id="private-shape-name" fill="url(#source-gradient)"/><text id="private-label">Neutral label</text></svg>';
    const first = sanitizeBlindSvgContextV2(source);
    const second = sanitizeBlindSvgContextV2(source);
    assert.equal(first, second);
    assert.equal(sanitizeBlindSvgContextV2(first), first);
    assert.equal(/(?:inkscape|sodipodi|private-source|private-shape|private-label|source-gradient|<!--)/iu.test(first), false);
    assert.match(first, /id="blind-id-000001"/u);
    assert.match(first, /fill="url\(#blind-id-000001\)"/u);
    assert.deepEqual(verifySanitizedBlindSvgContextV2(Buffer.from(first)), { valid: true, issues: [] });
  });

  it("fails closed on outcome hints, opaque source paths, data URLs, processing instructions and foreign namespaces", () => {
    const encodedSvgPayload = ["PHN2", "Zz4="].join("");
    const privateSourcePath = ["/", "Us", "ers", "/fixture-user/private/source.svg"].join("");
    const blocked = [
      '<svg><text>breaklint result: finding</text></svg>',
      `<svg><image href="data:image/svg+xml;base64,${encodedSvgPayload}"/><text>Neutral</text></svg>`,
      '<?packet finding="positive"?><svg><text>Neutral</text></svg>',
      '<svg xmlns:vendor="https://vendor.invalid/ns"><vendor:payload>Neutral</vendor:payload><text>Neutral</text></svg>',
      '<svg><script>throw new Error("active")</script><text>Neutral</text></svg>',
      '<svg><foreignObject><iframe src="about:blank"></iframe></foreignObject><text>Neutral</text></svg>',
      '<svg><text onclick="alert(1)">Neutral</text></svg>',
      '<svg><animate attributeName="x" values="0;1"/><text>Neutral</text></svg>',
      '<svg><set attributeName="visibility" to="hidden"/><text>Neutral</text></svg>',
      '<svg><style>#source-id { display: none }</style><text id="source-id">Neutral</text></svg>',
      '<svg><image href=https://example.test/private.png/><text>Neutral</text></svg>',
      `<svg data-source=${privateSourcePath}><text>Neutral</text></svg>`,
      '<svg><text id="first" ID="second">Neutral</text></svg>',
      '<svg><text>f&#105;nding: positive</text></svg>',
      '<svg><image href="&#35;source-id"/><text id="source-id">Neutral</text></svg>',
      String.raw`<svg><text style="fill:url(\68 ttps://attacker.invalid/x)">Neutral</text></svg>`,
      String.raw`<svg xmlns="http://www.w3.org/2000/svg"><rect style="fill:u\72 l(https://example.invalid/pixel)"/></svg>`,
      '<svg><text>result: pass</text></svg>',
      '<svg><text>result: fail</text></svg>',
      '<svg><text>verdict: pass</text></svg>',
      '<svg><text>r&#101;sult: fail</text></svg>',
    ];
    for (const source of blocked) assert.throws(() => sanitizeBlindSvgContextV2(source), /(?:outcome hint|data URL|processing instruction|unknown namespace|active or independently mutable content|event handler|must be quoted|duplicate attribute|character reference|backslash or CSS escape)/u, source);
    const hiddenChannels = sanitizeBlindSvgContextV2(`<svg data-source="${privateSourcePath}"><title>finding: positive</title><desc>source.svg</desc><text class="outcome_fail" aria-label="severity: high" role="status">Neutral</text></svg>`);
    assert.equal(/(?:data-source|<title|<desc|class=|aria-|role=|finding|outcome|severity|source\.svg)/iu.test(hiddenChannels), false);
    const metadataOnly = sanitizeBlindSvgContextV2('<svg><metadata><dc:title>finding: positive</dc:title></metadata><text>Neutral</text></svg>');
    assert.equal(metadataOnly.includes("finding"), false);
    const idOnly = sanitizeBlindSvgContextV2('<svg><text id="finding-positive">Neutral</text></svg>');
    assert.equal(idOnly.includes("finding"), false);
    const commentOnly = sanitizeBlindSvgContextV2('<svg><!-- finding: positive --><text>Neutral</text></svg>');
    assert.equal(commentOnly.includes("finding"), false);
  });

  it("rejects each reported blind-context escape counterexample for its own specific reason", () => {
    // Exact counterexamples from the independent final review of 54fa14d. A real Chrome resolves
    // both CSS-escape forms to url("https://…invalid/…") and requests them, so a sanitizer that
    // returns them unchanged hands the annotator an external, outcome-carrying resource channel.
    const cssEscape: ReadonlyArray<readonly [string, string]> = [
      ["reviewer u\\72 l form", String.raw`<svg xmlns="http://www.w3.org/2000/svg"><rect style="fill:u\72 l(https://example.invalid/pixel)"/></svg>`],
      ["reviewer \\68 ttps form", String.raw`<svg><text style="fill:url(\68 ttps://attacker.invalid/x)">Neutral</text></svg>`],
    ];
    for (const [label, source] of cssEscape) {
      assert.throws(() => sanitizeBlindSvgContextV2(source), /blind SVG context attribute style contains a backslash or CSS escape/u, label);
    }

    // Outcome hints keyed on `result` / `verdict`, including a character-reference spelling.
    const outcomeHints: ReadonlyArray<readonly [string, string]> = [
      ["result: pass", '<svg xmlns="http://www.w3.org/2000/svg"><text>result: pass</text></svg>'],
      ["result: fail", '<svg xmlns="http://www.w3.org/2000/svg"><text>result: fail</text></svg>'],
      ["verdict: pass", '<svg xmlns="http://www.w3.org/2000/svg"><text>verdict: pass</text></svg>'],
      ["entity-encoded result: fail", '<svg xmlns="http://www.w3.org/2000/svg"><text>r&#101;sult: fail</text></svg>'],
    ];
    for (const [label, source] of outcomeHints) {
      assert.throws(() => sanitizeBlindSvgContextV2(source), /blind SVG context contains an outcome hint/u, label);
    }

    // Positive control: the ban is on the escape channel, not on ordinary presentational style.
    const benign = sanitizeBlindSvgContextV2('<svg xmlns="http://www.w3.org/2000/svg"><rect style="fill:#101010"/><text>Neutral</text></svg>');
    assert.equal(benign.includes("fill:#101010"), true);
    assert.equal(sanitizeBlindSvgContextV2(benign), benign);
  });

  it("refuses external attribute references by allowlist, including the backslash-free counterexamples", () => {
    // A second independent review defeated the backslash ban without any backslash. Both of these
    // produced an annotator context that the fixed-point verifier called valid and that a real
    // Chrome fetched from, while the rendering contract still asserted externalAssetsFetched:false.
    assert.throws(
      () => sanitizeBlindSvgContextV2(`<svg xmlns="http://www.w3.org/2000/svg"><text style='fill:url("https://attacker.invalid/beacon"/*c*/)'>Alpha</text></svg>`),
      /contains a CSS comment/u,
      "url() with a trailing CSS comment escaped the bare-token pattern",
    );
    assert.throws(
      () => sanitizeBlindSvgContextV2(`<svg xmlns="http://www.w3.org/2000/svg"><text style='mask-image:image-set("https://attacker.invalid/mask" 1x)'>Beta</text></svg>`),
      /calls a non-allowlisted function: image-set/u,
      "image-set never spells url(, so no url() pattern can catch it",
    );

    // The guard must be an allowlist, not a longer denylist: a function nobody enumerated is refused
    // on the sole ground that it was never permitted.
    for (const [label, fn] of [["cross-fade", "cross-fade(url(https://a.invalid/x) 50%)"], ["element", "element(#src)"], ["var", "var(--leak)"], ["image", "image(https://a.invalid/x)"]] as const) {
      assert.throws(
        () => sanitizeBlindSvgContextV2(`<svg xmlns="http://www.w3.org/2000/svg"><rect style="fill:${fn}"/><text>Neutral</text></svg>`),
        /calls a non-allowlisted function|references a url\(\) target that is not a same-document fragment/u,
        label,
      );
    }

    // A url() that leaves the document is refused however it is spelled or quoted.
    for (const value of ['url(https://a.invalid/x)', "url('https://a.invalid/x')", 'url( https://a.invalid/x )']) {
      assert.throws(
        () => sanitizeBlindSvgContextV2(`<svg xmlns="http://www.w3.org/2000/svg"><rect fill="${value}"/><text>Neutral</text></svg>`),
        /references a url\(\) target that is not a same-document fragment/u,
        value,
      );
    }

    // Positive controls: the geometry and same-document references the real corpus depends on must
    // survive untouched, otherwise the allowlist would silently invalidate the frozen contexts.
    const legitimate = '<svg xmlns="http://www.w3.org/2000/svg"><rect transform="matrix(0.8,0,0,0.8,10,0)" fill="url(#blind-id-000001)"/><g transform="translate(-198.42,-232.06) scale(2)"><text>Neutral</text></g></svg>';
    const kept = sanitizeBlindSvgContextV2(legitimate);
    assert.equal(kept.includes('matrix(0.8,0,0,0.8,10,0)'), true);
    assert.equal(kept.includes('url(#blind-id-000001)'), true);
    assert.equal(kept.includes('translate(-198.42,-232.06) scale(2)'), true);
    assert.equal(sanitizeBlindSvgContextV2(kept), kept);
  });

  it("refuses an unterminated url(, which CSS closes at end-of-input and a browser still fetches", () => {
    // A third independent review defeated the target check with one missing `)`. CSS closes an
    // unterminated function at EOF, so a browser treats `url(https://host/x` as a complete url(),
    // while every paren-terminated pattern simply never matches it. Real Chrome fetched from nine
    // such channels while the verifier reported the produced artifact valid.
    const channels = ["mask-image", "fill", "background-image", "marker-start", "clip-path", "stroke", "filter"];
    for (const property of channels) {
      assert.throws(
        () => sanitizeBlindSvgContextV2(`<svg xmlns="http://www.w3.org/2000/svg"><text style='${property}:url(https://attacker.invalid/x'>Alpha</text></svg>`),
        /contains unbalanced parentheses/u,
        property,
      );
    }
    // Spelling variants of the same hole.
    for (const [label, value] of [["uppercase", "URL(https://attacker.invalid/e1"], ["quoted", 'url("https://attacker.invalid/a4"'], ["trailing newline", "url(https://attacker.invalid/f15\n"]] as const) {
      assert.throws(
        () => sanitizeBlindSvgContextV2(`<svg xmlns="http://www.w3.org/2000/svg"><text style='fill:${value}'>Alpha</text></svg>`),
        /contains unbalanced parentheses/u,
        label,
      );
    }
    // A stray closing paren is equally unbalanced and equally refused.
    assert.throws(
      () => sanitizeBlindSvgContextV2('<svg xmlns="http://www.w3.org/2000/svg"><text style="fill:#101010)">Alpha</text></svg>'),
      /contains unbalanced parentheses/u,
    );
    // Positive controls: balanced geometry and same-document references stay accepted, including the
    // quoted fragment form that the first version of this guard wrongly refused.
    for (const value of ['url(#g)', "url('#g')", 'url(#g)']) {
      const kept = sanitizeBlindSvgContextV2(`<svg xmlns="http://www.w3.org/2000/svg"><text fill="${value}">Alpha</text></svg>`);
      assert.equal(kept.includes("Alpha"), true, value);
    }
  });

  it("binds packet-v2 target set and order to an independently reconstructed custodial source", () => {
    const source = Buffer.from('<svg id="root"><text id="first">Alpha</text><text id="second">Beta</text></svg>');
    const targets = enumerateSvgTextTargets(source, ["svg/text-clipped"]).map((target) => ({ ...target, documentId: `doc_${"1".repeat(32)}` }));
    const contexts = buildBlindContextArtifactsV2(source, "image/svg+xml", targets);
    const artifacts = new Map(contexts.artifacts.map((artifact) => [artifact.path, artifact.bytes]));
    const orderSeed = "order_seed_packet_v2_unit_0001";
    const packet = buildBlindPacketV2({ packetId: "blind_packet_v2_unit_0001", orderSeed, targets, contextsByTargetId: contexts.contextsByTargetId });
    assert.throws(() => buildBlindPacketV2({ packetId: "blind_packet_finding_positive_0001", orderSeed, targets, contextsByTargetId: contexts.contextsByTargetId }), /packet ID contains an outcome hint/u);
    assert.equal(compileSchema("blind-packet-v2")(packet), true);
    assert.deepEqual(verifyBlindPacketV2Public(packet, artifacts), { valid: true, issues: [] });
    assert.deepEqual(verifyBlindPacketV2Custodial({ packet, packetId: packet.packetId, orderSeed, targets: [...targets].reverse(), contextsByTargetId: contexts.contextsByTargetId, artifactsByPath: artifacts }), { valid: true, issues: [] });

    const reorderedTargets = [...packet.targets].reverse().map((target, index) => ({ ...target, neutralOrder: index + 1 }));
    const reorderedWithoutHash = {
      ...packet,
      orderContract: { ...packet.orderContract, orderedBlindTargetIdsSha256: createHash("sha256").update(canonicalJson(reorderedTargets.map((target) => target.blindTargetId))).digest("hex") },
      targets: reorderedTargets,
    };
    const { packetSha256: _oldHash, ...reorderedProjection } = reorderedWithoutHash;
    const coherentReorder = { ...reorderedProjection, packetSha256: createHash("sha256").update(canonicalJson(reorderedProjection)).digest("hex") };
    assert.deepEqual(verifyBlindPacketV2Public(coherentReorder, artifacts), { valid: true, issues: [] });
    assert.equal(verifyBlindPacketV2Custodial({ packet: coherentReorder, packetId: packet.packetId, orderSeed, targets, contextsByTargetId: contexts.contextsByTargetId, artifactsByPath: artifacts }).issues.includes("packet-custodial-reconstruction-mismatch"), true);

    const duplicated = structuredClone(packet);
    duplicated.targets[1] = { ...duplicated.targets[0]!, neutralOrder: 2 };
    assert.equal(verifyBlindPacketV2Public(duplicated, artifacts).issues.includes("packet-blind-target-duplicate"), true);
    assert.equal(verifyBlindPacketV2Public({ ...packet, unexpectedGovernedField: true }, artifacts).issues[0]!.startsWith("packet-schema-invalid:"), true);
  });

  it("preserves all five labels and requires blind adjudication for every non-binary label", () => {
    const bytes = Buffer.from('<svg id="root"><text id="label">Review</text></svg>');
    const target = enumerateSvgTextTargets(bytes, ["svg/text-clipped"])[0]!;
    const bound = { ...target, documentId: `doc_${"1".repeat(32)}` };
    const contexts = buildBlindContextArtifacts(bytes, "image/svg+xml", [bound]);
    const packet = buildBlindPacket({ packetId: "blind_packet_annotation_0001", orderSeed: "annotation_order_seed_0001", targets: [bound], contextsByTargetId: contexts.contextsByTargetId });
    const sessions = [
      { sessionId: "session_a_0001", annotatorOpaqueId: "annotator_a_0001", packetSha256: packet.packetSha256, startedAt: "2026-08-23T10:00:00Z", completedAt: "2026-08-23T10:30:00Z", findingExposed: false },
      { sessionId: "session_b_0001", annotatorOpaqueId: "annotator_b_0001", packetSha256: packet.packetSha256, startedAt: "2026-08-23T10:00:00Z", completedAt: "2026-08-23T10:30:00Z", findingExposed: false },
    ];
    const annotations = [
      { sessionId: sessions[0]!.sessionId, blindTargetId: packet.targets[0]!.blindTargetId, ruleId: packet.targets[0]!.ruleId, label: "ambiguous" as const, rationale: "Borderline visual evidence remains.", createdAt: "2026-08-23T10:20:00Z" },
      { sessionId: sessions[1]!.sessionId, blindTargetId: packet.targets[0]!.blindTargetId, ruleId: packet.targets[0]!.ruleId, label: "invalid_target" as const, rationale: "The supplied target locator is insufficient.", createdAt: "2026-08-23T10:21:00Z" },
    ];
    const workflowBindings = { originGroupByBlindTargetId: { [packet.targets[0]!.blindTargetId]: "origin_group_annotation_0001" }, statisticsPlan: { bootstrapIterations: 1000, bootstrapSeed: "annotation_bootstrap_seed_0001", confidenceLevel: 0.95 as const } };
    const red = validateAnnotationWorkflow({ packet, sessions, annotations, adjudications: [], ...workflowBindings });
    assert.equal(red.structurallyValid, false);
    assert.ok(red.issues.includes("required-adjudication-missing"));
    assert.deepEqual(red.agreement, { exactAgreement: 0, agreedTargets: 0, comparableTargets: 1 });
    assert.equal(red.statistics?.adjudication.completed, 0);
    assert.equal(red.statistics?.adjudication.rejectedInvalid, 0);
    assert.equal(red.statistics?.adjudication.completionRate, 0);
    const green = validateAnnotationWorkflow({ packet, sessions, annotations, adjudications: [{ blindTargetId: packet.targets[0]!.blindTargetId, adjudicatorOpaqueId: "adjudicator_c_0001", sourceSessionIds: [sessions[0]!.sessionId, sessions[1]!.sessionId], finalLabel: "abstain", rationale: "The frozen context remains insufficient.", createdAt: "2026-08-23T10:40:00Z", blinded: true, breaklintResultExposed: false }], ...workflowBindings });
    assert.equal(green.structurallyValid, true);
    assert.deepEqual(green.agreement, { exactAgreement: 0, agreedTargets: 0, comparableTargets: 1 });
    assert.equal(green.statistics?.confusionTable.ambiguous.invalid_target, 1);
    assert.equal(green.statistics?.cohenKappa, 0);
    assert.equal(green.statistics?.krippendorffNominalAlpha, 0);
    assert.equal(green.statistics?.nonbinaryRates.anyNonbinary, 1);
    assert.equal(green.statistics?.annotatorPrevalence.annotatorA.sessionId, sessions[0]!.sessionId);
    assert.equal(green.statistics?.annotatorPrevalence.annotatorA.prevalence.ambiguous, 1);
    assert.equal(green.statistics?.annotatorPrevalence.annotatorB.sessionId, sessions[1]!.sessionId);
    assert.equal(green.statistics?.annotatorPrevalence.annotatorB.prevalence.invalid_target, 1);
    assert.deepEqual(green.statistics?.originGroupBootstrap, {
      disposition: "not-computable",
      reason: "insufficient-origin-groups",
      minimumOriginGroups: 2,
      confidenceLevel: 0.95,
      iterations: 1000,
      seedSha256: createHash("sha256").update("annotation_bootstrap_seed_0001").digest("hex"),
      exactAgreement95Ci: null,
      cohenKappa95Ci: null,
    });
    assert.equal(green.statistics?.labels.length, 5);
    assert.equal(Object.values(green.statistics!.confusionTable).reduce((sum, row) => sum + Object.keys(row).length, 0), 25);
    assert.deepEqual(green.statistics?.adjudication, { required: 1, completed: 1, rejectedInvalid: 0, completionRate: 1, finalLabelCounts: { positive: 0, negative: 0, ambiguous: 0, abstain: 1, invalid_target: 0 } });
    assert.deepEqual(annotations.map((entry) => entry.label), ["ambiguous", "invalid_target"]);
    const missingMapping = validateAnnotationWorkflow({ packet, sessions, annotations, adjudications: [], ...workflowBindings, originGroupByBlindTargetId: {} });
    assert.equal(missingMapping.statistics, null);
    assert.ok(missingMapping.issues.includes("custodial-origin-mapping-incomplete-or-invalid"));
    const cliRoot = mkdtempSync(join(tmpdir(), "breaklint-m3-1-annotation-cli-"));
    const cliInput = join(cliRoot, "workflow.json");
    writeFileSync(cliInput, JSON.stringify({ packet, sessions, annotations, adjudications: green.statistics ? [{ blindTargetId: packet.targets[0]!.blindTargetId, adjudicatorOpaqueId: "adjudicator_c_0001", sourceSessionIds: [sessions[0]!.sessionId, sessions[1]!.sessionId], finalLabel: "abstain", rationale: "The frozen context remains insufficient.", createdAt: "2026-08-23T10:40:00Z", blinded: true, breaklintResultExposed: false }] : [], ...workflowBindings }));
    const cli = spawnSync(process.execPath, ["--experimental-strip-types", "tests/tools/calibration/m3-1-pilot-cli.ts", "annotation-check", cliInput], { cwd: new URL("../../", import.meta.url), encoding: "utf8" });
    assert.equal(cli.status, 1);
    const cliReport = JSON.parse(cli.stdout) as { statistics: { confusionTable: Record<string, Record<string, number>> } | null; issues: string[] };
    assert.equal(cliReport.statistics?.confusionTable.ambiguous?.invalid_target, 1);
    assert.ok(cliReport.issues.includes("external-human-identity-oracle-unavailable"));

    const baseAdjudication = {
      blindTargetId: packet.targets[0]!.blindTargetId,
      adjudicatorOpaqueId: "adjudicator_c_0001",
      sourceSessionIds: [sessions[0]!.sessionId, sessions[1]!.sessionId] as [string, string],
      finalLabel: "positive" as const,
      rationale: "The independent adjudicator resolved the frozen evidence.",
      createdAt: "2026-08-23T10:40:00Z",
      blinded: true as const,
      breaklintResultExposed: false as const,
    };
    const zeroFinalLabels = { positive: 0, negative: 0, ambiguous: 0, abstain: 0, invalid_target: 0 };
    const requiredInvalidMatrix = [
      { name: "identity-equals-annotator-a", mutation: { adjudicatorOpaqueId: sessions[0]!.annotatorOpaqueId }, issue: "adjudicator-not-independent" },
      { name: "identity-equals-annotator-b", mutation: { adjudicatorOpaqueId: sessions[1]!.annotatorOpaqueId }, issue: "adjudicator-not-independent" },
      { name: "before-first-annotation", mutation: { createdAt: "2026-08-23T10:19:59Z" }, issue: "adjudication-annotation-binding-invalid" },
      { name: "after-annotations-before-session-completion", mutation: { createdAt: "2026-08-23T10:25:00Z" }, issue: "adjudication-before-source-session-completion" },
      { name: "not-blinded", mutation: { blinded: false }, issue: "adjudication-blinding-invalid" },
      { name: "result-exposed", mutation: { breaklintResultExposed: true }, issue: "adjudication-result-exposed" },
      { name: "duplicate-source-session", mutation: { sourceSessionIds: [sessions[0]!.sessionId, sessions[0]!.sessionId] }, issue: "adjudication-session-binding-invalid" },
      { name: "unknown-source-session", mutation: { sourceSessionIds: [sessions[0]!.sessionId, "session_unknown_0001"] }, issue: "adjudication-session-binding-invalid" },
      { name: "invalid-label", mutation: { finalLabel: "binary-coerced" }, issue: "adjudication-label-invalid" },
      { name: "short-rationale", mutation: { rationale: "short" }, issue: "adjudication-rationale-invalid" },
      { name: "empty-identity", mutation: { adjudicatorOpaqueId: "   " }, issue: "adjudicator-opaque-id-invalid" },
    ] as const;
    for (const testCase of requiredInvalidMatrix) {
      const result = validateAnnotationWorkflow({ packet, sessions, annotations, adjudications: [{ ...baseAdjudication, ...testCase.mutation } as never], ...workflowBindings });
      assert.equal(result.structurallyValid, false, testCase.name);
      assert.ok(result.issues.includes(testCase.issue), `${testCase.name}: ${result.issues.join(",")}`);
      assert.ok(result.issues.includes("required-adjudication-missing"), testCase.name);
      assert.deepEqual(result.statistics?.adjudication, {
        required: 1,
        completed: 0,
        rejectedInvalid: 1,
        completionRate: 0,
        finalLabelCounts: zeroFinalLabels,
      }, testCase.name);
    }

    const noTriggerAnnotations = annotations.map((annotation) => ({ ...annotation, label: "positive" as const }));
    const noTrigger = validateAnnotationWorkflow({ packet, sessions, annotations: noTriggerAnnotations, adjudications: [baseAdjudication], ...workflowBindings });
    assert.ok(noTrigger.issues.includes("adjudication-without-trigger"));
    assert.deepEqual(noTrigger.statistics?.adjudication, {
      required: 0,
      completed: 0,
      rejectedInvalid: 1,
      // With no required items, completionRate=1 is explicitly vacuous and does
      // not turn the structurally invalid workflow into a valid execution.
      completionRate: 1,
      finalLabelCounts: zeroFinalLabels,
    });

    const duplicate = validateAnnotationWorkflow({ packet, sessions, annotations, adjudications: [baseAdjudication, { ...baseAdjudication }], ...workflowBindings });
    assert.ok(duplicate.issues.includes("adjudication-duplicated"));
    assert.ok(duplicate.issues.includes("required-adjudication-missing"));
    assert.deepEqual(duplicate.statistics?.adjudication, {
      required: 1,
      completed: 0,
      rejectedInvalid: 2,
      completionRate: 0,
      finalLabelCounts: zeroFinalLabels,
    });

    const invalidSelfAdjudication = { ...baseAdjudication, adjudicatorOpaqueId: sessions[0]!.annotatorOpaqueId };
    for (const [name, ordered] of [
      ["invalid-then-valid", [invalidSelfAdjudication, baseAdjudication]],
      ["valid-then-invalid", [baseAdjudication, invalidSelfAdjudication]],
    ] as const) {
      const result = validateAnnotationWorkflow({ packet, sessions, annotations, adjudications: [...ordered], ...workflowBindings });
      assert.ok(result.issues.includes("adjudication-duplicated"), name);
      assert.ok(result.issues.includes("required-adjudication-missing"), name);
      assert.deepEqual(result.statistics?.adjudication, {
        required: 1,
        completed: 0,
        rejectedInvalid: 2,
        completionRate: 0,
        finalLabelCounts: zeroFinalLabels,
      }, name);
    }

    assert.deepEqual(green.statistics?.adjudication, {
      required: 1,
      completed: 1,
      rejectedInvalid: 0,
      completionRate: 1,
      finalLabelCounts: { positive: 0, negative: 0, ambiguous: 0, abstain: 1, invalid_target: 0 },
    });
  });

  it("computes origin bootstrap intervals only when at least two complete origin clusters exist", () => {
    const bytes = Buffer.from('<svg id="root"><text id="first">First</text><text id="second">Second</text></svg>');
    const targets = enumerateSvgTextTargets(bytes, ["svg/text-clipped"]).map((target) => ({ ...target, documentId: `doc_${"2".repeat(32)}` }));
    const contexts = buildBlindContextArtifacts(bytes, "image/svg+xml", targets);
    const packet = buildBlindPacket({ packetId: "blind_packet_two_origins_0001", orderSeed: "annotation_two_origins_seed_0001", targets, contextsByTargetId: contexts.contextsByTargetId });
    const sessions = [
      { sessionId: "session_a_clusters_0001", annotatorOpaqueId: "annotator_a_clusters_0001", packetSha256: packet.packetSha256, startedAt: "2026-08-23T10:00:00Z", completedAt: "2026-08-23T10:30:00Z", findingExposed: false },
      { sessionId: "session_b_clusters_0001", annotatorOpaqueId: "annotator_b_clusters_0001", packetSha256: packet.packetSha256, startedAt: "2026-08-23T10:00:00Z", completedAt: "2026-08-23T10:30:00Z", findingExposed: false },
    ];
    const labels = ["positive", "negative"] as const;
    const annotations = sessions.flatMap((session, sessionIndex) => packet.targets.map((target, targetIndex) => ({
      sessionId: session.sessionId,
      blindTargetId: target.blindTargetId,
      ruleId: target.ruleId,
      label: labels[targetIndex]!,
      rationale: `Independent cluster annotation ${sessionIndex}-${targetIndex}.`,
      createdAt: `2026-08-23T10:2${sessionIndex}:00Z`,
    })));
    const originGroupByBlindTargetId = Object.fromEntries(packet.targets.map((target, index) => [target.blindTargetId, `origin_group_bootstrap_${index + 1}_0001`]));
    const result = validateAnnotationWorkflow({
      packet,
      sessions,
      annotations,
      adjudications: [],
      originGroupByBlindTargetId,
      statisticsPlan: { bootstrapIterations: 1000, bootstrapSeed: "annotation_two_origins_seed_0001", confidenceLevel: 0.95 },
    });
    assert.equal(result.structurallyValid, true);
    assert.equal(result.statistics?.originGroupCount, 2);
    assert.equal(result.statistics?.originGroupBootstrap.disposition, "computed");
    assert.deepEqual(result.statistics?.originGroupBootstrap.exactAgreement95Ci, [1, 1]);
    assert.equal(result.statistics?.annotatorPrevalence.annotatorA.prevalence.positive, 0.5);
    assert.equal(result.statistics?.annotatorPrevalence.annotatorB.prevalence.negative, 0.5);
  });

  it("requires two externally distinct identities and pre-reveal completion", () => {
    const result = validateAnnotationChronology({
      revealAt: "2026-08-23T12:00:00.000Z",
      sessions: [
        { sessionId: "session_annotator_a_0001", annotatorOpaqueId: "annotator_alpha_0001", packetSha256: SHA_A, startedAt: "2026-08-23T10:00:00.000Z", completedAt: "2026-08-23T10:30:00.000Z", findingExposed: false },
        { sessionId: "session_annotator_b_0001", annotatorOpaqueId: "annotator_beta_0001", packetSha256: SHA_A, startedAt: "2026-08-23T10:05:00.000Z", completedAt: "2026-08-23T10:40:00.000Z", findingExposed: false },
      ],
      identityBindings: [],
    });
    assert.equal(result.valid, false);
    assert.ok(result.issues.includes("real-identity-bindings-missing"));
  });

  it("blocks origin, duplicate, derivation, template and version leakage", () => {
    const documents = [
      { documentId: "doc_a", split: "development" as const, artifactSha256: SHA_A, originGroupId: "origin_a", duplicateGroupId: "duplicate_a", derivationGroupId: "derivation_a", templateGroupId: "template_a", versionGroupId: "version_a" },
      { documentId: "doc_b", split: "holdout" as const, artifactSha256: SHA_B, originGroupId: "origin_b", duplicateGroupId: "duplicate_b", derivationGroupId: "derivation_b", templateGroupId: "template_a", versionGroupId: "version_b" },
    ];
    const result = validateStrictSplits(documents);
    assert.equal(result.valid, false);
    assert.deepEqual(result.issues.map((issue) => issue.code), ["split-template-leakage"]);
  });

  it("observes a staged-private red control and a targeted ignored green correction", () => {
    const repo = mkdtempSync(join(tmpdir(), "breaklint-m3-1-git-"));
    execFileSync("git", ["init", "-q"], { cwd: repo });
    writeFileSync(join(repo, "private-document.svg"), "private bytes must never be staged");
    execFileSync("git", ["add", "private-document.svg"], { cwd: repo });
    const red = scanStagedPublicArtifacts(repo);
    assert.equal(red.valid, false);
    assert.deepEqual(red.disallowedPaths, ["private-document.svg"]);

    execFileSync("git", ["reset", "-q"], { cwd: repo });
    writeFileSync(join(repo, ".gitignore"), "private-document.svg\n");
    execFileSync("git", ["add", ".gitignore"], { cwd: repo });
    const green = scanStagedPublicArtifacts(repo);
    assert.equal(green.valid, true);
    assert.deepEqual(green.disallowedPaths, []);

    const classifiedRepo = mkdtempSync(join(tmpdir(), "breaklint-m3-1-content-classifier-"));
    execFileSync("git", ["init", "-q"], { cwd: classifiedRepo });
    const publicPath = join(classifiedRepo, "corpus/public/m3-1-pilot-v1");
    mkdirSync(publicPath, { recursive: true });
    writeFileSync(join(publicPath, "leaked.svg"), "<svg><text>private@example.test</text></svg>");
    execFileSync("git", ["add", "corpus/public/m3-1-pilot-v1/leaked.svg"], { cwd: classifiedRepo });
    const classified = scanStagedPublicArtifacts(classifiedRepo);
    assert.equal(classified.valid, false);
    assert.deepEqual(classified.disallowedPaths, []);
    assert.deepEqual(classified.contentFindings, [{ path: "corpus/public/m3-1-pilot-v1/leaked.svg", code: "email-address" }]);

    const alternateRepo = mkdtempSync(join(tmpdir(), "breaklint-m3-1-alternate-index-"));
    execFileSync("git", ["init", "-q"], { cwd: alternateRepo });
    mkdirSync(join(alternateRepo, "tests/tools/calibration"), { recursive: true });
    writeFileSync(join(alternateRepo, "CHANGELOG.md"), "M3-1 public infrastructure only.\n");
    writeFileSync(join(alternateRepo, "tests/tools/calibration/m3-1-code-canary.ts"), 'const canary = "gitleaks-canary@example.test";\n');
    execFileSync("git", ["add", "CHANGELOG.md", "tests/tools/calibration/m3-1-code-canary.ts"], { cwd: alternateRepo });
    assert.equal(scanStagedPublicArtifacts(alternateRepo).valid, true);
    mkdirSync(join(alternateRepo, "corpus/public/m3-1-pilot-v1/source-evidence"), { recursive: true });
    writeFileSync(join(alternateRepo, "corpus/public/m3-1-pilot-v1/source-evidence/leak.json"), '{"sourceLocator":"source_secret_bearer_0001"}\n');
    execFileSync("git", ["add", "corpus/public/m3-1-pilot-v1/source-evidence/leak.json"], { cwd: alternateRepo });
    const sensitiveLocator = scanStagedPublicArtifacts(alternateRepo);
    assert.equal(sensitiveLocator.valid, false);
    assert.ok(sensitiveLocator.contentFindings.some((finding) => finding.code === "sensitive-locator"));
  });

  it("changes the freeze hash on any holdout mutation", () => {
    const baseFreeze = {
      contractVersion: "m3-1-freeze-projection-v1" as const,
      holdoutId: "holdout_public_pilot_0001",
      purpose: "holdout-evaluation-preregistration" as const,
      createdAt: "2026-08-23T00:00:00Z",
      frozenAt: "2026-08-23T00:00:00Z",
      sequence: 1,
      previousFreezeSha256: null,
      blindPacketSha256: SHA_A,
      blindPacketBundle: { bundleId: "blind_bundle_freeze_0001", bundleIndexSha256: SHA_A, indexedFileCount: 2 },
      samplingPlanSha256: SHA_A,
      analysisPlanSha256: SHA_B,
      guidelineSha256ByRule: { "svg/text-clipped": SHA_A, "svg/text-ink-collision": SHA_A, "svg/text-overflows-viewport": SHA_A },
      renderer: { status: "blocked-missing-renderer-asset-freeze" as const, rendererFreezeSha256: null, assetManifestSha256: null },
      documents: [{
        documentId: `doc_${"1".repeat(32)}`,
        artifactSha256: SHA_A,
        split: "holdout" as const,
        groups: { originGroupId: "origin_group_freeze_0001", duplicateGroupId: "duplicate_group_freeze_0001", derivationGroupId: "derivation_group_freeze_0001", templateGroupId: "template_group_freeze_0001", versionGroupId: "version_group_freeze_0001" },
        source: { sourceLocator: "source_freeze_fixture_0001", sourceCapturedAt: "2026-08-23T00:00:00Z", sourceCaptureMode: "synthetic-fixture-construction" as const, firstPartySourceSnapshot: null, provenanceClass: "synthetic-first-party" as const, provenanceEvidenceSha256: SHA_A, rightsBasis: "first-party-founder-authorized" as const, rightsEvidenceSha256: SHA_A, privacyClass: "synthetic-no-personal-data" as const, privacyEvidenceSha256: SHA_A, founderAuthorizationSha256: null },
        targets: [{ targetId: `target_${"1".repeat(32)}`, ruleId: "svg/text-clipped" as const }],
      }],
    };
    const first = buildFreezeProjection(baseFreeze);
    const second = buildFreezeProjection({ ...baseFreeze, documents: baseFreeze.documents.map((document) => ({ ...document, targets: [...document.targets, { targetId: `target_${"2".repeat(32)}`, ruleId: "svg/text-clipped" as const }] })) });
    assert.notEqual(first.freezeSha256, second.freezeSha256);
    for (const mutation of [
      { ...baseFreeze, blindPacketSha256: "c".repeat(64) },
      { ...baseFreeze, blindPacketBundle: { ...baseFreeze.blindPacketBundle, bundleIndexSha256: "c".repeat(64) } },
      { ...baseFreeze, samplingPlanSha256: "c".repeat(64) },
      { ...baseFreeze, analysisPlanSha256: "c".repeat(64) },
      { ...baseFreeze, guidelineSha256ByRule: { ...baseFreeze.guidelineSha256ByRule, "svg/text-clipped": "c".repeat(64) } },
      { ...baseFreeze, createdAt: "2026-08-22T23:59:59Z" },
      { ...baseFreeze, frozenAt: "2026-08-23T00:00:01Z" },
      { ...baseFreeze, sequence: 2, previousFreezeSha256: "c".repeat(64) },
      { ...baseFreeze, documents: baseFreeze.documents.map((document) => ({ ...document, groups: { ...document.groups, originGroupId: "origin_group_freeze_mutated_0002" } })) },
      { ...baseFreeze, documents: baseFreeze.documents.map((document) => ({ ...document, source: { ...document.source, sourceCapturedAt: "2026-08-22T23:59:59Z" } })) },
      { ...baseFreeze, documents: baseFreeze.documents.map((document) => ({ ...document, source: { ...document.source, rightsEvidenceSha256: "c".repeat(64) } })) },
      { ...baseFreeze, documents: baseFreeze.documents.map((document) => ({ ...document, source: { ...document.source, privacyEvidenceSha256: "c".repeat(64) } })) },
    ]) assert.notEqual(first.freezeSha256, buildFreezeProjection(mutation).freezeSha256);
    assert.throws(() => buildFreezeProjection({ ...baseFreeze, renderer: { status: "ready", rendererFreezeSha256: SHA_A, assetManifestSha256: SHA_B } } as never), /unverified renderer material/u);
  });

  it("never trusts a free key or policy and keeps local fixtures claim-false", () => {
    const receipt = JSON.parse(readFileSync(new URL("../fixtures/calibration/m3-1/untrusted-holdout-freeze-receipt.json", import.meta.url), "utf8")) as Record<string, unknown>;
    receipt.publicKey = "freely supplied key";
    const proofBytes = readFileSync(new URL("../fixtures/calibration/m3-1/untrusted-external-attestation-proof.json", import.meta.url));
    const result = verifyExternalTrust({ subjectPath: "/does/not/exist", expectedSubjectSha256: SHA_A, receiptBytes: Buffer.from(JSON.stringify(receipt)), proofBytes, ...INITIAL_TRUST_BASELINE });
    assert.equal(result.trusted, false);
    assert.ok(result.issues.includes("producer-supplied-trust-material"));
    assert.ok(result.issues.includes("freeze-receipt-schema-invalid"));
  });

  it("adapts full receipt/proof artifacts and rejects identity substitution, replay, rollback and untrusted evidence", () => {
    const root = mkdtempSync(join(tmpdir(), "breaklint-m3-1-trust-"));
    const subjectPath = join(root, "freeze.json");
    const bundlePath = join(root, "attestation.jsonl");
    writeFileSync(subjectPath, "frozen subject bytes");
    writeFileSync(bundlePath, "{}\n");
    const digest = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
    const subjectSha256 = digest(subjectPath);
    const fixtureReceipt = JSON.parse(readFileSync(new URL("../fixtures/calibration/m3-1/untrusted-holdout-freeze-receipt.json", import.meta.url), "utf8")) as ExternalFreezeReceipt;
    const fixtureProof = JSON.parse(readFileSync(new URL("../fixtures/calibration/m3-1/untrusted-external-attestation-proof.json", import.meta.url), "utf8")) as ExternalAttestationProof;
    const encode = (receipt: ExternalFreezeReceipt, proof: ExternalAttestationProof): { receiptBytes: Buffer; proofBytes: Buffer } => {
      proof.subject.subjectSha256 = subjectSha256;
      proof.verificationMaterial.bundleSha256 = digest(bundlePath);
      proof.serialNumber = receipt.serialNumber;
      receipt.subject.subjectSha256 = subjectSha256;
      const proofBytes = Buffer.from(JSON.stringify(proof));
      receipt.externalAttestationProofSha256 = createHash("sha256").update(proofBytes).digest("hex");
      return { receiptBytes: Buffer.from(JSON.stringify(receipt)), proofBytes };
    };
    const base = encode(structuredClone(fixtureReceipt), structuredClone(fixtureProof));
    const untrusted = verifyExternalTrust({ subjectPath, expectedSubjectSha256: subjectSha256, ...base, bundlePath, ...INITIAL_TRUST_BASELINE });
    assert.equal(untrusted.trusted, false);
    assert.ok(untrusted.issues.includes("freeze-receipt-not-externally-verified"));
    assert.ok(untrusted.issues.includes("attestation-proof-not-externally-verified"));
    assert.ok(untrusted.issues.includes("unknown-trust-policy"));

    const substitutedProof = structuredClone(fixtureProof);
    substitutedProof.workflowIdentity.repository = "attacker/substituted";
    const identitySubstitution = verifyExternalTrust({ subjectPath, expectedSubjectSha256: subjectSha256, ...encode(structuredClone(fixtureReceipt), substitutedProof), bundlePath, ...INITIAL_TRUST_BASELINE });
    assert.ok(identitySubstitution.issues.includes("attestor-identity-substitution"));

    const callerRootReceipt = structuredClone(fixtureReceipt) as ExternalFreezeReceipt & { customTrustedRoot: string };
    callerRootReceipt.customTrustedRoot = "/caller/controlled/root.jsonl";
    const callerRoot = verifyExternalTrust({ subjectPath, expectedSubjectSha256: subjectSha256, ...encode(callerRootReceipt, structuredClone(fixtureProof)), bundlePath, ...INITIAL_TRUST_BASELINE });
    assert.ok(callerRoot.issues.includes("producer-supplied-trust-material"));
    assert.ok(callerRoot.issues.includes("freeze-receipt-schema-invalid"));

    const sourceReceipt = structuredClone(fixtureReceipt);
    const sourceProof = structuredClone(fixtureProof);
    sourceReceipt.workflowIdentity.commitSha = "d".repeat(40);
    sourceProof.workflowIdentity.commitSha = "e".repeat(40);
    const sourceSubstitution = verifyExternalTrust({ subjectPath, expectedSubjectSha256: subjectSha256, ...encode(sourceReceipt, sourceProof), bundlePath, ...INITIAL_TRUST_BASELINE });
    assert.ok(sourceSubstitution.issues.includes("source-digest-substitution"));

    const callerRevocationReceipt = structuredClone(fixtureReceipt) as ExternalFreezeReceipt & { revocations: never[] };
    callerRevocationReceipt.revocations = [];
    const callerRevocation = verifyExternalTrust({ subjectPath, expectedSubjectSha256: subjectSha256, ...encode(callerRevocationReceipt, structuredClone(fixtureProof)), bundlePath, ...INITIAL_TRUST_BASELINE });
    assert.ok(callerRevocation.issues.includes("producer-supplied-trust-material"));
    assert.ok(callerRevocation.issues.includes("freeze-receipt-schema-invalid"));

    const previousAccepted = {
      receiptSha256: createHash("sha256").update(base.receiptBytes).digest("hex"),
      proofSha256: createHash("sha256").update(base.proofBytes).digest("hex"),
      sequence: 1,
      checkpointSha256: fixtureReceipt.transparencyCheckpoint.checkpointSha256 as string,
      integratedAt: fixtureReceipt.transparencyCheckpoint.integratedAt as string,
    };
    const replay = verifyExternalTrust({ subjectPath, expectedSubjectSha256: subjectSha256, ...base, bundlePath, previousAccepted, evaluationStartedAt: INITIAL_TRUST_BASELINE.evaluationStartedAt });
    assert.ok(replay.issues.includes("receipt-replay-or-sequence-rollback"));
    assert.ok(replay.issues.includes("checkpoint-rollback"));

    const rollbackReceipt = structuredClone(fixtureReceipt);
    const rollbackProof = structuredClone(fixtureProof);
    rollbackReceipt.sequence = 2;
    rollbackProof.sequence = 2;
    rollbackReceipt.previousReceiptSha256 = previousAccepted.receiptSha256;
    rollbackProof.previousProofSha256 = previousAccepted.proofSha256;
    rollbackReceipt.previousCheckpointSha256 = "d".repeat(64);
    rollbackProof.previousCheckpointSha256 = "d".repeat(64);
    rollbackReceipt.transparencyCheckpoint.integratedAt = "2026-08-23T00:00:02Z";
    rollbackProof.transparencyCheckpoint.integratedAt = "2026-08-23T00:00:02Z";
    const rollback = verifyExternalTrust({ subjectPath, expectedSubjectSha256: subjectSha256, ...encode(rollbackReceipt, rollbackProof), bundlePath, previousAccepted, evaluationStartedAt: INITIAL_TRUST_BASELINE.evaluationStartedAt });
    assert.ok(rollback.issues.includes("checkpoint-rollback"));
    assert.equal(rollback.issues.includes("receipt-replay-or-sequence-rollback"), false);

    const externallyClaimedReceipt = structuredClone(fixtureReceipt);
    const externallyClaimedProof = structuredClone(fixtureProof);
    const workflowIdentity = {
      issuer: PINNED_M3_1_TRUST_POLICY.allowedWorkflowIdentities[0]!.issuer,
      subject: "repo:godarg/breaklint:ref:refs/heads/main",
      repository: PINNED_M3_1_TRUST_POLICY.allowedWorkflowIdentities[0]!.repository,
      workflowPath: ".github/workflows/m3-1-attest.yml",
      workflowRef: PINNED_M3_1_TRUST_POLICY.allowedWorkflowIdentities[0]!.workflowRef,
      commitSha: "e".repeat(40),
      runId: "1000002",
      runAttempt: 1,
    };
    externallyClaimedReceipt.workflowIdentity = workflowIdentity;
    externallyClaimedProof.workflowIdentity = { ...workflowIdentity, oidcAudience: "sigstore" };
    externallyClaimedReceipt.trustPolicyId = PINNED_M3_1_TRUST_POLICY.policyId;
    externallyClaimedProof.trustPolicyId = PINNED_M3_1_TRUST_POLICY.policyId;
    externallyClaimedReceipt.trustPolicySha256 = PINNED_M3_1_TRUST_POLICY_SHA256;
    externallyClaimedProof.trustPolicySha256 = PINNED_M3_1_TRUST_POLICY_SHA256;
    externallyClaimedReceipt.holdoutFreezeExternalValid = true;
    externallyClaimedReceipt.evidenceTrust = "externally-verified";
    externallyClaimedProof.evidenceTrust = "externally-verified";
    externallyClaimedProof.signatureCryptographicallyVerified = true;
    externallyClaimedProof.subjectBindingVerified = true;
    externallyClaimedProof.workflowIdentityVerified = true;
    externallyClaimedProof.trustPolicyMatched = true;
    externallyClaimedProof.lifecycleValid = true;
    externallyClaimedProof.replayCheckPassed = true;
    externallyClaimedProof.rollbackCheckPassed = true;
    const encodedExternalClaim = encode(externallyClaimedReceipt, externallyClaimedProof);
    const fakeCrypto = verifyExternalTrust({ subjectPath, expectedSubjectSha256: subjectSha256, ...encodedExternalClaim, bundlePath, ...INITIAL_TRUST_BASELINE });
    assert.equal(fakeCrypto.trusted, false);
    assert.equal(fakeCrypto.cryptographicallyVerified, false);
    assert.ok(fakeCrypto.issues.includes("github-attestation-cryptographic-verification-failed"));
    assert.ok(fakeCrypto.issues.includes("external-trust-policy-not-independently-anchored"));

    const forgedWrapperAroundCryptoSuccess = verifyExternalTrust(
      { subjectPath, expectedSubjectSha256: subjectSha256, ...encodedExternalClaim, bundlePath, ...INITIAL_TRUST_BASELINE },
      {
        runGithubAttestationVerification: () => JSON.stringify([{
          verificationResult: {
            verifiedTimestamps: [{ type: "transparency-log" }],
            statement: { subject: [{ digest: { sha256: subjectSha256 } }] },
          },
        }]),
      },
    );
    assert.equal(forgedWrapperAroundCryptoSuccess.cryptographicallyVerified, true);
    assert.equal(forgedWrapperAroundCryptoSuccess.trusted, false);
    assert.ok(forgedWrapperAroundCryptoSuccess.issues.includes("external-trust-policy-not-independently-anchored"));
    assert.ok(forgedWrapperAroundCryptoSuccess.issues.includes("verified-bundle-timestamp-independent-derivation-missing"));
    assert.ok(forgedWrapperAroundCryptoSuccess.issues.includes("independent-replay-state-missing"));
    assert.ok(forgedWrapperAroundCryptoSuccess.issues.includes("independent-rollback-state-missing"));

    const omittedBaseline = verifyExternalTrust({ subjectPath, expectedSubjectSha256: subjectSha256, ...encode(externallyClaimedReceipt, externallyClaimedProof), bundlePath } as never);
    assert.ok(omittedBaseline.issues.includes("previous-accepted-baseline-omitted"));
    assert.ok(omittedBaseline.issues.includes("evaluation-started-at-required"));

    const validatePolicy = compileSchema("attestor-trust-policy-v1");
    assert.equal(validatePolicy(PINNED_M3_1_TRUST_POLICY), true, JSON.stringify(validatePolicy.errors));
    assert.equal(PINNED_M3_1_TRUST_POLICY.policyStatus, "untrusted");
    assert.equal(PINNED_M3_1_TRUST_POLICY.evidenceTrust, "untrusted");
    assert.equal(PINNED_M3_1_TRUST_POLICY.externalPolicyPinPresent, false);
    assert.equal(PINNED_M3_1_TRUST_POLICY.governanceSource.externallyGoverned, false);
    assert.equal(PINNED_M3_1_TRUST_POLICY.governanceSource.sourceSha256, null);
    assert.equal(validatePolicy({ ...PINNED_M3_1_TRUST_POLICY, allowSelfProvidedTrustRoot: true }), false);
    assert.equal(validatePolicy({ ...PINNED_M3_1_TRUST_POLICY, allowedWorkflowIdentities: [{ ...PINNED_M3_1_TRUST_POLICY.allowedWorkflowIdentities[0]!, trustRootProvider: "caller-root" }] }), false);

    const omittedCliInput = join(root, "omitted-baseline-input.json");
    writeFileSync(omittedCliInput, JSON.stringify({ subjectPath, expectedSubjectSha256: subjectSha256, receiptPath: new URL("../fixtures/calibration/m3-1/untrusted-holdout-freeze-receipt.json", import.meta.url).pathname, proofPath: new URL("../fixtures/calibration/m3-1/untrusted-external-attestation-proof.json", import.meta.url).pathname }));
    const omittedCli = spawnSync(process.execPath, ["--experimental-strip-types", "tests/tools/calibration/m3-1-pilot-cli.ts", "trust-check", omittedCliInput], { cwd: new URL("../../", import.meta.url), encoding: "utf8" });
    assert.equal(omittedCli.status, 2);
    assert.match(omittedCli.stderr, /previousAccepted must be present/u);

  });

  it("emits a deterministic blocked pilot report without calibration claims", () => {
    const input = {
      pilotId: "pilot_public_untrusted_0001",
      createdAt: "2026-08-23T00:00:00.000Z",
      manifestReference: { artifactId: "intake_manifest_public_untrusted_0001", artifactSha256: SHA_A, artifactContractVersion: "m3-1-public-intake-manifest-v1" as const },
      samplingPlanId: "sampling_public_untrusted_0001",
      samplingPlanSha256: SHA_B,
      artifactCount: 1,
      realDocumentCount: 0,
      originGroupCount: 1,
      sourceGateValid: true,
      annotationGateValid: false,
      splitGateValid: true,
      externalFreezeValid: false,
      externalTrustValid: false,
      captureEvidenceValid: false,
    };
    const first = buildPilotReport(input);
    const second = buildPilotReport(input);
    assert.deepEqual(first, second);
    assert.equal(first.executionStatus, "infrastructure-complete-external-execution-blocked");
    assert.equal(first.claims.captureAttestorTrustValid, false);
    assert.equal(first.claims.ruleReadyForCalibratedClaim, false);
    assert.equal(first.claims.calibrated, false);
    const validate = compileSchema("m3-1-pilot-report-v1");
    assert.equal(validate(first), true, JSON.stringify(validate.errors));
  });

  it("compiles all M3-1 schemas and accepts only their untrusted technical fixtures", () => {
    const fixtures = [
      ["sampling-plan-v1", "untrusted-sampling-plan.json"],
      ["annotation-session-v1", "untrusted-annotation-session.json"],
      ["identity-binding-v1", "untrusted-identity-binding.json"],
      ["public-intake-manifest-v1", "untrusted-public-intake-manifest.json"],
      ["holdout-freeze-receipt-v1", "untrusted-holdout-freeze-receipt.json"],
      ["attestor-trust-policy-v1", "untrusted-attestor-trust-policy.json"],
      ["external-attestation-proof-v1", "untrusted-external-attestation-proof.json"],
      ["m3-1-pilot-report-v1", "untrusted-pilot-report.json"],
    ] as const;
    for (const [schemaName, fixtureName] of fixtures) {
      const validate = compileSchema(schemaName);
      const fixture = JSON.parse(readFileSync(new URL(`../fixtures/calibration/m3-1/${fixtureName}`, import.meta.url), "utf8")) as object;
      assert.equal(validate(fixture), true, `${schemaName}: ${JSON.stringify(validate.errors)}`);
    }
  });
});
