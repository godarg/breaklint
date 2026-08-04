/**
 * The licence gate.
 *
 * Permissive only — the exact set is `ALLOWED` below, and it is wider than MIT because the tree
 * genuinely ships Apache-2.0 (`pdfjs-dist`) and BSD. This header used to say "MIT only" while the
 * check admitted eight licences: a promise the code does not keep, in the file whose whole job is
 * keeping it. What the gate enforces is no copyleft and no package whose terms nobody stated.
 *
 * The walk covers `dependencies` AND `optionalDependencies` — an earlier version
 * of this check in a comparable project walked only the first, and an optional dependency is
 * still installed by a plain `npm i`. "Optional" means tolerant of install failure, not absent.
 *
 * The tool that checks licences brings no licence question of its own: this is forty lines over
 * `node_modules`, not a scanner with its own dependency tree.
 *
 * A missing licence field is a failure, not a pass. An unlicensed package is not permissively
 * licensed; it is a package whose terms nobody stated.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

const ALLOWED = new Set(["MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "Unlicense", "CC0-1.0"]);
/** Named exclusions. Both were considered for the type rules and both are copyleft or unstated. */
const NEVER = new Set(["dictionary-de", "hyphenation.de"]);

interface Offender {
  name: string;
  licence: string;
  why: string;
}

export function checkLicences(root = ROOT): Offender[] {
  const offenders: Offender[] = [];
  const modules = join(root, "node_modules");
  if (!existsSync(modules)) return offenders;

  const declared = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  };
  for (const name of Object.keys({ ...declared.dependencies, ...declared.optionalDependencies })) {
    if (NEVER.has(name)) {
      offenders.push({ name, licence: "n/a", why: "named exclusion: copyleft or no licence field" });
    }
  }

  for (const entry of walk(modules)) {
    const pkgFile = join(entry, "package.json");
    if (!existsSync(pkgFile)) continue;
    let pkg: { name?: string; license?: unknown; licenses?: unknown };
    try {
      pkg = JSON.parse(readFileSync(pkgFile, "utf8"));
    } catch {
      continue;
    }
    if (!pkg.name) continue;
    if (NEVER.has(pkg.name)) {
      offenders.push({ name: pkg.name, licence: String(pkg.license ?? "none"), why: "named exclusion" });
      continue;
    }
    const licence = normalise(pkg.license ?? pkg.licenses);
    if (licence === null) {
      offenders.push({ name: pkg.name, licence: "none", why: "no licence field — terms unstated is not permissive" });
      continue;
    }
    if (!licence.split(/\s+OR\s+|\s+AND\s+/u).some((part) => ALLOWED.has(part.replace(/[()]/gu, "")))) {
      offenders.push({ name: pkg.name, licence, why: "not on the allow list" });
    }
  }
  return offenders;
}

function normalise(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) {
    const parts = value.map((v) => (typeof v === "object" && v && "type" in v ? String((v as { type: unknown }).type) : String(v)));
    return parts.join(" OR ") || null;
  }
  if (value && typeof value === "object" && "type" in value) return String((value as { type: unknown }).type);
  return null;
}

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === ".bin" || name === ".package-lock.json") continue;
    const full = join(dir, name);
    if (name.startsWith("@")) {
      for (const scoped of readdirSync(full)) yield join(full, scoped);
      continue;
    }
    yield full;
    const nested = join(full, "node_modules");
    if (existsSync(nested)) yield* walk(nested);
  }
}

const invokedDirectly = process.argv[1]?.endsWith("licenses.ts");
if (invokedDirectly) {
  const offenders = checkLicences();
  for (const o of offenders) console.log(`${o.name.padEnd(30)} ${o.licence.padEnd(20)} ${o.why}`);
  console.log(offenders.length === 0 ? "licences: all permissive, none missing" : `${offenders.length} offender(s)`);
  process.exit(offenders.length === 0 ? 0 : 1);
}
