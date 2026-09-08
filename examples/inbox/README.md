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

Everything except the endpoint and the demo page is behind
`Authorization: Basic`, compared against `INBOX_PASSWORD` in constant time.
The username is ignored.

Reports go to `examples/inbox/reports/` — or wherever `REPORTS_DIR` says — as
two files each:

- `<time>-<id>.json`, the validated report **without** the screenshot data
  URL, so the file stays readable;
- `<id>.png`, the decoded picture.

Deleting a report deletes both. There is no database and nothing to migrate;
`rm -rf reports/` is the whole retention policy until you write a better one.

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
}
```

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
