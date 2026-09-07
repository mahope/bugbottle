import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  initBreadcrumbs,
  getBreadcrumbs,
  resetBreadcrumbs,
  isBreadcrumbsActive,
} from "../src/breadcrumbs.ts";
import { buildReport } from "../src/send.ts";
import { normaliseBreadcrumbs, MAX_BREADCRUMBS } from "../src/report-core.ts";
import { toMarkdown } from "../src/markdown.ts";

/**
 * Node has EventTarget but no DOM, so `document`, `window`, `history` and
 * `location` are stood up by hand — the same trick `console-buffer.test.ts`
 * uses for `window`.
 */
type FakeElement = {
  tagName: string;
  id: string;
  parentElement: FakeElement | null;
  previousElementSibling: FakeElement | null;
  ownerDocument: null;
  textContent: string;
  innerText?: string;
  attributes: Record<string, string>;
  closest(selector: string): FakeElement | null;
  getAttribute(name: string): string | null;
};

function element(
  tagName: string,
  options: { id?: string; text?: string; inside?: string[] } = {},
): FakeElement {
  const inside = options.inside ?? [];
  const el: FakeElement = {
    tagName: tagName.toUpperCase(),
    id: options.id ?? "",
    parentElement: null,
    previousElementSibling: null,
    ownerDocument: null,
    textContent: options.text ?? "",
    attributes: {},
    closest: (selector) => (inside.includes(selector) ? el : null),
    getAttribute: () => null,
  };
  return el;
}

type Listener = (event: unknown) => void;

/** A document that only does what breadcrumbs asks of it. */
function fakeDocument() {
  const listeners = new Map<string, Listener[]>();
  return {
    hidden: false,
    addEventListener(type: string, fn: Listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), fn]);
    },
    removeEventListener(type: string, fn: Listener) {
      listeners.set(type, (listeners.get(type) ?? []).filter((l) => l !== fn));
    },
    dispatch(type: string, event: unknown) {
      for (const fn of listeners.get(type) ?? []) fn(event);
    },
  };
}

type Globals = {
  document?: unknown;
  window?: unknown;
  history?: unknown;
  location?: unknown;
};

type FakeHistory = {
  pushState: (data: unknown, unused: string, url?: string) => void;
  replaceState: (data: unknown, unused: string, url?: string) => void;
  calls: string[];
};

type Browser = {
  doc: ReturnType<typeof fakeDocument>;
  win: EventTarget;
  history: FakeHistory;
  /** Move the fake location, the way a real navigation would. */
  go: (path: string) => void;
};

function withBrowser(fn: (env: Browser) => void): void {
  const g = globalThis as Globals;
  const doc = fakeDocument();
  const win = new EventTarget();
  const location = { href: "https://app.example/orders/1", pathname: "/orders/1", search: "" };
  const calls: string[] = [];
  const history = {
    calls,
    pushState: (_d: unknown, _u: string, url?: string) => void calls.push(`push:${url}`),
    replaceState: (_d: unknown, _u: string, url?: string) => void calls.push(`replace:${url}`),
  };
  // `collectContext` reads these off `window`, so a bare EventTarget is not enough.
  Object.assign(win, {
    location,
    innerWidth: 1440,
    innerHeight: 900,
    navigator: { userAgent: "test" },
  });
  g.document = doc;
  g.window = win;
  g.history = history;
  g.location = location;
  const go = (path: string) => {
    const url = new URL(path, "https://app.example");
    location.href = url.href;
    location.pathname = url.pathname;
    location.search = url.search;
  };
  try {
    fn({ doc, win, history, go });
  } finally {
    delete g.document;
    delete g.window;
    delete g.history;
    delete g.location;
  }
}

afterEach(() => resetBreadcrumbs());

test("a click records the selector and the trimmed text", () => {
  withBrowser(({ doc }) => {
    initBreadcrumbs();
    doc.dispatch("click", { target: element("button", { id: "save", text: "  Save   order \n" }) });
  });
  const crumbs = getBreadcrumbs();
  assert.equal(crumbs.length, 1);
  assert.equal(crumbs[0]?.kind, "click");
  assert.equal(crumbs[0]?.target, "button#save");
  assert.equal(crumbs[0]?.text, "Save order");
  assert.ok(!Number.isNaN(Date.parse(crumbs[0]?.ts ?? "")), "each crumb is timestamped");
});

test("an input never contributes its value as text", () => {
  withBrowser(({ doc }) => {
    initBreadcrumbs();
    const input = element("input", { id: "email", text: "someone@example.com" });
    input.innerText = "someone@example.com";
    doc.dispatch("click", { target: input });
  });
  const crumb = getBreadcrumbs()[0];
  assert.equal(crumb?.target, "input#email");
  assert.equal(crumb?.text, undefined, "a field's value is never recorded");
});

