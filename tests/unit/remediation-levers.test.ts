/**
 * The lever reader itself — tests/tools/remediation-levers.ts — which three guards stand on: the
 * rule pages' Examples and the context pack's repair map (tests/unit/registry.test.ts) and the
 * agent contract (tests/unit/agent-contract.test.ts).
 *
 * Those guards only read the real documents, which already say the right thing, so a regression in
 * the reader left every one of them green: reporting only levers a remedied example SETS (and so
 * missing a deleted `break-inside: avoid`), voiding a whole sentence for one warning word, or
 * forgetting the removal synonyms. Each case below fails on one of those reversions.
 *
 * The reader is a heuristic over English, not a parser; its known limits are stated in its own
 * header. It errs in both directions, and on the advice text an invented proposal is the silent
 * one, because it widens what every guard accepts. The sentences below are its contract — the
 * proposals it must see and the warnings it must not read as proposals — including the rewordings
 * three verification rounds used against it.
 */

import { strict as assert } from "node:assert";
import { describe, it } from "node:test";

import { changedLevers, positiveLevers, proposedLevers } from "../tools/remediation-levers.ts";

describe("the lever reader", () => {
  it("counts a lever as changed when the remedied example adds, changes or REMOVES it", () => {
    const trigger = '<div style="break-inside: avoid; height: 300mm;">x</div>';
    assert.deepEqual(changedLevers(trigger, '<div style="height: 300mm;">x</div>'), ["break-inside"], "a removed declaration is a change");
    assert.deepEqual(changedLevers(trigger, '<div style="break-inside: auto; height: 300mm;">x</div>'), ["break-inside"]);
    assert.deepEqual(changedLevers(trigger, '<div style="break-inside: avoid; line-height: 1.2;">x</div>'), ["line-height"]);
    assert.deepEqual(changedLevers(trigger, trigger), []);
  });

  it("reads removal synonyms as proposals", () => {
    for (const verb of ["Remove", "Delete", "Drop", "Strip", "Omit", "Unset", "Eliminate", "Get rid of", "Take out"]) {
      assert.deepEqual(proposedLevers(`${verb} \`break-inside: avoid\` from the block.`), ["break-inside"], verb);
    }
  });

  it("reads the other forms a proposal takes", () => {
    const proposals = [
      "Change `break-inside: avoid` to `auto`.",
      "Override `break-inside` with `auto`.",
      "Consider removing `break-inside: avoid`.",
      "You should remove `break-inside: avoid`.",
      "You can delete `break-inside: avoid` if the block is too tall.",
      "Removing `break-inside: avoid` fixes the finding.",
      "Make the block shorter, or remove `break-inside: avoid`.",
      "If the block is taller than a page, remove `break-inside: avoid`.",
      "The fix: remove `break-inside: avoid`.",
      'Set "break-inside: auto" on the block.',
      "Replace `break-inside: avoid` with `break-inside: auto`.",
    ];
    for (const sentence of proposals) assert.deepEqual(proposedLevers(sentence), ["break-inside"], sentence);
  });

  it("voids only the clause that warns, not the sentence around it", () => {
    const proposals = [
      "Remove `break-inside: avoid`; this never hurts.",
      "Remove `break-inside: avoid`, which does not hurt.",
      "Remove the declaration `break-inside: avoid`—it is ignored by nothing.",
      // A word inside a quoted span is not grammar.
      "Remove `break-inside: avoid, which never helps here`.",
      // "does not" voids only when it negates the proposal verb.
      "Remove `break-inside: avoid` from any block that does not fit on a page.",
      "Remove `break-inside: avoid` if Paged.js does not honour it.",
      "Remove `break-inside: avoid` only where the block is taller than the page.",
    ];
    for (const sentence of proposals) assert.deepEqual(proposedLevers(sentence), ["break-inside"], sentence);
  });

  it("does not read a warning, a description or a negated list as a proposal", () => {
    const warnings = [
      "Do not remove `break-inside: avoid`.",
      "Never delete `break-inside: avoid`; make the block shorter.",
      "Removing `break-inside: avoid` also clears the finding without fixing anything.",
      "`break-inside: avoid` is what keeps the block together.",
      // A negation distributes over the list it opens.
      "**Agent Rule:** **never** inflate `font-size`, inject filler text, or stretch `line-height` to resolve it.",
      "Do not remove its `break-inside: avoid` to clear the finding: the finding then disappears only because the rule has no candidate.",
      "*(Paged.js does not implement the CSS `widows` and `orphans` properties; they are inert here.)*",
      // One-word levers only count as declarations or quoted names, never as English words.
      "Replace spaced hyphens with an en dash, and straight quotes with curly ones.",
    ];
    for (const sentence of warnings) assert.deepEqual(proposedLevers(sentence), [], sentence);
  });

  it("does not read a gerund as a proposal when the sentence says its fix is none", () => {
    const warnings = [
      "Removing `break-inside: avoid` never fixes the finding.",
      "Removing `break-inside: avoid` clears the finding only because the rule then has no candidate.",
      "Removing `break-inside: avoid` resolves the finding by hiding it, which is a false repair.",
      "Removing `break-inside: avoid` does not fix the finding.",
      "Removing `break-inside: avoid` removes the finding without making the block fit.",
      // Clearing a finding is what a false repair does; it is not a fix verb.
      "Removing `break-inside: avoid` clears the finding.",
    ];
    for (const sentence of warnings) assert.deepEqual(proposedLevers(sentence), [], sentence);
    // A word inside a quoted span is not grammar, and the gerund still proposes.
    assert.deepEqual(proposedLevers("Removing `break-inside: avoid, never auto` fixes the finding."), ["break-inside"]);
    // The real layout/unbreakable-block-too-tall advice (as of this change), without its "also":
    // the false repair it describes must not become a lever the advice proposes.
    const unbreakable =
      "Make the block shorter — split it into smaller sections deliberately, or reduce container padding, font size or contained rows. " +
      "Removing 'break-inside: avoid' clears the finding, but only because the rule then has no candidate: the block is exactly as tall as before, and it will still be broken, just without having asked not to be.";
    assert.deepEqual([...positiveLevers(unbreakable)], []);
    assert.deepEqual([...positiveLevers(unbreakable.replace("avoid' clears", "avoid' also clears"))], []);
  });

  it("derives an advice text's positive levers without the levers it warns about", () => {
    const advice =
      "Make the block shorter — split it into smaller sections deliberately. " +
      "Removing 'break-inside: avoid' also clears the finding, but only because the rule then has no candidate. " +
      "Otherwise insert 'break-before: page' earlier.";
    assert.deepEqual([...positiveLevers(advice)], ["break-before"]);
    assert.deepEqual([...positiveLevers("(Note: CSS 'widows' is ignored by Paged.js). Keep the row together with 'tr { break-inside: avoid; }'.")], ["break-inside"]);
  });

  it("reads every clause of a repair instruction as a proposal unless it warns", () => {
    assert.deepEqual(proposedLevers("the block can fit with 'break-inside: auto'", { requireImperative: false }), ["break-inside"]);
    assert.deepEqual(proposedLevers("do not only remove its 'break-inside: avoid', which clears the finding without making the block fit", { requireImperative: false }), []);
  });
});
