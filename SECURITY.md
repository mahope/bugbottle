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
- `bugbottle/sign` puts an HMAC-SHA-256 over `<timestamp>.<body>` on the
  request and `handleReport`'s `signature` option verifies it in constant time,
  refusing a body that was tampered with, signed under an unknown key, older
  than the skew window or replayed. The key ships to the browser and is
  therefore public: this raises the cost of posting rubbish to a public
  endpoint, and it authenticates nobody. Keep the rate limit and the
  authorisation.
- The replay cache is bounded per *signed second* — 128 digests each, 640
  seconds at a time — rather than globally, because a public key means a flood
  of valid signatures is free to produce. A flood can only displace digests
  dated the same second it floods, so a captured honest body cannot be replayed
  by filling the cache with unrelated traffic. It is still one instance's
  memory: give `signature.replayStore` a shared store (Redis, a table with a
  TTL) when several instances answer the same endpoint.
- The rate limit counts against the connection address only, unless
  `trustProxy` says a forwarding header may name the caller instead. It
  defaults to `false` because a header is a claim: reading `X-Forwarded-For`
  unconditionally lets any caller pick their own bucket, which is not a limit
  at all. The cost of the default behind a proxy is the opposite mistake —
  every visitor in one bucket — so set it deliberately, and to the number of
  hops you actually control.
- The rate limit and the dedupe have the same seam —
  `rateLimit.rateLimitStore` and `dedupe.dedupeStore` — and the opposite
  failure mode on purpose: a replay store that throws answers 500, because an
  unchecked signature is the replay it exists to stop, while those two fail
  open, because an honest report must not be refused when a shared store
  blinks. A rate limit is a defence in depth beside `authorize`, never the
  thing that keeps a report safe.
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
