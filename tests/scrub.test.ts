import { test } from "node:test";
import assert from "node:assert/strict";
import { scrubReport, BUILTIN_SCRUBBERS, DEFAULT_REPLACEMENT } from "../src/scrub.ts";
import type { BugReport } from "../src/report-core.ts";

const R = DEFAULT_REPLACEMENT;

/** A minimal valid report, with the message and url the test cares about. */
function report(message: string, url = "/orders/42"): BugReport & Record<string, unknown> {
  return {
    type: "bug",
    message,
    context: { url, viewport: "1440x900", userAgent: "Mozilla/5.0" },
  };
}

test("an email address in the message is redacted", () => {
  const out = scrubReport(report("write to anna.berg+work@example.co.uk about it"));
  assert.equal(out.message, `write to ${R} about it`);
});

test("a bearer token is redacted but the scheme is kept", () => {
  const out = scrubReport(report("sent Authorization: Bearer sk_live_ab12CD34-ef_56 and got 401"));
  assert.equal(out.message, `sent Authorization: Bearer ${R} and got 401`);
});

test("a JWT is redacted", () => {
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1";
  const out = scrubReport(report(`the cookie held ${jwt} yesterday`));
  assert.equal(out.message, `the cookie held ${R} yesterday`);
});

test("a card number passing Luhn is redacted, with or without spaces", () => {
  assert.equal(scrubReport(report("paid with 4242424242424242")).message, `paid with ${R}`);
  assert.equal(scrubReport(report("paid with 4242 4242 4242 4242")).message, `paid with ${R}`);
  assert.equal(scrubReport(report("amex 378282246310005 declined")).message, `amex ${R} declined`);
});

test("a 16-digit order number that fails Luhn is kept", () => {
  const out = scrubReport(report("order 1234567890123456 never shipped"));
  assert.equal(out.message, "order 1234567890123456 never shipped");
});

test("digit runs outside 13 to 19 digits are kept", () => {
  const out = scrubReport(report("ref 123456789012 and 12345678901234567890 look wrong"));
  assert.equal(out.message, "ref 123456789012 and 12345678901234567890 look wrong");
});

test("an IBAN is redacted", () => {
  const out = scrubReport(report("refund to GB82WEST12345698765432 please"));
  assert.equal(out.message, `refund to ${R} please`);
});

test("a query value with a sensitive key is redacted in the url, keeping the key", () => {
  const out = scrubReport(report("x", "/orders/42?tab=notes&access_token=abc123&api_key=zz"));
  assert.equal(out.context.url, `/orders/42?tab=notes&access_token=${R}&api_key=${R}`);
});

test("prose that happens to say key= is left alone, because it is not a url", () => {
  const out = scrubReport(report("the key=value pair in the config is wrong"));
  assert.equal(out.message, "the key=value pair in the config is wrong");
});

test("nested fields are scrubbed: console, element text, href and data attributes", () => {
  const out = scrubReport({
    ...report("x"),
    console: [
      { ts: "2026-09-07T08:12:31.004Z", level: "error", message: "401 for anna@example.com" },
      { ts: "2026-09-07T08:12:32.004Z", level: "warn", message: "retrying" },
    ],
    elements: [
      {
        selector: "a#invite",
        tag: "a",
        text: "Invite anna@example.com",
        rect: { x: 1, y: 2, width: 3, height: 4 },
        attributes: {
          href: "/invite?token=s3cret&page=2",
          "data-user": "anna@example.com",
          id: "invite",
        },
      },
    ],
  });
  assert.equal(out.console?.[0]?.message, `401 for ${R}`);
  assert.equal(out.console?.[1]?.message, "retrying");
  const element = out.elements?.[0];
  assert.equal(element?.text, `Invite ${R}`);
  assert.equal(element?.attributes.href, `/invite?token=${R}&page=2`);
  assert.equal(element?.attributes["data-user"], R);
  assert.equal(element?.attributes.id, "invite", "structural attributes are left alone");
});

test("every attribute but the structural three is scrubbed, aria-label included", () => {
  const out = scrubReport({
    ...report("x"),
    elements: [
      {
        selector: "button#invite",
        tag: "button",
        text: "Invite",
        rect: { x: 1, y: 2, width: 3, height: 4 },
        attributes: {
          "aria-label": "Invite anna@example.com",
          title: "Last invited by bo@example.com",
          name: "invite anna@example.com",
          placeholder: "anna@example.com",
          id: "invite",
          role: "button",
          type: "submit",
        },
      },
    ],
  });
  const attributes = out.elements?.[0]?.attributes;
  assert.equal(attributes?.["aria-label"], `Invite ${R}`);
  assert.equal(attributes?.title, `Last invited by ${R}`);
  assert.equal(attributes?.name, `invite ${R}`);
  assert.equal(attributes?.placeholder, R);
  assert.equal(attributes?.id, "invite");
  assert.equal(attributes?.role, "button");
  assert.equal(attributes?.type, "submit");
});

