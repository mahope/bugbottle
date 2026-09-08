/**
 * The report payloads the tests send, in one place.
 *
 * `tests/handle.test.ts` posts these at `handleReport`, and
 * `tests/schema.test.ts` validates the same objects against the generated
 * `report.schema.json`. Sharing them is the point: a payload the receiver
 * accepts but the published schema rejects would be a documentation bug that
 * two separate copies of the fixture could hide.
 *
 * Not a `*.test.ts` file, so `npm test` does not try to run it.
 */

/** A report the way the browser sends one: message, context, a console entry. */
export const reportBody = {
  type: "bug",
  message: "The save button does nothing",
  context: { url: "/orders/91", viewport: "1440x900", userAgent: "Chrome 141" },
  console: [{ level: "error", message: "save failed", ts: "2026-09-07T10:00:00.000Z" }],
};

/** The smallest valid PNG data URL: signature plus a byte, base64-encoded. */
export const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]);

export const PNG_DATA_URL = `data:image/png;base64,${Buffer.from(PNG_BYTES).toString("base64")}`;

/** The same report with every optional section and every optional fact filled in. */
export const fullReportBody = {
  ...reportBody,
  context: {
    ...reportBody.context,
    language: "en-GB",
    timezone: "Europe/Copenhagen",
    screen: "2560x1440@2",
    colorScheme: "dark",
    online: true,
    connection: "4g",
  },
  console: [
    {
      level: "error",
      message: "Uncaught: order.save is not a function",
      ts: "2026-09-07T10:00:00.000Z",
      stack: [
        { file: "https://app.test/assets/main.js", line: 12, col: 9, fn: "saveOrder" },
        { file: "https://app.test/assets/vendor.js", line: 1, col: 1 },
      ],
    },
  ],
  elements: [
    {
      selector: "form#checkout > button:nth-of-type(2)",
      tag: "button",
      text: "Save",
      rect: { x: 12, y: 340, width: 88, height: 36 },
      attributes: { id: "save", type: "submit" },
    },
  ],
  breadcrumbs: [
    { ts: "2026-09-07T09:59:58.000Z", kind: "navigation", from: "/orders", to: "/orders/91" },
    { ts: "2026-09-07T09:59:59.000Z", kind: "click", target: "button#save", text: "Save" },
  ],
  network: [
    {
      ts: "2026-09-07T10:00:00.000Z",
      method: "POST",
      url: "/api/orders/91",
      status: 500,
      ms: 812,
    },
    { ts: "2026-09-07T10:00:01.000Z", method: "GET", url: "/api/me", status: 0, ms: 30, error: true },
  ],
  perf: {
    lcp: 3412,
    cls: 0.081,
    inp: 210,
    ttfb: 128,
    domContentLoaded: 641,
    load: 1200,
    longTasks: { count: 3, totalMs: 480 },
    memory: { usedMB: 32, limitMB: 2048 },
  },
  storage: {
    local: [
      { key: "theme", length: 4 },
      { key: "authToken", length: 132 },
    ],
    session: [{ key: "cart", length: 7 }],
    cookies: ["session", "consent"],
    values: { tenant: "acme" },
  },
  screenshotDataUrl: PNG_DATA_URL,
};
