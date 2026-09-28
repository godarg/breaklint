import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as browser from "../../src/acquire/browser.ts";

describe("inherited browser environment", () => {
  it("strips wrapper flags from the child environment", () => {
    assert.equal(typeof browser.safeBrowserEnvironment, "function", "browser child environment is not scrubbed");
    const env = browser.safeBrowserEnvironment({ PATH: "/usr/bin", CHROME_EXTRA_FLAGS: "--remote-debugging-port=9222" });
    assert.equal(env.PATH, "/usr/bin");
    assert.equal(Object.hasOwn(env, "CHROME_EXTRA_FLAGS"), false);
  });

  it("refuses both Puppeteer variables before browser launch", async () => {
    // A fake executable makes the negative control fail without starting an unsandboxed Chrome.
    const previousBrowser = process.env.BREAKLINT_CHROME;
    process.env.BREAKLINT_CHROME = process.execPath;
    try {
      for (const name of ["PUPPETEER_DANGEROUS_NO_SANDBOX", "PUPPETEER_TEST_EXPERIMENTAL_CHROME_FEATURES"]) {
        const previous = process.env[name];
        process.env[name] = "true";
        try {
          const result = await browser.launchBrowser();
          if (result.browser) await result.browser.close();
          assert.equal(result.browser, null, `${name} reached a browser launch`);
          assert.match(result.detail, /unsafe inherited browser environment/u);
        } finally {
          if (previous === undefined) delete process.env[name];
          else process.env[name] = previous;
        }
      }
    } finally {
      if (previousBrowser === undefined) delete process.env.BREAKLINT_CHROME;
      else process.env.BREAKLINT_CHROME = previousBrowser;
    }
  });
});
