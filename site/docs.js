/*
 * The two small things the documentation pages need at runtime. Everything
 * else — which page is current, the anchors, previous and next — is written
 * into the HTML by scripts/build-docs.mjs, so a browser that never runs this
 * file still gets a finished page.
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
