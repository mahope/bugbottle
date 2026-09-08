# The public API, read once before 1.0

One reading of the whole public surface at 0.8.0, on 8 September 2026, before
1.0 freezes it: every export of the eighteen entry points, every option object,
every `data-*` attribute and every `window.bugbottle` member, looked at for
naming consistency, option shapes, things exported by accident, and things
documented but not typed or typed but not documented. Issue #62.

The table at the end is the whole surface. This half is what it says.

## What was read

`package.json#exports`, the eighteen `dist/*.d.ts` trees behind it, the README
"API" section and its script-tag attribute table, `src/global.ts` and
`src/global-slim.ts` for `window.bugbottle`, and `dist/report.schema.json`.

| | |
|---|---|
| Entry points | 18 code + `./report.schema.json` + `./package.json` |
| Exported bindings | 412 (315 distinct names: 159 types, 127 constants, 118 functions, 8 classes) |
| Untyped exports | 0 — every entry is a `tsc`-emitted declaration, so nothing can be exported without a type |
| Documented in the README but not exported | 0 |
| Exported but not named in the README | 75 distinct names, of which 40 are `MAX_*`/`SLACK_MAX_*`/`DISCORD_MAX_*` limits the README covers as a group; the remaining 35 are named individually in this change |

The schema cannot drift from the types: `scripts/build-schema.ts` generates
`report.schema.json` from `BugReport` and `tests/schema.test.ts` pins its
`maxLength`/`maxItems` to the `MAX_*` constants.

## The rules the audit settled

These are now in CLAUDE.md's Conventions, so the next export is named by rule
rather than by whichever module it lands in.

1. **A function is a verb, a value is a noun.** `captureScreenshot`,
   `buildReport`, `pickElement`, `resolveLocale` — against `locales`, `Queue`,
   `DISCORD_COLOURS`. Two exceptions were examined and kept: `fingerprint`,
   which reads as the verb it also is, and `htmlToImage`, which is a renderer
   value rather than a call.
2. **Every `init*` returns its `stop()`.** `initPerf` already returned
   `resetPerf`; `initConsoleBuffer`, `initBreadcrumbs` and `initNetwork`
   returned `void` and now return the matching `reset*`. The `on*` and
   `attach*` listeners already returned theirs. A caller can now undo anything
   it started without importing a second name.
3. **An optional capability is handed in, never imported.** `screenshot`,
   `annotate`, `shake`, `scrub`, `sign`, `queue` and — since #70 — `network`
   and `perf` are all functions or objects the application passes to the panel
   or the state machine, so the module is in a bundle only when it is used.
   Nothing breaks the rule now: the panel starts and stops both recorders, and
   the script tag hands them in for `data-network` and `data-perf` rather than
   calling them behind the panel's back.
4. **One name per idea across option objects.** `endpoint` for the address this
   library POSTs to; `headers`, `credentials`, `fetch`, `signal`, `timeoutMs`
   for the request; `onError` for "something failed, here it is";
   `maxEntries` for a ring buffer's length and `maxBytes` for a payload's size;
   `beforeSend`/`before*` for a last look at what is about to leave. A
   third-party address keeps the vendor's own word — `webhookUrl`, `host`,
   `site`, `dsn` — because that is what their documentation calls it, and so do
   their credentials: `token`, `apiKey`, `apiToken`.
5. **One prefix for a ceiling, `MAX_*`, and one for a default, `DEFAULT_*`.**
   Slack and Discord put the vendor first; the `MAX_SLACK_*` and
   `MAX_DISCORD_*` spellings now exist beside them.
6. **Every `data-*` attribute is a mount option of the same name.** Seventeen
   of the nineteen already were, counting `data-primary` and `data-position` as
   `theme` and `data-brand`/`data-logo` as `brand`; #70 added the last two,
   `network` and `perf`, so all nineteen are. `data-sign-key` is `sign`
   deliberately: the attribute takes a key because a script tag cannot pass a
   function, and the option takes the signer that key would have built.
7. **Nothing is exported without being named in the README.** A group line
   ("the `MAX_*` limits") covers a family; anything else is named.

## What landed with this audit

Nothing was removed and nothing changed meaning. Each rename added the new name
and kept the old one working with an `@deprecated` JSDoc, tested on both
spellings, and each has an issue for its removal in 1.0.

| Old name | New name | Removal |
|---|---|---|
| `SendOptions.onFailure` | `SendOptions.onError` | #63 |
| `QueueOptions.maxItems` | `QueueOptions.maxEntries` | #64 |
| `SLACK_MAX_*`, `DISCORD_MAX_*` (13) | `MAX_SLACK_*`, `MAX_DISCORD_*` | #65 |
| `RateLimitOptions.rateLimitStore` | `RateLimitOptions.store` | #66 |
| `DedupeOptions.dedupeStore` | `DedupeOptions.store` | #66 |
| `SignatureOptions.replayStore` | `SignatureOptions.store` | #66 |
| `SendReportWebhookOptions.url` | `SendReportWebhookOptions.endpoint` | #67 |

Where both names are given, the new one wins and the old one is ignored rather
than merged: two spellings of one option are a mistake to make loudly, not a
thing to guess about.

Also landed: the three `init*` return values from rule 2, the thirty-five
export names the README never mentioned, and `tests/exports.test.ts`, which
fails if `package.json#exports` gains or loses an entry without CLAUDE.md's
count and the README's API list following it.

## What is left for 1.0

Breaking, so each is its own issue rather than a change here.

- **#63–#67** remove the seven aliases above.
- **#68** takes the thirteen server validators and `toMarkdown` off the `.`
  entry. They are tree-shaken today, so this is about what the core entry says
  it is, not about bytes.
- **#69** gives the seven sinks one shape for the picture address:
  `screenshotUrl` a string, `screenshotUrlFrom` a function. Slack and Discord
  currently take the function under the first name, which is the only place in
  the package where one key has two types depending on the import.
