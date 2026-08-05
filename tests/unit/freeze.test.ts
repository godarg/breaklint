/**
 * The freeze signature's decision logic, driven through its own injected seam.
 *
 * `awaitStableLayout` takes `sample` and `wait` as arguments, and the fakes stand exactly there.
 * That is deliberate and it is the only way these branches are reachable: a real document cannot
 * be asked to drift once and then settle, and "drifts forever" is precisely the case whose
 * handling decides whether a run reports exit 3 or a clean page. The collection half runs in a
 * browser and is covered by `tests/live/`, which fails rather than skips when the browser is
 * missing.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import {
  awaitStableLayout,
  composeSignature,
  digest,
  driftedComponents,
  FREEZE_COMPONENTS,
  MAX_STABILITY_RETRIES,
  STABILITY_WINDOW_MS,
  type FreezeComponent,
  type FreezeParts,
} from "../../src/measure/freeze.ts";

function parts(overrides: Partial<Record<FreezeComponent, string>> = {}): FreezeParts {
  const base = Object.fromEntries(FREEZE_COMPONENTS.map((c) => [c, `${c}-stable`])) as Record<
    FreezeComponent,
    string
  >;
  return { ...base, ...overrides, canvasInkReadable: false };
}

describe("the freeze signature", () => {
  /**
   * The seven components, as a LITERAL.
   *
   * Not derived from `FREEZE_COMPONENTS` — that would be the expectation computed from the thing
   * under test, which is the oracle mistake that survived a full 153-test battery in this repo and
   * had to be found by a mutation instead. If a component is dropped, this line is where it shows.
   */
  it("carries exactly the seven components §11.3 names", () => {
    assert.deepEqual(
      [...FREEZE_COMPONENTS],
      ["pageCount", "boxes", "pseudo", "svgGeometry", "replaced", "canvas", "marginBoxes"],
      "the component set changed — §11.3 makes this list normative",
    );
    assert.equal(STABILITY_WINDOW_MS, 250, "§11.3 binds this number");
    assert.equal(MAX_STABILITY_RETRIES, 3, "§11.3 binds this number");
  });

  /**
   * Every component is load-bearing, one at a time.
   *
   * The drift table in §11.3 is a claim about six drift classes, and the way that claim goes
   * hollow is a component that is collected but never reaches the signature. Each iteration below
   * changes exactly ONE component and requires the signature to move.
   *
   * Red condition: drop any component from `composeSignature` and this fails, naming it.
   */
  for (const component of FREEZE_COMPONENTS) {
    it(`a change in ${component} alone moves the signature`, () => {
      const before = parts();
      const after = parts({ [component]: `${component}-MOVED` });
      assert.notEqual(
        composeSignature(before),
        composeSignature(after),
        `${component} is collected but does not reach the signature`,
      );
      assert.deepEqual(driftedComponents(before, after), [component], "the drift must name the component");
    });
  }

  it("an unchanged document produces an identical signature and no drift", () => {
    assert.equal(composeSignature(parts()), composeSignature(parts()));
    assert.deepEqual(driftedComponents(parts(), parts()), []);
  });

  /** Two different inputs must not collide into one component digest for realistic payloads. */
  it("the digest separates the payloads it actually sees", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 5000; i += 1) seen.add(digest(`P:${i},${i * 3.17},10.5,4.25;DIV:1,2,3,4`));
    assert.equal(seen.size, 5000, "digest collision within a single document's worth of boxes");
  });

  describe("the stability loop", () => {
    const noWait = async (): Promise<void> => {};

    it("a still document settles on the first comparison", async () => {
      let calls = 0;
      const outcome = await awaitStableLayout({
        sample: async () => (calls++, parts()),
        wait: noWait,
      });
      assert.equal(outcome.stable, true);
      assert.equal(outcome.retries, 0);
      assert.equal(outcome.drift, null);
      assert.equal(calls, 2, "one sample, one wait, one confirming sample");
    });

    /**
     * The case that cannot be produced by a real document: drift exactly once, then settle.
     *
     * This is what `maxStabilityRetries` is FOR — a document that is merely slow, not moving.
     * Without this case the retry loop could be `if (drift) fail` and every test would still pass.
     */
    it("a document that moves once and then settles is stable, and says how many retries it took", async () => {
      let calls = 0;
      const outcome = await awaitStableLayout({
        sample: async () => {
          calls += 1;
          return calls <= 1 ? parts({ boxes: "moving" }) : parts();
        },
        wait: noWait,
      });
      assert.equal(outcome.stable, true, "a document that settles must not be reported as drifting");
      assert.equal(outcome.retries, 1, "the number of retries is part of the report, not a detail");
    });

    it("a document that never settles exhausts the retries and names what moved", async () => {
      let calls = 0;
      const outcome = await awaitStableLayout({
        sample: async () => {
          calls += 1;
          return parts({ boxes: `moving-${calls}`, svgGeometry: `spinning-${calls}` });
        },
        wait: noWait,
      });
      assert.equal(outcome.stable, false);
      assert.equal(outcome.retries, MAX_STABILITY_RETRIES + 1);
      assert.deepEqual(outcome.drift?.components, ["boxes", "svgGeometry"]);
      assert.equal(outcome.drift?.driftAmount, 2);
      assert.notEqual(outcome.drift?.before, outcome.drift?.after, "the two signatures must differ");
    });

    /**
     * The retry budget is spent, not merely declared.
     *
     * A loop that returned after the first comparison would satisfy every assertion above except
     * this one — and would turn a slow document into exit 3 on every run.
     */
    it("the loop actually samples MAX_STABILITY_RETRIES + 1 times before giving up", async () => {
      let samples = 0;
      let waits = 0;
      await awaitStableLayout({
        sample: async () => (samples += 1, parts({ boxes: `m${samples}` })),
        wait: async () => { waits += 1; },
      });
      assert.equal(samples, MAX_STABILITY_RETRIES + 2, "one initial sample plus one per attempt");
      assert.equal(waits, MAX_STABILITY_RETRIES + 1, "every attempt waits before re-sampling");
    });

    it("the wait is the contract's window, not something shorter", async () => {
      const waited: number[] = [];
      await awaitStableLayout({
        sample: async () => parts(),
        wait: async (ms) => { waited.push(ms); },
      });
      assert.deepEqual(waited, [STABILITY_WINDOW_MS]);
    });

    /**
     * `canvasInkReadable` is carried through rather than dropped.
     *
     * Measured on this build: a canvas that carried ink before pagination reports zero non-zero
     * bytes afterwards, in the page clone AND in the template Paged.js parks the source in. The
     * flag is how a reader tells "the bitmap was readable and did not change" from "the bitmap was
     * never readable at all" — and those two look identical in a hash.
     */
    it("reports whether the canvas bitmap was readable at all", async () => {
      const readable = await awaitStableLayout({
        sample: async () => ({ ...parts(), canvasInkReadable: true }),
        wait: noWait,
      });
      assert.equal(readable.canvasInkReadable, true);
      const notReadable = await awaitStableLayout({ sample: async () => parts(), wait: noWait });
      assert.equal(notReadable.canvasInkReadable, false);
    });
  });
});
