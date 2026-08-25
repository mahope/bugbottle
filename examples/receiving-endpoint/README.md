# Receiving-endpoint example

A complete, runnable receiving endpoint for `bugbottle`: auth, validation via
`bugbottle/server`, upload to a private bucket, and an authenticated route
that streams the screenshot back.

This exists because the main README's advice — "put screenshots somewhere
private" — is the most important part of the library and the easiest to get
wrong. Media buckets commonly carry a public-read policy, so a screenshot
written there is readable by anyone holding the URL. This example shows the
whole path, not just the warning.

## Files

- **`route.ts`** — `POST` receives a report and (optionally) a screenshot;
  `GET` streams a screenshot back to the reporter who filed it. Written as
  Next.js Route Handler exports (`Request` in, `Response` out); adapt the
  export shape to your framework, the logic inside doesn't change.
- **`s3.ts`** — a from-scratch S3-compatible client: request signing
  (SigV4), `putObject`, `getObject`, and `assertBucketIsPrivate`. No SDK, no
  dependency — see "Why no SDK" below.
- **`db.ts`** — an in-memory stand-in for your database. Swap `db.reports`
  for your own; the one thing to keep is storing a storage *key*, never a
  URL, on the row.

## Setup

```bash
S3_ENDPOINT=https://s3.eu-central-1.amazonaws.com   # or your provider's origin
S3_REGION=eu-central-1
S3_BUCKET=your-private-bucket
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

The bucket must have all four S3 public-access blocks enabled
(`BlockPublicAcls`, `IgnorePublicAcls`, `BlockPublicPolicy`,
`RestrictPublicBuckets`) — `assertBucketIsPrivate` in `s3.ts` checks this
before every upload and refuses to write if it can't confirm them. This is
deliberate: a screenshot ending up on a bucket that *could* be made public is
a configuration bug, not a risk worth taking silently.

Wire `getUser()` in `route.ts` to your real session/auth check, and
`db.ts` to your real database.

## Storage-agnostic, on purpose

SigV4 — the request-signing scheme in `s3.ts` — is accepted by AWS S3,
Cloudflare R2, MinIO, DigitalOcean Spaces, and Backblaze B2's S3-compatible
endpoint. Point `S3_ENDPOINT` at whichever one you use; nothing else in this
example changes. That's the "no vendor lock-in" this example is trying to
demonstrate, not just claim.

### Why no SDK

`bugbottle` itself ships zero runtime dependencies on purpose, and this
example follows the same discipline rather than reaching for
`@aws-sdk/client-s3` (which pulls in a lot for what amounts to a handful of
signed HTTP requests). `s3.ts` implements SigV4 directly against `fetch` and
the Web Crypto API — both already available in Node 18+, and in every
serverless/edge runtime this route is likely to run on. If you'd rather use
a vendor SDK, `s3.ts` is the one file to replace; `route.ts` and `db.ts`
don't need to change.

## What this deliberately doesn't do

- **Rate limiting, CSRF, request size limits at the framework level** — those
  belong to your framework/infrastructure, not this example.
- **Retrying a failed upload** — `bugbottle/server`'s
  `decodeScreenshotDataUrl` already treats a bad screenshot as "store the
  report without the picture," and `route.ts` follows that: a failed upload
  never fails the report.
