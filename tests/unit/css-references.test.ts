/**
 * The shared CSS reference scanner (src/core/css-references.ts), one complication per case.
 *
 * Every regex it replaced required whitespace after `@import`, so `@import"/x.css"` — valid CSS
 * that Chromium and Paged.js both load — escaped local resource discovery, the style-sheet route
 * guard and the local-URI collector at once. The cases pin the tokenizer rules that decide what a
 * style sheet references: comments, strings, url() with and without quotes, escapes, and no
 * mandatory whitespace. Red condition: reinstate `@import\s+` (or any per-reader regex) and the
 * no-space cases fail; read strings as references and the string/comment controls fail.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cssReferences } from "../../src/core/css-references.ts";

const cases: { css: string; expected: [kind: "import" | "url", value: string][]; complication: string }[] = [
  { css: '@import"/x.css";', expected: [["import", "/x.css"]], complication: "@import with no space before a double-quoted string" },
  { css: "@import'/x.css';", expected: [["import", "/x.css"]], complication: "@import with no space before a single-quoted string" },
  { css: '@import "/x.css";', expected: [["import", "/x.css"]], complication: "@import with a space" },
  { css: '@import/**/"/x.css";', expected: [["import", "/x.css"]], complication: "a comment between @import and its string" },
  { css: '@IMPORT "/x.css";', expected: [["import", "/x.css"]], complication: "at-keywords are case-insensitive" },
  { css: '@import url(/x.css);', expected: [["import", "/x.css"]], complication: "@import url() unquoted" },
  { css: '@import url("/x.css");', expected: [["import", "/x.css"]], complication: "@import url() double-quoted" },
  { css: "@import url('/x.css');", expected: [["import", "/x.css"]], complication: "@import url() single-quoted" },
  { css: '@import url( "/x.css" ) print;', expected: [["import", "/x.css"]], complication: "@import url() with inner whitespace and a media query" },
  { css: "@importurl(/x.css);", expected: [], complication: "@importurl is one at-keyword, not @import" },
  { css: '@import"/a.css";@import"/b.css";', expected: [["import", "/a.css"], ["import", "/b.css"]], complication: "two imports with no space at all" },
  { css: ".a{background:url(/a.png)}", expected: [["url", "/a.png"]], complication: "an unquoted url()" },
  { css: '.a{background:url("/a b.png")}', expected: [["url", "/a b.png"]], complication: "a quoted url() may contain a space" },
  { css: ".a{background:URL(/a.png)}", expected: [["url", "/a.png"]], complication: "function names are case-insensitive" },
  { css: ".a{background:url(  /a.png  )}", expected: [["url", "/a.png"]], complication: "whitespace inside an unquoted url() is trimmed" },
  { css: ".a{background:url(/a\\)b.png)}", expected: [["url", "/a)b.png"]], complication: "an escaped parenthesis inside an unquoted url()" },
  { css: ".a{background:url(\\2f a.png)}", expected: [["url", "/a.png"]], complication: "a hex escape and its terminating space" },
  { css: '.a{background:url("/a\\"b.png")}', expected: [["url", '/a"b.png']], complication: "an escaped quote inside a quoted url()" },
  { css: '@import "/li\\\nne.css";', expected: [["import", "/line.css"]], complication: "an escaped newline continues a string" },
  { css: ".a{background:url(/a b.png)}", expected: [], complication: "inner whitespace makes a bad url, which names nothing" },
  { css: '.a{background:url(/a"b.png)}', expected: [], complication: "a quote inside an unquoted url() makes a bad url" },
  { css: ".a{background:url()}", expected: [], complication: "an empty url() names nothing" },
  { css: '.a::before{content:"url(/no.png)"}', expected: [], complication: "url( inside a string is text, not a reference" },
  { css: '.a::before{content:"@import \\"/no.css\\""}', expected: [], complication: "@import inside a string is text" },
  { css: "/* @import '/no.css'; url(/no.png) */ .a{}", expected: [], complication: "a comment holds no references" },
  { css: ".a{background:myurl(/no.png)}", expected: [], complication: "a function named myurl is not url" },
  { css: "#url(x){} .a{}", expected: [], complication: "a hash token url is not a url() function" },
  { css: '@font-face{font-family:X;src:url(/f.woff2)format("woff2")}', expected: [["url", "/f.woff2"]], complication: "@font-face src with no space before format()" },
  { css: '@import "/a.css";.a{background:url(/b.png)}', expected: [["import", "/a.css"], ["url", "/b.png"]], complication: "source order across kinds" },
  { css: '@import "/a.css\n', expected: [], complication: "a newline in a string makes a bad string, which names nothing" },
  { css: "\r\n@import\r\n'/x.css';", expected: [["import", "/x.css"]], complication: "CR LF is a newline, and a newline is whitespace" },
  { css: ".a{background:u\\72l(/a.png)}", expected: [["url", "/a.png"]], complication: "an escaped letter in the function name still spells url" },
];

describe("the shared CSS reference scanner", () => {
  for (const item of cases) {
    it(item.complication, () => {
      assert.deepEqual(cssReferences(item.css).map((reference) => [reference.kind, reference.value]), item.expected);
    });
  }
});