test("a long label is clipped to 40 characters", () => {
  withBrowser(({ doc }) => {
    initBreadcrumbs();
    doc.dispatch("click", { target: element("a", { id: "x", text: "z".repeat(100) }) });
  });
  assert.equal(getBreadcrumbs()[0]?.text?.length, 40);
});

test("elements inside [data-bugbottle] are not recorded at all", () => {
  withBrowser(({ doc }) => {
    initBreadcrumbs();
    doc.dispatch("click", {
      target: element("button", { id: "close", text: "Close", inside: ["[data-bugbottle]"] }),
    });
  });
  assert.equal(getBreadcrumbs().length, 0, "the library's own panel is not part of the story");
});

test("[data-bugbottle-mask] records the selector but no text", () => {
  withBrowser(({ doc }) => {
    initBreadcrumbs();
    doc.dispatch("click", {
      target: element("button", {
        id: "reveal",
        text: "Jane Doe, 1970-01-01",
        inside: ["[data-bugbottle-mask]"],
      }),
    });
  });
  const crumb = getBreadcrumbs()[0];
  assert.equal(crumb?.target, "button#reveal");
  assert.equal(crumb?.text, undefined);
});

test("a submit records the form selector only", () => {
  withBrowser(({ doc }) => {
    initBreadcrumbs();
    doc.dispatch("submit", { target: element("form", { id: "checkout", text: "Pay now" }) });
  });
  const crumb = getBreadcrumbs()[0];
  assert.equal(crumb?.kind, "submit");
  assert.equal(crumb?.target, "form#checkout");
  assert.equal(crumb?.text, undefined);
});

test("a visibility change records hidden and visible", () => {
  withBrowser(({ doc }) => {
    initBreadcrumbs();
    doc.hidden = true;
    doc.dispatch("visibilitychange", {});
    doc.hidden = false;
    doc.dispatch("visibilitychange", {});
  });
  assert.deepEqual(
    getBreadcrumbs().map((c) => `${c.kind}:${c.to}`),
    ["visibility:hidden", "visibility:visible"],
  );
});

test("pushState and replaceState are patched, and the originals still run", () => {
  withBrowser(({ history }) => {
    initBreadcrumbs();
    history.pushState({}, "", "/orders/2?tab=notes#secret-token");
    history.replaceState({}, "", "/orders/3");
  });
  const crumbs = getBreadcrumbs();
  assert.equal(crumbs.length, 2);
  assert.equal(crumbs[0]?.kind, "navigation");
  assert.equal(crumbs[0]?.from, "/orders/1");
  assert.equal(crumbs[0]?.to, "/orders/2?tab=notes", "path and query only, no origin, no fragment");
  assert.equal(crumbs[1]?.from, "/orders/2?tab=notes");
  assert.equal(crumbs[1]?.to, "/orders/3");
});

test("popstate and hashchange are recorded, and the patch is undone on reset", () => {
  withBrowser(({ win, history, go }) => {
    initBreadcrumbs();
    const patched = history.pushState;
    go("/orders/9");
    win.dispatchEvent(new Event("popstate"));
    assert.equal(getBreadcrumbs().at(-1)?.to, "/orders/9");

    resetBreadcrumbs();
    assert.notEqual(patched, history.pushState, "the original pushState is back");
    win.dispatchEvent(new Event("popstate"));
    history.pushState({}, "", "/orders/10");
    assert.equal(getBreadcrumbs().length, 0, "nothing is recorded after a reset");
    assert.deepEqual(history.calls.at(-1), "push:/orders/10", "the real pushState still ran");
  });
});

test("the buffer keeps the most recent entries, not the first", () => {
  withBrowser(({ doc }) => {
    initBreadcrumbs({ maxEntries: 3 });
    for (let i = 0; i < 5; i++) {
      doc.dispatch("click", { target: element("button", { id: `b${i}`, text: `b${i}` }) });
    }
  });
  assert.deepEqual(
    getBreadcrumbs().map((c) => c.target),
    ["button#b2", "button#b3", "button#b4"],
  );
});

test("the default ring buffer holds 30", () => {
  withBrowser(({ doc }) => {
    initBreadcrumbs();
    for (let i = 0; i < MAX_BREADCRUMBS + 5; i++) {
      doc.dispatch("click", { target: element("button", { id: `b${i}` }) });
    }
  });
  const crumbs = getBreadcrumbs();
  assert.equal(crumbs.length, MAX_BREADCRUMBS);
  assert.equal(crumbs[0]?.target, "button#b5", "the oldest were dropped");
});