test("breadcrumbs are scrubbed when the field is there, string by string", () => {
  const out = scrubReport({
    ...report("x"),
    breadcrumbs: [
      { category: "click", message: "signed in as anna@example.com", level: 3 },
      "navigated to anna@example.com",
      null,
    ],
  }) as Record<string, unknown>;
  const crumbs = out.breadcrumbs as [Record<string, unknown>, string, null];
  assert.equal(crumbs[0].message, `signed in as ${R}`);
  assert.equal(crumbs[0].category, "click");
  assert.equal(crumbs[0].level, 3, "non-strings are left as they are");
  assert.equal(crumbs[1], `navigated to ${R}`);
  assert.equal(crumbs[2], null);
});

test("the screenshot is passed through untouched", () => {
  const screenshotDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
  const out = scrubReport({ ...report("anna@example.com"), screenshotDataUrl });
  assert.equal(out.screenshotDataUrl, screenshotDataUrl);
});

test("the report handed in is not modified", () => {
  const input = report("anna@example.com", "/x?token=abc");
  const out = scrubReport(input);
  assert.equal(input.message, "anna@example.com");
  assert.equal(input.context.url, "/x?token=abc");
  assert.notEqual(out, input);
  assert.notEqual(out.context, input.context);
});

test("a custom pattern is applied on top of the built-ins", () => {
  const out = scrubReport(report("ticket ACME-1234 from anna@example.com"), {
    patterns: [/\bACME-\d+\b/g],
  });
  assert.equal(out.message, `ticket ${R} from ${R}`);
});

test("keep switches a built-in off and leaves the rest on", () => {
  const out = scrubReport(report("anna@example.com paid with 4242424242424242"), {
    keep: ["email"],
  });
  assert.equal(out.message, `anna@example.com paid with ${R}`);
});

test("the replacement text can be changed", () => {
  const out = scrubReport(report("anna@example.com"), { replacement: "***" });
  assert.equal(out.message, "***");
});

test("malformed input never throws", () => {
  assert.doesNotThrow(() => scrubReport(null));
  assert.doesNotThrow(() => scrubReport(undefined));
  assert.doesNotThrow(() => scrubReport("anna@example.com"));
  assert.doesNotThrow(() => scrubReport(42));
  assert.doesNotThrow(() => scrubReport([1, 2, 3]));
  assert.equal(scrubReport(null), null);
  assert.equal(scrubReport("anna@example.com"), "anna@example.com", "a bare string is not a report");

  const junk = {
    type: 7,
    message: { nope: true },
    context: "not an object",
    console: ["a string", null, { message: 5 }],
    elements: [null, { text: 1, attributes: "no" }, { attributes: { href: null } }],
    breadcrumbs: "not an array",
  };
  const out = scrubReport(junk);
  assert.deepEqual(out, junk, "nothing scrubbable, nothing changed");

  assert.doesNotThrow(() =>
    scrubReport(report("x"), { patterns: ["not a regex" as unknown as RegExp], keep: undefined }),
  );
});

test("a self-referential report does not hang the scrubber", () => {
  const input = report("anna@example.com") as Record<string, unknown>;
  input.self = input;
  const out = scrubReport(input) as Record<string, unknown>;
  assert.equal(out.message, R);
  assert.equal(out.self, input, "unknown fields are copied across, not walked");
});

test("the contact field is kept unless the application asks for it to go", () => {
  const withContact = { ...report("it broke"), contact: "call me on 12345678" };
  assert.equal(
    scrubReport(withContact).contact,
    "call me on 12345678",
    "an address the reporter typed on purpose is not a leak",
  );
  assert.equal(scrubReport(withContact, { contact: true }).contact, R);
  // The whole line goes, not only the part a pattern would have matched.
  assert.equal(scrubReport({ ...withContact, contact: "anna@example.com" }, { contact: true }).contact, R);
  assert.equal(
    "contact" in scrubReport(report("it broke"), { contact: true }),
    false,
    "a report without a contact line does not grow one",
  );
});

test("the built-in patterns are exported so they can be reused or inspected", () => {
  assert.deepEqual(Object.keys(BUILTIN_SCRUBBERS).sort(), [
    "bearer",
    "card",
    "email",
    "iban",
    "jwt",
    "query",
  ]);
  for (const [name, scrubber] of Object.entries(BUILTIN_SCRUBBERS)) {
    assert.ok(scrubber.pattern.global, `${name} must be a global regex`);
  }
});
