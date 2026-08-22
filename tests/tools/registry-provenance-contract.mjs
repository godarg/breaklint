#!/usr/bin/env node

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

const SLSA_PREDICATE = "https://slsa.dev/provenance/v1";
const GITHUB_BUILD_TYPE =
  "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1";

function decodeSlsaStatement(attestations) {
  const entry = attestations.attestations?.find(
    (candidate) => candidate.predicateType === SLSA_PREDICATE,
  );
  assert.ok(entry, "SLSA provenance entry is absent");
  assert.equal(entry.bundle?.dsseEnvelope?.payloadType, "application/vnd.in-toto+json");
  return JSON.parse(
    Buffer.from(entry.bundle.dsseEnvelope.payload, "base64").toString("utf8"),
  );
}

function sriToHex(sri) {
  assert.match(sri, /^sha512-[A-Za-z0-9+/]+={0,2}$/u, "expected a SHA-512 SRI");
  return Buffer.from(sri.slice("sha512-".length), "base64").toString("hex");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export function verifyRegistryProvenance(metadata, attestations, expected) {
  assert.equal(metadata.version, expected.version, "registry version differs");
  assert.equal(metadata["dist.integrity"], expected.sri, "registry SRI differs");
  if (metadata.gitHead !== undefined) {
    assert.equal(metadata.gitHead, expected.commit, "registry gitHead contradicts provenance");
  }
  assert.equal(
    metadata["dist.attestations"]?.provenance?.predicateType,
    SLSA_PREDICATE,
    "registry metadata does not advertise SLSA provenance",
  );
  const attestationUrl = new URL(metadata["dist.attestations"]?.url ?? "");
  assert.equal(attestationUrl.protocol, "https:");
  assert.equal(attestationUrl.hostname, "registry.npmjs.org");
  assert.equal(
    attestationUrl.pathname,
    `/-/npm/v1/attestations/${expected.packageName}@${expected.version}`,
    "registry attestation URL path differs",
  );

  const statement = decodeSlsaStatement(attestations);
  assert.equal(statement._type, "https://in-toto.io/Statement/v1");
  assert.equal(statement.predicateType, SLSA_PREDICATE);
  const subject = statement.subject?.find(
    (candidate) => candidate.name === `pkg:npm/${expected.packageName}@${expected.version}`,
  );
  assert.ok(subject, "provenance has no subject for the expected npm package");
  assert.equal(subject.digest?.sha512, sriToHex(expected.sri), "attested package digest differs");

  const buildDefinition = statement.predicate?.buildDefinition;
  assert.equal(buildDefinition?.buildType, GITHUB_BUILD_TYPE);
  const workflow = buildDefinition.externalParameters?.workflow;
  assert.equal(workflow?.repository, expected.repository, "attested repository differs");
  assert.equal(workflow?.ref, expected.ref, "attested Git ref differs");
  assert.equal(workflow?.path, expected.workflowPath, "attested workflow path differs");

  const source = buildDefinition.resolvedDependencies?.find(
    (candidate) => candidate.digest?.gitCommit,
  );
  assert.ok(source, "provenance has no resolved Git dependency");
  assert.equal(source.uri, `git+${expected.repository}@${expected.ref}`, "attested source URI differs");
  assert.equal(source.digest.gitCommit, expected.commit, "attested Git commit differs");
  assert.equal(
    statement.predicate?.runDetails?.builder?.id,
    "https://github.com/actions/runner/github-hosted",
    "attested builder differs",
  );
  assert.match(
    statement.predicate?.runDetails?.metadata?.invocationId ?? "",
    new RegExp(`^${escapeRegExp(expected.repository)}/actions/runs/[0-9]+/attempts/[0-9]+$`, "u"),
    "attested invocation is not a GitHub Actions run for the expected repository",
  );

  return { packageDigest: subject.digest.sha512, gitCommit: source.digest.gitCommit };
}

function fixture(expected) {
  const statement = {
    _type: "https://in-toto.io/Statement/v1",
    subject: [
      {
        name: `pkg:npm/${expected.packageName}@${expected.version}`,
        digest: { sha512: sriToHex(expected.sri) },
      },
    ],
    predicateType: SLSA_PREDICATE,
    predicate: {
      buildDefinition: {
        buildType: GITHUB_BUILD_TYPE,
        externalParameters: {
          workflow: {
            repository: expected.repository,
            ref: expected.ref,
            path: expected.workflowPath,
          },
        },
        resolvedDependencies: [
          {
            uri: `git+${expected.repository}@${expected.ref}`,
            digest: { gitCommit: expected.commit },
          },
        ],
      },
      runDetails: {
        builder: { id: "https://github.com/actions/runner/github-hosted" },
        metadata: { invocationId: `${expected.repository}/actions/runs/123/attempts/1` },
      },
    },
  };
  return {
    metadata: {
      version: expected.version,
      "dist.integrity": expected.sri,
      "dist.attestations": {
        url: `https://registry.npmjs.org/-/npm/v1/attestations/${expected.packageName}@${expected.version}`,
        provenance: { predicateType: SLSA_PREDICATE },
      },
      // Intentionally no gitHead: npm omits it when `npm publish` receives a tarball.
    },
    attestations: {
      attestations: [
        {
          predicateType: SLSA_PREDICATE,
          bundle: {
            dsseEnvelope: {
              payloadType: "application/vnd.in-toto+json",
              payload: Buffer.from(JSON.stringify(statement)).toString("base64"),
            },
          },
        },
      ],
    },
  };
}

function runSelfTest() {
  const expected = {
    packageName: "breaklint",
    version: "0.2.0",
    sri: `sha512-${Buffer.alloc(64, 0xa5).toString("base64")}`,
    commit: "0123456789abcdef0123456789abcdef01234567",
    repository: "https://github.com/godarg/breaklint",
    ref: "refs/tags/v0.2.0",
    workflowPath: ".github/workflows/release.yml",
  };
  const good = fixture(expected);
  verifyRegistryProvenance(good.metadata, good.attestations, expected);

  const wrongCommit = structuredClone(good);
  const statement = decodeSlsaStatement(wrongCommit.attestations);
  statement.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit = "f".repeat(40);
  wrongCommit.attestations.attestations[0].bundle.dsseEnvelope.payload = Buffer.from(
    JSON.stringify(statement),
  ).toString("base64");
  assert.throws(
    () => verifyRegistryProvenance(wrongCommit.metadata, wrongCommit.attestations, expected),
    /attested Git commit differs/u,
  );

  const wrongBytes = structuredClone(good);
  wrongBytes.metadata["dist.integrity"] = `sha512-${Buffer.alloc(64, 0x5a).toString("base64")}`;
  assert.throws(
    () => verifyRegistryProvenance(wrongBytes.metadata, wrongBytes.attestations, expected),
    /registry SRI differs/u,
  );

  const wrongSubject = structuredClone(good);
  const wrongSubjectStatement = decodeSlsaStatement(wrongSubject.attestations);
  wrongSubjectStatement.subject[0].digest.sha512 = "5a".repeat(64);
  wrongSubject.attestations.attestations[0].bundle.dsseEnvelope.payload = Buffer.from(
    JSON.stringify(wrongSubjectStatement),
  ).toString("base64");
  assert.throws(
    () => verifyRegistryProvenance(wrongSubject.metadata, wrongSubject.attestations, expected),
    /attested package digest differs/u,
  );

  const contradictoryGitHead = structuredClone(good);
  contradictoryGitHead.metadata.gitHead = "f".repeat(40);
  assert.throws(
    () =>
      verifyRegistryProvenance(
        contradictoryGitHead.metadata,
        contradictoryGitHead.attestations,
        expected,
      ),
    /registry gitHead contradicts provenance/u,
  );
  process.stdout.write(
    "registry provenance: absent gitHead accepted only with exact SRI, signed subject and Git commit\n",
  );
}

function expectedFromEnvironment() {
  const required = (name) => {
    const value = process.env[name];
    assert.ok(value, `${name} is required`);
    return value;
  };
  return {
    packageName: required("EXPECTED_PACKAGE_NAME"),
    version: required("EXPECTED_VERSION"),
    sri: required("EXPECTED_SRI"),
    commit: required("EXPECTED_COMMIT"),
    repository: required("EXPECTED_REPOSITORY_URL"),
    ref: required("EXPECTED_REF"),
    workflowPath: required("EXPECTED_WORKFLOW_PATH"),
  };
}

const [mode, metadataPath, attestationsPath] = process.argv.slice(2);
if (mode === "--self-test" && process.argv.length === 3) {
  runSelfTest();
} else if (mode === "--verify" && metadataPath && attestationsPath && process.argv.length === 5) {
  const result = verifyRegistryProvenance(
    JSON.parse(readFileSync(metadataPath, "utf8")),
    JSON.parse(readFileSync(attestationsPath, "utf8")),
    expectedFromEnvironment(),
  );
  process.stdout.write(
    `registry provenance: package digest and Git commit ${result.gitCommit} verified\n`,
  );
} else {
  process.stderr.write(
    "usage: registry-provenance-contract.mjs --self-test | --verify <metadata.json> <attestations.json>\n",
  );
  process.exitCode = 2;
}
