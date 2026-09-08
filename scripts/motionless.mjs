/**
 * The reduced-motion check both accessibility audits make.
 *
 * axe has no rule for `prefers-reduced-motion`: it reads the accessibility
 * tree, and a transition is not in it. So the question — did anything keep
 * moving after the reader asked it to stop? — can only be answered by reading
 * the computed styles back out of a real browser with the feature emulated.
 *
 * The answer is deliberately blunt. Any element whose `transition-duration` or
 * a running `animation-duration` is above zero is reported, as is a document
 * that still scrolls smoothly, because a smooth scroll is motion no transition
 * property describes. Instant state changes are the goal, not slower ones:
 * WCAG 2.3.3 is about motion, and a 150 ms fade is still motion to a reader
 * who gets sick from it.
 *
 * The walk descends into open shadow roots, so the panel is covered when it is
 * mounted on the page under audit — a host element carries `:host` rules and
 * is reached by the outer walk, its contents by the inner one.
 */

/**
 * Returns one line per moving element, empty when the page is still.
 *
 * @param {import("puppeteer-core").Page} tab a tab with reduced motion emulated
 * @returns {Promise<string[]>}
 */
export async function movingElements(tab) {
  return await tab.evaluate(() => {
    /* `transition-duration` is a list when `transition-property` is, and the
       longest entry is the one the reader waits for. A malformed value parses
       to NaN, which `|| 0` turns into "no motion" rather than a crash. */
    const longest = (value) =>
      Math.max(0, ...String(value).split(",").map((part) => Number.parseFloat(part) || 0));

    /* Enough of an element to find it again in the stylesheet. */
    const name = (element) => {
      const classes = typeof element.className === "string" ? element.className.trim() : "";
      return element.tagName.toLowerCase() + (classes ? `.${classes.split(/\s+/).join(".")}` : "");
    };

    const skip = new Set(["SCRIPT", "STYLE", "LINK", "META", "HEAD", "TITLE"]);
    const found = [];

    const look = (element, pseudo) => {
      const style = getComputedStyle(element, pseudo);
      const transition = longest(style.transitionDuration);
      /* A duration with no animation attached to it animates nothing, and the
         initial value of `animation-duration` is not always zero. */
      const animation = style.animationName === "none" ? 0 : longest(style.animationDuration);
      const where = `${name(element)}${pseudo ?? ""}`;
      if (transition > 0) {
        found.push(`${where}: transition ${transition}s (${style.transitionProperty})`);
      }
      if (animation > 0) {
        found.push(`${where}: animation ${animation}s (${style.animationName})`);
      }
    };

    const walk = (root) => {
      for (const element of root.querySelectorAll("*")) {
        if (skip.has(element.tagName)) continue;
        look(element, null);
        look(element, "::before");
        look(element, "::after");
        if (element.shadowRoot) walk(element.shadowRoot);
      }
    };
    walk(document);

    if (getComputedStyle(document.documentElement).scrollBehavior === "smooth") {
      found.push("html: scroll-behavior smooth");
    }
    return found;
  });
}

/**
 * Reports what `movingElements` found and returns the number of failures, so a
 * caller can add it to its own count.
 *
 * @param {string} label the state the check ran in
 * @param {string[]} moving
 * @returns {number}
 */
export function reportMotion(label, moving) {
  if (!moving.length) {
    console.log(`${label}: nothing moves under prefers-reduced-motion: reduce`);
    return 0;
  }
  /* Ten lines is plenty to find the rule; a stylesheet that lost the media
     block would otherwise print every element on the page. */
  for (const line of moving.slice(0, 10)) console.error(`  ${label}: ${line}`);
  if (moving.length > 10) console.error(`  ${label}: and ${moving.length - 10} more`);
  return 1;
}
