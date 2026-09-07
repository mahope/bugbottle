# Security

bugbottle handles two things that deserve care: screenshots of an application,
which can contain anything the reporter could see, and payloads from a browser,
which a server is about to write to storage.

## Reporting a vulnerability

Email **mads@mahope.dk** with a description and, if you have one, a way to
reproduce. You will get a reply within a few days. Please do not open a public
issue for anything that could expose a reporter's data or let a payload reach
storage unchecked.

Once fixed, the issue is credited in `CHANGELOG.md` unless you would rather it
was not.

## What the library does

- Server validators clip every string, strip null bytes, whitelist the report
  type and console levels, and verify the PNG signature in the decoded
  screenshot bytes rather than trusting the declared MIME type. Size ceilings
  are enforced before decoding.
- The console buffer records `error` and `warn` only. `log` and `debug`, where
  stray user data usually ends up, are never captured.
- Page context is path and query only — no origin, no fragment.
- The network log in `bugbottle/network` records the method, URL, status and
  duration of a request and nothing else. Request and response bodies are never
  recorded, and neither are headers, in either direction; sensitive query
  values in the URL are redacted before the entry is stored.
- Screenshots are rendered from the DOM, never from the screen, so a capture
  cannot include another tab, window, or the desktop.
- Screenshots are masked before they are taken and restored immediately after:
  field values and `contenteditable` text become bullets, `data-bugbottle-mask`
  text is bulleted and `data-bugbottle-block` regions are covered. On by
  default, `mask: false` to switch it off. It hides the fields it knows about,
  so anything else sensitive on the page still has to be marked.
- No cookies, no identifiers, no third-party calls. A report goes to the
  endpoint you configure and nowhere else.
- `scrubReport` redacts email addresses, bearer tokens, JWTs, Luhn-valid card
  numbers, IBANs and sensitive query values when you wire it in, on either
  side; `beforeSend` can drop a report outright. Both are opt-in, and pattern
  matching catches shapes, not everything.

## What the library cannot do for you

- Decide where screenshots are stored. Use a bucket with no public read
  policy, and serve pictures back through an authenticated route.
- Authenticate the reporter. Do it in your endpoint before touching the body.
- Mark what only you can recognise. Masking covers form fields on its own;
  a name your application paints into a `div` is hidden only if you add
  `data-bugbottle-mask`. If a screenshot could still contain someone else's
  data, say so next to the checkbox, or leave the screenshot option out.

The README section *Please read this part* covers this in more detail.
