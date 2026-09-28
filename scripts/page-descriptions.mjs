/* One sentence per page for <meta name="description"> — the text a search
   engine shows under the title, and the cheapest growth there is, because the
   ranking is already there and only the choice is not.
   build-docs.mjs falls back to the first paragraph of the page when a slug is
   missing, and the build fails on a description that is clipped or that talks
   about the site instead of the page. That fallback is why this file is a map
   and not a second copy of the prose: the paragraph is written for a reader who
   has just clicked, and a reader on a results page has not.
   Three rules, all learned from the 40 descriptions this replaced, every one of
   which was the opening paragraph of its page, clipped mid-word:
   1. Say what the page is *for*, in the words somebody types. The name of the
      API is usually the query — "fastifyHandler", "error.tsx", "svelte:boundary".
   2. Never refer to the site. "The sixth framework in this row", "every other
      page on this list" and "the same state machine" are true on the page and
      meaningless under a title; a result that says them gets rewritten or
      skipped.
   3. Whole words, under 158 characters. A description Google clips is a
      description Google wrote instead.
   Keys are the page slugs. Two of the fifty are Danish. Every generated page is
   in here, including `install`: a fallback that is allowed to be right is a
   fallback somebody will come to rely on, and the build cannot tell right from
   lucky. */

/* Words that only mean something while you are reading the site. Kept as a list
   rather than a paragraph of rules, because the rule is easy to break by
   accident and hard to notice: a page whose opening sentence was rewritten for
   a reader can pass every other check and still ship a snippet nobody clicks. */
export const SELF_REFERENTIAL = [
  "this row",
  "this list",
  "this readme",
  "the ones above",
  "the frameworks above",
  "the same state machine",
  "does not yet have a page",
];

/* Google shows roughly 158 characters of a desktop snippet and fewer on a
   phone, so this is the ceiling rather than a target. */
export const MAX_DESCRIPTION_CHARS = 158;

