/*
 * The theme playground, on /docs/languages-and-branding/ and nowhere else.
 *
 * It mounts the real `bugbottle/ui` panel from the copy of `dist/` that ships
 * in the image, restyles it as the controls move, and prints the
 * `mountBugbottle` call and the CSS that produce what is on screen. Like the
 * demo on the landing page it has no endpoint: nothing is ever sent, because
 * the panel is inside an `inert` stage and cannot be typed into at all. It is
 * a picture that happens to be the real thing.
 *
 * Two rules this file exists under:
 *
 *   - The variable names come from the page. `scripts/build-docs.mjs` reads
 *     them out of the README's "Branding and theme" table and writes them onto
 *     the controls as `data-var`, so the CSS this prints is the CSS the table
 *     above it documents. Nothing here has a list of its own to fall behind.
 *   - No inline style anywhere. The stage and the controls are styled by
 *     docs.css; the theme reaches the panel through `style.setProperty` on the
 *     host and through its two data attributes, which is what the library
 *     itself does and what the site's `style-src 'self' 'unsafe-inline'`
 *     allows.
 *
 * The defaults are read off the mounted panel with getComputedStyle rather
 * than written down, so the controls always start where the panel starts —
 * and they are kept, because they are also what tells a change from a default.
 * Only the keys the reader moved are printed: a block that pinned every colour
 * as it was read, and `scheme` as it happened to be, would ship a panel that
 * ignores the reader's own colour scheme, which is the one setting whose
 * default is "follow the browser".
 */

import { mountBugbottle } from "/dist/ui/index.js";

const block = document.querySelector("[data-playground]");
const stage = document.querySelector("[data-playground-stage]");
if (block && stage) {
  setUp(block, stage);
}

