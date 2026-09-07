/**
 * Signing a report body, so a public endpoint can drop the obvious rubbish.
 *
 * The signature is an HMAC-SHA-256 over `<timestamp>.<body>` with a shared
 * key, sent as one header: `t=<unix ms>,v1=<hex>`. `handleReport` recomputes
 * it over the exact bytes it received, checks the clock skew and refuses a
 * signature it has already seen.
 *
 * Be honest about what this is. A key that ships to a browser is public: open
 * the bundle and it is right there. Signing raises the cost of a script that
 * POSTs to your endpoint in a loop — it now has to read your JavaScript and
 * implement HMAC — and it does not authenticate anybody. Use it as spam
 * deterrence beside a rate limit, never as the reason an endpoint is safe.
 *
 * Its own module on purpose, and nothing in the core imports it, so an
 * integrator who does not sign never pays for the WebCrypto calls. Wire it in
 * yourself:
 *
 * ```ts
 * import { createSigner } from "bugbottle/sign";
 * sendReport(endpoint, report, { sign: createSigner({ key: SIGN_KEY }) });
 * ```
 */
/** The header the signature travels in, unless `header` says otherwise. */
export declare const DEFAULT_SIGNATURE_HEADER = "X-Bugbottle-Signature";
export type SignerOptions = {
    /** The shared key. The same string the server is configured with. */
    key: string;
    /** Where to put the signature. Default `X-Bugbottle-Signature`. */
    header?: string;
};
/**
 * The raw HMAC-SHA-256 of `message` under `key`, lowercase hex.
 *
 * Exported because the server verifies with the very same function: one
 * implementation means the browser and the route handler cannot drift apart
 * over an encoding detail.
 */
export declare function hmacHex(key: string, message: string): Promise<string>;
/**
 * The header value for one body: `t=<unix ms>,v1=<hex>`.
 *
 * The timestamp is signed along with the body rather than sent beside it, so
 * moving it to sneak past the skew window invalidates the signature. Exported
 * mostly for tests and for anything that signs outside `sendReport`.
 */
export declare function computeSignature(key: string, body: string, timestamp?: number): Promise<string>;
/**
 * Builds the `sign` function `sendReport` takes: body in, headers out.
 *
 * When `crypto.subtle` is missing — a very old browser, or any page served
 * over plain HTTP, where WebCrypto is not exposed — this returns no headers
 * and the report is sent unsigned rather than not at all. Nothing fails, and
 * `onFailure` is not involved. A server with `require` left on then answers
 * 401, which is the trade the option is asking for: those reporters lose their
 * report, and a signature that could be skipped by dropping a header would not
 * be worth having.
 */
export declare function createSigner(options: SignerOptions): (body: string) => Promise<Record<string, string>>;
//# sourceMappingURL=sign.d.ts.map