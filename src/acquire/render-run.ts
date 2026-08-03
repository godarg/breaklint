/**
 * The live path: resolve a renderer, resolve Paged.js, measure, rasterise.
 *
 * What is finished here and what is not is stated plainly, because a half-built render path
 * that returned empty snapshots would be the worst possible outcome — a green run that means
 * nothing. Everything below fails closed: if a stage is not ready, the run ends with exit 3 and
 * an infrastructure event that names the stage. It never ends with 0 and no findings.
 *
 * Finished:
 *   - renderer resolution, with one copyable install command on failure
 *   - the Paged.js version gate, fail-closed, checked against the RESOLVED artefact
 *
 * Not finished, and therefore fail-closed rather than silently empty:
 *   - the in-page measurement probe (`src/measure/`), the collector (`src/paginate/`) and the
 *     evidence rasteriser (`src/render/`). Until those run against a real browser, the live
 *     path reports `checker-crashed` for the measurement stage instead of returning a snapshot.
 *
 * The reason this is a hard gate and not a warning: the break cause is read from attributes the
 * paginator writes into the tree and does not guarantee as an interface. A report produced on an
 * unmeasured paginator version states things nobody measured, and that is worse than no report.
 */

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import { SUPPORTED_PAGEDJS_VERSION } from "../core/enums.ts";
import type { DocumentInput } from "../core/engine.ts";

export interface RenderOptions {
  outDir: string;
  evidenceBinding: boolean;
  sourceMapInjection: boolean;
  network: { mode: "offline" | "allowlist"; allowed: string[] };
  locale: string;
}

export interface RenderResult {
  documents: DocumentInput[];
  fatal: { message: string; exitCode: 2 | 3 } | null;
}

const CHROME_CANDIDATES_BY_PLATFORM: Readonly<Record<string, readonly string[]>> = {
  darwin: [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ],
  linux: ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"],
};

/**
 * Where the browser is. The chain is explicit so that a failure can name every place it looked
 * rather than saying "not found" — a reader who sees the list can tell whether their browser is
 * simply somewhere else.
 */
export function resolveBrowser(): { path: string | null; searched: string[] } {
  const searched: string[] = [];
  const fromEnv = process.env.BREAKLINT_CHROME;
  if (fromEnv) {
    searched.push(`$BREAKLINT_CHROME (${fromEnv})`);
    if (existsSync(fromEnv)) return { path: fromEnv, searched };
  }
  for (const candidate of CHROME_CANDIDATES_BY_PLATFORM[process.platform] ?? []) {
    searched.push(candidate);
    if (existsSync(candidate)) return { path: candidate, searched };
  }
  return { path: null, searched };
}

/**
 * The Paged.js gate.
 *
 * Two things are checked, and one alone would not do. The version has to come from the
 * artefact that will actually be loaded, not from a `package.json` that may describe something
 * else; and the package has to be reached through the normal module resolution rather than
 * through a vendored copy, because a check against a copy proves the copy.
 */
export function resolvePagedjs(fromDir: string): {
  ok: boolean;
  version: string | null;
  path: string | null;
  detail: string;
} {
  const require = createRequire(join(fromDir, "noop.js"));
  let packageRoot: string;
  try {
    // `pagedjs` exports no subpaths — neither `pagedjs/package.json` nor `pagedjs/dist/paged.js`
    // resolves. Only the package name does, so the root is derived from that and the package
    // file is read from disk rather than imported.
    const entry = require.resolve("pagedjs");
    packageRoot = entry.slice(0, entry.lastIndexOf("/node_modules/pagedjs/") + "/node_modules/pagedjs/".length);
  } catch {
    return {
      ok: false,
      version: null,
      path: null,
      detail:
        "breaklint: paged.js is not installed.\n" +
        `  install: npm i -D pagedjs@${SUPPORTED_PAGEDJS_VERSION}`,
    };
  }

  const pkgFile = join(packageRoot, "package.json");
  if (!existsSync(pkgFile)) {
    return { ok: false, version: null, path: packageRoot, detail: `breaklint: ${pkgFile} not readable.` };
  }
  const pkg = JSON.parse(readFileSync(pkgFile, "utf8")) as { version?: string; browser?: string; main?: string };
  const version = pkg.version ?? null;
  // The package says which file is its browser bundle. Guessing a path here would be the same
  // class of mistake as reading the version from somewhere other than what gets loaded.
  const bundle = pkg.browser ?? pkg.main ?? null;
  const bundlePath = bundle ? join(packageRoot, bundle) : null;

  if (version !== SUPPORTED_PAGEDJS_VERSION) {
    return {
      ok: false,
      version,
      path: bundlePath,
      detail:
        `breaklint: paged.js ${version ?? "unknown"} resolved, but this release is measured ` +
        `against exactly ${SUPPORTED_PAGEDJS_VERSION}.\n` +
        `  The break cause is read from attributes the paginator writes and does not guarantee ` +
        `as an interface. A report from an unmeasured version would state things nobody measured.\n` +
        `  install: npm i -D pagedjs@${SUPPORTED_PAGEDJS_VERSION}\n` +
        `  There is no flag that overrides this.`,
    };
  }
  return { ok: true, version, path: bundlePath, detail: "" };
}

export async function renderDocuments(paths: readonly string[], _options: RenderOptions): Promise<RenderResult> {
  const browser = resolveBrowser();
  if (!browser.path) {
    // The measured promise: no renderer means exit 3 with a command that installs one. Not
    // exit 0, not an empty success. Looked in every place, and the message says which.
    return {
      documents: [],
      fatal: {
        exitCode: 3,
        message:
          "breaklint: no renderer available.\n" +
          "  install: npm i -D puppeteer-core\n" +
          "  or point breaklint at a browser: BREAKLINT_CHROME=/path/to/chrome\n" +
          `  looked in: ${browser.searched.join(", ") || "no candidates for this platform"}`,
      },
    };
  }

  const paged = resolvePagedjs(process.cwd());
  if (!paged.ok) {
    return { documents: [], fatal: { exitCode: 3, message: paged.detail } };
  }

  // Measurement is not wired to a browser yet. This returns documents with no snapshot and an
  // infrastructure event, which the engine turns into exit 3 — never into a clean run. When the
  // probe lands, this branch goes away; until then the tool refuses rather than pretends.
  return {
    documents: paths.map((path) => ({
      path,
      snapshot: null,
      infrastructure: [
        {
          kind: "checker-crashed" as const,
          detail:
            "the live measurement probe is not wired to a browser in this build. " +
            "Use --demo to exercise the rule and reporter chain. This run measured nothing and " +
            "says so rather than reporting a clean document.",
          measured: { stage: "measure", browser: browser.path, pagedjsVersion: paged.version },
        },
      ],
    })),
    fatal: null,
  };
}
