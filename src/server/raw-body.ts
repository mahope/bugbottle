import { DEFAULT_BODY_TIMEOUT_MS } from "./handle.ts";

export class RawBodyTimeoutError extends Error {
  readonly stop: () => void;

  constructor(stop: () => void) {
    super("Report took too long to arrive");
    this.stop = stop;
  }
}

/** One deadline for the entire upload, including time between chunks. */
export async function* timedChunks(
  raw: AsyncIterable<unknown> & { destroy?: () => unknown },
  timeoutMs = DEFAULT_BODY_TIMEOUT_MS,
): AsyncGenerator<unknown> {
  const iterator = raw[Symbol.asyncIterator]();
  const stop = () => {
    raw.destroy?.();
    // A custom iterator can leave next() pending even after destroy().
    void Promise.resolve(iterator.return?.()).catch(() => {});
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  const expiry = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(new RawBodyTimeoutError(stop));
    }, timeoutMs);
  });
  try {
    for (;;) {
      const { done, value } = await Promise.race([iterator.next(), expiry]);
      if (done) return;
      yield value;
    }
  } finally {
    clearTimeout(timer);
    // On timeout the adapter must send its 408 before closing the socket.
    if (!timedOut) void Promise.resolve(iterator.return?.()).catch(() => {});
  }
}

export function stopAfterReply(
  response: { once?: (event: "finish", listener: () => void) => unknown } | undefined,
  stop: () => void,
): void {
  if (response?.once) response.once("finish", stop);
  else stop();
}
