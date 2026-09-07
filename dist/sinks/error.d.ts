/**
 * The one error every sink throws, so a route handler can catch a failed
 * delivery in a single place regardless of where the report was headed.
 *
 * The status and the response body are kept because they are what you need in
 * the log line: a 422 from Resend names the unverified sender, a 404 from a
 * Slack webhook means the URL was revoked. Neither is safe to show a reporter.
 */
/** A `fetch` that can be injected in a test or a worker with its own client. */
export type FetchLike = typeof globalThis.fetch;
/** A sink answered, but not with success. */
export declare class SinkError extends Error {
    readonly status: number;
    readonly body: unknown;
    constructor(message: string, status: number, body: unknown);
}
/**
 * Reads a response body once, as JSON when the server says so and as text
 * otherwise, and never throws — a sink failure must not be masked by a second
 * failure while describing it.
 */
export declare function readBody(response: Response): Promise<unknown>;
/** Digs a human-readable reason out of whatever the service answered with. */
export declare function messageFromBody(body: unknown, fallback: string): string;
//# sourceMappingURL=error.d.ts.map