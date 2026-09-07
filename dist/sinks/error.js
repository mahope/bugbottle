/**
 * The one error every sink throws, so a route handler can catch a failed
 * delivery in a single place regardless of where the report was headed.
 *
 * The status and the response body are kept because they are what you need in
 * the log line: a 422 from Resend names the unverified sender, a 404 from a
 * Slack webhook means the URL was revoked. Neither is safe to show a reporter.
 */
/** A sink answered, but not with success. */
export class SinkError extends Error {
    status;
    body;
    constructor(message, status, body) {
        super(message);
        this.name = "SinkError";
        this.status = status;
        this.body = body;
    }
}
/**
 * Reads a response body once, as JSON when the server says so and as text
 * otherwise, and never throws — a sink failure must not be masked by a second
 * failure while describing it.
 */
export async function readBody(response) {
    try {
        const text = await response.text();
        if (!text)
            return null;
        try {
            return JSON.parse(text);
        }
        catch {
            return text;
        }
    }
    catch {
        return null;
    }
}
/** Digs a human-readable reason out of whatever the service answered with. */
export function messageFromBody(body, fallback) {
    if (typeof body === "string" && body.trim())
        return body.trim().slice(0, 200);
    if (typeof body === "object" && body !== null) {
        const record = body;
        for (const key of ["message", "error", "detail"]) {
            const value = record[key];
            if (typeof value === "string" && value.trim())
                return value.trim();
        }
    }
    return fallback;
}
//# sourceMappingURL=error.js.map