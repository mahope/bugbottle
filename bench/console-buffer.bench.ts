/**
 * Benchmarks for src/console-buffer.ts — run with `npm run bench`.
 *
 * Measures whether the console buffer's patching and serialisation cost is
 * something a host application would actually feel. No behaviour is changed
 * here; see bench/README.md for the numbers and what they mean.
 */
import { initConsoleBuffer, resetConsoleBuffer } from "../src/console-buffer.ts";

const WARMUP = 5_000;
const ITERATIONS = 200_000;
const LATENCY_ITERATIONS = 50_000;

function silence<T>(fn: () => T): T {
  const realError = console.error;
  const realWarn = console.warn;
  console.error = () => {};
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.error = realError;
    console.warn = realWarn;
  }
}

function deepObject(): unknown {
  return {
    id: "req_8f3a1c2b",
    user: { id: 42, roles: ["admin", "billing"], settings: { theme: "dark", locale: "da-DK" } },
    request: {
      method: "POST",
      url: "/api/orders/8842",
      headers: { "content-type": "application/json", "x-request-id": "abc-123-def-456" },
      body: { items: [{ sku: "A1", qty: 2 }, { sku: "B7", qty: 1 }], total: 129.5 },
    },
    stack: ["at handler (server.ts:42)", "at dispatch (router.ts:88)", "at listener (http.ts:12)"],
  };
}

function entriesPerSecond(label: string, iterations: number, arg: unknown): void {
  // `arg` is built once and reused so the loop times serialise() and push(),
  // not the cost of constructing a fresh Error (which captures a stack trace)
  // or object literal on every call.
  silence(() => {
    initConsoleBuffer();
    for (let i = 0; i < WARMUP; i++) console.error(arg);

    const start = process.hrtime.bigint();
    for (let i = 0; i < iterations; i++) console.error(arg);
    const end = process.hrtime.bigint();

    resetConsoleBuffer();

    const seconds = Number(end - start) / 1e9;
    const rate = iterations / seconds;
    console.log(`${label.padEnd(28)} ${rate.toFixed(0).padStart(12)} entries/s`);
  });
}

function averageLatency(label: string, iterations: number, call: () => void): number {
  const start = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) call();
  const end = process.hrtime.bigint();
  const micros = Number(end - start) / 1e3 / iterations;
  console.log(`${label.padEnd(28)} ${micros.toFixed(3).padStart(12)} µs/call`);
  return micros;
}

console.log("--- throughput (entries/second) ---");
entriesPerSecond("string args", ITERATIONS, "save failed for order 8842");
entriesPerSecond("Error args", ITERATIONS, new Error("save failed for order 8842"));
entriesPerSecond("deep object args", ITERATIONS, deepObject());

console.log("\n--- latency per console.error call ---");
silence(() => {
  for (let i = 0; i < WARMUP; i++) console.error("save failed for order 8842");
  const baseline = averageLatency("unpatched console", LATENCY_ITERATIONS, () =>
    console.error("save failed for order 8842"),
  );

  initConsoleBuffer();
  for (let i = 0; i < WARMUP; i++) console.error("save failed for order 8842");
  const patched = averageLatency("patched (bugbottle)", LATENCY_ITERATIONS, () =>
    console.error("save failed for order 8842"),
  );
  resetConsoleBuffer();

  console.log(`\nadded latency: ${(patched - baseline).toFixed(3)} µs/call`);
});
