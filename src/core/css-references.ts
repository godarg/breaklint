/**
 * The URL references of a style sheet, read the way a CSS tokenizer reads them (CSS Syntax Level 3):
 * comments are skipped, strings are skipped unless they are the URL, escapes are decoded, and no
 * whitespace is required anywhere it is optional. One scanner for every reader — local resource
 * discovery, the style-sheet route guard and the local-URI collector — so that the three agree on
 * what a style sheet references. Each regex it replaces required whitespace after `@import` and so
 * lost `@import"/x.css"`, which is valid CSS.
 *
 * Returned in source order:
 * - `import`: the target of an `@import`, written as a string or as `url(…)`;
 * - `url`: every other `url(…)` token (backgrounds, `@font-face` sources, cursors, …).
 *
 * Not read, and stated rather than guessed at: URL strings that are not in `url()` and not the
 * target of `@import` (the string arguments of `image-set()`, `src()` and the like).
 */

export interface CssReference {
  kind: "import" | "url";
  /** The URL with CSS escapes decoded; never empty. */
  value: string;
}

const WHITESPACE = new Set([" ", "\t", "\n"]);

function isHex(ch: string | undefined): boolean {
  return ch !== undefined && /^[0-9A-Fa-f]$/u.test(ch);
}

function isNameChar(ch: string | undefined): boolean {
  return ch !== undefined && (/^[A-Za-z0-9_-]$/u.test(ch) || ch.charCodeAt(0) >= 0x80);
}

/** `\` followed by something other than a newline starts a valid escape. */
function validEscape(text: string, i: number): boolean {
  return text[i] === "\\" && i + 1 < text.length && text[i + 1] !== "\n";
}

/** Consume the escape at `text[i] === "\\"`; returns the decoded character and the next index. */
function consumeEscape(text: string, i: number): [string, number] {
  let j = i + 1;
  if (isHex(text[j])) {
    let hex = "";
    while (hex.length < 6 && isHex(text[j])) hex += text[j++];
    if (WHITESPACE.has(text[j] ?? "")) j += 1;
    const code = Number.parseInt(hex, 16);
    const valid = code !== 0 && !(code >= 0xd800 && code <= 0xdfff) && code <= 0x10ffff;
    return [valid ? String.fromCodePoint(code) : "�", j];
  }
  if (j >= text.length) return ["�", j];
  const cp = text.codePointAt(j)!;
  const ch = String.fromCodePoint(cp);
  return [ch, j + ch.length];
}

function consumeName(text: string, i: number): [string, number] {
  let out = "";
  let j = i;
  for (;;) {
    if (isNameChar(text[j])) out += text[j++];
    else if (validEscape(text, j)) {
      const [ch, next] = consumeEscape(text, j);
      out += ch;
      j = next;
    } else return [out, j];
  }
}

/** A string token starting at the quote `text[i]`. `ok` is false for a bad string (raw newline). */
function consumeString(text: string, i: number): { value: string; next: number; ok: boolean } {
  const quote = text[i];
  let out = "";
  let j = i + 1;
  while (j < text.length) {
    const ch = text[j]!;
    if (ch === quote) return { value: out, next: j + 1, ok: true };
    if (ch === "\n") return { value: out, next: j, ok: false };
    if (ch === "\\") {
      if (j + 1 >= text.length) { j += 1; continue; }
      if (text[j + 1] === "\n") { j += 2; continue; }
      const [decoded, next] = consumeEscape(text, j);
      out += decoded;
      j = next;
      continue;
    }
    out += ch;
    j += 1;
  }
  return { value: out, next: j, ok: true };
}

function skipWhitespace(text: string, i: number): number {
  let j = i;
  while (WHITESPACE.has(text[j] ?? "")) j += 1;
  return j;
}

function skipWhitespaceAndComments(text: string, i: number): number {
  let j = i;
  for (;;) {
    j = skipWhitespace(text, j);
    if (text.startsWith("/*", j)) {
      const end = text.indexOf("*/", j + 2);
      j = end === -1 ? text.length : end + 2;
    } else return j;
  }
}

/**
 * The argument of a `url(` whose `(` ends at `i`. A quoted argument is a function whose first token
 * is a string; an unquoted one is a url token, which ends at `)` and may carry escapes but no
 * quote, `(` or inner whitespace (those make a bad url, which names nothing).
 */
function consumeUrl(text: string, i: number): { value: string | null; next: number } {
  let j = skipWhitespace(text, i);
  const ch = text[j];
  if (ch === '"' || ch === "'") {
    const string = consumeString(text, j);
    j = skipWhitespaceAndComments(text, string.next);
    if (text[j] === ")") return { value: string.ok ? string.value : null, next: j + 1 };
    // Not a plain url("…"): skip to the closing parenthesis and name nothing.
    const close = text.indexOf(")", j);
    return { value: null, next: close === -1 ? text.length : close + 1 };
  }
  let out = "";
  while (j < text.length) {
    const c = text[j]!;
    if (c === ")") return { value: out, next: j + 1 };
    if (WHITESPACE.has(c)) {
      j = skipWhitespace(text, j);
      if (text[j] === ")" || j >= text.length) return { value: out, next: j + 1 };
      break;
    }
    if (c === '"' || c === "'" || c === "(" || c.charCodeAt(0) < 0x20 || c === "\u007f") break;
    if (c === "\\") {
      if (!validEscape(text, j)) break;
      const [decoded, next] = consumeEscape(text, j);
      out += decoded;
      j = next;
      continue;
    }
    out += c;
    j += 1;
  }
  if (j >= text.length) return { value: out, next: j };
  // Bad url: consume through the next unescaped `)`.
  while (j < text.length && text[j] !== ")") j += text[j] === "\\" ? 2 : 1;
  return { value: null, next: j + 1 };
}

/** Every URL reference of a style sheet, in source order. */
export function cssReferences(css: string): CssReference[] {
  // CSS input preprocessing: CR LF, CR and FF are one newline; NUL is U+FFFD.
  const text = css.replace(/\r\n?|\f/gu, "\n").replace(/\0/gu, "�");
  const out: CssReference[] = [];
  const push = (kind: CssReference["kind"], value: string | null): void => {
    if (value !== null && value.length > 0) out.push({ kind, value });
  };
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (text.startsWith("/*", i)) {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 2;
    } else if (ch === '"' || ch === "'") {
      i = consumeString(text, i).next;
    } else if (ch === "@" || ch === "#") {
      const [name, next] = consumeName(text, i + 1);
      i = next;
      if (ch === "@" && name.toLowerCase() === "import") {
        const j = skipWhitespaceAndComments(text, i);
        if (text[j] === '"' || text[j] === "'") {
          const string = consumeString(text, j);
          if (string.ok) push("import", string.value);
          i = string.next;
        } else {
          const [fn, afterName] = consumeName(text, j);
          if (fn.toLowerCase() === "url" && text[afterName] === "(") {
            const url = consumeUrl(text, afterName + 1);
            push("import", url.value);
            i = url.next;
          } else {
            i = Math.max(afterName, j);
          }
        }
      }
    } else if (isNameChar(ch) || validEscape(text, i)) {
      const [name, next] = consumeName(text, i);
      i = next;
      if (name.toLowerCase() === "url" && text[i] === "(") {
        const url = consumeUrl(text, i + 1);
        push("url", url.value);
        i = url.next;
      }
    } else if (ch === "\\") {
      i += 2;
    } else {
      i += 1;
    }
  }
  return out;
}
