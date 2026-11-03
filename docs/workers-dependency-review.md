# Workers smoke dependency review

Reviewed 2026-11-03 before installation. Decision: **install with
`--ignore-scripts`**, dev-only, exact pin `workerd@1.20260730.1`.

- Maintainer: Cloudflare's `wrangler-publisher`; source is
  [cloudflare/workerd](https://github.com/cloudflare/workerd), an established
  runtime project since 2022. This is also the runtime version used by stable
  `miniflare@4.20260730.0`, without Miniflare's additional dependency tree.
- npm release metadata dates this version to 2026-07-30 01:06 UTC, well beyond
  the three-day minimum. Daily runtime releases are the established cadence.
  The current latest (1.20261103.1) is less than three days old and was not used.
- Six new lock entries: the wrapper and five optional platform binaries, all
  exactly 1.20260730.1. Only the matching platform binary is installed. The
  binaries have no npm dependencies or lifecycle scripts. No runtime dependency
  is added to bugbottle or the packed smoke consumer.
- Inspected the npm tarball's `install.js` and `lib/main.js`. The wrapper's
  `postinstall` validates/selects the binary and can download a missing binary
  through npm/HTTPS. Scripts are therefore disabled. The runtime path resolver
  reads platform/filesystem information; its environment-dependent Yarn/PnP
  handling does not send environment data or make network calls on import.
- The smoke imports the binary path from `workerd`, which works with scripts
  disabled when optional platform packages are installed. It executes only our
  locally bundled example. The worker configuration exposes loopback HTTP,
  with no external network service or bindings. No Cloudflare tooling/account
  authentication, telemetry client or credential loading is involved.

Reproduce metadata inspection with `npm view workerd@1.20260730.1` and inspect
the tarball with `npm pack workerd@1.20260730.1 --ignore-scripts`. The existing
esbuild dependency performs bundling; no new bundler or polyfill is installed.
