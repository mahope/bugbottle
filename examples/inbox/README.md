# bugbottle — the inbox example

A place for reports to land, in one file and with no dependencies: a Node
server that receives reports with `handleReport`, writes each one to disk, and
serves a read-only inbox behind one password.

It is deliberately the smallest honest version of what the hosted products
give you. No accounts, no search, no assignment, no digests — a list, a detail
page and a delete button. Enough to run one per client site on a small VPS and
stop losing reports in email.

```bash
npm run build                       # in the repository root, once
INBOX_PASSWORD=$(openssl rand -base64 24) node examples/inbox/server.mjs
```

Open http://127.0.0.1:8788/demo.html, send a report, then open
http://127.0.0.1:8788 and sign in with any username and that password.

Without `INBOX_PASSWORD` the server refuses to start. That is not a
convenience check: an inbox that came up without a password would be a public
list of screenshots of somebody's application, and nobody would notice until
it was indexed.

## What is where

| | |
|---|---|
| `POST /api/feedback` | The endpoint the browser posts to. Public, rate-limited to 30 reports a minute, deduplicated for a minute, capped at 4 MB |
| `GET /` | The list, newest first: title, type, page, time |
| `GET /r/<id>` | One report as rendered Markdown, with the picture, *Copy as Markdown* and *Delete* |
| `GET /feed.json` | The newest 50 reports as JSON Feed 1.1 |
| `GET /feed.xml` | The same 50 as Atom |
| `GET /r/<id>.json` | The stored JSON, exactly as it is on disk |
| `GET /r/<id>.png` | The screenshot |
| `POST /r/<id>/delete` | Removes both files. Same-origin only: see below |
| `GET /demo.html` | A page with the ready-made panel mounted against this server |
| `GET /health` | `ok`, and nothing else. Public, for the platform's check |

Everything except the endpoint, the demo page and the health route is behind
`Authorization: Basic`, compared against `INBOX_PASSWORD` in constant time.
The username is ignored.

Storage is `fileStore` from `bugbottle/server`, which is where this used to
keep two hundred lines of its own: the example hands it a directory and a cap
and does no filesystem work itself. Reports go to `examples/inbox/reports/` —
or wherever `REPORTS_DIR` says — as two files each:

- `<time>-<id>.json`, the validated report **without** the screenshot data
  URL, so the file stays readable;
- `<id>.png`, the decoded picture.

Deleting a report deletes both. There is no database and nothing to migrate:
`rm -rf reports/` empties the inbox, and *What is deleted, and when* below is
the policy that runs without you.

Both files are written under a temporary name and renamed into place, which is
atomic within a directory: a process killed halfway through four megabytes of
picture leaves a `.tmp` file that no listing looks at, never a truncated report
or half a screenshot. And every id in a URL is matched against the shape
`crypto.randomUUID()` writes before it becomes part of a path, so `/r/../../..`
is a 404 rather than a question about how `normalize` works.

The list is held in memory. The directory is walked once, at the first request
that needs it, and after that a write appends to the list and a delete removes
from it — nothing re-reads the directory, because this process is the only
thing that writes to it. Only the few strings the list shows are kept, so a
thousand reports cost a few hundred kilobytes rather than a thousand parsed
reports; the detail page reads the one file it was asked for. If you point a
second process at the same `REPORTS_DIR`, neither will see the other's
reports until it restarts — one process per directory.

None of that is special to the example. `fileStore({ dir, maxReports,
maxAgeDays })` is in `bugbottle/server`, and `list()`, `read(id)`, `remove(id)`
and `prune()` are there for whoever wants a different page over the same
directory — see *Receiving a report* in the main README.

### What is deleted, and when

The directory has a ceiling and, if you ask for one, an age limit. Two rules,
and both of them delete a report whole — the JSON and the picture together:

- **`MAX_REPORTS`** — 2000 by default — is how many reports are kept. Once a
  new one takes the count past it, the oldest are deleted until it is back
  inside, **on the write itself**. Without that the disk is the ceiling: thirty
  reports a minute are allowed and each may carry four megabytes of picture, so
  an inbox left running is eventually a full volume and an endpoint that has
  stopped accepting anything. `MAX_REPORTS=0` switches the cap off, and the
  disk is yours to watch.
- **`RETENTION_DAYS`** — unset, so off — is how long a report is kept. With it
  set, everything that arrived longer ago than that is deleted **when the inbox
  starts and once an hour after that**. It is a schedule rather than a write
  because it is the rule that empties an inbox nobody is posting to: thirty
  days of retention on a quiet month has to delete something with no request
  to trigger it.

