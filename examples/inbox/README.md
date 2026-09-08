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
| `GET /r/<id>.json` | The stored JSON, exactly as it is on disk |
| `GET /r/<id>.png` | The screenshot |
| `POST /r/<id>/delete` | Removes both files. Same-origin only: see below |
| `GET /demo.html` | A page with the ready-made panel mounted against this server |
| `GET /health` | `ok`, and nothing else. Public, for the platform's check |

Everything except the endpoint, the demo page and the health route is behind
`Authorization: Basic`, compared against `INBOX_PASSWORD` in constant time.
The username is ignored.

Reports go to `examples/inbox/reports/` — or wherever `REPORTS_DIR` says — as
two files each:

- `<time>-<id>.json`, the validated report **without** the screenshot data
  URL, so the file stays readable;
- `<id>.png`, the decoded picture.

Deleting a report deletes both. There is no database and nothing to migrate;
`rm -rf reports/` is the whole retention policy until you write a better one.

The directory does have a ceiling. `MAX_REPORTS` — 2000 by default — is how
many reports are kept; once a new one takes the count past it, the oldest are
deleted, JSON and picture together, until it is back inside. Without that the
disk is the ceiling: thirty reports a minute are allowed and each may carry
four megabytes of picture, so an inbox left running is eventually a full volume
and an endpoint that has stopped accepting anything. Set `MAX_REPORTS=0` to
switch the cap off, and watch the disk yourself.

The list is held in memory. The directory is walked once, at the first request
that needs it, and after that a write appends to the list and a delete removes
from it — nothing re-reads the directory, because this process is the only
thing that writes to it. Only the four strings the list shows are kept, so a
thousand reports cost a few hundred kilobytes rather than a thousand parsed
reports; the detail page reads the one file it was asked for. If you point a
second process at the same `REPORTS_DIR`, neither will see the other's
reports until it restarts — one process per directory.

The detail page renders `toMarkdown` through a tiny subset — headings,
paragraphs, tables, fenced code, lists and the two `<details>` lines the
renderer writes itself. The structure is read from the Markdown and every
piece of text is escaped before it reaches the page, so a report whose message
is `<img src=x onerror=…>` is *shown*, never run. Report text is
attacker-controlled input; treat any inbox you write the same way.

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

| | |
|---|---|
| `INBOX_PASSWORD` | Required. No password, no inbox |
| `REPORTS_DIR` | `/data` in the image, `./reports` otherwise |
| `PORT` | 8788 |
| `HOST` | `127.0.0.1` by default; the image sets `0.0.0.0`, because in a container the proxy is on the other side of the boundary |
| `ALLOWED_ORIGIN`, `MAX_REPORTS` | As above |

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
