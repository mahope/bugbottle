import { DEFAULT_BODY_TIMEOUT_MS } from "./handle.js";
export class RawBodyTimeoutError extends Error {
    stop;
    constructor(stop) {
        super("Report took too long to arrive");
        this.stop = stop;
    }
}
/** One deadline for the entire upload, including time between chunks. */
export async function* timedChunks(raw, timeoutMs = DEFAULT_BODY_TIMEOUT_MS) {
    const iterator = raw[Symbol.asyncIterator]();
    const stop = () => {
        raw.destroy?.();
        // A custom iterator can leave next() pending even after destroy().
        void Promise.resolve(iterator.return?.()).catch(() => { });
    };
    let timer;
    let timedOut = false;
    const expiry = new Promise((_, reject) => {
        timer = setTimeout(() => {
            timedOut = true;
            reject(new RawBodyTimeoutError(stop));
        }, timeoutMs);
    });
    try {
        for (;;) {
            const { done, value } = await Promise.race([iterator.next(), expiry]);
            if (done)
                return;
            yield value;
        }
    }
    finally {
        clearTimeout(timer);
        // On timeout the adapter must send its 408 before closing the socket.
        if (!timedOut)
            void Promise.resolve(iterator.return?.()).catch(() => { });
    }
}
export function stopAfterReply(response, stop, send) {
    let stopped = false;
    const cleanup = () => {
        if (stopped)
            return;
        stopped = true;
        response?.removeListener?.("finish", cleanup);
        response?.removeListener?.("close", cleanup);
        stop();
    };
    response?.once?.("finish", cleanup);
    response?.once?.("close", cleanup);
    try {
        send();
    }
    catch (err) {
        cleanup();
        throw err;
    }
    finally {
        if (!response?.once)
            cleanup();
    }
}
//# sourceMappingURL=raw-body.js.map