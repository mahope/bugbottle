bugbottle is MIT-licensed, has zero runtime dependencies, and has no paid
tier: there is no Pro, no team licence, no seat count and no support contract
to buy. The library, the documentation, the panel and the server half are the
same for everybody, forever.

That is a promise most products in this field do not make, because most of them
are selling a dashboard. bugbottle has none, so the only thing money can do here
is pay for the person who maintains it. This page says what that is, how to do
it, and — equally plainly — what a donation does **not** buy.

## What a donation does not buy

Nothing in the product. There is no licence key to enter, no feature behind a
paywall, no limit on sites or reports, no telemetry, and no branding carried in
the panel. A paid version, if one ever exists, has to be a thing that is
obviously worth more than a donation: something about many sites, many people or
many reports at once, where one person's licence would be the wrong shape.

Money does not buy priority support here either. An issue from a company that
donated is not answered first — that promise cannot be kept by one person and
should not be made. What it does buy is time: time is the only currency in
which "answer the issue, check the browser, cut the release" is paid for, and
that work is what keeps a library trustworthy three years from now.

## What it goes to

- **The browser matrix, honestly described.** Every push runs the accessibility
  audits, the panel's states and an annotation smoke test in a real Chrome, and
  the stack parser reads the V8 format and the Firefox/Safari one because both
  are in the wild. But there is **no automated Firefox or Safari run** — one
  browser in CI, not three. A Safari-only bug is found by somebody with a Mac
  filing an issue, and it is fixed because it is filed. If you run this in a
  browser nobody else does, that is worth knowing before you ship it.
- **The version cadence.** 1.0 was released in September 2026 and the public API
  is frozen: removing or renaming an export needs a major version, and every
  release says what it cost in bytes. Keeping that promise is calendar work.
- **Answering issues.** A report of "the panel is behind the modal on Safari" is
  worth more than any feature, and answering it well is most of the job.
- **Keeping the dependency count at zero.** Nothing to audit, nothing to
  patch, nothing to explain in a security questionnaire. It costs real effort
  to *not* reach for a dependency, and that effort is a cost of the product.

The library is written and maintained by one person,
[Mads Holst Jensen](https://mahoje.dk), in Denmark. There is no team, no
employer and no investor behind it, which is also why the answer to "what
happens if you stop" is: the last release keeps working, because it is MIT and
it is on npm.

## Supporting it without money

The most useful thing costs nothing, and for a library this small it is not the
one people reach for first: **a GitHub star.** The repositories are
[bugbottle](https://github.com/mahope/bugbottle),
[bugbottle-wordpress](https://github.com/mahope/bugbottle-wordpress) and
[bugbottle-action](https://github.com/mahope/bugbottle-action). A star is what
tells the next person looking at a dependency list that this one is worth
trying, and it is the only signal any of the three is measured on.

After that, in the order that helps:

- **Use it and say so.** A report that reached Slack, a Linear ticket or a
  database row is worth a great deal more to a project this size than a
  subscription. The [recipes](/docs/recipes/) are written so that wiring one up
  takes an afternoon.
- **Answer somebody else's issue.** There are not many, and a second maintainer
  in a specific browser is worth more than a general offer.
- **Try it on an application you have not written.** A 1.0 library with two
  stars has been used by almost nobody outside this repository, so the bugs that
  remain are the boring ones nobody hit yet.
- **Say what is missing.** The [roadmap](https://github.com/mahope/bugbottle/blob/main/docs/roadmap.md)
  is public, and "I needed X and it is not there" moves it further than a
  feature request written by the author.

## Donating

Stripe handles the money, and bugbottle never sees a card number or an address:

[**donate at bugbottle.dev**](https://donate.stripe.com/7sYeVcbn50wieFM8gDbMQ0c)

One link, on this page and in the repository's
[`.github/FUNDING.yml`](https://github.com/mahope/bugbottle/blob/main/.github/FUNDING.yml),
so GitHub's own Sponsor button points at the same place. It is not on the
panel, not in the console, and not in a report, and there is no banner anywhere
asking for money. If a donation is a good idea for you, this is where it is; if
it is not, nothing here is in the way.

## If you are buying this for a company

Some questions come from a procurement checklist rather than from a developer,
and the answers are short:

- **Can we use it commercially?** Yes. [MIT](/docs/licence/) says so, and
  commercial use needs no permission and no licence key.
- **Is there a DPA, an SLA or a vendor agreement?** No. There is one maintainer
  and a [MIT licence](/docs/licence/). A DPA is only relevant if data reaches
  the maintainer, and no report ever does: the library posts to an endpoint you
  own, and the maintainer is not in the path. The [privacy
  checklist](/docs/privacy-checklist/) is the document to hand over — it exists
  because a company asked which fields can hold personal data, field by field.
- **Who do we contact about a security problem?** The same address as everybody
  else, and the answer is in [SECURITY.md](https://github.com/mahope/bugbottle/blob/main/SECURITY.md).
- **What happens to our reports?** They go where you told the library to send
  them. Nothing is sent anywhere else, and nothing is kept here.
- **Is the roadmap public?** Yes, and it is in the repository.

If that answer set is not what your process needs, the honest answer is that
this project cannot fill it yet, and a paid team edition is a thing to build
before it is a thing to promise. What exists today is a small MIT library with
[the whole documentation](/docs/) public and a panel that costs
[about 11.5 kB gzipped](/compare/) — code you can read in an afternoon and
run on your own infrastructure.
