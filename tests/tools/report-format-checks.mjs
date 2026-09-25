#!/usr/bin/env node
/**
 * Shape checks for the three projections the GitHub Action publishes: SARIF, JUnit and Markdown.
 *
 * SARIF is validated against the SARIF 2.1.0 JSON schema vendored under
 * `tests/fixtures/sarif-schema/` (source, licence and digest in the README there). The schema is
 * test-only: it is never shipped and never fetched, so this check needs no network. Its bytes are
 * verified against the recorded digest before it is used, and the one normative constraint of the
 * OASIS errata01 schema that this copy lacks (a region must carry `startLine`, `charOffset` or
 * `byteOffset`) is restored in memory, never in the vendored file.
 *
 * JUnit has no normative schema that every consumer agrees on, so it gets a structural check with
 * no XSD: a well-formed XML document with a `testsuites` root, integer counters, and failure
 * counts that equal the `<failure>` elements they count. Markdown gets the verdict line.
 *
 * Used by `tests/unit/report-formats.test.ts` and, through the CLI below, by the `action` job in
 * `.github/workflows/ci.yml` on the files the real Action wrote.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

export const SARIF_SCHEMA_PATH = fileURLToPath(new URL("../fixtures/sarif-schema/sarif-2.1.0.json", import.meta.url));
export const SARIF_SCHEMA_SHA256 = "0de6555c956d0e2081bb40f0b877f275634cba28a6f8954e6d858a49138143d6";

/** The run verdicts a report can carry, as the Markdown reporter prints them. */
export const RUN_VERDICTS = Object.freeze(["clean", "findings", "usage", "infrastructure", "insufficient-coverage"]);

// JSON-schema formats the SARIF schema uses. Ajv knows none of them without ajv-formats, which is
// not a dependency here, and an unknown format would otherwise be ignored in silence.
const UNRESERVED_OR_RESERVED = String.raw`(?:[A-Za-z0-9\-._~!$&'()*+,;=:@/?\[\]]|%[0-9A-Fa-f]{2})`;
const URI = new RegExp(String.raw`^[A-Za-z][A-Za-z0-9+.\-]*:${UNRESERVED_OR_RESERVED}*(?:#${UNRESERVED_OR_RESERVED}*)?$`, "u");
const RELATIVE_REF = new RegExp(String.raw`^${UNRESERVED_OR_RESERVED}*(?:#${UNRESERVED_OR_RESERVED}*)?$`, "u");