Nothing here picks a number for you, and that is deliberate. How long you may
keep somebody's screenshot is a question about the promise you made them and
about the law where they live, not one this example can answer; what it can do
is delete on the day you name. Reports that a run before this one left in the
directory are pruned too — the first pass walks the directory rather than only
what this process wrote.

A report a rule deletes is gone: there is no bin, no soft delete, and nothing
in the notification path is touched — an email or a Slack message that has
already been sent stays sent, and the link in it starts answering 404. A
report an arrival time nobody can parse is left alone, since its age is not
something to guess at; the cap takes it in the end. Files the inbox did not
write are never touched by either rule, so a directory that also holds a note,
a backup or an export keeps all three.

The browser has a lifetime of its own, and it is not this one: a report that
was queued because the endpoint was unreachable sits in that browser's storage
until it is delivered or the queue's own limits drop it. Retention here is
about what has arrived.

The detail page renders `toMarkdown` through a tiny subset — headings,
paragraphs, tables, fenced code, lists and the two `<details>` lines the
renderer writes itself. The structure is read from the Markdown and every
piece of text is escaped before it reaches the page, so a report whose message
is `<img src=x onerror=…>` is *shown*, never run. Report text is
attacker-controlled input; treat any inbox you write the same way.

## Subscribe to it

The list is also a feed, so a new report can arrive in the place you already
look rather than in a browser tab you have to remember to open:

