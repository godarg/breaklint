import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, sep } from "node:path";

/**
 * The absolute path an output is written to, resolved the way the file system resolves it.
 *
 * `path.resolve()` normalises `..` lexically: `link/../report.json` becomes `./report.json`. The
 * file system follows `link` first and then goes up from where it points, so the same string names
 * a file beside the link's target. A collision check that asks the file system and a writer that
 * normalised lexically then look at two different files, and the write can replace an input the
 * check never saw. Every output path is therefore resolved here, once, and both use the result.
 *
 * `realpathSync.native` is the operating system's realpath(3). The JavaScript `realpathSync` calls
 * `path.resolve()` first and so repeats the lexical normalisation this function exists to avoid.
 *
 * An existing path resolves completely (every symlink, `..` after it). An absent leaf resolves its
 * parent directory and keeps its own name; an absent parent is left to the file system, unchanged,
 * because no `..` in it is normalised anywhere. A dangling symlink at the leaf stays the link.
 */
export function physicalPath(path: string): string {
  // Concatenated, not joined: `join` would normalise the `..` this function exists to keep.
  const absolute = isAbsolute(path) ? path : `${process.cwd()}${sep}${path}`;
  try {
    return realpathSync.native(absolute);
  } catch {
    // Absent leaf (or a dangling link): resolve where it would be created.
  }
  try {
    return join(realpathSync.native(dirname(absolute)), basename(absolute));
  } catch {
    return absolute;
  }
}
