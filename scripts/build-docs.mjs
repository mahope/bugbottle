/*
 * Generates site/docs/, the two "Compared with" pages, sitemap.xml and
 * robots.txt.
 *
 * The README is the only copy of the documentation. Keeping a second copy
 * under site/ would mean two texts that drift apart within a release, so this
 * script slices the README at its top-level headings and renders one page per
 * section, with the same header and footer as the landing page. Nothing it
 * writes is committed: site/docs/ is gitignored and built inside the site
 * image, so a README edit is live the next time the site is deployed and no
 * step can be forgotten.
 *
 *   node scripts/build-docs.mjs        # writes site/docs/ and the rest
 *
 * The grouping below is the one editorial decision the script makes. Every
 * top-level README section must appear in it exactly once; the build fails
 * when a new section is added and not placed, because a section nobody placed
 * is a page nobody can reach.
 *
 * Five pages are not README sections. site/compare.md and site/da/sammenlign.md
 * are their own Markdown files, rendered by the same renderer into
 * site/compare/ and site/da/sammenlign/ with the landing page's header and
 * footer. They are prose that is neither the landing page nor the README,
 * because they are about other people's products and have no business in a
 * package README. site/da/kom-i-gang.md is the third, for the same kind of
 * reason in reverse: the documentation is English and this is the one Danish
 * way in, so it belongs on the site rather than in the README.
 * site/da/privatliv.md is the fourth and the one page written twice: it is the
 * Danish half of the README's privacy checklist, paired with it by hreflang
 * because the two really are one page in two languages. The fifth is
 * CHANGELOG.md, rendered into site/docs/changelog/ so the release notes are a
 * page on the site rather than a link away to a raw file on GitHub.
 *
 * The last two files are for machines: site/sitemap.xml lists every URL the
 * site has, each with the date of the commit that last touched the file it is
 * generated from and with hreflang alternates on the two pairs that exist in
 * both languages, and site/robots.txt allows everything and points at the
 * sitemap.
 * Both are generated here rather than written by hand so a new docs page
 * cannot be left out of them, and both are gitignored like site/docs/.
 */

import { execFileSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Marked } from "marked";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "site", "docs");

const REPO = "https://github.com/mahope/bugbottle";
const BLOB = `${REPO}/blob/main`;
const ORIGIN = "https://bugbottle.dev";

/* Filled in from package.json by main(), so the index page can say which
   release it describes without anyone typing the number twice. */
let version = "";

/* The intro — everything above the first `##` — is a page of its own, since
   that is where installing lives. It has no README heading to slice at, so it
   is named here rather than discovered. */
const INTRO = {
  slug: "install",
  title: "Install bugbottle",
  navTitle: "Install",
};

/* The pages that come from their own Markdown file instead of a README
   section. The two comparison pages are a pair: the same page in the other
   language, linked from the other with `otherUrl` and hreflang, exactly like
   the two landing pages. A page without an `otherUrl` has no counterpart and
   claims none — `hreflang` is a promise that the other URL is the same page,
   and there is no honest way to make that promise about a page that does not
   exist. `indexed: false` keeps a page out of site/docs/search.json. */
const STANDALONE = [
  {
    id: "compare",
    lang: "en",
    source: join("site", "compare.md"),
    out: join("compare"),
    url: "/compare/",
    title: "Compared with",
    navTitle: "Compared with",
    eyebrow: "About",
    heading: "Compared with the alternatives",
    otherUrl: "/da/sammenlign/",
  },
  {
    id: "sammenlign",
    lang: "da",
    source: join("site", "da", "sammenlign.md"),
    out: join("da", "sammenlign"),
    url: "/da/sammenlign/",
    title: "Sammenlignet med",
    navTitle: "Sammenlignet med",
    eyebrow: "Om",
    heading: "Sammenlignet med alternativerne",
    otherUrl: "/compare/",
  },
  {
    id: "kom-i-gang",
    lang: "da",
    source: join("site", "da", "kom-i-gang.md"),
    out: join("da", "kom-i-gang"),
    url: "/da/kom-i-gang/",
    title: "Kom i gang",
    navTitle: "Kom i gang",
    eyebrow: "Dansk",
    heading: "Kom i gang med bugbottle",
    /* No `otherUrl`: /docs/install/ is the nearest English page and it is not
       this page. It is the README's opening — what the package is and how to
       install it — while this one walks three routes to a first report, the
       WordPress plugin among them, and says the privacy part in Danish.
       Calling them alternates would tell a crawler they are the same page. */
    indexed: false,
  },
  {
    id: "privatliv",
    lang: "da",
    source: join("site", "da", "privatliv.md"),
    out: join("da", "privatliv"),
    url: "/da/privatliv/",
    title: "Privatliv",
    navTitle: "Privatliv",
    eyebrow: "Dansk",
    heading: "Privatliv i bugbottle",
    /* The one Danish page with an English twin. It is the same page as the
       README's privacy checklist, field for field, so it says so with
       `hreflang`: an EU site owner reaching for it in Danish and a crawler
       looking at both should be told they are one page in two languages. */
    otherUrl: "/docs/privacy-checklist/",
  },
];

/* The changelog. Also its own Markdown file rather than a README section, but
   unlike the comparison it exists in one language and lives under /docs/,
   because it is documentation: it is the answer to "what moved", and the
   answer should be a page with the site's typography and not a raw file on
   GitHub. Its `##` headings are the releases, and their anchors are the
   version with hyphens for dots, so /docs/changelog/#0-9-0 is a link anyone
   can guess and the landing pages can stamp. */
const CHANGELOG = {
  id: "changelog",
  lang: "en",
  source: "CHANGELOG.md",
  out: join("docs", "changelog"),
  url: "/docs/changelog/",
  title: "Changelog",
  navTitle: "Changelog",
  eyebrow: "About",
  heading: "Changelog",
  tocTitle: "Releases",
};

/* slug -> group. The order inside a group is the order of the pages in the
   sidebar and of previous/next. */