| | |
|---|---|
| `/feed.json` | [JSON Feed 1.1](https://jsonfeed.org/version/1.1) |
| `/feed.xml` | Atom ([RFC 4287](https://www.rfc-editor.org/rfc/rfc4287)) |

Both carry the newest 50 reports, newest first: the title, the whole report as
rendered Markdown in `content_text` (Atom's `<content type="text">`), a link to
the detail page, the time it arrived, and the report's type as its one tag or
`<category>`. The screenshot is a link on that page, never bytes in the feed —
a feed carrying fifty pictures is one nothing will poll twice.

**Both want the password**, exactly as the list does, and that is the point:
titles, page addresses and console lines are the same facts about somebody's
application that the inbox exists to keep private, and a feed URL travels
further than a bookmark — into a reader's sync service, a phone, a shared
Slack channel. There is no unguarded token URL to leak instead.

Most readers accept the credentials in the URL, which is how you subscribe:

```
https://inbox:PASSWORD@bugs.example.com/feed.xml
```

NetNewsWire, Reeder, Miniflux, FreshRSS, Feedbin and Slack's RSS app all take
that form, and several have a separate username and password field as well —
prefer the fields when they are there, because a URL with a password in it is
copied, synced and logged like any other. The username is ignored; only the
password after the colon is checked. `curl -u inbox:PASSWORD
https://bugs.example.com/feed.json` is the same request from a script.

The links in a feed are absolute, because they are read somewhere else
entirely. The address comes from the request — `Host`, and
`X-Forwarded-Proto` from the proxy — so behind Caddy or Traefik it is already
right. Set `PUBLIC_URL=https://bugs.example.com` when it is not: a proxy that
rewrites the host, or a reader that shows `http://` links you clicked from a
`https://` page.

Neither feed is cached: `no-store, private`, so a reader shows the reports
that are there rather than the ones that were, and nothing in between keeps a
copy of the list.

## Be told about new reports

A feed is something you poll. The other half is being told, and the inbox does
it through the library's own sinks — no delivery code lives in this example,
only the environment variables that switch one on:

| | |
|---|---|
| `NOTIFY_WEBHOOK` | The webhook a new report is posted to. Treat it as a password: anyone holding it can post to that channel |
| `NOTIFY_KIND` | `slack`, `discord`, `teams` or `webhook`, when the URL's own host does not say — behind a relay, a gateway, a proxy. Unset, the host decides |
| `NOTIFY_SMTP_HOST` | The mail server to send through. Setting it switches the mail on; the four below go with it |
| `NOTIFY_SMTP_PORT` | 465 for implicit TLS, 587 otherwise. Left unset, the sink picks by `secure`; anything that is not a port between 1 and 65535 stops the inbox starting, rather than being discovered on the first report |
| `NOTIFY_SMTP_USER`, `NOTIFY_SMTP_PASS` | The account. Without both, no `AUTH` is attempted at all — and `AUTH` over a connection that is not encrypted is refused rather than sent |
| `NOTIFY_SMTP_FROM` | The envelope sender and the `From` header: `bugs@example.com`. Required |
| `NOTIFY_SMTP_TO` | Who is told. One address, or several separated by commas. Required |

`hooks.slack.com` is a Slack webhook, `discord.com` a Discord one and
`*.webhook.office.com` or `*.logic.azure.com` a Microsoft Teams Workflows one,
so a URL pasted from any of the three needs nothing else: the message arrives
as Block Kit, as an embed or as an Adaptive Card, with the facts, five console
lines and a button to the report. Anything else is posted as JSON — the whole
report with the rendered Markdown beside it — which is the shape an intake of
your own would want.

Both are set at once if you want both. Neither is set by default, and that is
deliberate: an inbox that mailed somebody the first time it was started would
be worse than one that is quiet.

The links in the message point back here — the detail page at `/r/<id>` and the
picture at `/r/<id>.png` — so set `PUBLIC_URL=https://bugs.example.com`, the
same variable the feeds use. Without it the address the process is bound to is
what goes out, which is right on a laptop and wrong behind a proxy. **Both
addresses are behind the password**, which means Slack and Teams cannot render
the picture: they fetch it themselves and are refused, and the person who
clicks the button signs in as usual. That is the right way round. The
alternative is a public URL for a screenshot of somebody's application, and the
privacy note at the end of this file is about exactly that.

A delivery runs after the report is on disk and can never take it away:
`handleReport` gives each sink its own deadline, and a webhook revoked last
week is a line on stderr and still a `201` for the reporter. Nothing is
retried — the report is in `reports/` and in the feed either way, which is why
this is a notification and not a queue.

## Behind TLS

Basic auth over plain HTTP sends the password in every request. Put a
terminating proxy in front of it and never expose port 8788 itself:

```caddy
bugs.example.com {
    reverse_proxy 127.0.0.1:8788

    # A report may carry a four-megabyte picture.
    request_body {
        max_size 5MB
    }
}
```

`Caddyfile` beside this README is that block with its comments, ready to copy.
TLS is Caddy's and the password stays the application's: do not put
`basic_auth` in front of this, because `POST /api/feedback` is public by
design and a proxy password would lock the reporters out of the one route
they need.

nginx is the same shape — `proxy_pass http://127.0.0.1:8788;` inside a
`server` block with a certificate — plus `client_max_body_size 5m;`, or the
proxy refuses the screenshot before the server sees it.

Point any site at it:

```ts
import { mountBugbottle } from "bugbottle/ui";
mountBugbottle({ endpoint: "https://bugs.example.com/api/feedback" });
```

A site on another origin needs the endpoint to say so: start the server with
`ALLOWED_ORIGIN=https://app.example.com`, and that one origin is allowed. It
is deliberately one name rather than a wildcard — `*` lets any page on the
internet fill this disk, and the disk is where the pictures are. A report is
not a login, so nothing sends credentials.

## Deploy it

`Dockerfile` and `compose.yml` are here because the people this example is for
run Dokploy, Coolify or a VPS with Caddy, not `node server.mjs` in a terminal:

```bash
npm run build                              # dist/ is copied into the image
cp examples/inbox/.env.example examples/inbox/.env   # and set INBOX_PASSWORD
docker compose -f examples/inbox/compose.yml up --build
```

The image is `node:22-alpine`, runs as the `node` user, and keeps nothing of
its own: `package.json`, `dist/` and the two files of this example. There is no
`npm install` in it, because the library has no runtime dependencies and the
example self-references it — which is also why the build context is the
repository root. `npm pack`ing the library in would work as well; it is bigger
and one step longer, since the tarball carries the same `dist/` and `npm
install` then unpacks a second copy of it under `node_modules/`.

Reports go to `/data`, and `/data` is the volume. Everything else in the
container is replaceable; that directory is not, and it is as sensitive as the
screenshots in it.

Behind a proxy, set `TRUST_PROXY`. The rate limit — 30 reports a minute —
counts against the address the request came from, and behind Caddy, Traefik or
nginx every request comes from the proxy, so without this setting the whole
site shares one bucket of 30. Caddy and Traefik both append the caller to
`X-Forwarded-For` and are the only hop in front of this process, so
`TRUST_PROXY=true` is the setting for both; nginx does it too when the site
carries `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`, which
is what `proxy_params` contains. Behind a CDN in front of your own proxy set
the number of hops you control instead — `TRUST_PROXY=2` — and on a platform
that writes its own header, name it: `TRUST_PROXY=CF-Connecting-IP`. Only the
named header is read, and only when this is set; leave it unset and a caller
inventing the header changes nothing. Set it too generously and the opposite
is true: any caller can then pick their own bucket and never meet the limit.

| | |
|---|---|
| `INBOX_PASSWORD` | Required. No password, no inbox |
| `REPORTS_DIR` | `/data` in the image, `./reports` otherwise |
| `PORT` | 8788 |
| `HOST` | `127.0.0.1` by default; the image sets `0.0.0.0`, because in a container the proxy is on the other side of the boundary |
| `PUBLIC_URL` | The address the feeds and the notifications link to, when the request's own host is not it |
| `TRUST_PROXY` | Unset by default: the socket, which behind a proxy is the proxy. `true` for the last `X-Forwarded-For` entry, a number for that many hops in from the right, or a header name. As above |
| `ALLOWED_ORIGIN`, `MAX_REPORTS`, `RETENTION_DAYS` | As above. *What is deleted, and when* for the last two |
| `AUDIT_LOG` | `1` prints one JSON line per decision to stdout — what was decided, why, for whom and when, and nothing out of the report itself. *An audit line per report* below |
| `NOTIFY_WEBHOOK`, `NOTIFY_KIND`, `NOTIFY_SMTP_*` | Who is told about a new report, and how. *Be told about new reports* above |

### An audit line per report

`AUDIT_LOG=1` and the inbox prints one JSON line for every answer the endpoint
gives, on stdout, which is where Docker keeps logs:

```json
{"event":"bugbottle.decision","id":"9d1c…","status":201,"reason":"stored",
 "address":"203.0.113.7","fingerprint":"a41f…","at":1757260800000}
```

That is `handleReport`'s `onDecision` hook and nothing else — *Knowing what it
decided* in the main README has the eleven `reason` words. `address` is the
caller as `TRUST_PROXY` resolves it, so it is the same address the rate limit
counted against.

It is off by default because a line per report is a second place somebody's
data could end up, and this one deliberately carries none of it: no message, no
contact line, no picture. The fingerprint is how two lines about the same
report tie together without either of them quoting it.


On **Dokploy**, in eight lines:

1. **Create → Compose**, and point it at your fork of this repository.
2. Set **Compose Path** to `examples/inbox/compose.yml`.
3. Under **Environment**, add `INBOX_PASSWORD` — `openssl rand -base64 24`.
4. Delete the `ports:` block from the compose file, or your inbox is on the
   host's port 8788 in plain HTTP as well as behind the proxy.
5. Under **Domains**, add `bugs.example.com`, service `inbox`, port `8788`,
   HTTPS on, certificate Let's Encrypt.
6. **Advanced → Health Check**: `GET /health`, which is the one public route
   and answers `ok` before anybody has the password.
7. **Deploy**, then open the domain and sign in with any username and that
   password.
8. The `reports` volume is created by compose and survives every redeploy;
   back it up like a database, because that is what it is.

Coolify is the same list with different menu names. A bare VPS is
`docker compose up -d` plus the `Caddyfile` above.

## Please read this part

Verbatim from the main README, because this example is exactly the situation
it warns about — the pictures are on disk, and the disk is the bucket now:

> A screenshot of your application contains whatever the reporter could see. In a
> clinical system that can mean a patient photograph; in a payroll tool, a salary;
> in yours, perhaps somebody's inbox or a half-written message they had not sent
> yet.
>
> Three things follow, and the library cannot do them for you:
>
> 1. **Put screenshots somewhere private.** If your object storage bucket has a
>    public read policy — many media buckets do — anything you write to it can be
>    fetched by anyone holding the URL. Use a separate bucket with no public
>    policy.
> 2. **Serve them back through an authenticated route.** Never give a screenshot
>    a public URL. Look the storage key up from the row rather than taking it from
>    the request, so an id cannot be used to walk your bucket.
> 3. **Say so before the picture is taken.** Put it in the form, next to the
>    checkbox — not in a policy nobody opens.
>
> Requiring people to be signed in is worth considering too. An anonymous
> screenshot is one nobody can be asked about later, and nobody can be told has
> been deleted.

Here, (1) means the `reports/` directory must not sit inside a directory your
web server serves, and its backups are as sensitive as it is. (2) is why
`/r/<id>.png` is behind the password and why the id is checked against a UUID
shape before it reaches a path. (3) is your page's job, not this server's.

Delete asks for one thing more than the password. A browser attaches a cached
`Authorization` header to a form POST from any site, not only from this one —
`SameSite` governs cookies and says nothing about HTTP auth — so a page the
operator visits could otherwise delete a report whose id it knows, and a
reporter learns an id by sending one. `POST /r/<id>/delete` therefore answers
403 unless `Sec-Fetch-Site` and `Origin` say the request came from the inbox.
A request carrying neither header is not a browser and is allowed through, so
`curl` still works.

## What it is not

One password is one person. There is no audit of who read what, no retention
sweep, no export, and a report that is deleted is gone. If you need any of
that, this file is a starting point rather than an answer — the receiving half
is 40 lines of `handleReport`, and the rest is yours to replace.
