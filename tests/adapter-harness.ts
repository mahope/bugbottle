/**
 * What the Vue and Svelte adapter tests share: a DOM, a renderer that never
 * touches a canvas, a stubbed `fetch` and a queue stand-in.
 *
 * The React test file grew these first and keeps its own copies on purpose —
 * it is the one file that pins the hook's behaviour, and the refactor onto
 * `src/report-state.ts` had to leave it untouched to prove that. The two
 * adapters below assert the same behaviour through their own primitives.
 */

import type { ScreenshotRenderer } from "../src/capture.ts";

export const ENDPOINT = "https://example.test/api/bug-reports";
export const PNG = "data:image/png;base64,AAAA";

/**
 * Puts a happy-dom window on `globalThis`, the way the hook test does.
 *
 * Node already owns names such as `fetch`, `setTimeout` and `console`, and
 * happy-dom's versions of those would fight the test runner. Only the DOM
 * names Node lacks are copied, plus the handful the element picker looks up by
 * identity (`e.target instanceof Element` needs *this* Element).
 */
export async function installDom() {
  const { Window } = await import("happy-dom");
  const win = new Window({ url: "https://example.test/orders?tab=open" });
  const globals = globalThis as unknown as Record<string, unknown>;
  const forced = new Set([
    "window",
    "document",
    "navigator",
    "location",
    "getComputedStyle",
    "requestAnimationFrame",
    "cancelAnimationFrame",
    "Element",
    "HTMLElement",
    "Node",
    "Event",
    "CustomEvent",
    "MouseEvent",
    "KeyboardEvent",
    "PointerEvent",
    "DocumentFragment",
    "MutationObserver",
  ]);
  for (const key of Object.getOwnPropertyNames(win)) {
    if (key.startsWith("_")) continue;
    if (!forced.has(key) && key in globals) continue;
    try {
      globals[key] = (win as unknown as Record<string, unknown>)[key];
    } catch {
      // A few properties are getter-only on the window; none of them matter here.
    }
  }
  return win;
}

/** Lets everything already queued as a microtask or a timer run. */
export const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** A renderer that never touches a canvas, and counts how often it was asked. */
export function fakeRenderer(dataUrl = PNG) {
  let calls = 0;
  const render: ScreenshotRenderer = async () => {
    calls += 1;
    return dataUrl;
  };
  return {
    render,
    get calls() {
      return calls;
    },
  };
}

/** Replaces the global `fetch` for one test and restores it afterwards. */
export function stubFetch(reply: (url: string, init: RequestInit) => Response) {
  const original = globalThis.fetch;
  const seen: { url: string; body: unknown }[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    seen.push({ url, body: init.body ? JSON.parse(String(init.body)) : null });
    return reply(url, init);
  }) as typeof globalThis.fetch;
  return {
    seen,
    restore() {
      globalThis.fetch = original;
    },
  };
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A queue stand-in that only records what it was handed. */
export function fakeQueue() {
  const queued: unknown[] = [];
  return {
    queued,
    queue: {
      enqueue: (report: unknown) => void queued.push(report),
      flush: async () => 0,
      size: () => queued.length,
      clear: () => void queued.splice(0),
      destroy: () => {},
    },
  };
}
