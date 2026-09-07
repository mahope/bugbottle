import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";

/**
 * The error boundary needs React and a DOM, so this file sets up a happy-dom
 * window before React is loaded — the same arrangement, and the same reasons,
 * as `use-bug-report.test.ts`.
 */
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
globals["IS_REACT_ACT_ENVIRONMENT"] = true;

const { act, cleanup, render } = await import("@testing-library/react");
const { createElement } = await import("react");
const { BugReportBoundary, createRootErrorHandlers, describeRenderError } = await import(
  "../src/react/boundary.ts"
);

const ENDPOINT = "https://example.test/api/bug-reports";

/** A fetch that never leaves the process, and remembers what it was given. */
function fakeFetch(status = 201) {
  const bodies: Record<string, unknown>[] = [];
  const fn = (async (_input: unknown, init?: { body?: unknown }) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response(JSON.stringify(status < 400 ? { id: "rep_1" } : { error: "no" }), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof globalThis.fetch;
  return { fn, bodies };
}

/** A component that fails the way a real one does: in the middle of rendering. */
function Boom(): never {
  throw new Error("Cannot read properties of undefined (reading 'total')");
}

/**
 * React writes every caught error to the console, which is correct in an
 * application and noise in a test run. Silenced only around the render.
 */
async function renderQuietly(element: ReturnType<typeof createElement>) {
  const original = console.error;
  console.error = () => {};
  try {
    let result!: ReturnType<typeof render>;
    await act(async () => {
      result = render(element);
    });
    return result;
  } finally {
    console.error = original;
  }
}

/** Lets the send promise and its `then` settle. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 10));

test("the boundary renders the fallback and reports what it caught", async () => {
  const { fn, bodies } = fakeFetch();
  let reported: string | undefined | null = null;
  const { container } = await renderQuietly(
    createElement(
      BugReportBoundary,
      {
        endpoint: ENDPOINT,
        fetch: fn,
        extra: { appVersion: "1.4.2" },
        onReport: (_error, id) => {
          reported = id;
        },
        fallback: (error, report) =>
          createElement("button", { type: "button", onClick: () => void report() }, error.message),
      },
      createElement(Boom),
    ),
  );

  const button = container.querySelector("button");
  assert.ok(button, "the fallback is rendered instead of the broken subtree");
  assert.match(button.textContent ?? "", /reading 'total'/);
  assert.equal(bodies.length, 0, "nothing is sent until the reporter asks for it");

  await act(async () => {
    button.dispatchEvent(new win.MouseEvent("click", { bubbles: true }) as unknown as Event);
    await flush();
  });

  assert.equal(bodies.length, 1);
  const body = bodies[0] as { type?: string; message?: string; appVersion?: string };
  assert.equal(body.type, "bug");
  assert.equal(body.appVersion, "1.4.2");
  assert.match(String(body.message), /Cannot read properties of undefined/);
  assert.match(String(body.message), /Component stack:/);
  assert.match(String(body.message), /Boom/);
  assert.equal(reported, "rep_1");
  cleanup();
});

test("a failed send is reported to onError and never thrown at the page", async () => {
  const { fn } = fakeFetch(500);
  const errors: unknown[] = [];
  const { container } = await renderQuietly(
    createElement(
      BugReportBoundary,
      {
        endpoint: ENDPOINT,
        fetch: fn,
        onError: (error) => errors.push(error),
        fallback: (_error, report) =>
          createElement("button", { type: "button", onClick: () => void report() }, "Tell us"),
      },
      createElement(Boom),
    ),
  );

  // The boundary catching is itself an onError call, before anything is sent.
  assert.equal(errors.length, 1);
  const button = container.querySelector("button");
  assert.ok(button);
  await act(async () => {
    button.dispatchEvent(new win.MouseEvent("click", { bubbles: true }) as unknown as Event);
    await flush();
  });
  assert.equal(errors.length, 2, "the failed send is the second");
  cleanup();
});

test("children render untouched while nothing throws", async () => {
  const { fn, bodies } = fakeFetch();
  const { container } = await renderQuietly(
    createElement(
      BugReportBoundary,
      { endpoint: ENDPOINT, fetch: fn, fallback: () => createElement("p", null, "broken") },
      createElement("span", null, "the orders list"),
    ),
  );
  assert.equal(container.textContent, "the orders list");
  assert.equal(bodies.length, 0);
  cleanup();
});

test("the root handlers report each distinct error once per window", async () => {
  const { fn, bodies } = fakeFetch();
  const handlers = createRootErrorHandlers({ endpoint: ENDPOINT, fetch: fn, dedupeMs: 60_000 });
  const error = new Error("the whole root fell over");
  const info = { componentStack: "\n    at App" };

  handlers.onUncaughtError(error, info);
  handlers.onCaughtError(error, info);
  handlers.onUncaughtError(error, info);
  await flush();
  assert.equal(bodies.length, 1, "one report, however many times the tree throws it");

  handlers.onUncaughtError(new Error("a different failure"), info);
  await flush();
  assert.equal(bodies.length, 2);
  assert.match(String(bodies[1]?.message), /a different failure/);
});

test("clicking report twice files one report, and the fallback is told it is sending", async () => {
  let release!: () => void;
  const bodies: Record<string, unknown>[] = [];
  const fn = (async (_input: unknown, init?: { body?: unknown }) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    await new Promise<void>((resolve) => (release = resolve));
    return new Response(JSON.stringify({ id: "rep_1" }), {
      status: 201,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof globalThis.fetch;

  let report!: () => Promise<boolean>;
  const { container } = await renderQuietly(
    createElement(
      BugReportBoundary,
      {
        endpoint: ENDPOINT,
        fetch: fn,
        fallback: (_error, send, sending) => {
          report = send;
          return createElement(
            "button",
            { type: "button", disabled: sending, onClick: () => void send() },
            sending ? "sending" : "tell us",
          );
        },
      },
      createElement(Boom),
    ),
  );

  // A worried person clicks the button twice. It is the same render error both
  // times, so it must be the same send.
  let first!: Promise<boolean>;
  let second!: Promise<boolean>;
  await act(async () => {
    first = report();
    second = report();
  });
  assert.equal(first, second, "the second call joined the first send");
  assert.equal(bodies.length, 1, "one POST, not two");
  assert.equal(container.querySelector("button")?.textContent, "sending");

  await act(async () => {
    release();
    await flush();
  });
  assert.equal(await first, true);
  assert.equal(container.querySelector("button")?.textContent, "tell us", "and it is over");

  // The report is filed. Clicking again is the same click.
  await act(async () => {
    void report();
    await flush();
  });
  assert.equal(bodies.length, 1, "a click after a successful send files nothing new");
  cleanup();
});

test("a send that failed can be tried again", async () => {
  const { fn, bodies } = fakeFetch(500);
  let report!: () => Promise<boolean>;
  await renderQuietly(
    createElement(
      BugReportBoundary,
      {
        endpoint: ENDPOINT,
        fetch: fn,
        fallback: (_error, send) => {
          report = send;
          return createElement("p", null, "broken");
        },
      },
      createElement(Boom),
    ),
  );

  await act(async () => {
    assert.equal(await report(), false);
  });
  await act(async () => {
    assert.equal(await report(), false);
  });
  assert.equal(bodies.length, 2, "the guard is lifted by a failure, not by a success");
  cleanup();
});

test("a render error is described with its stack and its component stack", () => {
  const described = describeRenderError(new TypeError("nope"), "\n    at Row\n    at Table");
  assert.match(described, /^TypeError: nope/);
  assert.match(described, /Component stack:/);
  assert.match(described, /at Table/);
  // Anything can be thrown in JavaScript, including a string.
  assert.match(describeRenderError("just a string", null), /^Render error: just a string$/);
});