function isUri(value) {
  return URI.test(value) && (value.match(/#/gu) ?? []).length <= 1;
}

function isUriReference(value) {
  if (/^[A-Za-z][A-Za-z0-9+.\-]*:/u.test(value)) return isUri(value);
  // RFC 3986 4.2: in a relative-path reference the first segment may not contain a colon.
  const firstSegment = value.split(/[/?#]/u)[0] ?? "";
  return !firstSegment.includes(":") && RELATIVE_REF.test(value) && (value.match(/#/gu) ?? []).length <= 1;
}

function isDateTime(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:[Zz]|[+-](\d{2}):(\d{2}))$/u.exec(value);
  if (!match) return false;
  const [, , month, day, hour, minute, second, offsetHour, offsetMinute] = match.map(Number);
  return month >= 1 && month <= 12 && day >= 1 && day <= 31 && hour <= 23 && minute <= 59 && second <= 60 &&
    (Number.isNaN(offsetHour) || (offsetHour <= 23 && offsetMinute <= 59));
}

// The normative OASIS schema spells GUIDs as this pattern (version 1-5, RFC 4122 variant).
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/u;

let compiled = null;

/** The SARIF 2.1.0 validator, built once. Throws if the vendored schema's bytes have changed. */
export function sarifValidator() {
  if (compiled) return compiled;
  const bytes = readFileSync(SARIF_SCHEMA_PATH);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== SARIF_SCHEMA_SHA256) {
    throw new Error(`the vendored SARIF schema is not the recorded one: sha256 ${digest}, expected ${SARIF_SCHEMA_SHA256}`);
  }
  const schema = JSON.parse(bytes.toString("utf8"));
  // The OASIS errata01 constraint this copy lacks. Added to the in-memory schema only.
  schema.definitions.region.anyOf = [{ required: ["startLine"] }, { required: ["charOffset"] }, { required: ["byteOffset"] }];
  const Ajv2020 = require("ajv/dist/2020").default;
  // `strictRequired` is the schema's own authoring style (anyOf branches naming properties
  // declared one level up), not a leniency towards the document; every other strict check stays.
  const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true });
  ajv.addFormat("uri", isUri);
  ajv.addFormat("uri-reference", isUriReference);
  ajv.addFormat("date-time", isDateTime);
  ajv.addFormat("uuid", (value) => UUID.test(value));
  compiled = ajv.compile(schema);
  return compiled;
}

/** Every schema violation of one SARIF log, as readable lines. Empty means valid. */
export function sarifProblems(document) {
  const validate = sarifValidator();
  if (validate(document)) return [];
  return (validate.errors ?? []).map((error) => `${error.instancePath || "/"} ${error.message}${error.params ? ` ${JSON.stringify(error.params)}` : ""}`);
}

// ---------------------------------------------------------------------------------------------
// JUnit, without an XSD.

const XML_FORBIDDEN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/u;
const ENTITY = /&(?:amp|lt|gt|quot|apos|#[0-9]+|#x[0-9A-Fa-f]+);/gu;

function checkText(text, where, problems) {
  if (XML_FORBIDDEN.test(text)) problems.push(`${where}: a character XML 1.0 forbids`);
  if (/&/u.test(text.replace(ENTITY, ""))) problems.push(`${where}: an unescaped '&'`);
  if (/</u.test(text)) problems.push(`${where}: an unescaped '<'`);
}

/** A small, strict XML reader: elements, double-quoted attributes, text. Enough for this format. */
function parseXml(xml, problems) {
  const root = { name: "#document", attributes: {}, children: [], text: "" };
  const stack = [root];
  let at = 0;
  const declaration = /^<\?xml version="1\.0" encoding="UTF-8"\?>\n?/u.exec(xml);
  if (!declaration) problems.push('missing <?xml version="1.0" encoding="UTF-8"?> declaration');
  else at = declaration[0].length;
  while (at < xml.length) {
    const open = xml.indexOf("<", at);
    const text = xml.slice(at, open === -1 ? xml.length : open);
    if (text.trim() !== "") {
      checkText(text, `text in <${stack.at(-1).name}>`, problems);
      stack.at(-1).text += text;
    }
    if (open === -1) break;
    const close = xml.indexOf(">", open);
    if (close === -1) {
      problems.push(`unterminated tag at offset ${open}`);
      break;
    }
    const tag = xml.slice(open + 1, close);
    at = close + 1;
    if (tag.startsWith("/")) {
      const name = tag.slice(1).trim();
      const top = stack.pop();
      if (!top || top === root || top.name !== name) {
        problems.push(`closing </${name}> does not match <${top?.name ?? "nothing"}>`);
        return root;
      }
      continue;
    }
    const selfClosing = tag.endsWith("/");
    const body = selfClosing ? tag.slice(0, -1) : tag;
    const nameMatch = /^([A-Za-z_][\w.-]*)/u.exec(body);
    if (!nameMatch) {
      problems.push(`malformed tag <${tag}>`);
      return root;
    }
    const element = { name: nameMatch[1], attributes: {}, children: [], text: "" };
    let rest = body.slice(nameMatch[1].length);
    const attribute = /^\s+([A-Za-z_][\w.-]*)="([^"]*)"/u;
    for (let m = attribute.exec(rest); m; m = attribute.exec(rest)) {
      if (Object.hasOwn(element.attributes, m[1])) problems.push(`<${element.name}> repeats attribute ${m[1]}`);
      checkText(m[2], `<${element.name} ${m[1]}>`, problems);
      element.attributes[m[1]] = m[2];
      rest = rest.slice(m[0].length);
    }
    if (rest.trim() !== "") problems.push(`<${element.name}> has malformed attributes: ${rest.trim().slice(0, 60)}`);
    stack.at(-1).children.push(element);
    if (!selfClosing) stack.push(element);
  }
  if (stack.length > 1) problems.push(`unclosed <${stack.slice(1).map((e) => e.name).join("> <")}>`);
  return root;
}

const count = (element, name) =>
  element.children.reduce((sum, child) => sum + (child.name === name ? 1 : 0) + count(child, name), 0);

function integerAttribute(element, name, problems) {
  const raw = element.attributes[name];
  if (raw === undefined || !/^\d+$/u.test(raw)) {
    problems.push(`<${element.name}${element.attributes.name ? ` name="${element.attributes.name}"` : ""}> ${name}="${raw ?? ""}" is not a non-negative integer`);
    return null;
  }
  return Number(raw);
}

/** Structural problems of one JUnit document. Empty means it has the shape CI readers expect. */
export function junitProblems(xml) {
  const problems = [];
  const document = parseXml(xml, problems);
  if (problems.length > 0) return problems;
  if (document.children.length !== 1 || document.children[0].name !== "testsuites") {
    return [`the root element must be one <testsuites>, got ${document.children.map((c) => `<${c.name}>`).join(" ") || "nothing"}`];
  }
  const suites = document.children[0];
  integerAttribute(suites, "tests", problems);
  const rootFailures = integerAttribute(suites, "failures", problems);
  if (suites.attributes.time !== undefined && !/^\d+(?:\.\d+)?$/u.test(suites.attributes.time)) {
    problems.push(`<testsuites> time="${suites.attributes.time}" is not a number of seconds`);
  }
  if (rootFailures !== null && rootFailures !== count(suites, "failure")) {
    problems.push(`<testsuites> failures="${rootFailures}" but the document holds ${count(suites, "failure")} <failure> element(s)`);
  }
  for (const child of suites.children) {
    if (child.name === "properties") {
      for (const property of child.children) {
        if (property.name !== "property" || property.attributes.name === undefined || property.attributes.value === undefined) {
          problems.push(`<properties> may hold only <property name value>, got <${property.name}>`);
        }
      }
      continue;
    }
    if (child.name !== "testsuite") {
      problems.push(`<testsuites> may hold <properties> and <testsuite>, got <${child.name}>`);
      continue;
    }
    if (!child.attributes.name) problems.push("a <testsuite> has no name");
    integerAttribute(child, "tests", problems);
    const failures = integerAttribute(child, "failures", problems);
    if (failures !== null && failures !== count(child, "failure")) {
      problems.push(`<testsuite name="${child.attributes.name}"> failures="${failures}" but holds ${count(child, "failure")} <failure> element(s)`);
    }
    for (const testcase of child.children) {
      if (testcase.name !== "testcase") {
        problems.push(`<testsuite> may hold only <testcase>, got <${testcase.name}>`);
        continue;
      }
      if (testcase.attributes.name === undefined || testcase.attributes.classname === undefined) {
        problems.push("a <testcase> lacks name or classname");
      }
      for (const inner of testcase.children) {
        if (!["failure", "skipped", "system-out", "error"].includes(inner.name)) {
          problems.push(`<testcase> may hold failure, skipped, error or system-out, got <${inner.name}>`);
        }
      }
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------
// Markdown.

/** The verdict line the Markdown reporter opens with, and its agreement with the counter table. */
export function markdownProblems(markdown, expectedVerdict) {
  const problems = [];
  const first = markdown.split("\n", 1)[0] ?? "";
  const match = /^# breaklint — ([a-z-]+)$/u.exec(first);
  if (!match) return [`the first line is not the verdict line "# breaklint — <verdict>": ${JSON.stringify(first.slice(0, 80))}`];
  const verdict = match[1];
  if (!RUN_VERDICTS.includes(verdict)) problems.push(`"${verdict}" is not a run verdict`);
  if (expectedVerdict !== undefined && verdict !== expectedVerdict) problems.push(`verdict line says "${verdict}", expected "${expectedVerdict}"`);
  if (!markdown.includes(`| verdict | ${verdict} |`)) problems.push("the counter table does not repeat the verdict of the first line");
  if (!/^## Coverage$/mu.test(markdown)) problems.push("no ## Coverage section");
  return problems;
}

// ---------------------------------------------------------------------------------------------
// CLI: node tests/tools/report-format-checks.mjs [--sarif f]... [--junit f]... [--markdown f [--verdict v]]...

function main(argv) {
  let failed = 0;
  let checked = 0;
  let verdict;
  const markdownFiles = [];
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const file = argv[i + 1];
    if (flag === "--verdict") {
      verdict = file;
      i += 1;
      continue;
    }
    if (!["--sarif", "--junit", "--markdown"].includes(flag) || !file) {
      process.stderr.write(`usage: report-format-checks.mjs [--sarif file] [--junit file] [--markdown file] [--verdict v]\n`);
      return 2;
    }
    i += 1;
    if (flag === "--markdown") {
      markdownFiles.push(file);
      continue;
    }
    const text = readFileSync(file, "utf8");
    const problems = flag === "--sarif" ? sarifProblems(JSON.parse(text)) : junitProblems(text);
    checked += 1;
    if (problems.length > 0) failed += 1;
    process.stdout.write(`${problems.length === 0 ? "valid" : "INVALID"} ${flag.slice(2)} ${file}\n${problems.map((p) => `  ${p}\n`).join("")}`);
  }
  for (const file of markdownFiles) {
    const problems = markdownProblems(readFileSync(file, "utf8"), verdict);
    checked += 1;
    if (problems.length > 0) failed += 1;
    process.stdout.write(`${problems.length === 0 ? "valid" : "INVALID"} markdown ${file}\n${problems.map((p) => `  ${p}\n`).join("")}`);
  }
  if (checked === 0) {
    process.stderr.write("report-format-checks: nothing was checked\n");
    return 2;
  }
  return failed === 0 ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exitCode = main(process.argv.slice(2));
