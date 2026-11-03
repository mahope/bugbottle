# Local Workers receiver

From the repository root, with Node 22+:

```sh
npm ci --ignore-scripts
npm run build
npm run smoke:workers
```

The smoke packs bugbottle, installs only that tarball into a temporary consumer,
bundles this example through the public `bugbottle/server` export, and starts
the pinned local `workerd` runtime. No account, credentials, deployment or
external sink is used. The configuration has no `nodejs_compat` flag and no
outbound network service. The script stops and awaits the runtime in `finally`,
with a 30-second watchdog and forced termination fallback.

`POST /report` accepts reports from `Origin: https://app.example`. A valid
report returns 201 and `{ "id": "report_1" }`; malformed JSON returns 400;
another or missing origin returns 401 through `authorize`. CORS alone is not
an origin check. `POST /signed-report` also requires an HMAC signature using
the public demonstration key `public-demo-key`. This is friction, not a secret
or authentication. The test wrapper mints a signature using workerd's own
WebCrypto and checks unsigned, tampered, valid and replayed requests.

The exported `reports` Map lets the local test wrapper inspect storage. It is
neither durable, shared across isolates nor bounded: replace it with your own
Worker-compatible store before using this pattern in an application. The
`/__stored` and `/__sign` routes exist only in the test wrapper, not this example.

To run the example interactively after building the repository:

```sh
node_modules/.bin/esbuild examples/workers/worker.mjs --bundle --format=esm --platform=neutral '--external:node:*' --outfile=examples/workers/bundle.mjs
node_modules/.bin/workerd serve examples/workers/workerd.capnp --socket-addr=http=127.0.0.1:8787
```

Stop with Ctrl-C. `node:*` is marked external only so esbuild can resolve the
barrel's unused Node-only exports before tree shaking; no Node implementation
is supplied. The smoke requires the final bundle to have **zero external
imports** and no `node:` references, then executes it without Node globals.
Import named portable helpers; do not import the whole barrel namespace.

`handleReport`, validation, Markdown, fingerprinting and the HTTP sinks use
Fetch/Web APIs. Signature verification requires WebCrypto. `fileStore` needs
Node filesystem/path/crypto APIs; SMTP needs Node sockets/TLS. Express and
Fastify adapters target Node request streams. Those helpers are not portable
Worker storage or delivery adapters.
