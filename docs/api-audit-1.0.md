# The public API, frozen at 1.0

One reading of the whole public surface at 0.8.0, on 8 September 2026, before
1.0 froze it: every export of the eighteen entry points there were then, every
option object, every `data-*` attribute and every `window.bugbottle` member,
looked at for naming consistency, option shapes, things exported by accident,
and things documented but not typed or typed but not documented. Issue #62.
Refreshed at 1.0 (#97), where the aliases it added were removed again and the
table at the end became the contract.

The table at the end is the whole surface, generated from the build. This half
is what it says.

## What was read

`package.json#exports`, the `dist/*.d.ts` trees behind it, the README
"API" section and its script-tag attribute table, `src/global.ts` and
`src/global-slim.ts` for `window.bugbottle`, and `dist/report.schema.json`.

At 1.0 (the numbers below are the generated table's, not the 0.8.0 reading's):

| | |
|---|---|
| Entry points | 20 code + `./report.schema.json` + `./openapi.json` + `./package.json` |
| Exported bindings | 454 (367 distinct names: 124 types, 122 constants, 113 functions, 8 classes) |
| Untyped exports | 0 — every entry is a `tsc`-emitted declaration, so nothing can be exported without a type |
| Documented in the README but not exported | 0 |
| Exported but not named in the README | 0 individually or by a group line; `tests/exports.test.ts` fails when that stops being true |

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

## What 1.0 removed

Every alias the table above added has gone, and the removals are the whole of
1.0's breaking half. The migration is mechanical in all seven cases.

| Gone in 1.0 | Use instead | Issue |
|---|---|---|
| `SendOptions.onFailure` | `SendOptions.onError` | #63 |
| `QueueOptions.maxItems` | `QueueOptions.maxEntries` | #64 |
| `SLACK_MAX_*`, `DISCORD_MAX_*` (13) | `MAX_SLACK_*`, `MAX_DISCORD_*` | #65 |
| `RateLimitOptions.rateLimitStore` | `RateLimitOptions.store` | #66 |
| `DedupeOptions.dedupeStore` | `DedupeOptions.store` | #66 |
| `SignatureOptions.replayStore` | `SignatureOptions.store` | #66 |
| `SendReportWebhookOptions.url` | `SendReportWebhookOptions.endpoint` | #67 |

Two shapes changed with them:

- **#68** took the eleven server validators and `toMarkdown` off the `.` entry.
  They are on `bugbottle/server`, which re-exported every one of them all
  along; only the import path changes. `REPORT_TYPES` and `isReportType` stay
  on `.`, because the panel and the adapters build the type radiogroup out of
  them. They were tree-shaken before, so no bundle shrank: the core measured
  1540 bytes gzipped before and 1543 after.
- **#69** gave all eleven sinks one shape for the picture address:
  `screenshotUrl` a string, `screenshotUrlFrom` a function of the report, the
  function winning where both are given. Slack, Discord and Teams took the
  function under the first name, which was the only place in the package where
  one key had two types depending on the import.

- ~~**#70** mirrors `data-network` and `data-perf` with `network` and `perf`
  mount options on the hand-it-in seam.~~ Landed before 1.0:
  `MountOptions.network` and `MountOptions.perf` take `initNetwork` and
  `initPerf`, or `{ on, …options }`, started on mount and stopped in
  `destroy()`. Typed structurally, so `src/ui/` imports neither module. It was
  additive, and it was the one hole in rules 3 and 6.

## Nothing else was left half-renamed

Every `### Changed` section from 0.9.0 to 0.15.0 was read again before the
freeze, looking for a shape that was announced as provisional and never
settled. There is none:

- **0.9.0** is the audit itself: seven aliases, all removed above.
- **0.10.0**, **0.11.0**, **0.12.0**: additive — sinks, entry points and the
  panel's seams. No option changed meaning.
- **0.13.0** carries the one other note that called itself a pre-1.0 shape
  change: `QueueStorage` is one function rather than two, `read` having been
  required of every storage and called from nowhere (#88). That landed whole in
  0.13.0 — `createIdbStorage` lost its `read` in the same release — and nothing
  about it is pending.
- **0.14.0** changed one default rather than a shape: `handleReport` no longer
  reads `X-Forwarded-For` or `CF-Connecting-IP` unless `trustProxy` says it
  may (#90). The option is the settled name and the behaviour is the settled
  one.
- **0.15.0** added `onDecision` and the reduced-motion pass, and says in its
  own summary that no public API changed shape.

No `@deprecated` marker is left anywhere under `src/`, which is the mechanical
half of the same check.

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

The whole public surface, generated from the build by
`node scripts/api-table.mjs` and regenerated whenever an export changes.
20 entry points; a name under more than one of them is the same symbol
re-exported, not a copy. From 1.0 this table is the contract: removing a row
needs a major version, and adding an entry point needs a minor one.

### `bugbottle`

82 exports.

| Name | Kind | Source |
|---|---|---|
| `Breadcrumb` | type | `src/report-core.ts` |
| `BreadcrumbKind` | type | `src/report-core.ts` |
| `BugReport` | type | `src/report-core.ts` |
| `buildReport` | function | `src/send.ts` |
| `BuildReportInput` | type | `src/send.ts` |
| `buildSelector` | function | `src/element-picker.ts` |
| `BUILTIN_SCRUBBERS` | const | `src/scrub.ts` |
| `CaptureInfo` | type | `src/capture.ts` |
| `CaptureOptions` | type | `src/capture.ts` |
| `captureScreenshot` | function | `src/capture.ts` |
| `collectContext` | function | `src/capture.ts` |
| `ConsoleBufferOptions` | type | `src/console-buffer.ts` |
| `ConsoleEntry` | type | `src/report-core.ts` |
| `ConsoleLevel` | type | `src/report-core.ts` |
| `DEFAULT_BLOCK_SELECTOR` | const | `src/mask.ts` |
| `DEFAULT_BYTES_PER_PIXEL_ESTIMATE` | const | `src/capture.ts` |
| `DEFAULT_MASK_COLOUR` | const | `src/mask.ts` |
| `DEFAULT_MASK_SELECTOR` | const | `src/mask.ts` |
| `DEFAULT_REPLACEMENT` | const | `src/scrub.ts` |
| `DEFAULT_SEND_TIMEOUT_MS` | const | `src/send.ts` |
| `describeElement` | function | `src/element-picker.ts` |
| `ElementRef` | type | `src/report-core.ts` |
| `EmailTexts` | type | `src/locales.ts` |
| `fingerprint` | function | `src/fingerprint.ts` |
| `FingerprintInput` | type | `src/fingerprint.ts` |
| `getConsoleBuffer` | function | `src/console-buffer.ts` |
| `initConsoleBuffer` | function | `src/console-buffer.ts` |
| `isReportType` | function | `src/report-core.ts` |
| `Locale` | type | `src/locales.ts` |
| `MaskOptions` | type | `src/mask.ts` |
| `MAX_BREADCRUMB_TEXT_LENGTH` | const | `src/report-core.ts` |
| `MAX_BREADCRUMBS` | const | `src/report-core.ts` |
| `MAX_CONSOLE_ENTRIES` | const | `src/report-core.ts` |
| `MAX_CONSOLE_MESSAGE_LENGTH` | const | `src/report-core.ts` |
| `MAX_CONTACT_LENGTH` | const | `src/report-core.ts` |
| `MAX_CONTEXT_LENGTHS` | const | `src/report-core.ts` |
| `MAX_COOKIE_NAMES` | const | `src/report-core.ts` |
| `MAX_ELEMENT_TEXT_LENGTH` | const | `src/report-core.ts` |
| `MAX_ELEMENTS` | const | `src/report-core.ts` |
| `MAX_MESSAGE_LENGTH` | const | `src/report-core.ts` |
| `MAX_NETWORK_ENTRIES` | const | `src/report-core.ts` |
| `MAX_NOTE_LENGTH` | const | `src/report-core.ts` |
| `MAX_NOTES` | const | `src/report-core.ts` |
| `MAX_PERF_MS` | const | `src/report-core.ts` |
| `MAX_REPLAY_BYTES` | const | `src/report-core.ts` |
| `MAX_REPLAY_EVENTS` | const | `src/report-core.ts` |
| `MAX_SCREENSHOT_BYTES` | const | `src/report-core.ts` |
| `MAX_SCREENSHOT_DATA_URL_LENGTH` | const | `src/report-core.ts` |
| `MAX_STACK_FRAMES` | const | `src/report-core.ts` |
| `MAX_STACK_STRING_LENGTH` | const | `src/report-core.ts` |
| `MAX_STORAGE_KEY_LENGTH` | const | `src/report-core.ts` |
| `MAX_STORAGE_KEYS` | const | `src/report-core.ts` |
| `MAX_STORAGE_VALUE_LENGTH` | const | `src/report-core.ts` |
| `MAX_STORAGE_VALUES` | const | `src/report-core.ts` |
| `Messages` | type | `src/locales.ts` |
| `NetworkEntry` | type | `src/report-core.ts` |
| `PerfSnapshot` | type | `src/report-core.ts` |
| `pickElement` | function | `src/element-picker.ts` |
| `PickOptions` | type | `src/element-picker.ts` |
| `ReplayCapture` | type | `src/report-core.ts` |
| `ReplayEvent` | type | `src/report-core.ts` |
| `REPORT_TYPES` | const | `src/report-core.ts` |
| `ReportContext` | type | `src/report-core.ts` |
| `ReportType` | type | `src/report-core.ts` |
| `resetConsoleBuffer` | function | `src/console-buffer.ts` |
| `ScreenshotRenderer` | type | `src/capture.ts` |
| `ScreenshotTooLargeError` | class | `src/capture.ts` |
| `Scrubber` | type | `src/scrub.ts` |
| `ScrubberName` | type | `src/scrub.ts` |
| `ScrubOptions` | type | `src/scrub.ts` |
| `scrubReport` | function | `src/scrub.ts` |
| `scrubUrl` | function | `src/scrub.ts` |
| `SendFailedError` | class | `src/send.ts` |
| `SendOptions` | type | `src/send.ts` |
| `sendReport` | function | `src/send.ts` |
| `SendResult` | type | `src/send.ts` |
| `SendTimeoutError` | class | `src/send.ts` |
| `stableHash` | function | `src/fingerprint.ts` |
| `StackFrame` | type | `src/report-core.ts` |
| `StorageKeyRef` | type | `src/report-core.ts` |
| `StorageSnapshot` | type | `src/report-core.ts` |
| `UiTexts` | type | `src/locales.ts` |

### `bugbottle/react`

14 exports.

| Name | Kind | Source |
|---|---|---|
| `BugReportBoundary` | class | `src/react/boundary.ts` |
| `BugReportBoundaryProps` | type | `src/react/boundary.ts` |
| `BugReportStatus` | type | `src/report-state.ts` |
| `createRootErrorHandlers` | function | `src/react/boundary.ts` |
| `describeRenderError` | function | `src/react/boundary.ts` |
| `ElementRef` | type | `src/report-core.ts` |
| `REPORT_TYPES` | const | `src/report-core.ts` |
| `ReportErrorOptions` | type | `src/react/boundary.ts` |
| `ReportType` | type | `src/report-core.ts` |
| `RootErrorHandlerOptions` | type | `src/react/boundary.ts` |
| `RootErrorHandlers` | type | `src/react/boundary.ts` |
| `ScreenshotRenderer` | type | `src/capture.ts` |
| `useBugReport` | function | `src/react/use-bug-report.ts` |
| `UseBugReportOptions` | type | `src/report-state.ts` |

### `bugbottle/vue`

7 exports.

| Name | Kind | Source |
|---|---|---|
| `BugReportStatus` | type | `src/report-state.ts` |
| `ElementRef` | type | `src/report-core.ts` |
| `REPORT_TYPES` | const | `src/report-core.ts` |
| `ReportType` | type | `src/report-core.ts` |
| `ScreenshotRenderer` | type | `src/capture.ts` |
| `useBugReport` | function | `src/vue/index.ts` |
| `UseBugReportOptions` | type | `src/report-state.ts` |

### `bugbottle/svelte`

8 exports.

| Name | Kind | Source |
|---|---|---|
| `BugReportStatus` | type | `src/report-state.ts` |
| `BugReportView` | type | `src/svelte/index.ts` |
| `createBugReport` | function | `src/svelte/index.ts` |
| `ElementRef` | type | `src/report-core.ts` |
| `REPORT_TYPES` | const | `src/report-core.ts` |
| `ReportType` | type | `src/report-core.ts` |
| `ScreenshotRenderer` | type | `src/capture.ts` |
| `UseBugReportOptions` | type | `src/report-state.ts` |

### `bugbottle/solid`

7 exports.

| Name | Kind | Source |
|---|---|---|
| `BugReportStatus` | type | `src/report-state.ts` |
| `createBugReport` | function | `src/solid/index.ts` |
| `ElementRef` | type | `src/report-core.ts` |
| `REPORT_TYPES` | const | `src/report-core.ts` |
| `ReportType` | type | `src/report-core.ts` |
| `ScreenshotRenderer` | type | `src/capture.ts` |
| `UseBugReportOptions` | type | `src/report-state.ts` |

### `bugbottle/server`

230 exports.

| Name | Kind | Source |
|---|---|---|
| `AdfDoc` | type | `src/sinks/jira.ts` |
| `AdfNode` | type | `src/sinks/jira.ts` |
| `BAD_SIGNATURE_ERROR` | const | `src/server/handle.ts` |
| `Breadcrumb` | type | `src/report-core.ts` |
| `BreadcrumbKind` | type | `src/report-core.ts` |
| `BugReport` | type | `src/report-core.ts` |
| `buildDiscordMessage` | function | `src/sinks/discord.ts` |
| `buildJiraDescription` | function | `src/sinks/jira.ts` |
| `buildMessage` | function | `src/sinks/smtp.ts` |
| `buildSentryEnvelope` | function | `src/sinks/sentry.ts` |
| `buildSentryEvent` | function | `src/sinks/sentry.ts` |
| `buildSlackMessage` | function | `src/sinks/slack.ts` |
| `buildTeamsMessage` | function | `src/sinks/teams.ts` |
| `BUILTIN_SCRUBBERS` | const | `src/scrub.ts` |
| `ChatSink` | type | `src/sinks/chat.ts` |
| `ChatSinkContext` | type | `src/sinks/chat.ts` |
| `clientAddress` | function | `src/server/handle.ts` |
| `clipBytes` | function | `src/sinks/sentry.ts` |
| `collectExtra` | function | `src/server/handle.ts` |
| `ConsoleEntry` | type | `src/report-core.ts` |
| `ConsoleLevel` | type | `src/report-core.ts` |
| `createGithubIssue` | function | `src/sinks/github.ts` |
| `CreateGithubIssueOptions` | type | `src/sinks/github.ts` |
| `CreateGithubIssueResult` | type | `src/sinks/github.ts` |
| `CreateGitlabIssueResult` | type | `src/sinks/gitlab.ts` |
| `CreateJiraIssueResult` | type | `src/sinks/jira.ts` |
| `createLinearIssue` | function | `src/sinks/linear.ts` |
| `CreateLinearIssueOptions` | type | `src/sinks/linear.ts` |
| `CreateLinearIssueResult` | type | `src/sinks/linear.ts` |
| `DecisionReason` | type | `src/server/handle.ts` |
| `decodeScreenshotDataUrl` | function | `src/report-core.ts` |
| `DedupeEntry` | type | `src/server/handle.ts` |
| `DedupeOptions` | type | `src/server/handle.ts` |
| `DedupeStore` | type | `src/server/handle.ts` |
| `DEFAULT_BODY_TIMEOUT_MS` | const | `src/server/handle.ts` |
| `DEFAULT_GITLAB_HOST` | const | `src/sinks/gitlab.ts` |
| `DEFAULT_JIRA_ISSUE_TYPE` | const | `src/sinks/jira.ts` |
| `DEFAULT_MAX_BODY_BYTES` | const | `src/server/handle.ts` |
| `DEFAULT_MAX_REPORTS` | const | `src/server/file-store.ts` |
| `DEFAULT_REPLACEMENT` | const | `src/scrub.ts` |
| `DEFAULT_SENTRY_RETRY_AFTER` | const | `src/sinks/sentry.ts` |
| `DEFAULT_SIGNATURE_SKEW_MS` | const | `src/server/handle.ts` |
| `DEFAULT_SINK_TIMEOUT_MS` | const | `src/server/handle.ts` |
| `DEFAULT_SMTP_PORT` | const | `src/sinks/smtp.ts` |
| `DEFAULT_SMTP_TIMEOUT_MS` | const | `src/sinks/smtp.ts` |
| `DISCORD_COLOURS` | const | `src/sinks/discord.ts` |
| `discordSink` | function | `src/sinks/discord.ts` |
| `DiscordSinkOptions` | type | `src/sinks/discord.ts` |
| `dotStuff` | function | `src/sinks/smtp.ts` |
| `ElementRef` | type | `src/report-core.ts` |
| `EMPTY_MESSAGE_ERROR` | const | `src/server/handle.ts` |
| `escapeSlack` | function | `src/sinks/slack.ts` |
| `escapeTeams` | function | `src/sinks/teams.ts` |
| `expressHandler` | function | `src/server/express.ts` |
| `ExpressRequestLike` | type | `src/server/express.ts` |
| `ExpressResponseLike` | type | `src/server/express.ts` |
| `FetchLike` | type | `src/sinks/error.ts` |
| `fileStore` | function | `src/server/file-store.ts` |
| `FileStore` | type | `src/server/file-store.ts` |
| `FileStoreOptions` | type | `src/server/file-store.ts` |
| `fingerprint` | function | `src/fingerprint.ts` |
| `FingerprintInput` | type | `src/fingerprint.ts` |
| `foldHeader` | function | `src/sinks/smtp.ts` |
| `gitlabSink` | function | `src/sinks/gitlab.ts` |
| `GitlabSink` | type | `src/sinks/gitlab.ts` |
| `GitlabSinkOptions` | type | `src/sinks/gitlab.ts` |
| `handleReport` | function | `src/server/handle.ts` |
| `HandleReportOptions` | type | `src/server/handle.ts` |
| `HandleReportResult` | type | `src/server/handle.ts` |
| `InvalidScreenshotError` | class | `src/report-core.ts` |
| `isReportType` | function | `src/report-core.ts` |
| `jiraBaseUrl` | function | `src/sinks/jira.ts` |
| `jiraSink` | function | `src/sinks/jira.ts` |
| `JiraSink` | type | `src/sinks/jira.ts` |
| `JiraSinkOptions` | type | `src/sinks/jira.ts` |
| `jiraAuthHeader` | function | `src/sinks/jira.ts` |
| `looksLikeEmail` | function | `src/report-core.ts` |
| `MarkdownOptions` | type | `src/markdown.ts` |
| `MAX_BREADCRUMB_TEXT_LENGTH` | const | `src/report-core.ts` |
| `MAX_BREADCRUMBS` | const | `src/report-core.ts` |
| `MAX_CHAT_CONSOLE_ENTRIES` | const | `src/sinks/chat.ts` |
| `MAX_CONSOLE_ENTRIES` | const | `src/report-core.ts` |
| `MAX_CONSOLE_MESSAGE_LENGTH` | const | `src/report-core.ts` |
| `MAX_CONTACT_LENGTH` | const | `src/report-core.ts` |
| `MAX_CONTEXT_LENGTHS` | const | `src/report-core.ts` |
| `MAX_COOKIE_NAMES` | const | `src/report-core.ts` |
| `MAX_DEDUPE_ENTRIES` | const | `src/server/handle.ts` |
| `MAX_DISCORD_CONTENT` | const | `src/sinks/webhook.ts` |
| `MAX_DISCORD_EMBED_DESCRIPTION` | const | `src/sinks/discord.ts` |
| `MAX_DISCORD_EMBED_FIELDS` | const | `src/sinks/discord.ts` |
| `MAX_DISCORD_EMBED_TITLE` | const | `src/sinks/discord.ts` |
| `MAX_DISCORD_EMBED_TOTAL` | const | `src/sinks/discord.ts` |
| `MAX_DISCORD_FIELD_NAME` | const | `src/sinks/discord.ts` |
| `MAX_DISCORD_FIELD_VALUE` | const | `src/sinks/discord.ts` |
| `MAX_DISCORD_FOOTER_TEXT` | const | `src/sinks/discord.ts` |
| `MAX_ELEMENT_TEXT_LENGTH` | const | `src/report-core.ts` |
| `MAX_ELEMENTS` | const | `src/report-core.ts` |
| `MAX_EXTRA_KEYS` | const | `src/server/handle.ts` |
| `MAX_EXTRA_STRING_LENGTH` | const | `src/server/handle.ts` |
| `MAX_GITLAB_DESCRIPTION` | const | `src/sinks/gitlab.ts` |
| `MAX_GITLAB_TITLE` | const | `src/sinks/gitlab.ts` |
| `MAX_JIRA_CONSOLE_ENTRIES` | const | `src/sinks/jira.ts` |
| `MAX_JIRA_SUMMARY` | const | `src/sinks/jira.ts` |
| `MAX_MESSAGE_LENGTH` | const | `src/report-core.ts` |
| `MAX_NETWORK_ENTRIES` | const | `src/report-core.ts` |
| `MAX_NOTE_LENGTH` | const | `src/report-core.ts` |
| `MAX_NOTES` | const | `src/report-core.ts` |
| `MAX_PERF_MS` | const | `src/report-core.ts` |
| `MAX_RATE_LIMIT_BUCKETS` | const | `src/server/handle.ts` |
| `MAX_RATE_LIMIT_KEY_LENGTH` | const | `src/server/handle.ts` |
| `MAX_REPLAY_BYTES` | const | `src/report-core.ts` |
| `MAX_REPLAY_EVENTS` | const | `src/report-core.ts` |
| `MAX_SCREENSHOT_BYTES` | const | `src/report-core.ts` |
| `MAX_SCREENSHOT_DATA_URL_LENGTH` | const | `src/report-core.ts` |
| `MAX_SENTRY_BREADCRUMBS` | const | `src/sinks/sentry.ts` |
| `MAX_SENTRY_ENVELOPE_BYTES` | const | `src/sinks/sentry.ts` |
| `MAX_SENTRY_EVENT_BYTES` | const | `src/sinks/sentry.ts` |
| `MAX_SENTRY_FEEDBACK_MESSAGE` | const | `src/sinks/sentry.ts` |
| `MAX_SENTRY_MESSAGE_BYTES` | const | `src/sinks/sentry.ts` |
| `MAX_SIGNATURE_ENTRIES` | const | `src/server/handle.ts` |
| `MAX_SIGNATURE_ENTRIES_PER_SECOND` | const | `src/server/handle.ts` |
| `MAX_SIGNATURE_SECONDS` | const | `src/server/handle.ts` |
| `MAX_SLACK_BLOCKS` | const | `src/sinks/slack.ts` |
| `MAX_SLACK_FIELD_TEXT` | const | `src/sinks/slack.ts` |
| `MAX_SLACK_FIELDS` | const | `src/sinks/slack.ts` |
| `MAX_SLACK_HEADER_TEXT` | const | `src/sinks/slack.ts` |
| `MAX_SLACK_TEXT` | const | `src/sinks/slack.ts` |
| `MAX_STACK_FRAMES` | const | `src/report-core.ts` |
| `MAX_STACK_STRING_LENGTH` | const | `src/report-core.ts` |
| `MAX_STORAGE_KEY_LENGTH` | const | `src/report-core.ts` |
| `MAX_STORAGE_KEYS` | const | `src/report-core.ts` |
| `MAX_STORAGE_VALUE_LENGTH` | const | `src/report-core.ts` |
| `MAX_STORAGE_VALUES` | const | `src/report-core.ts` |
| `MAX_TEAMS_BUTTON_TEXT` | const | `src/sinks/teams.ts` |
| `MAX_TEAMS_CONSOLE` | const | `src/sinks/teams.ts` |
| `MAX_TEAMS_FACT_TITLE` | const | `src/sinks/teams.ts` |
| `MAX_TEAMS_FACT_VALUE` | const | `src/sinks/teams.ts` |
| `MAX_TEAMS_FACTS` | const | `src/sinks/teams.ts` |
| `MAX_TEAMS_MESSAGE` | const | `src/sinks/teams.ts` |
| `MAX_TEAMS_MESSAGE_BYTES` | const | `src/sinks/teams.ts` |
| `MAX_TEAMS_TITLE` | const | `src/sinks/teams.ts` |
| `messageFromGitlabBody` | function | `src/sinks/gitlab.ts` |
| `messageFromJiraBody` | function | `src/sinks/jira.ts` |
| `NetworkEntry` | type | `src/report-core.ts` |
| `normaliseBreadcrumbs` | function | `src/report-core.ts` |
| `normaliseConsole` | function | `src/report-core.ts` |
| `normaliseContact` | function | `src/report-core.ts` |
| `normaliseContext` | function | `src/report-core.ts` |
| `normaliseElements` | function | `src/report-core.ts` |
| `normaliseMessage` | function | `src/report-core.ts` |
| `normaliseNetwork` | function | `src/report-core.ts` |
| `normaliseNotes` | function | `src/report-core.ts` |
| `normalisePerf` | function | `src/report-core.ts` |
| `normaliseReplay` | function | `src/report-core.ts` |
| `normaliseStorage` | function | `src/report-core.ts` |
| `parseSentryDsn` | function | `src/sinks/sentry.ts` |
| `PerfSnapshot` | type | `src/report-core.ts` |
| `RateLimitOptions` | type | `src/server/handle.ts` |
| `RateLimitStore` | type | `src/server/handle.ts` |
| `ReplayCapture` | type | `src/report-core.ts` |
| `ReplayEvent` | type | `src/report-core.ts` |
| `ReplayStore` | type | `src/server/handle.ts` |
| `REPORT_TYPES` | const | `src/report-core.ts` |
| `ReportContext` | type | `src/report-core.ts` |
| `ReportDecision` | type | `src/server/handle.ts` |
| `ReportSink` | type | `src/server/handle.ts` |
| `ReportType` | type | `src/report-core.ts` |
| `resetDedupe` | function | `src/server/handle.ts` |
| `resetRateLimits` | function | `src/server/handle.ts` |
| `resetSignatures` | function | `src/server/handle.ts` |
| `Scrubber` | type | `src/scrub.ts` |
| `ScrubberName` | type | `src/scrub.ts` |
| `ScrubOptions` | type | `src/scrub.ts` |
| `scrubReport` | function | `src/scrub.ts` |
| `scrubUrl` | function | `src/scrub.ts` |
| `sendReportEmail` | function | `src/sinks/resend.ts` |
| `SendReportEmailOptions` | type | `src/sinks/resend.ts` |
| `SendReportEmailResult` | type | `src/sinks/resend.ts` |
| `sendReportSmtp` | function | `src/sinks/smtp.ts` |
| `SendReportSmtpResult` | type | `src/sinks/smtp.ts` |
| `sendReportWebhook` | function | `src/sinks/webhook.ts` |
| `SendReportWebhookOptions` | type | `src/sinks/webhook.ts` |
| `SendReportWebhookResult` | type | `src/sinks/webhook.ts` |
| `SendReportWebhookTarget` | type | `src/sinks/webhook.ts` |
| `SENTRY_CLIENT` | const | `src/sinks/sentry.ts` |
| `SENTRY_CLIENT_NAME` | const | `src/sinks/sentry.ts` |
| `SENTRY_CLIENT_VERSION` | const | `src/sinks/sentry.ts` |
| `SENTRY_VERSION` | const | `src/sinks/sentry.ts` |
| `sentryAuthHeader` | function | `src/sinks/sentry.ts` |
| `SentryDsn` | type | `src/sinks/sentry.ts` |
| `SentryEnvelope` | type | `src/sinks/sentry.ts` |
| `SentryItemType` | type | `src/sinks/sentry.ts` |
| `sentrySink` | function | `src/sinks/sentry.ts` |
| `SentrySinkContext` | type | `src/sinks/sentry.ts` |
| `SentrySinkError` | class | `src/sinks/sentry.ts` |
| `SentrySinkOptions` | type | `src/sinks/sentry.ts` |
| `SentryTruncation` | type | `src/sinks/sentry.ts` |
| `SignatureOptions` | type | `src/server/handle.ts` |
| `SinkContext` | type | `src/server/handle.ts` |
| `SinkError` | class | `src/sinks/error.ts` |
| `SinkTimeoutError` | class | `src/server/handle.ts` |
| `slackSink` | function | `src/sinks/slack.ts` |
| `SlackSinkOptions` | type | `src/sinks/slack.ts` |
| `SMTP_NO_REPLY` | const | `src/sinks/smtp.ts` |
| `SMTP_TLS_PORT` | const | `src/sinks/smtp.ts` |
| `smtpSink` | function | `src/sinks/smtp.ts` |
| `SmtpSink` | type | `src/sinks/smtp.ts` |
| `SmtpSinkOptions` | type | `src/sinks/smtp.ts` |
| `stableHash` | function | `src/fingerprint.ts` |
| `StackFrame` | type | `src/report-core.ts` |
| `StorageKeyRef` | type | `src/report-core.ts` |
| `StorageSnapshot` | type | `src/report-core.ts` |
| `StoredReport` | type | `src/server/file-store.ts` |
| `StoredReportFile` | type | `src/server/file-store.ts` |
| `TEAMS_CARD_CONTENT_TYPE` | const | `src/sinks/teams.ts` |
| `TEAMS_CARD_SCHEMA` | const | `src/sinks/teams.ts` |
| `TEAMS_CARD_VERSION` | const | `src/sinks/teams.ts` |
| `teamsSink` | function | `src/sinks/teams.ts` |
| `TeamsSinkOptions` | type | `src/sinks/teams.ts` |
| `toGithub` | function | `src/server/handle.ts` |
| `toLinear` | function | `src/server/handle.ts` |
| `toMarkdown` | function | `src/markdown.ts` |
| `TOO_LARGE_ERROR` | const | `src/server/handle.ts` |
| `toResend` | function | `src/server/handle.ts` |
| `toWebhook` | function | `src/server/handle.ts` |
| `TrustProxyOptions` | type | `src/server/handle.ts` |
| `UrlFrom` | type | `src/sinks/chat.ts` |
| `ValidatedReport` | type | `src/server/handle.ts` |
| `validateReport` | function | `src/server/handle.ts` |
| `WebhookFormat` | type | `src/sinks/webhook.ts` |

### `bugbottle/html-to-image`

1 exports.

| Name | Kind | Source |
|---|---|---|
| `htmlToImage` | function | `src/html-to-image.ts` |

### `bugbottle/annotate`

4 exports.

| Name | Kind | Source |
|---|---|---|
| `AnnotateTool` | type | `src/annotate.ts` |
| `Annotator` | type | `src/annotate.ts` |
| `AnnotatorOptions` | type | `src/annotate.ts` |
| `createAnnotator` | function | `src/annotate.ts` |

### `bugbottle/breadcrumbs`

7 exports.

| Name | Kind | Source |
|---|---|---|
| `Breadcrumb` | type | `src/report-core.ts` |
| `BreadcrumbKind` | type | `src/report-core.ts` |
| `BreadcrumbsOptions` | type | `src/breadcrumbs.ts` |
| `getBreadcrumbs` | function | `src/breadcrumbs.ts` |
| `initBreadcrumbs` | function | `src/breadcrumbs.ts` |
| `isBreadcrumbsActive` | function | `src/breadcrumbs.ts` |
| `resetBreadcrumbs` | function | `src/breadcrumbs.ts` |

### `bugbottle/network`

6 exports.

| Name | Kind | Source |
|---|---|---|
| `getNetwork` | function | `src/network.ts` |
| `initNetwork` | function | `src/network.ts` |
| `isNetworkActive` | function | `src/network.ts` |
| `NetworkEntry` | type | `src/report-core.ts` |
| `NetworkOptions` | type | `src/network.ts` |
| `resetNetwork` | function | `src/network.ts` |

### `bugbottle/perf`

9 exports.

| Name | Kind | Source |
|---|---|---|
| `getPerf` | function | `src/perf.ts` |
| `getStorageSnapshot` | function | `src/perf.ts` |
| `initPerf` | function | `src/perf.ts` |
| `isPerfActive` | function | `src/perf.ts` |
| `PerfOptions` | type | `src/perf.ts` |
| `PerfSnapshot` | type | `src/report-core.ts` |
| `resetPerf` | function | `src/perf.ts` |
| `StorageKeyRef` | type | `src/report-core.ts` |
| `StorageSnapshot` | type | `src/report-core.ts` |

### `bugbottle/rrweb`

15 exports.

| Name | Kind | Source |
|---|---|---|
| `attachRrweb` | function | `src/rrweb.ts` |
| `DEFAULT_REPLAY_MAX_BYTES` | const | `src/rrweb.ts` |
| `DEFAULT_REPLAY_SECONDS` | const | `src/rrweb.ts` |
| `getReplay` | function | `src/rrweb.ts` |
| `isRrwebAttached` | function | `src/rrweb.ts` |
| `REPLAY_BLOCK_SELECTOR` | const | `src/rrweb.ts` |
| `REPLAY_CHECKOUT_MS` | const | `src/rrweb.ts` |
| `REPLAY_MASK_SELECTOR` | const | `src/rrweb.ts` |
| `ReplayCapture` | type | `src/report-core.ts` |
| `ReplayEvent` | type | `src/report-core.ts` |
| `resetRrweb` | function | `src/rrweb.ts` |
| `RrwebEvent` | type | `src/rrweb.ts` |
| `RrwebOptions` | type | `src/rrweb.ts` |
| `RrwebRecord` | type | `src/rrweb.ts` |
| `RrwebRecordOptions` | type | `src/rrweb.ts` |

### `bugbottle/sign`

5 exports.

| Name | Kind | Source |
|---|---|---|
| `computeSignature` | function | `src/sign.ts` |
| `createSigner` | function | `src/sign.ts` |
| `DEFAULT_SIGNATURE_HEADER` | const | `src/sign.ts` |
| `hmacHex` | function | `src/sign.ts` |
| `SignerOptions` | type | `src/sign.ts` |

### `bugbottle/queue`

7 exports.

| Name | Kind | Source |
|---|---|---|
| `createQueue` | function | `src/queue.ts` |
| `MaybePromise` | type | `src/queue.ts` |
| `Queue` | type | `src/queue.ts` |
| `QueuedReport` | type | `src/queue.ts` |
| `QueueOptions` | type | `src/queue.ts` |
| `QueueStorage` | type | `src/queue.ts` |
| `SCREENSHOT_NOTE` | const | `src/queue.ts` |

### `bugbottle/queue-idb`

2 exports.

| Name | Kind | Source |
|---|---|---|
| `createIdbStorage` | function | `src/queue-idb.ts` |
| `IdbStorageOptions` | type | `src/queue-idb.ts` |

### `bugbottle/triggers`

17 exports.

| Name | Kind | Source |
|---|---|---|
| `deepActiveElement` | function | `src/triggers.ts` |
| `DEFAULT_DEDUPE_MS` | const | `src/triggers.ts` |
| `DEFAULT_SHORTCUT` | const | `src/triggers.ts` |
| `describeUncaught` | function | `src/triggers.ts` |
| `eventSource` | function | `src/triggers.ts` |
| `isApplePlatform` | function | `src/triggers.ts` |
| `isEditableTarget` | function | `src/triggers.ts` |
| `ListenerHost` | type | `src/triggers.ts` |
| `matchesShortcut` | function | `src/triggers.ts` |
| `onShortcut` | function | `src/triggers.ts` |
| `onUncaughtError` | function | `src/triggers.ts` |
| `parseShortcut` | function | `src/triggers.ts` |
| `Shortcut` | type | `src/triggers.ts` |
| `ShortcutEvent` | type | `src/triggers.ts` |
| `ShortcutOptions` | type | `src/triggers.ts` |
| `UncaughtError` | type | `src/triggers.ts` |
| `UncaughtErrorOptions` | type | `src/triggers.ts` |

### `bugbottle/shake`

7 exports.

| Name | Kind | Source |
|---|---|---|
| `DEFAULT_SHAKE_COOLDOWN_MS` | const | `src/shake.ts` |
| `DEFAULT_SHAKE_THRESHOLD` | const | `src/shake.ts` |
| `DEFAULT_SHAKE_WINDOW_MS` | const | `src/shake.ts` |
| `onShake` | function | `src/shake.ts` |
| `requestShakePermission` | function | `src/shake.ts` |
| `ShakeEvent` | type | `src/shake.ts` |
| `ShakeOptions` | type | `src/shake.ts` |

### `bugbottle/locales`

15 exports.

| Name | Kind | Source |
|---|---|---|
| `da` | const | `src/locales.ts` |
| `de` | const | `src/locales.ts` |
| `EmailTexts` | type | `src/locales.ts` |
| `en` | const | `src/locales.ts` |
| `enMessages` | const | `src/locales.ts` |
| `es` | const | `src/locales.ts` |
| `fr` | const | `src/locales.ts` |
| `Locale` | type | `src/locales.ts` |
| `locales` | const | `src/locales.ts` |
| `Messages` | type | `src/locales.ts` |
| `nb` | const | `src/locales.ts` |
| `nl` | const | `src/locales.ts` |
| `resolveLocale` | function | `src/locales.ts` |
| `sv` | const | `src/locales.ts` |
| `UiTexts` | type | `src/locales.ts` |

### `bugbottle/locales-extra`

6 exports.

| Name | Kind | Source |
|---|---|---|
| `fi` | const | `src/locales-extra.ts` |
| `it` | const | `src/locales-extra.ts` |
| `localesExtra` | const | `src/locales-extra.ts` |
| `pl` | const | `src/locales-extra.ts` |
| `pt` | const | `src/locales-extra.ts` |
| `uk` | const | `src/locales-extra.ts` |

### `bugbottle/ui`

5 exports.

| Name | Kind | Source |
|---|---|---|
| `Brand` | type | `src/ui/index.ts` |
| `BugbottleWidget` | type | `src/ui/index.ts` |
| `mountBugbottle` | function | `src/ui/index.ts` |
| `MountOptions` | type | `src/ui/index.ts` |
| `Theme` | type | `src/ui/index.ts` |

