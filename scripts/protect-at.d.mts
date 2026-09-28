/** Encode the `@` in a jsDelivr URL as `&#64;`, so Cloudflare's email
 *  obfuscation cannot read `bugbottle@1.0.1` as an address and cut the URL off
 *  at it. A browser decodes the entity before it reads the attribute and before
 *  a reader copies the text, so nothing visible changes. */
export function protectAtIn(html: string): string;

/** The same rule as a question, for a caller that only wants to know. */
export function hasRawAt(html: string): boolean;
