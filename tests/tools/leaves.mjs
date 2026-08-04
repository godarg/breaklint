/**
 * Count the leaf values in a measurement report, and diff two reports leaf by leaf.
 *
 * This exists because `docs/status.md` claims a leaf count and a "exactly one value differs
 * between two runs" reproducibility result, and an audit established that the stated number
 * (209) was not derivable under any plausible counting rule — nothing in the repository computed
 * it, so the claim was checkable only in the sense that a reader could disbelieve it.
 *
 * A number in prose that nobody can recompute is a claim. This makes it a command.
 *
 *   node tests/tools/leaves.mjs <report.json>              -> the leaf count
 *   node tests/tools/leaves.mjs <run1.json> <run2.json>    -> counts, and every differing leaf
 *
 * Counting rule, stated because it is the only thing that makes the number meaningful: one leaf
 * per scalar, and one leaf per EMPTY object or array. A non-empty container is not itself a leaf;
 * its contents are.
 */

import { readFileSync } from "node:fs";

function leaves(value, path = "", acc = new Map()) {
  if (value !== null && typeof value === "object") {
    const entries = Array.isArray(value)
      ? value.map((v, i) => [`[${i}]`, v])
      : Object.entries(value).map(([k, v]) => [`.${k}`, v]);
    if (entries.length === 0) acc.set(path, Array.isArray(value) ? "[]" : "{}");
    for (const [key, child] of entries) leaves(child, path + key, acc);
  } else {
    acc.set(path, value);
  }
  return acc;
}

const [a, b] = process.argv.slice(2);
if (!a) {
  console.error("usage: node tests/tools/leaves.mjs <report.json> [<report2.json>]");
  process.exit(2);
}

const one = leaves(JSON.parse(readFileSync(a, "utf8")));
if (!b) {
  console.log(`${one.size} leaves in ${a}`);
  process.exit(0);
}

const two = leaves(JSON.parse(readFileSync(b, "utf8")));
const onlyA = [...one.keys()].filter((k) => !two.has(k));
const onlyB = [...two.keys()].filter((k) => !one.has(k));
const differing = [...one.keys()].filter((k) => two.has(k) && !Object.is(one.get(k), two.get(k)));

console.log(`leaves: ${one.size} and ${two.size}`);
console.log(`paths only in the first: ${onlyA.length}, only in the second: ${onlyB.length}`);
console.log(`differing leaves: ${differing.length}`);
for (const key of [...onlyA, ...onlyB]) console.log(`  shape  ${key}`);
for (const key of differing) console.log(`  value  ${key} = ${one.get(key)} -> ${two.get(key)}`);

// A shape difference between two runs of the same build is never acceptable; a value difference
// may be (a wall-clock time is not a contract value, §12.4). The exit code separates the two.
process.exit(onlyA.length + onlyB.length > 0 ? 1 : 0);