- ~~**#70** mirrors `data-network` and `data-perf` with `network` and `perf`
  mount options on the hand-it-in seam.~~ Landed: `MountOptions.network` and
  `MountOptions.perf` take `initNetwork` and `initPerf`, or `{ on, …options }`,
  started on mount and stopped in `destroy()`. Typed structurally, so
  `src/ui/` imports neither module. It was additive, and it was the one hole in
  rules 3 and 6.

## Deliberately left alone

- **`window.bugbottle.mount` and `.mountBugbottle`** are the same function under
  two names. The short one is what the README uses and what a page with no
  bundler types; the long one matches the ESM export. Both stay.
- **The helpers the sinks export** — `buildSlackMessage`, `buildDiscordMessage`,
  `buildSentryEvent`, `buildSentryEnvelope`, `buildJiraDescription`,
  `parseSentryDsn`, `jiraBaseUrl`, `jiraAuthHeader`, `sentryAuthHeader`,
  `escapeSlack`, `clipBytes`, `messageFromJiraBody`, `messageFromGitlabBody` —
  look like test seams and are, but every one of them is documented and a
  server that wants the body without the send has no other way to get it.
- **`bugbottle/triggers`' small predicates** — `parseShortcut`,
  `matchesShortcut`, `isEditableTarget`, `eventSource`, `deepActiveElement`,
  `isApplePlatform`, `describeUncaught` — are the pieces a page needs to wire
  its own shortcut, and the entry is budgeted with them in it.
- **`HandleReportOptions.maxBodyBytes`** stays `maxBodyBytes` rather than
  `maxBytes`: the server caps the request body, `RrwebOptions.maxBytes` caps a
  replay, and the two numbers are not the same idea.
- **`CaptureOptions.maxDataUrlLength`** is a string length, not a byte count,
  and the name is the honest one.

## Every export

Read at 0.8.0, before the fixes above landed; the verdict column is what was
decided about each. A name that appears under more than one entry is the same
symbol re-exported, not a copy.

### `bugbottle`

