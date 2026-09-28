/*
 * Cloudflare's email obfuscation is enabled for bugbottle.dev, and it rewrites
 * anything in a response that reads as an address. `bugbottle@1.0.1` reads as
 * one, so every jsDelivr URL this site publishes came out of the edge cut off
 * at the `@` with a `/cdn-cgi/l/email-protection` anchor spliced into the
 * middle of it. Measured on the live site 28/9 23:0x: two hits on `/`, two on
 * `/da/` and one on `/docs/install/`, where the sample's `src` ended at
 * `.../npm/`. A reader who copied it got code that cannot load, on the one page
 * whose whole job is to be copied from.
 *
 * `&#64;` is the same character to a browser, which decodes it before it reads
 * the attribute and before the reader copies the text, and the edge matches on
 * the bytes it receives rather than on decoded entities, so it has nothing left
 * to rewrite. The sample renders and copies byte-identically.
 *
 * The README keeps a literal `@`: npm and GitHub render it themselves and show
 * `&#64;` verbatim inside a fenced code block, which would be worse than the
 * bug. Only HTML that goes through a web server needs this.
 *
 * Its own module rather than a function inside `build-docs.mjs` because that
 * script runs its whole build on import, and a test cannot call into it.
 */

const JSDELIVR_URL = /((?:cdn\.)?jsdelivr\.net\/(?:npm|gh)\/[^\s"'<]*?)@/g;

export function protectAtIn(html) {
  return html.replace(JSDELIVR_URL, "$1&#64;");
}

/** The same rule as a check, for a test or a script that wants a boolean. */
export function hasRawAt(html) {
  JSDELIVR_URL.lastIndex = 0;
  return JSDELIVR_URL.test(html);
}