const GROUPS = [
  {
    title: "Get started",
    blurb: "Install it, record the console, and put a form in front of it.",
    slugs: [
      INTRO.slug,
      "recording-console-errors",
      "the-form-react",
      "the-form-vue",
      "the-form-svelte",
      "the-form-solid",
      "catching-render-errors-react",
      "opening-it-without-a-button",
      "the-form-anything-else",
      "when-the-network-is-down",
      "the-ready-made-panel",
      "one-script-tag",
      "languages-and-branding",
    ],
  },
  {
    title: "Evidence",
    blurb: "What a report carries besides the sentence someone typed.",
    slugs: [
      "pointing-at-the-element",
      "what-happened-before",
      "what-the-network-did",
      "performance-and-storage",
      "replay-with-rrweb",
      "screenshots",
    ],
  },
  {
    title: "Server",
    blurb: "Receiving a report, checking it, and sending it onward.",
    slugs: [
      "receiving-a-report",
      "recipes",
      "sending-it-somewhere",
      "the-payload",
      "feeding-reports-to-an-agent",
    ],
  },
  {
    title: "Privacy",
    blurb: "The part to read before you turn screenshots on.",
    slugs: ["please-read-this-part"],
  },
  {
    title: "Reference",
    blurb: "The exported surface, a round trip you can run, and the Action.",
    slugs: ["api", "a-working-example", "github-action", "releasing"],
  },
  {
    title: "About",
    blurb:
      "The answers a data protection question needs, who writes this, and " +
      "under which licence.",
    slugs: ["privacy-checklist", "who-makes-it", "licence"],
    /* Not a README section, so it is listed here rather than in `slugs`: the
       comparison lives on the site alone. */
    extras: [
      {
        url: "/compare/",
        navTitle: "Compared with",
        description:
          "Where bugbottle sits next to Marker.io, Jam, Sentry User Feedback, BugPin and rrweb.",
      },
      {
        url: "/docs/changelog/",
        navTitle: "Changelog",
        description: "Every release, what it added, what it fixed and what it cost in bytes.",
      },
    ],
  },
];

/* The documentation pages that also exist in Danish, slug -> the Danish URL.
   The README is English by definition, so a `##` section normally has no
   counterpart and claims none. The privacy checklist is the exception: it is
   written twice, here and as site/da/privatliv.md, and the two are the same
   page in two languages. Named once, and read where the head, the language
   switch and the sitemap are built, so a pair is one line rather than four
   places to forget. */
const TRANSLATED = {
  "privacy-checklist": "/da/privatliv/",
};

/* A handful of README headings do not make good page titles on their own —
   they read as a continuation of the sentence above them, which the page no
   longer has. */
/* The one README heading whose URL is not its own slug. "A privacy checklist"
   reads as a sentence in the README and would give /docs/a-privacy-checklist/,
   which is a worse URL to hand to a data protection officer than
   /docs/privacy-checklist/ — and this URL is quoted in the sitemap's hreflang
   pair, on the Danish page and in the WordPress plugin's README, so it is the
   part that has to be short and stable. The README anchor is unchanged: it
   stays `#a-privacy-checklist` on GitHub, and the anchor map below points it
   at the page as well, so a link written for GitHub still lands here. */
const SLUG_OVERRIDES = {
  "a-privacy-checklist": "privacy-checklist",
};

const TITLE_OVERRIDES = {
  "the-form-react": "The form (React)",
  api: "API",
  "please-read-this-part": "Privacy: please read this part",
};

/* Scripts a single page loads on top of docs.js, keyed on the slug. The
   documentation is one shell for thirty pages, so anything that runs on one of
   them has to be named here rather than added to the file every page loads:
   /playground.js is a theme editor that twenty-nine pages have no use for. A
   module, because it imports the panel from /dist/. */
const PLAYGROUND_SLUG = "languages-and-branding";

const PAGE_SCRIPTS = {
  [PLAYGROUND_SLUG]: ["/playground.js"],
};

/*
 * The theme playground under "Branding and theme".
 *
 * The variable names and the `theme` keys are not written here. They are read
 * out of the README's own table by `themeVariables()` below, because that table
 * is what the reader is looking at when they reach the playground: a second
 * copy in this script could rename `--bb-bg` on the page and leave the table
 * saying something else, and nobody would notice until a reader copied the CSS
 * and it did nothing. What is written here is the one thing the table does not
 * say — how a value is edited — and the build fails when a control names a key
 * the table does not have, so the two cannot drift apart quietly.
 *
 * The default values are not here either: the playground reads them off the
 * mounted panel with getComputedStyle, so the controls start where the panel
 * actually starts even after src/ui/index.ts changes its blue.
 */
const PLAYGROUND_CONTROLS = [
  { key: "primary", label: "Primary colour", control: "colour" },
  { key: "background", label: "Ground", control: "colour" },
  { key: "text", label: "Ink", control: "colour" },
  { key: "radius", label: "Corner radius", control: "length", min: 0, max: 28, step: 1, unit: "px" },
  {
    key: "font",
    label: "Font",
    control: "choice",
    /* The empty value means "leave the panel's own stack alone", and the
       playground then prints no `font` at all. The other three are stacks
       every desktop has, so the change is a change rather than a fallback. */
    options: [
      ["", "The panel's own stack"],
      ['Georgia, "Times New Roman", serif', "Georgia"],
      ["Verdana, Geneva, sans-serif", "Verdana"],
      ["ui-monospace, SFMono-Regular, Menlo, monospace", "Monospace"],
    ],
  },
  {
    key: "position",
    label: "Position",
    control: "choice",
    options: [
      ["bottom-right", "Bottom right"],
      ["bottom-left", "Bottom left"],
      ["top-right", "Top right"],
      ["top-left", "Top left"],
    ],
  },
  {
    key: "scheme",
    label: "Colour scheme",
    control: "choice",
    options: [["light", "Light"], ["dark", "Dark"], ["auto", "Auto"]],
  },
];

/* The rows of the README's `--bb-*` table, as `{ variable, key }`. The two
   rows that are attributes rather than custom properties carry an em dash in
   the first column and come back with `variable: null`. The header row and the
   separator both fail the `theme` key pattern and are skipped, which is why
   nothing here has to count lines. */