test("beforeBreadcrumb can drop a crumb or rewrite it", () => {
  withBrowser(({ doc, history }) => {
    initBreadcrumbs({
      beforeBreadcrumb: (crumb) => {
        if (crumb.kind === "click") return null;
        return { ...crumb, to: crumb.to?.replace(/\/\d+/, "/:id") };
      },
    });
    doc.dispatch("click", { target: element("button", { id: "save", text: "Save" }) });
    history.pushState({}, "", "/orders/77");
  });
  const crumbs = getBreadcrumbs();
  assert.equal(crumbs.length, 1, "the click was dropped");
  assert.equal(crumbs[0]?.to, "/orders/:id", "the path was rewritten before it was stored");
});

test("the returned buffer is a copy", () => {
  withBrowser(({ doc }) => {
    initBreadcrumbs();
    doc.dispatch("click", { target: element("button", { id: "one" }) });
  });
  const snapshot = getBreadcrumbs();
  snapshot.push({ ts: "", kind: "click", target: "injected" });
  assert.equal(getBreadcrumbs().length, 1, "callers cannot mutate the buffer");
});

test("initialising twice does not double-record", () => {
  withBrowser(({ doc }) => {
    initBreadcrumbs();
    initBreadcrumbs();
    doc.dispatch("click", { target: element("button", { id: "once" }) });
  });
  assert.equal(getBreadcrumbs().length, 1);
});

test("buildReport attaches breadcrumbs while recording, and nothing when not", () => {
  assert.equal(isBreadcrumbsActive(), false);
  const before = buildReport({ type: "bug", message: "no recorder" });
  assert.equal(before.breadcrumbs, undefined, "an app that never imported the module pays nothing");

  withBrowser(({ doc, history }) => {
    initBreadcrumbs();
    doc.dispatch("click", { target: element("button", { id: "save", text: "Save" }) });
    history.pushState({}, "", "/orders/2");

    const report = buildReport({ type: "bug", message: "the save button does nothing" });
    assert.equal(report.breadcrumbs?.length, 2);
    assert.equal(report.breadcrumbs?.[0]?.target, "button#save");
    assert.equal(report.breadcrumbs?.[1]?.to, "/orders/2");

    const off = buildReport({ type: "bug", message: "x", includeBreadcrumbs: false });
    assert.equal(off.breadcrumbs, undefined, "includeBreadcrumbs: false wins");
  });

  resetBreadcrumbs();
  assert.equal(
    buildReport({ type: "bug", message: "after" }).breadcrumbs,
    undefined,
    "a reset unregisters the source",
  );
});

test("normaliseBreadcrumbs drops what it cannot recognise", () => {
  const crumbs = normaliseBreadcrumbs([
    null,
    "click",
    42,
    { kind: "keypress", text: "hunter2" },
    { kind: "click", target: "button#a", ts: "not a date" },
    { kind: "navigation", to: "/b", from: 7 },
    { kind: "visibility", to: "hidden", ts: "2026-09-07T08:12:31.004Z" },
  ]);
  assert.equal(crumbs.length, 3);
  assert.equal(crumbs[0]?.ts, "", "an unparseable timestamp becomes empty rather than a lie");
  assert.equal(crumbs[0]?.target, "button#a");
  assert.equal(crumbs[1]?.from, undefined, "a non-string field is left out");
  assert.equal(crumbs[2]?.ts, "2026-09-07T08:12:31.004Z");
  assert.deepEqual(normaliseBreadcrumbs("not an array"), []);
  assert.deepEqual(normaliseBreadcrumbs(undefined), []);
});

test("normaliseBreadcrumbs clips strings, strips null bytes and keeps the newest", () => {
  const nul = String.fromCharCode(0);
  const [crumb] = normaliseBreadcrumbs([
    { kind: "click", target: `button${nul}#a`, text: "t".repeat(200), to: "/x".repeat(600) },
  ]);
  assert.equal(crumb?.target, "button#a", "a null byte would be refused by the database");
  assert.equal(crumb?.text?.length, 40);
  assert.equal(crumb?.to?.length, 500);

  const many = Array.from({ length: 40 }, (_, i) => ({ kind: "click", target: `b${i}` }));
  const kept = normaliseBreadcrumbs(many);
  assert.equal(kept.length, MAX_BREADCRUMBS);
  assert.equal(kept[0]?.target, "b10", "the oldest were dropped");
  assert.equal(normaliseBreadcrumbs(many, { maxBreadcrumbs: 2 }).length, 2);
});

