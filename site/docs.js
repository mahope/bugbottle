/*
 * The small things the documentation pages need at runtime: the copy buttons,
 * the search field over the generated index, the topic list closing on a
 * phone, and the current heading in "On this page". Everything else — which
 * page is current, the anchors, previous and next — is written into the HTML
 * by scripts/build-docs.mjs, so a browser that never runs this file still
 * gets a finished page, search included: what it loses is the field, not the
 * list of pages.
 *
 * Not a module: it is loaded with `defer` from every generated page and has
 * nothing to export.
 */

(function () {
  "use strict";

  /* The documentation is English, but the two comparison pages are not, and
     they load this same file. The three words the buttons say follow the
     language the page declares rather than the language most of the pages
     happen to be in. */
  var danish = document.documentElement.lang === "da";
  var copyLabel = danish ? "Kopiér" : "Copy";
  var copiedLabel = danish ? "Kopieret" : "Copied";
  var pressLabel = danish ? "Tryk Ctrl+C" : "Press Ctrl+C";

  /* A copy button per code block. Added from here rather than from the
     generated HTML so the button only ever exists where it can work. */
  var slabs = document.querySelectorAll(".docs-body .slab[data-copy]");
  for (var i = 0; i < slabs.length; i += 1) {
    addCopyButton(slabs[i]);
  }

  function addCopyButton(slab) {
    var code = slab.querySelector("pre");
    if (!code) return;

    var button = document.createElement("button");
    button.type = "button";
    button.className = "copy";
    button.textContent = copyLabel;
    button.addEventListener("click", function () {
      var text = code.textContent || "";
      copy(text).then(
        function () {
          say(copiedLabel);
        },
        function () {
          say(pressLabel);
        },
      );
    });

    var timer = 0;
    function say(message) {
      button.textContent = message;
      button.setAttribute("data-done", "yes");
      window.clearTimeout(timer);
      timer = window.setTimeout(function () {
        button.textContent = copyLabel;
        button.removeAttribute("data-done");
      }, 1600);
    }

    slab.appendChild(button);
  }

  /* navigator.clipboard is missing on an insecure origin — which is what
     someone gets running the container locally over http — and it refuses
     outright in a few browsers and in headless Chrome even where it exists.
     Both cases fall back to a selection and execCommand rather than leaving
     the button dead. */
  function copy(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).catch(function () {
        return selectAndCopy(text);
      });
    }
    return selectAndCopy(text);
  }

  function selectAndCopy(text) {
    return new Promise(function (resolve, reject) {
      var area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      var ok = false;
      try {
        ok = document.execCommand("copy");
      } catch (error) {
        ok = false;
      }
      document.body.removeChild(area);
      if (ok) resolve();
      else reject(new Error("copy refused"));
    });
  }

  /* ------------------------------------------------------------- search */

  /* A field over an index of every heading on every documentation page,
     generated beside the pages by scripts/build-docs.mjs. It is built here
     rather than written into the HTML, so a reader without JavaScript is
     never offered a box that cannot answer — what they get is the whole list
     of pages, which is what the page had before there was a search at all.

     The index is fetched on the first focus of the field and not before: it
     is 70 kB of prose, and a reader who never searches should not pay for
     it. */
  var searchLabel = danish ? "Søg i dokumentationen" : "Search the documentation";
  var noneLabel = danish ? "Ingen resultater" : "No results";
  var oneLabel = danish ? "1 resultat" : "1 result";
  var failedLabel = danish ? "Søgningen kunne ikke hentes" : "The search index did not load";
  var MAX_RESULTS = 8;

  addSearch(document.querySelector(".docs-sidebar"));

  function addSearch(sidebar) {
    if (!sidebar || !window.fetch) return;

    var form = document.createElement("form");
    form.className = "docs-search";
    form.setAttribute("role", "search");

    var label = document.createElement("label");
    label.className = "docs-search-label";
    label.htmlFor = "docs-search-field";
    label.textContent = searchLabel;

    var field = document.createElement("input");
    field.type = "search";
    field.id = "docs-search-field";
    field.className = "docs-search-field";
    field.autocomplete = "off";

    /* The count is what a screen reader hears when the list changes; the list
       itself is a plain list of links, which needs no announcing of its own
       and stays operable with every key a link already understands. */
    var count = document.createElement("p");
    count.className = "docs-search-count";
    count.setAttribute("aria-live", "polite");

    var list = document.createElement("ul");
    list.className = "docs-search-results";

    form.appendChild(label);
    form.appendChild(field);
    form.appendChild(count);
    form.appendChild(list);
    sidebar.insertBefore(form, sidebar.firstChild);

    var index = null;
    var state = "";
    var shown = [];

    field.addEventListener("focus", load);
    field.addEventListener("input", function () {
      load();
      render();
    });

    /* Enter opens the first result and Escape empties the field. Submitting
       the form would reload the page, which is the one thing pressing Enter
       in a search field must not do here. */
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      go(0);
    });

    field.addEventListener("keydown", function (event) {
      if (event.key === "Escape" || event.key === "Esc") {
        field.value = "";
        render();
      }
    });

    function load() {
      if (state !== "") return;
      state = "loading";
      window
        .fetch("/docs/search.json")
        .then(function (response) {
          if (!response.ok) throw new Error(String(response.status));
          return response.json();
        })
        .then(
          function (data) {
            index = data;
            state = "ready";
            render();
          },
          function () {
            state = "failed";
            count.textContent = failedLabel;
          },
        );
    }

    function go(position) {
      var hit = shown[position];
      if (hit) window.location.assign(hit.url);
    }

    function render() {
      var query = field.value.trim().toLowerCase();
      while (list.firstChild) list.removeChild(list.firstChild);
      shown = [];
      if (query === "" || state === "failed") {
        count.textContent = state === "failed" ? failedLabel : "";
        return;
      }
      if (!index) return;

      shown = match(query);
      count.textContent =
        shown.length === 0
          ? noneLabel
          : shown.length === 1
            ? oneLabel
            : shown.length + (danish ? " resultater" : " results");

      for (var i = 0; i < shown.length; i += 1) {
        list.appendChild(result(shown[i]));
      }
    }

    function result(hit) {
      var item = document.createElement("li");
      var link = document.createElement("a");
      link.href = hit.url;
      var title = document.createElement("span");
      title.className = "docs-search-title";
      title.textContent = hit.title;
      link.appendChild(title);
      if (hit.heading) {
        var heading = document.createElement("span");
        heading.className = "docs-search-heading";
        heading.textContent = hit.heading;
        link.appendChild(heading);
      }
      item.appendChild(link);
      return item;
    }

    /* Case-insensitive substring, ranked title before heading before text.
       Inside a rank the entry that says the word most often wins, which is
       the difference between the page a word is mentioned on and the page it
       is about; a tie after that keeps the order of the sidebar. */
    function match(query) {
      var hits = [];
      for (var i = 0; i < index.length; i += 1) {
        var entry = index[i];
        var title = (entry.title || "").toLowerCase();
        var heading = (entry.heading || "").toLowerCase();
        var text = (entry.text || "").toLowerCase();
        var rank =
          title.indexOf(query) !== -1
            ? 0
            : heading.indexOf(query) !== -1
              ? 1
              : text.indexOf(query) !== -1
                ? 2
                : 3;
        if (rank === 3) continue;
        hits.push({
          url: entry.url,
          title: entry.title,
          heading: entry.heading,
          rank: rank,
          weight: occurrences(title, query) + occurrences(heading, query) + occurrences(text, query),
          order: i,
        });
      }
      hits.sort(function (a, b) {
        return a.rank - b.rank || b.weight - a.weight || a.order - b.order;
      });
      return hits.slice(0, MAX_RESULTS);
    }

    function occurrences(haystack, needle) {
      return haystack.split(needle).length - 1;
    }
  }

  /* The topic list is written open, so a page with no JavaScript is whole at
     every width. On a phone it is twenty-eight links standing between the
     reader and the article they asked for, so it closes — and the summary
     names the page they are on, which is what a closed list should say. */
  var topics = document.querySelector(".docs-topics");
  var here = topics && topics.querySelector('a[aria-current="page"]');
  if (topics && window.matchMedia("(max-width: 60rem)").matches) {
    topics.open = false;
    var summary = topics.querySelector("summary");
    if (summary && here) summary.textContent = here.textContent;
  }

  /* On a narrow screen the sidebar is a short scrolling box, so the current
     page can start out below its fold. Scroll the box itself — never the
     window, which would jump the reader past the heading they came for. */
  var sidebar = document.querySelector(".docs-sidebar");
  var current = here;
  if (sidebar && current && sidebar.scrollHeight > sidebar.clientHeight) {
    /* offsetTop would be measured against whichever ancestor happens to be
       positioned, which differs between the two layouts. Rectangles do not. */
    var offset = current.getBoundingClientRect().top - sidebar.getBoundingClientRect().top;
    sidebar.scrollTop = Math.max(0, offset - sidebar.clientHeight / 2);
  }

  /* Mark the section the reader is in, in the "On this page" list. The
     sidebar's current page is already marked in the HTML; this is the one
     part that only the scroll position knows. */
  var links = document.querySelectorAll(".docs-toc a");
  if (links.length === 0 || !("IntersectionObserver" in window)) return;

  var byId = {};
  var headings = [];
  for (var j = 0; j < links.length; j += 1) {
    var id = decodeURIComponent(links[j].getAttribute("href").slice(1));
    var heading = document.getElementById(id);
    if (!heading) continue;
    byId[id] = links[j];
    headings.push(heading);
  }

  var seen = [];
  var observer = new IntersectionObserver(
    function (entries) {
      for (var k = 0; k < entries.length; k += 1) {
        var entry = entries[k];
        var index = seen.indexOf(entry.target);
        if (entry.isIntersecting && index === -1) seen.push(entry.target);
        if (!entry.isIntersecting && index !== -1) seen.splice(index, 1);
      }
      /* The topmost heading currently on screen wins; when none is, the last
         one scrolled past stays marked. */
      if (seen.length === 0) return;
      var first = seen[0];
      for (var m = 1; m < seen.length; m += 1) {
        if (headings.indexOf(seen[m]) < headings.indexOf(first)) first = seen[m];
      }
      for (var id2 in byId) {
        if (Object.prototype.hasOwnProperty.call(byId, id2)) {
          byId[id2].removeAttribute("aria-current");
        }
      }
      var link = byId[first.id];
      if (link) link.setAttribute("aria-current", "true");
    },
    { rootMargin: "0px 0px -70% 0px" },
  );

  for (var n = 0; n < headings.length; n += 1) observer.observe(headings[n]);
})();
