import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Write the live measurement to the runner-owned partial path.
 *
 * The documented command deliberately permits a nested report path. A fresh checkout therefore
 * cannot rely on a pre-existing `.tmp` directory. Creating only the requested parent keeps the
 * operation deterministic while the parent runner retains sole authority to promote `.partial`
 * to the final report after every structured live gate has passed.
 */
export function writePartialLiveReport(target, measurement) {
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(`${target}.partial`, `${JSON.stringify(measurement, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
}
