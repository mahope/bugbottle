# Compiled Svelte form

One form and an in-memory localhost receiver, using **Svelte 5.57.1** and its
real component compiler from the root lockfile. `Form.svelte` imports
`bugbottle/svelte`; `$form` creates the real component subscription and input
handlers call `setMessage` and `setContact`. `onMount` opens the form and
`onDestroy` destroys it. The fixture counts its wrapped subscription so the
browser smoke can check compiler-driven unsubscribe on unmount.

From the repository root (Node 22):

```sh
npm ci
npm run build
node examples/forms/server.mjs svelte
```

Open http://127.0.0.1:8787. Enter synthetic text and a contact such as
`demo@example.invalid`, then Send. The success line includes the receiver's
id. Unmount form and Mount form exercise component disposal and a fresh form.
Ctrl-C stops the receiver and removes the temporary consumer directory.
Reports exist only in memory and disappear on shutdown; nothing is logged or
sent to third parties. No account, database, CDN or credentials are required.

The shared runner creates a local `npm pack --ignore-scripts` tarball,
extracts it into an isolated consumer's `node_modules/bugbottle`, compiles the
component and bundles it with esbuild. Both browser and receiver resolve
package exports from that artifact, never `src/`. Framework tooling comes
from the existing root installation; there is no second install or lockfile.

Run the browser smoke (both frameworks) after building:

```sh
# Same browser driver/version as the existing CI browser audits:
npm install -g puppeteer-core@25.3.0 --ignore-scripts
npm run smoke:forms
```

Use an installed stable Chrome; the existing `scripts/chrome.mjs` supports
`CHROME_BIN` when autodetection is insufficient. The smoke starts and stops
its own loopback receivers on ephemeral ports, verifies message/contact and
success, checks disposal, then remounts and verifies exactly one new delivery.
CI runs the same command in its browser job. This exercises Svelte 5, not
every version allowed by the package's optional peer range.

Browser screenshots are also opt-in: run
`FORMS_SCREENSHOT_DIR=/tmp/form-shots npm run smoke:forms` to save a PNG of
each framework's success state. The smoke saves no browser images by default.

Screenshots are disabled: no renderer is supplied, and the smoke asserts that
no screenshot is received. To opt in, import `htmlToImage` from
`bugbottle/html-to-image`, pass `screenshot: htmlToImage` and
`screenshotFor: () => false` to `createBugReport`, then let an explicit checkbox
call `form.toggleScreenshot(checked)` before submitting. This uses the
lockfile's local `html-to-image`, with no CDN or third-party account. Keep the
form marked `data-bugbottle` so it is excluded from pictures. Screenshot
capture is outside this submission smoke's scope.