function themeVariables(body) {
  const lines = body.split("\n");
  const start = lines.findIndex((line) => /^###\s+Branding and theme\s*$/.test(line));
  if (start === -1) return [];
  const rows = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (/^#{1,3}\s/.test(line)) break;
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    const key = /^`([A-Za-z]+)`$/.exec(cells[1] ?? "");
    if (!key) continue;
    const variable = /^`(--bb-[a-z-]+)`$/.exec(cells[0] ?? "");
    rows.push({ variable: variable ? variable[1] : null, key: key[1] });
  }
  return rows;
}

/* One labelled control per entry in PLAYGROUND_CONTROLS, carrying the CSS
   variable the README's table gives its key. Every input has a <label for>;
   the range also has an <output>, because a slider that says nothing about
   where it is is a slider nobody can set on purpose. */
function playgroundHtml(body) {
  const byKey = new Map(themeVariables(body).map((row) => [row.key, row]));
  const missing = PLAYGROUND_CONTROLS.filter((c) => !byKey.has(c.key)).map((c) => c.key);
  if (missing.length) {
    throw new Error(
      `The theme playground names ${missing.join(", ")}, which the README's ` +
        `"Branding and theme" table does not list. Add the row or drop the control.`,
    );
  }

  const fields = PLAYGROUND_CONTROLS.map((control) => {
    const row = byKey.get(control.key);
    const id = `pg-${control.key.toLowerCase()}`;
    const data =
      ` data-key="${control.key}"` +
      (row.variable ? ` data-var="${row.variable}"` : "") +
      (control.unit ? ` data-unit="${control.unit}"` : "");
    let field;
    if (control.control === "colour") {
      field = `<input id="${id}" type="color"${data}>`;
    } else if (control.control === "length") {
      field =
        `<input id="${id}" type="range" min="${control.min}" max="${control.max}" ` +
        `step="${control.step}"${data}>` +
        `<output for="${id}" id="${id}-value"></output>`;
    } else {
      const options = control.options
        .map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`)
        .join("");
      field = `<select id="${id}"${data}>${options}</select>`;
    }
    return (
      `      <p class="pg-field">` +
      `<label for="${id}">${escapeHtml(control.label)}</label>${field}</p>`
    );
  }).join("\n");

  /* Hidden until playground.js has mounted a panel into it: without JavaScript
     — or with /dist/ missing — an empty stage and two empty code blocks with
     copy buttons are worse than no section at all. */
  return `<div class="playground" data-playground hidden>
  <h3 id="theme-playground">Try it</h3>
  <p>Move a control and the panel beside it is restyled as you go, from the same
  values the table above lists. The two blocks below are the call and the
  stylesheet that produce what you are looking at. Nothing is saved: reloading
  the page brings back the defaults.</p>
  <div class="pg-grid">
    <div class="pg-controls" role="group" aria-labelledby="theme-playground">
${fields}
      <p class="pg-field"><button type="button" class="pg-reset">Reset the theme</button></p>
    </div>
    <div class="pg-stage" data-playground-stage inert></div>
  </div>
  <div class="slab" data-copy><div class="slab-tab">ts</div><pre><code data-playground-js></code></pre></div>
  <div class="slab" data-copy><div class="slab-tab">css</div><pre><code data-playground-css></code></pre></div>
</div>
`;
}

/* The playground goes under "Branding and theme", which means after everything
   that heading owns: the next heading of the same level or above, or the end of
   the page when — as today — the section is the last on it. */
function withPlayground(html, body) {
  const block = playgroundHtml(body);
  const heading = html.indexOf('<h2 id="branding-and-theme"');
  if (heading === -1) throw new Error('the panel page has no "Branding and theme" heading');
  const next = html.slice(heading + 1).search(/<h[12] /);
  if (next === -1) return html + block;
  return html.slice(0, heading + 1 + next) + block + html.slice(heading + 1 + next);
}

/* GitHub's heading anchors, near enough for the headings this README has:
   lowercase, punctuation dropped, spaces to hyphens. */
function slugify(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/`/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-");
}

/* The anchor of a changelog release. `## 0.9.0 — 2026-09-08` is `#0-9-0` and
   `## Unreleased` is `#unreleased`, so a link to a release survives the date
   being corrected and is short enough to type. The heading that covers four
   patch releases at once — `## 0.2.4, 0.2.3, 0.2.2, 0.2.1` — is anchored by
   the first version in it, which is the one anybody looks for. */
function versionAnchor(text) {
  const version = /\d+\.\d+(?:\.\d+)?/.exec(text);
  return version ? version[0].replace(/\./g, "-") : slugify(text);
}

/* Splitting on a regular expression would cut inside the fenced Markdown
   sample in "Feeding reports to an agent", which contains its own `##`
   heading. Walk the lines and remember whether a fence is open instead. */
function readHeadings(lines) {
  const headings = [];
  let fence = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const fenceMatch = /^\s*(```+|~~~+)/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1] ?? "";
      if (fence === null) fence = marker[0];
      else if (marker[0] === fence) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line);
    if (headingMatch) {
      const hashes = headingMatch[1] ?? "";
      const text = (headingMatch[2] ?? "").trim();
      headings.push({ line: i, depth: hashes.length, text, slug: slugify(text) });
    }
  }
  return headings;
}

function sliceSections(markdown) {
  const lines = markdown.split("\n");
  const headings = readHeadings(lines);
  const tops = headings.filter((h) => h.depth === 2);
  if (tops.length === 0) throw new Error("README has no `##` sections");

  const firstTop = tops[0];
  if (!firstTop) throw new Error("README has no `##` sections");

  /* The intro keeps its prose but not the H1, the badge row or the line
     pointing at bugbottle.dev. The badges are images from shields.io and this
     site makes no external request; the link is a link to the site the reader
     is already on. */
  const introLines = lines.slice(0, firstTop.line).filter((line) => {
    if (/^#\s/.test(line)) return false;
    if (/^\[!\[/.test(line)) return false;
    if (/^\[bugbottle\.dev\]/.test(line)) return false;
    return true;
  });

  const sections = [
    {
      slug: INTRO.slug,
      title: INTRO.title,
      navTitle: INTRO.navTitle,
      readmeAnchor: "",
      body: introLines.join("\n").trim(),
      headings: headings.filter((h) => h.line < firstTop.line && h.depth > 1),
    },
  ];

  for (let i = 0; i < tops.length; i += 1) {
    const top = tops[i];
    if (!top) continue;
    const next = tops[i + 1];
    const end = next ? next.line : lines.length;
    const body = lines.slice(top.line + 1, end).join("\n").trim();
    sections.push({
      slug: SLUG_OVERRIDES[top.slug] ?? top.slug,
      readmeSlug: top.slug,
      title: TITLE_OVERRIDES[top.slug] ?? top.text,
      navTitle: top.text,
      readmeAnchor: `#${top.slug}`,
      body,
      headings: headings.filter((h) => h.line > top.line && h.line < end && h.depth > 2),
    });
  }
  return sections;
}

/* One sentence of prose for <meta name="description">, taken from the section
   rather than written by hand so it cannot go stale either. */
function describe(body) {
  const lines = body.split("\n");
  const paragraph = [];
  let fence = null;
  for (const line of lines) {
    const fenceMatch = /^\s*(```+|~~~+)/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1] ?? "";
      if (fence === null) fence = marker[0];
      else if (marker[0] === fence) fence = null;
      continue;
    }
    if (fence !== null) continue;
    if (/^\s*(#|>|\||-\s|\*\s|\d+\.\s)/.test(line)) {
      if (paragraph.length > 0) break;
      continue;
    }
    if (line.trim() === "") {
      if (paragraph.length > 0) break;
      continue;
    }
    paragraph.push(line.trim());
  }
  const text = paragraph
    .join(" ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= 160) return text;
  const clipped = text.slice(0, 157);
  const cut = clipped.lastIndexOf(" ");
  return `${cut > 40 ? clipped.slice(0, cut) : clipped}…`;
}

/* The plain prose of a slice of Markdown, for the search index: fenced code
   and heading lines dropped, links and emphasis unwrapped, table cells kept as
   text. What is left is the sentences a reader would recognise, which is what
   a substring search has to match against.

   Underscores survive: an option called `DEFAULT_MASK_SELECTOR` is exactly the
   kind of word a reader half-remembers and types into the field, and stripping
   the underscore with the backticks around it made every such name
   unsearchable. */
function prose(lines) {
  const kept = [];
  let fence = null;
  for (const line of lines) {
    const fenceMatch = /^\s*(```+|~~~+)/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1] ?? "";
      if (fence === null) fence = marker[0];
      else if (marker[0] === fence) fence = null;
      continue;
    }
    if (fence !== null) continue;
    if (/^\s*#/.test(line)) continue;
    /* A table row is content, and several options are documented nowhere else.
       The alignment row underneath the header says nothing, so it goes; the
       cells of every other row stay, separated by spaces. */
    if (/^\s*\|/.test(line)) {
      if (/^\s*\|[\s:|-]*$/.test(line)) continue;
      kept.push(
        line
          .trim()
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((cell) => cell.trim())
          .filter((cell) => cell !== "")
          .join(" "),
      );
      continue;
    }
    kept.push(line.replace(/^\s*(>|[-*+]|\d+\.)\s+/, ""));
  }
  return kept
    .join(" ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/* One search entry per page and one per heading inside it. The text is the
   whole prose of that slice rather than an opening sentence: a reader
   searching the documentation is looking for a word they remember, and the
   words worth remembering are as often in the middle of a section as at the
   top of it. The file is fetched once, on the first focus of the field, so
   its size costs nobody anything until somebody searches.

   Headings of any depth are used, so the index follows the article rather
   than the page: a README `###` is an `<h2>` on the page it became. */
function searchEntries(page) {
  const lines = page.body.split("\n");
  const headings = readHeadings(lines);
  const first = headings[0];
  const entries = [
    {
      url: page.url,
      title: page.title,
      heading: "",
      text: prose(lines.slice(0, first ? first.line : lines.length)),
    },
  ];
  for (let i = 0; i < headings.length; i += 1) {
    const heading = headings[i];
    if (!heading) continue;
    const next = headings[i + 1];
    entries.push({
      url: `${page.url}#${heading.slug}`,
      title: page.title,
      heading: heading.text.replace(/`/g, ""),
      text: prose(lines.slice(heading.line + 1, next ? next.line : lines.length)),
    });
  }
  return entries;
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderer(page, anchors) {
  return {
    /* The section heading became the page's h1, so everything below it moves
       up one level and keeps the document outline honest. */
    heading(token) {
      const text = this.parser.parseInline(token.tokens);
      const level = Math.max(2, token.depth - 1);
      const id = slugify(token.raw.replace(/^#+\s*/, ""));
      return (
        `<h${level} id="${id}">${text}` +
        ` <a class="anchor" href="#${id}" aria-label="Link to this section">#</a>` +
        `</h${level}>\n`
      );
    },

    /* The same slab the landing page uses, plus a copy button that docs.js
       wires up. Without JavaScript the button is never added and the code is
       still there to select. */
    code(token) {
      const lang = (token.lang ?? "").split(/\s+/)[0] ?? "";
      const tab = lang ? `<div class="slab-tab">${escapeHtml(lang)}</div>` : "";
      return `<div class="slab" data-copy>${tab}<pre><code>${escapeHtml(token.text)}</code></pre></div>\n`;
    },

    /* README links are written for GitHub: `#anchor` means somewhere in the
       one long file, and `./LICENSE` means a file in the repository. Both
       have to be pointed somewhere real from a page that is only one section
       of it. */
    link(token) {
      const text = this.parser.parseInline(token.tokens);
      let href = token.href ?? "";
      if (href.startsWith("#")) {
        const target = anchors.get(href.slice(1));
        href = target ?? `${BLOB}/README.md${href}`;
      } else if (!href.startsWith("/") && !/^[a-z]+:|^\/\//i.test(href)) {
        href = `${BLOB}/${href.replace(/^\.\//, "")}`;
      }
      const external = !href.startsWith(`${ORIGIN}/`) && !href.startsWith("/") && !href.startsWith("#");
      const rel = external ? ' rel="noopener"' : "";
      return `<a href="${escapeHtml(href)}"${rel}>${text}</a>`;
    },

    /* The footer promises no external request. An image from the README would
       break that promise on a docs page, so images become their alt text. */
    image(token) {
      return escapeHtml(token.text ?? token.title ?? "");
    },
  };
}

/* The changelog's own heading rule, on top of the renderer above. A release
   heading is an `<h2>` carrying its version anchor; everything under it —
   Added, Fixed, Changed, a dozen times over — is an `<h3>` with no id at all.
   The shared renderer would give every one of those the id `added`, which is
   a page with twelve elements answering to one anchor and eleven of them
   unreachable. Nobody links to "Added"; they link to a release. */
function changelogRenderer(page) {
  const base = renderer(page, new Map());
  return {
    ...base,
    heading(token) {
      const text = this.parser.parseInline(token.tokens);
      if (token.depth > 2) return `<h3>${text}</h3>\n`;
      const id = versionAnchor(token.raw.replace(/^#+\s*/, ""));
      return (
        `<h2 id="${id}">${text}` +
        ` <a class="anchor" href="#${id}" aria-label="Link to this release">#</a>` +
        `</h2>\n`
      );
    },
  };
}

/* The <head> and the header, shared by the documentation and by the two
   comparison pages. A page carries its own language, its canonical URL and
   the alternates it has; a documentation page has only itself. */
function head(page) {
  const url =
    page.canonical ??
    `${ORIGIN}/docs/${page.slug === INTRO.slug ? "install/" : `${page.slug}/`}`;
  const title =
    page.headTitle ??
    (page.slug === "index" ? "Documentation — bugbottle" : `${page.title} — bugbottle docs`);
  const lang = page.lang ?? "en";
  const alternates = (page.alternates ?? [{ hreflang: lang, href: url }])
    .map((alt) => `<link rel="alternate" hreflang="${alt.hreflang}" href="${alt.href}">`)
    .join("\n");
  const ogLocale = lang === "da" ? "da_DK" : "en";
  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(page.description)}">
<link rel="canonical" href="${url}">
${alternates}
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Cpath d='M13 6h6v3.6l3.6 6.2A4 4 0 0 1 23 17.8V26a3 3 0 0 1-3 3h-8a3 3 0 0 1-3-3v-8.2c0-.7.2-1.4.5-2L13 9.6z' fill='%23a8102b'/%3E%3Crect x='12.5' y='2' width='7' height='4' rx='1' fill='%230d2a24'/%3E%3C/svg%3E">
<meta property="og:type" content="article">
<meta property="og:site_name" content="bugbottle">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(page.description)}">
<meta property="og:locale" content="${ogLocale}">
<meta property="og:image" content="${ORIGIN}/og.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="bugbottle: a report card with a message, an element selector, a console error and a breadcrumb trail, sealed with a 201.">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${ORIGIN}/og.png">
<link rel="preload" href="/fonts/sourcesans3-400.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/fonts/newsreader-600.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/style.css">
<link rel="stylesheet" href="/docs.css">
</head>
<body class="docs">

<header class="site-header">
  <div class="wrap">
    <a class="brand" href="${lang === "da" ? "/da/" : "/"}">
      <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
        <path d="M13 6h6v3.6l3.6 6.2A4 4 0 0 1 23 17.8V26a3 3 0 0 1-3 3h-8a3 3 0 0 1-3-3v-8.2c0-.7.2-1.4.5-2L13 9.6z" fill="currentColor"/>
        <rect x="12.5" y="2" width="7" height="4" rx="1" fill="currentColor" opacity=".55"/>
      </svg>
      bugbottle
    </a>
    <nav class="site-nav" aria-label="${lang === "da" ? "Websted" : "Site"}">
      <a href="/docs/"${page.docsCurrent === false ? ' hreflang="en"' : ' aria-current="true"'}>${lang === "da" ? "Dokumentation" : "Docs"}</a>
      <a href="https://github.com/mahope/bugbottle">GitHub</a>
      <a href="https://www.npmjs.com/package/bugbottle">npm</a>
    </nav>
    <nav class="lang" aria-label="${lang === "da" ? "Sprog" : "Language"}">
      <a href="${page.enUrl ?? "/"}" lang="en" hreflang="en"${lang === "en" ? ' aria-current="page"' : ""}>EN</a>
      <a href="${page.daUrl ?? "/da/"}" lang="da" hreflang="da"${lang === "da" ? ' aria-current="page"' : ""}>DA</a>
    </nav>
  </div>
</header>
`;
}

/* The same footer as the landing page, in either language, plus the link to
   the comparison — which is the one page a reader weighing up bugbottle is
   looking for and would otherwise never find. */
function foot(page) {
  const lang = typeof page === "string" ? page : (page.lang ?? "en");
  const da = lang === "da";
  const enUrl = (typeof page === "string" ? undefined : page.enUrl) ?? "/";
  const daUrl = (typeof page === "string" ? undefined : page.daUrl) ?? "/da/";
  return `
<footer>
  <div class="wrap">
    <nav aria-label="${da ? "Andre steder" : "Elsewhere"}">
      <a href="${REPO}">${da ? "Kildekoden på GitHub" : "Source on GitHub"}</a>
      <a href="https://www.npmjs.com/package/bugbottle">${da ? "bugbottle på npm" : "bugbottle on npm"}</a>
      <a href="${da ? "/da/sammenlign/" : "/compare/"}">${da ? "Sammenlignet med" : "Compared with"}</a>
      <a href="${REPO}/issues">${da ? "Meld et problem" : "Report a problem"}</a>
    </nav>
    <p>${
      da
        ? `MIT-licens. Skrevet og vedligeholdt af <a href="https://mahoje.dk">Mahope</a> i Danmark.`
        : `MIT licence. Written and maintained by <a href="https://mahoje.dk">Mahope</a> in Denmark.`
    }</p>
    <p>${
      da
        ? "Siden sætter ingen cookies, kører ingen statistik og henter ingenting udefra."
        : "This page sets no cookies, runs no analytics and makes no external request."
    }</p>
    <div class="lang lang-footer">
      <a href="${enUrl}" lang="en" hreflang="en"${da ? "" : ' aria-current="page"'}>English</a>
      <a href="${daUrl}" lang="da" hreflang="da"${da ? ' aria-current="page"' : ""}>Dansk</a>
    </div>
  </div>
</footer>

<script src="/docs.js" defer></script>
${pageScripts(page)}</body>
</html>
`;
}

/* The page-specific scripts, if the slug has any. A module rather than a
   `defer`red classic script, so it can import the panel from /dist/; both wait
   for the document either way. */
function pageScripts(page) {
  const slug = typeof page === "string" ? "" : (page.slug ?? "");
  return (PAGE_SCRIPTS[slug] ?? [])
    .map((src) => `<script type="module" src="${src}"></script>\n`)
    .join("");
}

function sidebar(pages, currentSlug) {
  const groups = GROUPS.map((group) => {
    const items = group.slugs
      .map((slug) => pages.find((p) => p.slug === slug))
      .filter((page) => page !== undefined)
      .concat(group.extras ?? [])
      .map((page) => {
        const current = page.slug !== undefined && page.slug === currentSlug;
        const mark = current ? ' aria-current="page"' : "";
        return `        <li><a href="${page.url}"${mark}>${escapeHtml(page.navTitle)}</a></li>`;
      })
      .join("\n");
    return `      <p class="docs-group">${escapeHtml(group.title)}</p>\n      <ul>\n${items}\n      </ul>`;
  }).join("\n");

  const indexMark = currentSlug === "index" ? ' aria-current="page"' : "";
  /* A <details> that is open in the HTML, so a reader without JavaScript gets
     the whole list on every width — which is what the page did before. On a
     phone docs.js closes it at load, where twenty-eight links above the
     article are a wall rather than a table of contents. */
  return `  <nav class="docs-sidebar" aria-label="Documentation">
    <details class="docs-topics" open>
      <summary>Topics</summary>
      <p class="docs-group"><a href="/docs/"${indexMark}>All topics</a></p>
${groups}
    </details>
  </nav>`;
}

function onThisPage(page) {
  if (page.headings.length < 2) return "";
  const items = page.headings
    .map((h) => `      <li><a href="#${h.slug}">${escapeHtml(h.text.replace(/`/g, ""))}</a></li>`)
    .join("\n");
  return `    <nav class="docs-toc" aria-label="On this page">
      <p>On this page</p>
      <ul>
${items}
      </ul>
    </nav>\n`;
}

/* The list of releases at the top of the changelog, in the same ruled column
   "On this page" uses, so docs.js marks the release the reader is inside as
   they scroll and the print stylesheet drops it. A reader arrives at a
   changelog looking for one version; the alternative is scrolling past 1400
   lines of prose to find it. */
function releaseToc(releases, title) {
  const items = releases
    .map((r) => `      <li><a href="#${r.anchor}">${escapeHtml(r.text)}</a></li>`)
    .join("\n");
  return `    <nav class="docs-toc" aria-label="${escapeHtml(title)}">
      <p>${escapeHtml(title)}</p>
      <ul>
${items}
      </ul>
    </nav>\n`;
}

function pageHtml(page, pages) {
  const previous = page.previous
    ? `<a class="prev" href="${page.previous.url}"><span>Previous</span>${escapeHtml(page.previous.navTitle)}</a>`
    : "";
  const next = page.next
    ? `<a class="next" href="${page.next.url}"><span>Next</span>${escapeHtml(page.next.navTitle)}</a>`
    : "";

  return `${head(page)}
<main class="docs-shell wrap">
${sidebar(pages, page.slug)}

  <article class="docs-body">
    <p class="docs-eyebrow">${escapeHtml(page.groupTitle)}</p>
    <h1>${escapeHtml(page.title)}</h1>
${onThisPage(page)}${page.html}
    <p class="docs-edit"><a href="${BLOB}/README.md${page.readmeAnchor}" rel="noopener">Edit this page on GitHub</a></p>
    <nav class="docs-pager" aria-label="Nearby pages">${previous}${next}</nav>
  </article>
</main>
${foot(page)}`;
}

/* A comparison page: the documentation's typography and chrome, but no
   sidebar and no pager. It belongs to no group and has no next page — it is
   one long read, and the sidebar would be a column of English links beside
   the Danish one. */
function standaloneHtml(page) {
  return `${head(page)}
<main class="docs-standalone wrap">
  <article class="docs-body">
    <p class="docs-eyebrow">${escapeHtml(page.eyebrow)}</p>
    <h1>${escapeHtml(page.heading)}</h1>
${page.html}
  </article>
</main>
${foot(page)}`;
}

/* The date a page reports in the sitemap is the date of the commit that last
   touched the file it is generated from, never that file's mtime: a checkout
   resets every mtime to the moment it ran, so mtimes would tell a crawler the
   whole site changed on every deploy. `git log -1 --format=%cs` prints the
   committer date as YYYY-MM-DD, which is what <lastmod> wants, and it needs
   only the history — the file itself does not have to be in the working tree.

   When there is no usable repository — a source export, or the site image
   built from a context whose .git did not travel — every page is dated today.
   That is a truthful answer for a build that just happened, and it keeps the
   file valid rather than dropping the element from half the URLs. */
const TODAY = new Date().toISOString().slice(0, 10);
const lastmods = new Map();

function lastmod(source) {
  const cached = lastmods.get(source);
  if (cached !== undefined) return cached;
  let date = TODAY;
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%cs", "--", source], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(out)) date = out;
  } catch {
    /* git missing, or not a repository. TODAY already stands. */
  }
  lastmods.set(source, date);
  return date;
}

/* Every URL the site serves, with the two pairs that exist in both languages
   carrying alternates both ways. Written from the same page list the sidebar
   is built from, so a docs page cannot be added without landing here. */
function sitemapXml(pages) {
  const pair = (self, other, selfLang, otherLang) => [
    { hreflang: selfLang, href: `${ORIGIN}${self}` },
    { hreflang: otherLang, href: `${ORIGIN}${other}` },
    { hreflang: "x-default", href: `${ORIGIN}${selfLang === "en" ? self : other}` },
  ];

  /* Each URL names the file it is generated from, so its date is the date that
     file last changed: the landing pages are their own HTML, the comparison
     pages their own Markdown, and every documentation page — the index
     included — is a slice of the one README. */
  const entries = [
    {
      loc: `${ORIGIN}/`,
      source: "site/index.html",
      alternates: pair("/", "/da/", "en", "da"),
    },
    {
      loc: `${ORIGIN}/da/`,
      source: "site/da/index.html",
      alternates: pair("/da/", "/", "da", "en"),
    },
    {
      loc: `${ORIGIN}/compare/`,
      source: "site/compare.md",
      alternates: pair("/compare/", "/da/sammenlign/", "en", "da"),
    },
    {
      loc: `${ORIGIN}/da/sammenlign/`,
      source: "site/da/sammenlign.md",
      alternates: pair("/da/sammenlign/", "/compare/", "da", "en"),
    },
    /* No alternates: the Danish getting-started page has no English twin.
       /docs/install/ is the nearest thing and it is a different page — see
       the note on the STANDALONE entry. */
    {
      loc: `${ORIGIN}/da/kom-i-gang/`,
      source: "site/da/kom-i-gang.md",
      alternates: [],
    },
    /* The privacy checklist is the one Danish page that does have one, so it
       is paired here the way the two comparison pages are. Its English half
       is a README section, and gets its half of the pair below. */
    {
      loc: `${ORIGIN}/da/privatliv/`,
      source: "site/da/privatliv.md",
      alternates: pair("/da/privatliv/", "/docs/privacy-checklist/", "da", "en"),
    },
    {
      loc: `${ORIGIN}${CHANGELOG.url}`,
      source: CHANGELOG.source,
      alternates: [],
    },
    { loc: `${ORIGIN}/docs/`, source: "README.md", alternates: [] },
    ...pages.map((page) => {
      const daUrl = TRANSLATED[page.slug];
      return {
        loc: `${ORIGIN}${page.url}`,
        source: "README.md",
        alternates: daUrl ? pair(page.url, daUrl, "en", "da") : [],
      };
    }),
  ];

  const body = entries
    .map((entry) => {
      const alternates = entry.alternates
        .map(
          (alt) =>
            `    <xhtml:link rel="alternate" hreflang="${alt.hreflang}" href="${escapeHtml(alt.href)}"/>`,
        )
        .join("\n");
      return (
        `  <url>\n    <loc>${escapeHtml(entry.loc)}</loc>\n` +
        `    <lastmod>${lastmod(entry.source)}</lastmod>` +
        `${alternates ? `\n${alternates}` : ""}\n  </url>`
      );
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${body}
</urlset>
`;
}

/* Nothing here is private and nothing is expensive to crawl, so the file says
   so plainly and points at the sitemap. */
const ROBOTS = `# https://bugbottle.dev — a static site with nothing to hide.
User-agent: *
Allow: /

Sitemap: ${ORIGIN}/sitemap.xml
`;

function indexHtml(pages) {
  const groups = GROUPS.map((group) => {
    const items = group.slugs
      .map((slug) => pages.find((p) => p.slug === slug))
      .filter((page) => page !== undefined)
      .concat(group.extras ?? [])
      .map(
        (page) =>
          `        <li><a href="${page.url}">${escapeHtml(page.navTitle)}</a>` +
          `<span>${escapeHtml(page.description)}</span></li>`,
      )
      .join("\n");
    return `      <section>
        <h2>${escapeHtml(group.title)}</h2>
        <p>${escapeHtml(group.blurb)}</p>
        <ul>
${items}
        </ul>
      </section>`;
  }).join("\n");

  const page = {
    slug: "index",
    title: "Documentation",
    description:
      "Everything bugbottle does, one page per topic, generated from the README so the two can never disagree.",
    canonical: `${ORIGIN}/docs/`,
  };

  return `${head(page)}
<main class="docs-shell wrap">
${sidebar(pages, "index")}

  <article class="docs-body">
    <p class="docs-eyebrow">Documentation</p>
    <h1>bugbottle documentation</h1>
    <p class="docs-lede">
      One page per topic, generated from the project README, so the page you are
      reading and the file in the repository are the same text. This is version
      ${escapeHtml(version)}; the <a href="${CHANGELOG.url}#${versionAnchor(version)}">changelog</a>
      has what moved.
    </p>
    <div class="docs-index">
${groups}
    </div>
  </article>
</main>
${foot(page)}`;
}

async function main() {
  /* A checkout on Windows hands back CRLF, and a lone \r survives `.` in a
     regular expression, so every heading match would miss. Normalise once. */
  const markdown = (await readFile(join(root, "README.md"), "utf8")).replace(/\r\n/g, "\n");
  version = JSON.parse(await readFile(join(root, "package.json"), "utf8")).version;
  const sections = sliceSections(markdown);

  const placed = GROUPS.flatMap((g) => g.slugs);
  const found = sections.map((s) => s.slug);
  const missing = found.filter((slug) => !placed.includes(slug));
  const ghosts = placed.filter((slug) => !found.includes(slug));
  /* A slug placed twice used to be silent: the page was written twice, listed
     twice in the sidebar and reached twice by previous/next, and once there is
     a sitemap it is a duplicate URL in it. It is always a mistake, so it is a
     build failure like the other two. */
  const twice = [...new Set(placed.filter((slug, i) => placed.indexOf(slug) !== i))];
  /* Two README headings that slugify the same way — "## Queue" and "## queue",
     or two sections genuinely called the same thing — used to collapse
     silently in the `new Map(sections)` below, and the second one won: its
     page was written under the first one's name and the first one's text was
     simply gone from the site, with the README still holding both. The build
     is the only place that can notice, because the README reads perfectly
     well. */
  const duplicates = [...new Set(found.filter((slug, i) => found.indexOf(slug) !== i))];
  /* A page-specific script is keyed on a slug, and a slug is a README heading
     somebody may rename. `PAGE_SCRIPTS[slug] ?? []` answers a renamed one with
     nothing at all, so the playground would simply stop being on the page —
     the build green, the section still there, the editor gone, and the theme
     table's own check silent, because that one only runs on the page it is
     attached to. A hook with no page to hook onto is a build failure. */
  const unhooked = Object.keys(PAGE_SCRIPTS).filter((slug) => !found.includes(slug));
  if (
    missing.length > 0 ||
    ghosts.length > 0 ||
    twice.length > 0 ||
    duplicates.length > 0 ||
    unhooked.length > 0
  ) {
    const lines = [];
    if (missing.length > 0) {
      lines.push(`README sections with no group in scripts/build-docs.mjs: ${missing.join(", ")}`);
    }
    if (ghosts.length > 0) {
      lines.push(`Grouped slugs with no README section: ${ghosts.join(", ")}`);
    }
    if (twice.length > 0) {
      lines.push(`Slugs placed in more than one group slot: ${twice.join(", ")}`);
    }
    if (duplicates.length > 0) {
      lines.push(`README \`##\` headings sharing one slug: ${duplicates.join(", ")}`);
    }
    if (unhooked.length > 0) {
      lines.push(`Page scripts keyed on a slug no README section has: ${unhooked.join(", ")}`);
    }
    throw new Error(lines.join("\n"));
  }

  const bySlug = new Map(sections.map((s) => [s.slug, s]));
  const pages = placed.map((slug) => {
    const section = bySlug.get(slug);
    if (!section) throw new Error(`missing section ${slug}`);
    const group = GROUPS.find((g) => g.slugs.includes(slug));
    const url = `/docs/${slug}/`;
    /* A page with a Danish twin carries the alternates both ways and points
       the language switch at it. Every other documentation page has only
       itself, and the switch falls back to the landing page. */
    const daUrl = TRANSLATED[slug];
    return {
      ...section,
      url,
      groupTitle: group?.title ?? "",
      description: describe(section.body),
      ...(daUrl
        ? {
            enUrl: url,
            daUrl,
            alternates: [
              { hreflang: "en", href: `${ORIGIN}${url}` },
              { hreflang: "da", href: `${ORIGIN}${daUrl}` },
              { hreflang: "x-default", href: `${ORIGIN}${url}` },
            ],
          }
        : {}),
    };
  });

  for (let i = 0; i < pages.length; i += 1) {
    const page = pages[i];
    if (!page) continue;
    page.previous = pages[i - 1];
    page.next = pages[i + 1];
  }

  /* Every anchor in the README, pointed at the page that now holds it. */
  const anchors = new Map();
  for (const page of pages) {
    anchors.set(page.slug, page.url);
    /* A section whose URL was shortened is still linked to by its heading
       anchor everywhere else in the README, so both point at the page. */
    if (page.readmeSlug) anchors.set(page.readmeSlug, page.url);
    for (const heading of page.headings) {
      anchors.set(heading.slug, `${page.url}#${heading.slug}`);
    }
  }

  for (const page of pages) {
    const marked = new Marked({ gfm: true, breaks: false });
    marked.use({ renderer: renderer(page, anchors) });
    page.html = marked.parse(page.body);
    /* The one page with something on it that is not README prose. */
    if (page.slug === PLAYGROUND_SLUG) {
      page.html = withPlayground(page.html, page.body);
    }
  }

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "index.html"), indexHtml(pages), "utf8");

  /* The search index, written beside the pages it points into. One entry per
     page and one per heading, in the order of the sidebar, so results that
     tie fall back to the order the documentation is meant to be read in. */
  const searchIndex = [
    {
      url: "/docs/",
      title: "Documentation",
      heading: "",
      text: GROUPS.map((group) => `${group.title}. ${group.blurb}`).join(" "),
    },
  ];

  for (const page of pages) {
    await mkdir(join(outDir, page.slug), { recursive: true });
    await writeFile(join(outDir, page.slug, "index.html"), pageHtml(page, pages), "utf8");
    searchIndex.push(...searchEntries(page));
  }

  /* The pages with their own Markdown file. It has no headings to slice at and
     no README anchors to rewrite, so each goes through the renderer with an
     empty anchor map and comes out as one article. A page with an `otherUrl`
     carries alternates both ways and puts its counterpart under the language
     switch; a page without one carries only itself and leaves the switch
     pointing at that language's landing page. */
  for (const entry of STANDALONE) {
    const body = (await readFile(join(root, entry.source), "utf8")).replace(/\r\n/g, "\n").trim();
    const marked = new Marked({ gfm: true, breaks: false });
    marked.use({ renderer: renderer(entry, new Map()) });
    const en = entry.lang === "en" ? entry.url : entry.otherUrl;
    const da = entry.lang === "da" ? entry.url : entry.otherUrl;
    const page = {
      ...entry,
      html: marked.parse(body),
      description: describe(body),
      headTitle: `${entry.heading} — bugbottle`,
      canonical: `${ORIGIN}${entry.url}`,
      alternates:
        en && da
          ? [
              { hreflang: "en", href: `${ORIGIN}${en}` },
              { hreflang: "da", href: `${ORIGIN}${da}` },
              { hreflang: "x-default", href: `${ORIGIN}${en}` },
            ]
          : undefined,
      enUrl: en,
      daUrl: da,
      docsCurrent: false,
    };
    const dir = join(root, "site", entry.out);
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "index.html"), standaloneHtml(page), "utf8");
    if (entry.indexed !== false) {
      searchIndex.push(...searchEntries({ url: entry.url, title: entry.heading, body }));
    }
  }

  /* The changelog. One long article like the comparison pages, but under
     /docs/ and with the list of releases at the top of it. Its H1 goes the way
     the README's does — the page already has one — while the paragraph under
     it stays, because it says what the file is and which conventions it
     follows. */
  {
    const body = (await readFile(join(root, CHANGELOG.source), "utf8"))
      .replace(/\r\n/g, "\n")
      .split("\n")
      .filter((line) => !/^#\s/.test(line))
      .join("\n")
      .trim();
    const lines = body.split("\n");
    const headings = readHeadings(lines);
    const releases = headings
      .filter((h) => h.depth === 2)
      .map((h) => ({ ...h, anchor: versionAnchor(h.text) }));

    /* The list of releases goes between the paragraph that says what the file
       is and the first release, which is where a reader looking for one
       version wants it: after the sentence explaining the versioning scheme,
       before 1400 lines of prose. */
    const first = releases[0];
    const marked = new Marked({ gfm: true, breaks: false });
    marked.use({ renderer: changelogRenderer(CHANGELOG) });
    const lede = marked.parse(lines.slice(0, first ? first.line : lines.length).join("\n").trim());
    const rest = first ? marked.parse(lines.slice(first.line).join("\n").trim()) : "";
    const page = {
      ...CHANGELOG,
      html: `${lede}${releaseToc(releases, CHANGELOG.tocTitle)}${rest}`,
      description: describe(body),
      headTitle: `${CHANGELOG.heading} — bugbottle`,
      canonical: `${ORIGIN}${CHANGELOG.url}`,
      docsCurrent: true,
    };
    const dir = join(root, "site", CHANGELOG.out);
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "index.html"), standaloneHtml(page), "utf8");

    /* Indexed by release, and each release by its own summary rather than by
       everything under it. The changelog says of every feature what the
       documentation says, at greater length: indexing all of it would put
       thirteen release entries above the page that actually documents
       whatever was searched for, since the ranking counts occurrences. What
       is wanted here is "which release was that in", so the entry a reader
       needs is the heading and the paragraph under it. */
    searchIndex.push({
      url: CHANGELOG.url,
      title: CHANGELOG.title,
      heading: "",
      text: prose(lines.slice(0, releases[0] ? releases[0].line : lines.length)),
    });
    for (let i = 0; i < releases.length; i += 1) {
      const release = releases[i];
      if (!release) continue;
      const next = headings.find((h) => h.line > release.line);
      searchIndex.push({
        url: `${CHANGELOG.url}#${release.anchor}`,
        title: CHANGELOG.title,
        heading: release.text,
        text: prose(lines.slice(release.line + 1, next ? next.line : lines.length)),
      });
    }
  }

  /* A page that is written but not indexed is a page the search cannot find,
     the same kind of quiet hole as a page with no group. The check is against
     the pages this run wrote, rather than a trust that the loops above stayed
     in step with each other. */
  const indexed = new Set(searchIndex.map((item) => item.url.split("#")[0]));
  const unindexed = [
    "/docs/",
    ...pages.map((page) => page.url),
    ...STANDALONE.filter((s) => s.indexed !== false).map((s) => s.url),
    CHANGELOG.url,
  ].filter((url) => !indexed.has(url));
  if (unindexed.length > 0) {
    throw new Error(`Pages missing from site/docs/search.json: ${unindexed.join(", ")}`);
  }
  await writeFile(join(outDir, "search.json"), JSON.stringify(searchIndex), "utf8");

  await writeFile(join(root, "site", "sitemap.xml"), sitemapXml(pages), "utf8");
  await writeFile(join(root, "site", "robots.txt"), ROBOTS, "utf8");

  process.stdout.write(
    `site/docs: ${pages.length + 1} pages from README.md; ` +
      `${STANDALONE.length} pages from their own Markdown; the changelog; ` +
      `${searchIndex.length} search entries; sitemap.xml and robots.txt\n`,
  );
}

await main();
