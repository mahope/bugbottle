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
 * Two pages are not README sections: site/compare.md and site/da/sammenlign.md
 * are their own Markdown files, rendered by the same renderer into
 * site/compare/ and site/da/sammenlign/ with the landing page's header and
 * footer. They are the only prose on the site that is neither the landing page
 * nor the README, because they are about other people's products and have no
 * business in a package README.
 *
 * The last two files are for machines: site/sitemap.xml lists every URL the
 * site has, with hreflang alternates on the two pairs that exist in both
 * languages, and site/robots.txt allows everything and points at the sitemap.
 * Both are generated here rather than written by hand so a new docs page
 * cannot be left out of them, and both are gitignored like site/docs/.
 */

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
   section. Each is a pair: the same page in the other language, linked from
   the other with hreflang, exactly like the two landing pages. */
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
];

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
      "screenshots",
    ],
  },
  {
    title: "Server",
    blurb: "Receiving a report, checking it, and sending it onward.",
    slugs: [
      "receiving-a-report",
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
    blurb: "Who writes this, under which licence, and what else is out there.",
    slugs: ["who-makes-it", "licence"],
    /* Not a README section, so it is listed here rather than in `slugs`: the
       comparison lives on the site alone. */
    extras: [
      {
        url: "/compare/",
        navTitle: "Compared with",
        description:
          "Where bugbottle sits next to Marker.io, Jam, Sentry User Feedback, BugPin and rrweb.",
      },
    ],
  },
];

/* A handful of README headings do not make good page titles on their own —
   they read as a continuation of the sentence above them, which the page no
   longer has. */
const TITLE_OVERRIDES = {
  "the-form-react": "The form (React)",
  api: "API",
  "please-read-this-part": "Privacy: please read this part",
};

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
      slug: top.slug,
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
</body>
</html>
`;
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

/* Every URL the site serves, with the two pairs that exist in both languages
   carrying alternates both ways. Written from the same page list the sidebar
   is built from, so a docs page cannot be added without landing here. */
function sitemapXml(pages) {
  const pair = (self, other, selfLang, otherLang) => [
    { hreflang: selfLang, href: `${ORIGIN}${self}` },
    { hreflang: otherLang, href: `${ORIGIN}${other}` },
    { hreflang: "x-default", href: `${ORIGIN}${selfLang === "en" ? self : other}` },
  ];

  const entries = [
    { loc: `${ORIGIN}/`, alternates: pair("/", "/da/", "en", "da") },
    { loc: `${ORIGIN}/da/`, alternates: pair("/da/", "/", "da", "en") },
    { loc: `${ORIGIN}/compare/`, alternates: pair("/compare/", "/da/sammenlign/", "en", "da") },
    {
      loc: `${ORIGIN}/da/sammenlign/`,
      alternates: pair("/da/sammenlign/", "/compare/", "da", "en"),
    },
    { loc: `${ORIGIN}/docs/`, alternates: [] },
    ...pages.map((page) => ({ loc: `${ORIGIN}${page.url}`, alternates: [] })),
  ];

  const body = entries
    .map((entry) => {
      const alternates = entry.alternates
        .map(
          (alt) =>
            `    <xhtml:link rel="alternate" hreflang="${alt.hreflang}" href="${escapeHtml(alt.href)}"/>`,
        )
        .join("\n");
      return `  <url>\n    <loc>${escapeHtml(entry.loc)}</loc>${alternates ? `\n${alternates}` : ""}\n  </url>`;
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
      ${escapeHtml(version)}; the <a href="${BLOB}/CHANGELOG.md" rel="noopener">changelog</a>
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
  if (missing.length > 0 || ghosts.length > 0 || twice.length > 0) {
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
    throw new Error(lines.join("\n"));
  }

  const bySlug = new Map(sections.map((s) => [s.slug, s]));
  const pages = placed.map((slug) => {
    const section = bySlug.get(slug);
    if (!section) throw new Error(`missing section ${slug}`);
    const group = GROUPS.find((g) => g.slugs.includes(slug));
    return {
      ...section,
      url: `/docs/${slug}/`,
      groupTitle: group?.title ?? "",
      description: describe(section.body),
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
    for (const heading of page.headings) {
      anchors.set(heading.slug, `${page.url}#${heading.slug}`);
    }
  }

  for (const page of pages) {
    const marked = new Marked({ gfm: true, breaks: false });
    marked.use({ renderer: renderer(page, anchors) });
    page.html = marked.parse(page.body);
  }

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, "index.html"), indexHtml(pages), "utf8");
  for (const page of pages) {
    await mkdir(join(outDir, page.slug), { recursive: true });
    await writeFile(join(outDir, page.slug, "index.html"), pageHtml(page, pages), "utf8");
  }

  /* The comparison pages. Their Markdown has no headings to slice at and no
     README anchors to rewrite, so they go through the renderer with an empty
     anchor map and come out as one article each. */
  for (const entry of STANDALONE) {
    const body = (await readFile(join(root, entry.source), "utf8")).replace(/\r\n/g, "\n").trim();
    const marked = new Marked({ gfm: true, breaks: false });
    marked.use({ renderer: renderer(entry, new Map()) });
    const en = STANDALONE[0];
    const da = STANDALONE[1];
    const page = {
      ...entry,
      html: marked.parse(body),
      description: describe(body),
      headTitle: `${entry.heading} — bugbottle`,
      canonical: `${ORIGIN}${entry.url}`,
      alternates: [
        { hreflang: "en", href: `${ORIGIN}${en?.url ?? "/compare/"}` },
        { hreflang: "da", href: `${ORIGIN}${da?.url ?? "/da/sammenlign/"}` },
        { hreflang: "x-default", href: `${ORIGIN}${en?.url ?? "/compare/"}` },
      ],
      enUrl: en?.url,
      daUrl: da?.url,
      docsCurrent: false,
    };
    const dir = join(root, "site", entry.out);
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "index.html"), standaloneHtml(page), "utf8");
  }

  await writeFile(join(root, "site", "sitemap.xml"), sitemapXml(pages), "utf8");
  await writeFile(join(root, "site", "robots.txt"), ROBOTS, "utf8");

  process.stdout.write(
    `site/docs: ${pages.length + 1} pages from README.md; ` +
      `${STANDALONE.length} comparison pages; sitemap.xml and robots.txt\n`,
  );
}

await main();