function setUp(block, stage) {
  const controls = Array.prototype.slice.call(block.querySelectorAll("[data-key]"));
  const jsOut = block.querySelector("[data-playground-js]");
  const cssOut = block.querySelector("[data-playground-css]");

  const widget = mountBugbottle({
    endpoint: "/this-endpoint-does-not-exist",
    container: stage,
    // No floating button: the panel is the whole exhibit, and a second trigger
    // fixed to the corner of a documentation page would be a trap.
    trigger: false,
    // The reader is on a documentation page. A keyboard shortcut that opened a
    // panel they cannot reach — the stage is inert — would be a dead key.
    shortcut: false,
    texts: {
      intro: "A live panel. It is inert here: this is what your theme looks like, not a form.",
    },
  });

  const host = widget.host;
  /* The panel is `position: fixed` by its own stylesheet, which is right in an
     application and wrong in the middle of an article. Taking it out of the
     fixed layer is the only thing this file overrides, and `data-pos` still
     does its work: it decides which edge of the stage the panel sits against
     and whether the button goes above or below it. */
  host.style.setProperty("position", "static");
  widget.open();

  /* The current theme, keyed the way `mountBugbottle` takes it. Every entry is
     put there by `apply` below, from a control whose starting value came off
     the panel — so nothing here is a guess about what src/ui/index.ts thinks
     the defaults are. */
  const theme = {};
  /* Each control's starting value, so `apply` can tell a change from a default
     and print only what the reader actually moved. */
  const defaults = new Map();
  const styles = window.getComputedStyle(host);

  for (const input of controls) {
    const key = input.dataset.key;
    const variable = input.dataset.var;

    if (input.type === "color") {
      input.value = hex(styles.getPropertyValue(variable));
    } else if (input.type === "range") {
      input.value = String(parseFloat(styles.getPropertyValue(variable)) || 0);
    } else if (key === "position" || key === "scheme") {
      input.value = (key === "position" ? host.dataset.pos : host.dataset.scheme) || input.value;
    } else {
      /* The font, whose first option is "leave it alone" and whose value is
         therefore the empty string. An empty value is printed by nobody. */
      input.value = "";
    }

    defaults.set(input, input.value);

    input.addEventListener("input", function () {
      apply(input);
      render();
    });
  }

  const reset = block.querySelector(".pg-reset");
  if (reset) {
    reset.addEventListener("click", function () {
      window.location.reload();
    });
  }

  for (const input of controls) apply(input);
  render();
  block.hidden = false;

  /** One control onto the panel: a custom property, or one of the two attributes. */
  function apply(input) {
    const key = input.dataset.key;
    const variable = input.dataset.var;
    const unit = input.dataset.unit || "";
    const value = input.type === "range" ? input.value + unit : input.value;

    if (key === "position") {
      host.dataset.pos = value;
      /* The stage takes the same attribute, because top and bottom are the one
         part of a corner that a box in the middle of an article has to decide
         for itself: the panel's own stylesheet only knows which way round to
         stack the panel and its button. docs.css reads it. */
      stage.dataset.pos = value;
    } else if (key === "scheme") {
      host.dataset.scheme = value;
    }

    if (variable) {
      if (value === "") host.style.removeProperty(variable);
      else host.style.setProperty(variable, value);
    }

    /* A control back where it started is a control the reader has said nothing
       about, and the panel's own default is better than a copy of it frozen
       into somebody's source. */
    if (value === "" || input.value === defaults.get(input)) delete theme[key];
    else theme[key] = value;

    const output = document.getElementById(input.id + "-value");
    if (output) output.textContent = value;
  }

  /** The two code blocks, rewritten from `theme` every time anything moves. */
  function render() {
    const lines = [];
    for (const input of controls) {
      const key = input.dataset.key;
      if (theme[key] === undefined) continue;
      /* JSON.stringify rather than a pair of quotes: a font stack has double
         quotes of its own — `Georgia, "Times New Roman", serif` — and a
         hand-quoted one is a syntax error in the block somebody copies. */
      lines.push("    " + key + ": " + JSON.stringify(theme[key]) + ",");
    }
    if (jsOut) {
      jsOut.textContent = lines.length
        ? "mountBugbottle({\n" +
          '  endpoint: "/api/report",\n' +
          "  theme: {\n" +
          lines.join("\n") +
          "\n  },\n});"
        : "mountBugbottle({\n" +
          '  endpoint: "/api/report",\n' +
          "});\n\n" +
          "/* Move a control and it appears here. Nothing moved is nothing to\n" +
          "   write down: the panel's own defaults are the better default. */";
    }

    const css = [];
    for (const input of controls) {
      const variable = input.dataset.var;
      const key = input.dataset.key;
      if (!variable || theme[key] === undefined) continue;
      css.push("  " + variable + ": " + theme[key] + ";");
    }
    if (cssOut) {
      cssOut.textContent = css.length
        ? '[data-bugbottle="ui"] {\n' +
          css.join("\n") +
          "\n}\n" +
          "/* position and scheme are not custom properties: they are the\n" +
          "   data-pos and data-scheme attributes the panel sets on its host. */"
        : "/* Move a colour or the corner radius and the custom properties\n" +
          "   appear here. */";
    }
  }
}

/**
 * A colour an `<input type="color">` will accept, which is `#rrggbb` and
 * nothing else. The panel's own defaults are written as `#fff` and `#2563eb`,
 * and a browser may hand back either the hex it was given or `rgb(…)`.
 * Anything this cannot read becomes black rather than an exception: a wrong
 * swatch is a smaller failure than a playground that does not appear.
 */
function hex(value) {
  const text = (value || "").trim();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(text);
  if (short) return "#" + short[1] + short[1] + short[2] + short[2] + short[3] + short[3];
  if (/^#[0-9a-f]{6}$/i.test(text)) return text.toLowerCase();
  const rgb = /^rgba?\(([^)]+)\)$/i.exec(text);
  if (rgb) {
    const parts = rgb[1].split(/[\s,/]+/).filter(Boolean).slice(0, 3);
    if (parts.length === 3) {
      return (
        "#" +
        parts
          .map(function (part) {
            const n = Math.max(0, Math.min(255, Math.round(parseFloat(part))));
            return (n < 16 ? "0" : "") + n.toString(16);
          })
          .join("")
      );
    }
  }
  return "#000000";
}