test("toMarkdown renders What happened before, between the elements and the console", () => {
  const md = toMarkdown({
    type: "bug",
    message: "The save button does nothing",
    breadcrumbs: [
      { ts: "2026-09-07T08:12:30.000Z", kind: "click", target: "button#save", text: "Save order" },
      { ts: "2026-09-07T08:12:30.500Z", kind: "navigation", from: "/orders/1", to: "/orders/2" },
      { ts: "2026-09-07T08:12:31.000Z", kind: "submit", target: "form#checkout" },
      { ts: "2026-09-07T08:12:31.500Z", kind: "visibility", to: "hidden" },
    ],
    elements: [
      { selector: "button#save", tag: "button", text: "Save order", rect: {}, attributes: {} },
    ],
    console: [{ ts: "2026-09-07T08:12:32.000Z", level: "error", message: "boom" }],
  });
  assert.match(md, /### What happened before/);
  assert.match(md, /- 2026-09-07T08:12:30\.000Z clicked `button#save` — "Save order"/);
  assert.match(md, /navigated `\/orders\/1` → `\/orders\/2`/);
  assert.match(md, /submitted `form#checkout`/);
  assert.match(md, /page hidden/);
  assert.ok(
    md.indexOf("Element pointed at") < md.indexOf("What happened before"),
    "the timeline sits after the elements",
  );
  assert.ok(
    md.indexOf("What happened before") < md.indexOf("Console (1 entry)"),
    "and before the console",
  );
  assert.doesNotMatch(toMarkdown({ type: "bug", message: "x" }), /What happened before/);
});

test("a beforeBreadcrumb that throws drops the crumb instead of the navigation", () => {
  withBrowser(({ doc, history }) => {
    initBreadcrumbs({
      beforeBreadcrumb: () => {
        throw new Error("the hook has a bug");
      },
    });
    assert.doesNotThrow(
      () => doc.dispatch("click", { target: element("button", { id: "save", text: "Save" }) }),
      "a click is not the hook's chance to break the page",
    );
    assert.doesNotThrow(
      () => history.pushState({}, "", "/orders/2"),
      "the router's own pushState must not throw because a bugbottle hook did",
    );
    assert.deepEqual(history.calls, ["push:/orders/2"], "the real pushState still ran");
  });
  assert.equal(getBreadcrumbs().length, 0, "a hook that cannot decide drops the crumb");
});

test("text inside a contenteditable region is masked, selector only", () => {
  withBrowser(({ doc }) => {
    initBreadcrumbs();
    doc.dispatch("click", {
      target: element("div", {
        id: "note-body",
        text: "Ring Anna on 0123456789 about the invoice",
        inside: ["[contenteditable]:not([contenteditable=\"false\"])"],
      }),
    });
  });
  const crumb = getBreadcrumbs()[0];
  assert.equal(crumb?.target, "div#note-body");
  assert.equal(crumb?.text, undefined, "a rich-text editor is a field, whatever tag it uses");
});

test("an option's label is masked the same way a select's value is", () => {
  withBrowser(({ doc }) => {
    initBreadcrumbs();
    doc.dispatch("click", { target: element("option", { id: "plan", text: "Anna Berg" }) });
  });
  assert.equal(getBreadcrumbs()[0]?.text, undefined);
});

test("a navigation that goes nowhere is not recorded", () => {
  withBrowser(({ win, history }) => {
    initBreadcrumbs();
    win.dispatchEvent(new Event("hashchange"));
    win.dispatchEvent(new Event("hashchange"));
    assert.ok(
      getBreadcrumbs().length <= 1,
      "two fragment changes on the same path are not two navigations",
    );
    history.replaceState({}, "", "/orders/1");
    assert.equal(
      getBreadcrumbs().filter((c) => c.kind === "navigation").length,
      0,
      "replaceState to the identical URL records nothing",
    );
  });
});

test("maxEntries: 0 records nothing at all", () => {
  withBrowser(({ doc, history }) => {
    initBreadcrumbs({ maxEntries: 0 });
    assert.equal(isBreadcrumbsActive(), false, "there is nothing to be active for");
    doc.dispatch("click", { target: element("button", { id: "save", text: "Save" }) });
    history.pushState({}, "", "/orders/2");
  });
  assert.equal(getBreadcrumbs().length, 0);
});

test("a maxEntries that is not a number falls back to the default bound", () => {
  withBrowser(({ doc }) => {
    initBreadcrumbs({ maxEntries: Number.NaN });
    for (let i = 0; i < MAX_BREADCRUMBS + 5; i++) {
      doc.dispatch("click", { target: element("button", { id: `b${i}` }) });
    }
  });
  assert.equal(getBreadcrumbs().length, MAX_BREADCRUMBS, "NaN must not remove the bound");
});
