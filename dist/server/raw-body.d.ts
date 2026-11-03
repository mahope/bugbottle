export declare class RawBodyTimeoutError extends Error {
    readonly stop: () => void;
    constructor(stop: () => void);
}
/** One deadline for the entire upload, including time between chunks. */
export declare function timedChunks(raw: AsyncIterable<unknown> & {
    destroy?: () => unknown;
}, timeoutMs?: number): AsyncGenerator<unknown>;
export declare function stopAfterReply(response: {
    once?: (event: "finish", listener: () => void) => unknown;
} | undefined, stop: () => void): void;
//# sourceMappingURL=raw-body.d.ts.map