export const PAGE_DESCRIPTIONS = {
  "a-working-example":
    "A Node server and a plain HTML form with no build step: bugbottle/server receives the report and checks every field in it.",
  angular:
    "Catch Angular errors without losing the console line: app.config.errorHandler, provideBrowserGlobalErrorListeners and the button on your 500 page.",
  api: "Every export in bugbottle, what it takes and what it returns. From 1.0 the list is a contract, and a rename needs a major version.",
  astro: "Astro has no error handler, so a report is built from astro:hydration-error and your own try/catch. Includes the island that never hydrates.",
  "catching-render-errors-react":
    "BugReportBoundary renders your fallback and reports the render error from it. createRootErrorHandlers covers the errors no boundary catches.",
  changelog:
    "Every release of bugbottle: what it added, what it fixed, and what it cost in bytes. Search it to find the version a change landed in.",
  compare: "bugbottle next to Marker.io, Jam, Sentry User Feedback, BugPin and rrweb, with the bundle size of each measured by the same build.",
  fastify: "Receive a report in Fastify with fastifyHandler, raise the default 1 MB bodyLimit, and keep the raw body so a signed report verifies.",
  "feeding-reports-to-an-agent":
    "A report with a selector, the element's text, the page path and the last console errors is usually enough context for a coding agent.",
  "global-errors":
    "window.onerror and unhandledrejection: the two events a browser fires when nothing caught the error, and what bugbottle records from both.",
  "github-action":
    "A GitHub Action that validates exported bugbottle reports in CI, so a report that reaches your repository is checked before anyone reads it.",
  hono: "Receive a report in Hono, Cloudflare Workers, Deno, Bun and Node: handleReport is a Request in and a Response out, with no adapter to write.",
  install:
    "Install bugbottle with npm or one script tag. It keeps a ring buffer of console errors and posts the report to an endpoint you own.",
  "kom-i-gang":
    "Tre veje til en første bugbottle-rapport: script-tag, WordPress-plugin, og en bundler med React-, Vue-, Svelte- eller Solid-hook.",
  "languages-and-branding":
    "Eight languages and the --bb-* CSS variables. Every string a reporter sees lives in a Locale, and your stylesheet never meets ours.",
  licence: "bugbottle is MIT licensed, so it is free to use in commercial and closed-source work. There is no other licence and no paid tier.",
  express: "expressHandler in Express: the 100 kB express.json() limit that 413s a screenshot, a signed route behind a body parser, and a 500 that pastes a stack trace.",
  "every-framework-one-table":
    "Every framework in one table: the hook, the file it goes in, and the four classes of failure it misses — Vue, Next.js, Angular, SvelteKit, Astro and more.",
  nestjs: "A NestJS exception filter runs on the server, so it cannot build a report. The browser side is the panel, and the route needs a 5 MB limit.",
  nextjs: "error.tsx, global-error.tsx and a button on the error page in Next.js: where a render error is reported without losing its console line.",
  nuxt: "vue:error, app:error, error.vue and fatal errors in Nuxt, and why showError() deletes the console line the report is built from.",
  "one-script-tag":
    "dist/bugbottle.js is the whole widget in one script tag: no build step, no framework, and a data-endpoint attribute instead of a bundler.",
  "opening-it-without-a-button":
    "Open the report panel with a keyboard shortcut, a shake, a custom event or your own button, using bugbottle/triggers and no floating icon.",
  "performance-and-storage":
    "Web Vitals, long tasks, navigation timings, the JS heap and a storage snapshot, so a report says whether it was slow and what the browser held.",
  privatliv: "Hvad bugbottle indsamler, hvor det ender, og hvor længe du opbevarer det — plus de spørgsmål du bør have svar på.",
  "please-read-this-part":
    "A screenshot holds whatever the reporter could see. Read this before you turn screenshots on, and before bugbottle goes near personal data.",
  "pointing-at-the-element":
    "pickElement() turns the cursor into a crosshair and resolves with a CSS selector, the element's text and its attributes, so the report names it.",
  "privacy-checklist":
    "What bugbottle collects, where the report goes, how long you keep it, and the questions to have answered before somebody asks them.",
  react: "A plain React app has no error hook of its own. createRootErrorHandlers covers the root, and in React 19 it is not a development-only path.",
  "react-router":
    "React Router v7, v8 and Remix: the declarative and the data error boundary, useRevalidator on the error page, and three modes that differ.",
  sveltekit:
    "SvelteKit: adding handleError deletes the console line, the server hook logs where nobody listens, and a server load error is never reported twice.",
  "tanstack-router":
    "TanStack Router: onCatch never runs without an errorComponent, and the global boundary is silent in production. The one line that fixes both.",
  "tanstack-query":
    "TanStack Query has no error boundary and does not throw by default. QueryCache onError, throwOnError, isError, retry, and the trap in each.",
  "receiving-a-report":
    "handleReport is the whole endpoint: it validates every field, scrubs, decides what happens to the screenshot, stores the report and calls the sinks.",
  recipes: "The endpoint is the same everywhere; only the sentence that produces a Request differs. One short recipe per framework and per host.",
  "recording-console-errors":
    "initConsoleBuffer keeps the last errors and warnings in a ring buffer. Call it once, as early as your application code runs.",
  releasing: "How a bugbottle release is cut: the version bump, the changelog, npm run release, and what CI does with the tag afterwards.",
  "replay-with-rrweb":
    "attachRrweb(record) puts the last half-minute of your own rrweb events in the report, masked, and trimmed to the window and the byte cap.",
  sammenlign: "bugbottle sammenlignet med Marker.io, Jam, Sentry User Feedback, BugPin og rrweb, med størrelserne målt af det samme buildværktøj.",
  "self-hosted":
    "Self-hosted error reporting with no server to run: a route in your own app, a container, or the WordPress plugin. What it costs.",
  screenshots: "captureScreenshot takes a renderer rather than importing one, so html-to-image stays optional. Field values are masked for the render.",
  "sending-it-somewhere":
    "Eleven sinks in bugbottle/server: Slack, Discord, Teams, mail, GitHub, Linear, Jira, GitLab, Sentry, SMTP and a plain webhook.",
  support: "There is no paid tier. What a donation to bugbottle goes to, what it does not buy, and how to help without spending money.",
  svelte: "svelte:boundary in Svelte 5 and SvelteKit: onerror, failed, the errors the boundary never sees, and the panel on your error page.",
  "the-form-anything-else":
    "No adapter and no framework: buildReport, collectContext and sendReport, and a form is a textarea, a button and somewhere for the picture.",
  "the-form-react":
    "useBugReport is a form as state: type, message, the file input, the send button and the queued state, over one machine with no React in it.",
  "the-form-solid":
    "createBugReport in Solid is one signal over that state machine; every value is an accessor, so the JSX tracks exactly what it reads.",
  "the-form-svelte":
    "createBugReport in Svelte is a readable store: $form for the values, and the methods on form for everything the reporter does.",
  "the-form-vue": "useBugReport in Vue is refs and computeds over that state machine. type and message are writable, so v-model works on them.",
  "the-payload": "The JSON your endpoint receives, field by field: what is required, what is optional, and which limit applies to each of them.",
  "the-ready-made-panel":
    "mountBugbottle puts a floating button and a dialog in a shadow root: a form, a screenshot, a queue and eight languages in about 12 kB.",
  vue: "app.config.errorHandler in a plain Vue app sees nearly everything, and an onErrorCaptured hook returning false deletes the error first.",
  "what-happened-before":
    "initBreadcrumbs records the last few clicks, navigations and submits, so the report says what the reporter was doing when it broke.",
  "what-the-network-did":
    "initNetwork records the failed and the slow requests, never a body and never a header, so 'the save button does nothing' names the fetch.",
  "when-the-network-is-down":
    "createQueue keeps reports in localStorage or IndexedDB and flushes them when the browser is back online, so an outage does not lose them.",
  "who-makes-it":
    "bugbottle is made by Mads Holst Jensen, a freelance developer in Denmark. MIT licensed, no company behind it, and no plan kept secret.",
  wordpress: "The bugbottle WordPress plugin mounts the panel and adds the route that receives it. One activation, though it is not in the directory yet.",
};