| Name | Kind | Source | Documented | Verdict |
|---|---|---|---|---|
| `Breadcrumb` | type | `src/report-core.ts` | no | documented in this change |
| `BreadcrumbKind` | type | `src/report-core.ts` | no | documented in this change |
| `BugReport` | type | `src/report-core.ts` | no | documented in this change |
| `buildReport` | function | `src/send.ts` | yes | keep |
| `BuildReportInput` | type | `src/send.ts` | no | documented in this change |
| `buildSelector` | function | `src/element-picker.ts` | yes | keep |
| `BUILTIN_SCRUBBERS` | const | `src/scrub.ts` | yes | keep |
| `CaptureInfo` | type | `src/capture.ts` | yes | keep |
| `CaptureOptions` | type | `src/capture.ts` | no | documented in this change |
| `captureScreenshot` | function | `src/capture.ts` | yes | keep |
| `collectContext` | function | `src/capture.ts` | yes | keep |
| `ConsoleBufferOptions` | type | `src/console-buffer.ts` | no | documented in this change |
| `ConsoleEntry` | type | `src/report-core.ts` | no | documented in this change |
| `ConsoleLevel` | type | `src/report-core.ts` | no | documented in this change |
| `DEFAULT_BLOCK_SELECTOR` | const | `src/mask.ts` | yes | keep |
| `DEFAULT_BYTES_PER_PIXEL_ESTIMATE` | const | `src/capture.ts` | yes | keep |
| `DEFAULT_MASK_COLOUR` | const | `src/mask.ts` | yes | keep |
| `DEFAULT_MASK_SELECTOR` | const | `src/mask.ts` | yes | keep |
| `DEFAULT_REPLACEMENT` | const | `src/scrub.ts` | no | documented in this change |
| `DEFAULT_SEND_TIMEOUT_MS` | const | `src/send.ts` | no | documented in this change |
| `describeElement` | function | `src/element-picker.ts` | yes | keep |
| `ElementRef` | type | `src/report-core.ts` | no | documented in this change |
| `EmailTexts` | type | `src/locales.ts` | yes | keep |
| `fingerprint` | function | `src/fingerprint.ts` | yes | keep — verb reading, one identity per report |
| `FingerprintInput` | type | `src/fingerprint.ts` | no | documented in this change |
| `getConsoleBuffer` | function | `src/console-buffer.ts` | yes | keep |
| `initConsoleBuffer` | function | `src/console-buffer.ts` | yes | keep |
| `isReportType` | function | `src/report-core.ts` | yes | keep |
| `Locale` | type | `src/locales.ts` | yes | keep |
| `MarkdownOptions` | type | `src/markdown.ts` | no | server-only; off `.` in 1.0 (#68) |
| `MaskOptions` | type | `src/mask.ts` | yes | keep |
| `MAX_BREADCRUMB_TEXT_LENGTH` | const | `src/report-core.ts` | no | keep — the README documents these as a group |
| `MAX_BREADCRUMBS` | const | `src/report-core.ts` | no | keep — the README documents these as a group |
| `MAX_CONSOLE_ENTRIES` | const | `src/report-core.ts` | no | keep — the README documents these as a group |
| `MAX_CONSOLE_MESSAGE_LENGTH` | const | `src/report-core.ts` | no | keep — the README documents these as a group |
| `MAX_CONTACT_LENGTH` | const | `src/report-core.ts` | yes | keep |
| `MAX_CONTEXT_LENGTHS` | const | `src/report-core.ts` | yes | keep |
| `MAX_COOKIE_NAMES` | const | `src/report-core.ts` | no | keep — the README documents these as a group |
| `MAX_ELEMENT_TEXT_LENGTH` | const | `src/report-core.ts` | no | keep — the README documents these as a group |
| `MAX_ELEMENTS` | const | `src/report-core.ts` | no | keep — the README documents these as a group |
| `MAX_MESSAGE_LENGTH` | const | `src/report-core.ts` | no | keep — the README documents these as a group |
| `MAX_NETWORK_ENTRIES` | const | `src/report-core.ts` | no | keep — the README documents these as a group |
| `MAX_PERF_MS` | const | `src/report-core.ts` | no | keep — the README documents these as a group |
| `MAX_REPLAY_BYTES` | const | `src/report-core.ts` | yes | keep |
| `MAX_REPLAY_EVENTS` | const | `src/report-core.ts` | no | keep — the README documents these as a group |
| `MAX_SCREENSHOT_BYTES` | const | `src/report-core.ts` | no | keep — the README documents these as a group |
| `MAX_SCREENSHOT_DATA_URL_LENGTH` | const | `src/report-core.ts` | no | keep — the README documents these as a group |
| `MAX_STACK_FRAMES` | const | `src/report-core.ts` | yes | keep |
| `MAX_STACK_STRING_LENGTH` | const | `src/report-core.ts` | yes | keep |
| `MAX_STORAGE_KEY_LENGTH` | const | `src/report-core.ts` | no | keep — the README documents these as a group |
| `MAX_STORAGE_KEYS` | const | `src/report-core.ts` | no | keep — the README documents these as a group |
| `MAX_STORAGE_VALUE_LENGTH` | const | `src/report-core.ts` | no | keep — the README documents these as a group |
| `MAX_STORAGE_VALUES` | const | `src/report-core.ts` | no | keep — the README documents these as a group |
| `Messages` | type | `src/locales.ts` | yes | keep |
| `NetworkEntry` | type | `src/report-core.ts` | yes | keep |
| `normaliseBreadcrumbs` | function | `src/report-core.ts` | yes | server-only; off `.` in 1.0 (#68) |
| `normaliseConsole` | function | `src/report-core.ts` | yes | server-only; off `.` in 1.0 (#68) |
| `normaliseContact` | function | `src/report-core.ts` | yes | server-only; off `.` in 1.0 (#68) |
| `normaliseContext` | function | `src/report-core.ts` | yes | server-only; off `.` in 1.0 (#68) |
| `normaliseElements` | function | `src/report-core.ts` | yes | server-only; off `.` in 1.0 (#68) |
| `normaliseMessage` | function | `src/report-core.ts` | yes | server-only; off `.` in 1.0 (#68) |
| `normaliseNetwork` | function | `src/report-core.ts` | yes | server-only; off `.` in 1.0 (#68) |
| `normalisePerf` | function | `src/report-core.ts` | yes | server-only; off `.` in 1.0 (#68) |
| `normaliseReplay` | function | `src/report-core.ts` | yes | server-only; off `.` in 1.0 (#68) |
| `normaliseStorage` | function | `src/report-core.ts` | yes | server-only; off `.` in 1.0 (#68) |
| `PerfSnapshot` | type | `src/report-core.ts` | yes | keep |
| `pickElement` | function | `src/element-picker.ts` | yes | keep |
| `PickOptions` | type | `src/element-picker.ts` | no | documented in this change |
| `ReplayCapture` | type | `src/report-core.ts` | yes | keep |
| `ReplayEvent` | type | `src/report-core.ts` | yes | keep |
| `REPORT_TYPES` | const | `src/report-core.ts` | yes | keep |
| `ReportContext` | type | `src/report-core.ts` | no | documented in this change |
| `ReportType` | type | `src/report-core.ts` | no | documented in this change |
| `resetConsoleBuffer` | function | `src/console-buffer.ts` | yes | keep |
| `ScreenshotRenderer` | type | `src/capture.ts` | yes | keep |
| `ScreenshotTooLargeError` | class | `src/capture.ts` | yes | keep |
| `Scrubber` | type | `src/scrub.ts` | no | documented in this change |
| `ScrubberName` | type | `src/scrub.ts` | no | documented in this change |
| `ScrubOptions` | type | `src/scrub.ts` | no | documented in this change |
| `scrubReport` | function | `src/scrub.ts` | yes | keep |
| `scrubUrl` | function | `src/scrub.ts` | yes | keep |
| `SendFailedError` | class | `src/send.ts` | yes | keep |
| `SendOptions` | type | `src/send.ts` | yes | keep |
| `sendReport` | function | `src/send.ts` | yes | keep |
| `SendResult` | type | `src/send.ts` | no | documented in this change |
| `SendTimeoutError` | class | `src/send.ts` | yes | keep |
| `stableHash` | function | `src/fingerprint.ts` | yes | keep — noun, but it is the hash, not the hashing |
| `StackFrame` | type | `src/report-core.ts` | yes | keep |
| `StorageKeyRef` | type | `src/report-core.ts` | yes | keep |
| `StorageSnapshot` | type | `src/report-core.ts` | yes | keep |
| `toMarkdown` | function | `src/markdown.ts` | yes | server-only; off `.` in 1.0 (#68) |
| `UiTexts` | type | `src/locales.ts` | yes | keep |

### `bugbottle./react`

| Name | Kind | Source | Documented | Verdict |
|---|---|---|---|---|
| `BugReportBoundary` | class | `src/react/boundary.ts` | yes | keep |
| `BugReportBoundaryProps` | type | `src/react/boundary.ts` | yes | keep |
| `BugReportStatus` | type | `src/report-state.ts` | yes | keep |
| `createRootErrorHandlers` | function | `src/react/boundary.ts` | yes | keep |
| `describeRenderError` | function | `src/react/boundary.ts` | yes | keep |
| `ElementRef` | type | `src/report-core.ts` | no | documented in this change |
| `REPORT_TYPES` | const | `src/report-core.ts` | yes | keep |
| `ReportErrorOptions` | type | `src/react/boundary.ts` | yes | keep |
| `ReportType` | type | `src/report-core.ts` | no | documented in this change |
| `RootErrorHandlerOptions` | type | `src/react/boundary.ts` | yes | keep |
| `RootErrorHandlers` | type | `src/react/boundary.ts` | yes | keep |
| `ScreenshotRenderer` | type | `src/capture.ts` | yes | keep |
| `useBugReport` | function | `src/react/use-bug-report.ts` | yes | keep |
| `UseBugReportOptions` | type | `src/report-state.ts` | yes | keep |

### `bugbottle./vue`

| Name | Kind | Source | Documented | Verdict |
|---|---|---|---|---|
| `BugReportStatus` | type | `src/report-state.ts` | yes | keep |
| `ElementRef` | type | `src/report-core.ts` | no | documented in this change |
| `REPORT_TYPES` | const | `src/report-core.ts` | yes | keep |
| `ReportType` | type | `src/report-core.ts` | no | documented in this change |
| `ScreenshotRenderer` | type | `src/capture.ts` | yes | keep |
| `useBugReport` | function | `src/vue/index.ts` | yes | keep |
| `UseBugReportOptions` | type | `src/report-state.ts` | yes | keep |

### `bugbottle./svelte`

| Name | Kind | Source | Documented | Verdict |
|---|---|---|---|---|
| `BugReportStatus` | type | `src/report-state.ts` | yes | keep |
| `BugReportView` | type | `src/svelte/index.ts` | yes | keep |
| `createBugReport` | function | `src/svelte/index.ts` | yes | keep |
| `ElementRef` | type | `src/report-core.ts` | no | documented in this change |
| `REPORT_TYPES` | const | `src/report-core.ts` | yes | keep |
| `ReportType` | type | `src/report-core.ts` | no | documented in this change |
| `ScreenshotRenderer` | type | `src/capture.ts` | yes | keep |
| `UseBugReportOptions` | type | `src/report-state.ts` | yes | keep |

### `bugbottle./solid`

| Name | Kind | Source | Documented | Verdict |
|---|---|---|---|---|
| `BugReportStatus` | type | `src/report-state.ts` | yes | keep |
| `createBugReport` | function | `src/solid/index.ts` | yes | keep |
| `ElementRef` | type | `src/report-core.ts` | no | documented in this change |
| `REPORT_TYPES` | const | `src/report-core.ts` | yes | keep |
| `ReportType` | type | `src/report-core.ts` | no | documented in this change |
| `ScreenshotRenderer` | type | `src/capture.ts` | yes | keep |
| `UseBugReportOptions` | type | `src/report-state.ts` | yes | keep |

### `bugbottle./server`

| Name | Kind | Source | Documented | Verdict |
|---|---|---|---|---|
| `AdfDoc` | type | `src/sinks/jira.ts` | yes | keep |
| `AdfNode` | type | `src/sinks/jira.ts` | yes | keep |
| `BAD_SIGNATURE_ERROR` | const | `src/server/handle.ts` | yes | keep |
| `Breadcrumb` | type | `src/report-core.ts` | no | documented in this change |
| `BreadcrumbKind` | type | `src/report-core.ts` | no | documented in this change |
| `BugReport` | type | `src/report-core.ts` | no | documented in this change |
| `buildDiscordMessage` | function | `src/sinks/discord.ts` | yes | keep |
| `buildJiraDescription` | function | `src/sinks/jira.ts` | yes | keep |
| `buildSentryEnvelope` | function | `src/sinks/sentry.ts` | yes | keep |
| `buildSentryEvent` | function | `src/sinks/sentry.ts` | yes | keep |
| `buildSlackMessage` | function | `src/sinks/slack.ts` | yes | keep |
| `BUILTIN_SCRUBBERS` | const | `src/scrub.ts` | yes | keep |
| `ChatSink` | type | `src/sinks/chat.ts` | yes | keep |
| `ChatSinkContext` | type | `src/sinks/chat.ts` | yes | keep |
| `clipBytes` | function | `src/sinks/sentry.ts` | yes | keep — documented; the byte clip a Sentry payload needs |
| `collectExtra` | function | `src/server/handle.ts` | yes | keep |
| `ConsoleEntry` | type | `src/report-core.ts` | no | documented in this change |
| `ConsoleLevel` | type | `src/report-core.ts` | no | documented in this change |
| `createGithubIssue` | function | `src/sinks/github.ts` | yes | keep |
| `CreateGithubIssueOptions` | type | `src/sinks/github.ts` | no | documented in this change |
| `CreateGithubIssueResult` | type | `src/sinks/github.ts` | no | documented in this change |
| `CreateGitlabIssueResult` | type | `src/sinks/gitlab.ts` | yes | keep |
| `CreateJiraIssueResult` | type | `src/sinks/jira.ts` | yes | keep |
| `createLinearIssue` | function | `src/sinks/linear.ts` | yes | keep |
| `CreateLinearIssueOptions` | type | `src/sinks/linear.ts` | no | documented in this change |
| `CreateLinearIssueResult` | type | `src/sinks/linear.ts` | no | documented in this change |
| `decodeScreenshotDataUrl` | function | `src/report-core.ts` | yes | keep |
| `DedupeEntry` | type | `src/server/handle.ts` | yes | keep |
| `DedupeOptions` | type | `src/server/handle.ts` | yes | keep |
| `DedupeStore` | type | `src/server/handle.ts` | yes | keep |
| `DEFAULT_BODY_TIMEOUT_MS` | const | `src/server/handle.ts` | yes | keep |
| `DEFAULT_GITLAB_HOST` | const | `src/sinks/gitlab.ts` | yes | keep |
| `DEFAULT_JIRA_ISSUE_TYPE` | const | `src/sinks/jira.ts` | yes | keep |
| `DEFAULT_MAX_BODY_BYTES` | const | `src/server/handle.ts` | yes | keep |
| `DEFAULT_REPLACEMENT` | const | `src/scrub.ts` | no | documented in this change |
| `DEFAULT_SENTRY_RETRY_AFTER` | const | `src/sinks/sentry.ts` | yes | keep |
| `DEFAULT_SIGNATURE_SKEW_MS` | const | `src/server/handle.ts` | yes | keep |
| `DEFAULT_SINK_TIMEOUT_MS` | const | `src/server/handle.ts` | yes | keep |
| `DISCORD_COLOURS` | const | `src/sinks/discord.ts` | yes | keep — vendor palette, not a limit |
| `DISCORD_MAX_CONTENT` | const | `src/sinks/webhook.ts` | no | alias of `MAX_DISCORD_CONTENT` (#65) |
| `DISCORD_MAX_EMBED_DESCRIPTION` | const | `src/sinks/discord.ts` | no | alias of `MAX_DISCORD_EMBED_DESCRIPTION` (#65) |
| `DISCORD_MAX_EMBED_FIELDS` | const | `src/sinks/discord.ts` | no | alias of `MAX_DISCORD_EMBED_FIELDS` (#65) |
| `DISCORD_MAX_EMBED_TITLE` | const | `src/sinks/discord.ts` | no | alias of `MAX_DISCORD_EMBED_TITLE` (#65) |
| `DISCORD_MAX_EMBED_TOTAL` | const | `src/sinks/discord.ts` | no | alias of `MAX_DISCORD_EMBED_TOTAL` (#65) |
| `DISCORD_MAX_FIELD_NAME` | const | `src/sinks/discord.ts` | no | alias of `MAX_DISCORD_FIELD_NAME` (#65) |
| `DISCORD_MAX_FIELD_VALUE` | const | `src/sinks/discord.ts` | no | alias of `MAX_DISCORD_FIELD_VALUE` (#65) |
| `DISCORD_MAX_FOOTER_TEXT` | const | `src/sinks/discord.ts` | no | alias of `MAX_DISCORD_FOOTER_TEXT` (#65) |
| `discordSink` | function | `src/sinks/discord.ts` | yes | keep |
| `DiscordSinkOptions` | type | `src/sinks/discord.ts` | yes | keep |
| `ElementRef` | type | `src/report-core.ts` | no | documented in this change |
| `EMPTY_MESSAGE_ERROR` | const | `src/server/handle.ts` | no | documented in this change |
| `escapeSlack` | function | `src/sinks/slack.ts` | yes | keep — documented; text bound for a Slack block |
| `expressHandler` | function | `src/server/express.ts` | yes | keep |
| `ExpressRequestLike` | type | `src/server/express.ts` | no | documented in this change |
| `ExpressResponseLike` | type | `src/server/express.ts` | no | documented in this change |
| `FetchLike` | type | `src/sinks/error.ts` | no | documented in this change |
| `fingerprint` | function | `src/fingerprint.ts` | yes | keep — verb reading, one identity per report |
| `FingerprintInput` | type | `src/fingerprint.ts` | no | documented in this change |
| `GitlabSink` | type | `src/sinks/gitlab.ts` | yes | keep |
| `gitlabSink` | function | `src/sinks/gitlab.ts` | yes | keep |
| `GitlabSinkOptions` | type | `src/sinks/gitlab.ts` | yes | keep |
| `handleReport` | function | `src/server/handle.ts` | yes | keep |
| `HandleReportOptions` | type | `src/server/handle.ts` | yes | keep |
| `HandleReportResult` | type | `src/server/handle.ts` | yes | keep |
| `InvalidScreenshotError` | class | `src/report-core.ts` | yes | keep |
| `isReportType` | function | `src/report-core.ts` | yes | keep |
| `jiraAuthHeader` | function | `src/sinks/jira.ts` | yes | keep — documented beside `jiraSink` |
| `jiraBaseUrl` | function | `src/sinks/jira.ts` | yes | keep — documented, and a server may build the URL itself |
| `JiraSink` | type | `src/sinks/jira.ts` | yes | keep |
| `jiraSink` | function | `src/sinks/jira.ts` | yes | keep |
| `JiraSinkOptions` | type | `src/sinks/jira.ts` | yes | keep |
| `looksLikeEmail` | function | `src/report-core.ts` | yes | keep |
| `MarkdownOptions` | type | `src/markdown.ts` | no | documented in this change |
| `MAX_BREADCRUMB_TEXT_LENGTH` | const | `src/report-core.ts` | no | keep — the README documents these as a group |
| `MAX_BREADCRUMBS` | const | `src/report-core.ts` | no | keep — the README documents these as a group |
| `MAX_CHAT_CONSOLE_ENTRIES` | const | `src/sinks/chat.ts` | yes | keep |
| `MAX_CONSOLE_ENTRIES` | const | `src/report-core.ts` | no | keep — the README documents these as a group |
| `MAX_CONSOLE_MESSAGE_LENGTH` | const | `src/report-core.ts` | no | keep — the README documents these as a group |
| `MAX_CONTACT_LENGTH` | const | `src/report-core.ts` | yes | keep |
| `MAX_CONTEXT_LENGTHS` | const | `src/report-core.ts` | yes | keep |
| `MAX_COOKIE_NAMES` | const | `src/report-core.ts` | no | keep — the README documents these as a group |
| `MAX_DEDUPE_ENTRIES` | const | `src/server/handle.ts` | no | keep — the README documents these as a group |
| `MAX_ELEMENT_TEXT_LENGTH` | const | `src/report-core.ts` | no | keep — the README documents these as a group |
| `MAX_ELEMENTS` | const | `src/report-core.ts` | no | keep — the README documents these as a group |
| `MAX_EXTRA_KEYS` | const | `src/server/handle.ts` | no | keep — the README documents these as a group |
| `MAX_EXTRA_STRING_LENGTH` | const | `src/server/handle.ts` | no | keep — the README documents these as a group |
| `MAX_GITLAB_DESCRIPTION` | const | `src/sinks/gitlab.ts` | yes | keep |
| `MAX_GITLAB_TITLE` | const | `src/sinks/gitlab.ts` | yes | keep |
| `MAX_JIRA_CONSOLE_ENTRIES` | const | `src/sinks/jira.ts` | yes | keep |
| `MAX_JIRA_SUMMARY` | const | `src/sinks/jira.ts` | yes | keep |
| `MAX_MESSAGE_LENGTH` | const | `src/report-core.ts` | no | keep — the README documents these as a group |
| `MAX_NETWORK_ENTRIES` | const | `src/report-core.ts` | no | keep — the README documents these as a group |
| `MAX_PERF_MS` | const | `src/report-core.ts` | no | keep — the README documents these as a group |
| `MAX_RATE_LIMIT_BUCKETS` | const | `src/server/handle.ts` | no | keep — the README documents these as a group |
| `MAX_RATE_LIMIT_KEY_LENGTH` | const | `src/server/handle.ts` | no | keep — the README documents these as a group |
| `MAX_REPLAY_BYTES` | const | `src/report-core.ts` | yes | keep |
| `MAX_REPLAY_EVENTS` | const | `src/report-core.ts` | no | keep — the README documents these as a group |
| `MAX_SCREENSHOT_BYTES` | const | `src/report-core.ts` | no | keep — the README documents these as a group |
| `MAX_SCREENSHOT_DATA_URL_LENGTH` | const | `src/report-core.ts` | no | keep — the README documents these as a group |
| `MAX_SENTRY_BREADCRUMBS` | const | `src/sinks/sentry.ts` | no | keep — the README documents these as a group |
| `MAX_SENTRY_ENVELOPE_BYTES` | const | `src/sinks/sentry.ts` | no | keep — the README documents these as a group |
| `MAX_SENTRY_EVENT_BYTES` | const | `src/sinks/sentry.ts` | no | keep — the README documents these as a group |
| `MAX_SENTRY_FEEDBACK_MESSAGE` | const | `src/sinks/sentry.ts` | no | keep — the README documents these as a group |
| `MAX_SENTRY_MESSAGE_BYTES` | const | `src/sinks/sentry.ts` | no | keep — the README documents these as a group |
| `MAX_SIGNATURE_ENTRIES` | const | `src/server/handle.ts` | yes | keep |
| `MAX_SIGNATURE_ENTRIES_PER_SECOND` | const | `src/server/handle.ts` | yes | keep |
| `MAX_SIGNATURE_SECONDS` | const | `src/server/handle.ts` | yes | keep |
| `MAX_STACK_FRAMES` | const | `src/report-core.ts` | yes | keep |
| `MAX_STACK_STRING_LENGTH` | const | `src/report-core.ts` | yes | keep |
| `MAX_STORAGE_KEY_LENGTH` | const | `src/report-core.ts` | no | keep — the README documents these as a group |
| `MAX_STORAGE_KEYS` | const | `src/report-core.ts` | no | keep — the README documents these as a group |
| `MAX_STORAGE_VALUE_LENGTH` | const | `src/report-core.ts` | no | keep — the README documents these as a group |
| `MAX_STORAGE_VALUES` | const | `src/report-core.ts` | no | keep — the README documents these as a group |
| `messageFromGitlabBody` | function | `src/sinks/gitlab.ts` | yes | keep |
| `messageFromJiraBody` | function | `src/sinks/jira.ts` | yes | keep |
| `NetworkEntry` | type | `src/report-core.ts` | yes | keep |
| `normaliseBreadcrumbs` | function | `src/report-core.ts` | yes | keep |
| `normaliseConsole` | function | `src/report-core.ts` | yes | keep |
| `normaliseContact` | function | `src/report-core.ts` | yes | keep |
| `normaliseContext` | function | `src/report-core.ts` | yes | keep |
| `normaliseElements` | function | `src/report-core.ts` | yes | keep |
| `normaliseMessage` | function | `src/report-core.ts` | yes | keep |
| `normaliseNetwork` | function | `src/report-core.ts` | yes | keep |
| `normalisePerf` | function | `src/report-core.ts` | yes | keep |
| `normaliseReplay` | function | `src/report-core.ts` | yes | keep |
| `normaliseStorage` | function | `src/report-core.ts` | yes | keep |
| `parseSentryDsn` | function | `src/sinks/sentry.ts` | yes | keep |
| `PerfSnapshot` | type | `src/report-core.ts` | yes | keep |
| `RateLimitOptions` | type | `src/server/handle.ts` | yes | keep |
| `RateLimitStore` | type | `src/server/handle.ts` | yes | keep |
| `ReplayCapture` | type | `src/report-core.ts` | yes | keep |
| `ReplayEvent` | type | `src/report-core.ts` | yes | keep |
| `ReplayStore` | type | `src/server/handle.ts` | yes | keep |
| `REPORT_TYPES` | const | `src/report-core.ts` | yes | keep |
| `ReportContext` | type | `src/report-core.ts` | no | documented in this change |
| `ReportSink` | type | `src/server/handle.ts` | yes | keep |
| `ReportType` | type | `src/report-core.ts` | no | documented in this change |
| `resetDedupe` | function | `src/server/handle.ts` | yes | keep |
| `resetRateLimits` | function | `src/server/handle.ts` | yes | keep |
| `resetSignatures` | function | `src/server/handle.ts` | yes | keep |
| `Scrubber` | type | `src/scrub.ts` | no | documented in this change |
| `ScrubberName` | type | `src/scrub.ts` | no | documented in this change |
| `ScrubOptions` | type | `src/scrub.ts` | no | documented in this change |
| `scrubReport` | function | `src/scrub.ts` | yes | keep |
| `scrubUrl` | function | `src/scrub.ts` | yes | keep |
| `sendReportEmail` | function | `src/sinks/resend.ts` | yes | keep |
| `SendReportEmailOptions` | type | `src/sinks/resend.ts` | no | documented in this change |
| `SendReportEmailResult` | type | `src/sinks/resend.ts` | no | documented in this change |
| `sendReportWebhook` | function | `src/sinks/webhook.ts` | yes | keep |
| `SendReportWebhookOptions` | type | `src/sinks/webhook.ts` | no | documented in this change |
| `SendReportWebhookResult` | type | `src/sinks/webhook.ts` | no | documented in this change |
| `SENTRY_CLIENT` | const | `src/sinks/sentry.ts` | yes | keep |
| `SENTRY_CLIENT_NAME` | const | `src/sinks/sentry.ts` | yes | keep |
| `SENTRY_CLIENT_VERSION` | const | `src/sinks/sentry.ts` | yes | keep |
| `SENTRY_VERSION` | const | `src/sinks/sentry.ts` | yes | keep |
| `sentryAuthHeader` | function | `src/sinks/sentry.ts` | yes | keep — documented beside `sentrySink` |
| `SentryDsn` | type | `src/sinks/sentry.ts` | yes | keep |
| `SentryEnvelope` | type | `src/sinks/sentry.ts` | yes | keep |
| `SentryItemType` | type | `src/sinks/sentry.ts` | yes | keep |
| `sentrySink` | function | `src/sinks/sentry.ts` | yes | keep |
| `SentrySinkContext` | type | `src/sinks/sentry.ts` | yes | keep |
| `SentrySinkError` | class | `src/sinks/sentry.ts` | yes | keep |
| `SentrySinkOptions` | type | `src/sinks/sentry.ts` | yes | keep |
| `SentryTruncation` | type | `src/sinks/sentry.ts` | yes | keep |
| `SignatureOptions` | type | `src/server/handle.ts` | yes | keep |
| `SinkContext` | type | `src/server/handle.ts` | yes | keep |
| `SinkError` | class | `src/sinks/error.ts` | yes | keep |
| `SinkTimeoutError` | class | `src/server/handle.ts` | yes | keep |
| `SLACK_MAX_BLOCKS` | const | `src/sinks/slack.ts` | no | alias of `MAX_SLACK_BLOCKS` (#65) |
| `SLACK_MAX_FIELD_TEXT` | const | `src/sinks/slack.ts` | no | alias of `MAX_SLACK_FIELD_TEXT` (#65) |
| `SLACK_MAX_FIELDS` | const | `src/sinks/slack.ts` | no | alias of `MAX_SLACK_FIELDS` (#65) |
| `SLACK_MAX_HEADER_TEXT` | const | `src/sinks/slack.ts` | no | alias of `MAX_SLACK_HEADER_TEXT` (#65) |
| `SLACK_MAX_TEXT` | const | `src/sinks/slack.ts` | no | alias of `MAX_SLACK_TEXT` (#65) |
| `slackSink` | function | `src/sinks/slack.ts` | yes | keep |
| `SlackSinkOptions` | type | `src/sinks/slack.ts` | yes | keep |
| `stableHash` | function | `src/fingerprint.ts` | yes | keep — noun, but it is the hash, not the hashing |
| `StackFrame` | type | `src/report-core.ts` | yes | keep |
| `StorageKeyRef` | type | `src/report-core.ts` | yes | keep |
| `StorageSnapshot` | type | `src/report-core.ts` | yes | keep |
| `toGithub` | function | `src/server/handle.ts` | yes | keep |
| `toLinear` | function | `src/server/handle.ts` | yes | keep |
| `toMarkdown` | function | `src/markdown.ts` | yes | keep |
| `TOO_LARGE_ERROR` | const | `src/server/handle.ts` | no | documented in this change |
| `toResend` | function | `src/server/handle.ts` | yes | keep |
| `toWebhook` | function | `src/server/handle.ts` | yes | keep |
| `UrlFrom` | type | `src/sinks/chat.ts` | yes | keep |
| `ValidatedReport` | type | `src/server/handle.ts` | yes | keep |
| `validateReport` | function | `src/server/handle.ts` | yes | keep |
| `WebhookFormat` | type | `src/sinks/webhook.ts` | no | documented in this change |

### `bugbottle./html-to-image`

| Name | Kind | Source | Documented | Verdict |
|---|---|---|---|---|
| `htmlToImage` | const | `src/html-to-image.ts` | yes | keep — a renderer value, so a noun is right |

### `bugbottle./annotate`

| Name | Kind | Source | Documented | Verdict |
|---|---|---|---|---|
| `AnnotateTool` | type | `src/annotate.ts` | yes | keep |
| `Annotator` | type | `src/annotate.ts` | yes | keep |
| `AnnotatorOptions` | type | `src/annotate.ts` | yes | keep |
| `createAnnotator` | function | `src/annotate.ts` | yes | keep |

### `bugbottle./breadcrumbs`

| Name | Kind | Source | Documented | Verdict |
|---|---|---|---|---|
| `Breadcrumb` | type | `src/report-core.ts` | no | documented in this change |
| `BreadcrumbKind` | type | `src/report-core.ts` | no | documented in this change |
| `BreadcrumbsOptions` | type | `src/breadcrumbs.ts` | yes | keep |
| `getBreadcrumbs` | function | `src/breadcrumbs.ts` | yes | keep |
| `initBreadcrumbs` | function | `src/breadcrumbs.ts` | yes | keep |
| `isBreadcrumbsActive` | function | `src/breadcrumbs.ts` | yes | keep |
| `resetBreadcrumbs` | function | `src/breadcrumbs.ts` | yes | keep |

### `bugbottle./network`

| Name | Kind | Source | Documented | Verdict |
|---|---|---|---|---|
| `getNetwork` | function | `src/network.ts` | yes | keep |
| `initNetwork` | function | `src/network.ts` | yes | keep |
| `isNetworkActive` | function | `src/network.ts` | yes | keep |
| `NetworkEntry` | type | `src/report-core.ts` | yes | keep |
| `NetworkOptions` | type | `src/network.ts` | yes | keep |
| `resetNetwork` | function | `src/network.ts` | yes | keep |

### `bugbottle./perf`

| Name | Kind | Source | Documented | Verdict |
|---|---|---|---|---|
| `getPerf` | function | `src/perf.ts` | yes | keep |
| `getStorageSnapshot` | function | `src/perf.ts` | yes | keep |
| `initPerf` | function | `src/perf.ts` | yes | keep |
| `isPerfActive` | function | `src/perf.ts` | yes | keep |
| `PerfOptions` | type | `src/perf.ts` | yes | keep |
| `PerfSnapshot` | type | `src/report-core.ts` | yes | keep |
| `resetPerf` | function | `src/perf.ts` | yes | keep |
| `StorageKeyRef` | type | `src/report-core.ts` | yes | keep |
| `StorageSnapshot` | type | `src/report-core.ts` | yes | keep |

### `bugbottle./rrweb`

| Name | Kind | Source | Documented | Verdict |
|---|---|---|---|---|
| `attachRrweb` | function | `src/rrweb.ts` | yes | keep |
| `DEFAULT_REPLAY_MAX_BYTES` | const | `src/rrweb.ts` | yes | keep |
| `DEFAULT_REPLAY_SECONDS` | const | `src/rrweb.ts` | yes | keep |
| `getReplay` | function | `src/rrweb.ts` | yes | keep |
| `isRrwebAttached` | function | `src/rrweb.ts` | yes | keep |
| `REPLAY_BLOCK_SELECTOR` | const | `src/rrweb.ts` | yes | keep |
| `REPLAY_CHECKOUT_MS` | const | `src/rrweb.ts` | yes | keep |
| `REPLAY_MASK_SELECTOR` | const | `src/rrweb.ts` | yes | keep |
| `ReplayCapture` | type | `src/report-core.ts` | yes | keep |
| `ReplayEvent` | type | `src/report-core.ts` | yes | keep |
| `resetRrweb` | function | `src/rrweb.ts` | yes | keep |
| `RrwebEvent` | type | `src/rrweb.ts` | yes | keep |
| `RrwebOptions` | type | `src/rrweb.ts` | yes | keep |
| `RrwebRecord` | type | `src/rrweb.ts` | yes | keep |
| `RrwebRecordOptions` | type | `src/rrweb.ts` | yes | keep |

### `bugbottle./sign`

| Name | Kind | Source | Documented | Verdict |
|---|---|---|---|---|
| `computeSignature` | function | `src/sign.ts` | yes | keep |
| `createSigner` | function | `src/sign.ts` | yes | keep |
| `DEFAULT_SIGNATURE_HEADER` | const | `src/sign.ts` | yes | keep |
| `hmacHex` | function | `src/sign.ts` | yes | keep |
| `SignerOptions` | type | `src/sign.ts` | yes | keep |

### `bugbottle./queue`

| Name | Kind | Source | Documented | Verdict |
|---|---|---|---|---|
| `createQueue` | function | `src/queue.ts` | yes | keep |
| `Queue` | type | `src/queue.ts` | yes | keep |
| `QueuedReport` | type | `src/queue.ts` | yes | keep |
| `QueueOptions` | type | `src/queue.ts` | yes | keep |

### `bugbottle./triggers`

| Name | Kind | Source | Documented | Verdict |
|---|---|---|---|---|
| `deepActiveElement` | function | `src/triggers.ts` | yes | keep — documented; the shadow-DOM focus chain |
| `DEFAULT_DEDUPE_MS` | const | `src/triggers.ts` | yes | keep |
| `DEFAULT_SHORTCUT` | const | `src/triggers.ts` | yes | keep |
| `describeUncaught` | function | `src/triggers.ts` | yes | keep |
| `eventSource` | function | `src/triggers.ts` | yes | keep — documented; the composed path of an event |
| `isApplePlatform` | function | `src/triggers.ts` | yes | keep |
| `isEditableTarget` | function | `src/triggers.ts` | yes | keep |
| `ListenerHost` | type | `src/triggers.ts` | yes | keep |
| `matchesShortcut` | function | `src/triggers.ts` | yes | keep |
| `onShortcut` | function | `src/triggers.ts` | yes | keep |
| `onUncaughtError` | function | `src/triggers.ts` | yes | keep |
| `parseShortcut` | function | `src/triggers.ts` | yes | keep |
| `Shortcut` | type | `src/triggers.ts` | yes | keep |
| `ShortcutEvent` | type | `src/triggers.ts` | yes | keep |
| `ShortcutOptions` | type | `src/triggers.ts` | yes | keep |
| `UncaughtError` | type | `src/triggers.ts` | yes | keep |
| `UncaughtErrorOptions` | type | `src/triggers.ts` | yes | keep |

### `bugbottle./shake`

| Name | Kind | Source | Documented | Verdict |
|---|---|---|---|---|
| `DEFAULT_SHAKE_COOLDOWN_MS` | const | `src/shake.ts` | yes | keep |
| `DEFAULT_SHAKE_THRESHOLD` | const | `src/shake.ts` | yes | keep |
| `DEFAULT_SHAKE_WINDOW_MS` | const | `src/shake.ts` | yes | keep |
| `onShake` | function | `src/shake.ts` | yes | keep |
| `requestShakePermission` | function | `src/shake.ts` | yes | keep |
| `ShakeEvent` | type | `src/shake.ts` | yes | keep |
| `ShakeOptions` | type | `src/shake.ts` | yes | keep |

### `bugbottle./locales`

| Name | Kind | Source | Documented | Verdict |
|---|---|---|---|---|
| `da` | const | `src/locales.ts` | yes | keep |
| `de` | const | `src/locales.ts` | yes | keep |
| `EmailTexts` | type | `src/locales.ts` | yes | keep |
| `en` | const | `src/locales.ts` | yes | keep |
| `enMessages` | const | `src/locales.ts` | no | documented in this change |
| `es` | const | `src/locales.ts` | yes | keep |
| `fr` | const | `src/locales.ts` | yes | keep |
| `Locale` | type | `src/locales.ts` | yes | keep |
| `locales` | const | `src/locales.ts` | yes | keep |
| `Messages` | type | `src/locales.ts` | yes | keep |
| `nb` | const | `src/locales.ts` | yes | keep |
| `nl` | const | `src/locales.ts` | yes | keep |
| `resolveLocale` | function | `src/locales.ts` | yes | keep |
| `sv` | const | `src/locales.ts` | yes | keep |
| `UiTexts` | type | `src/locales.ts` | yes | keep |

### `bugbottle./ui`

| Name | Kind | Source | Documented | Verdict |
|---|---|---|---|---|
| `Brand` | type | `src/ui/index.ts` | yes | keep |
| `BugbottleWidget` | type | `src/ui/index.ts` | yes | keep |
| `mountBugbottle` | function | `src/ui/index.ts` | yes | keep |
| `MountOptions` | type | `src/ui/index.ts` | yes | keep |
| `Theme` | type | `src/ui/index.ts` | yes | keep |
