import { MAX_ELEMENT_TEXT_LENGTH } from "./report-core.js";
/** Attributes worth carrying. `data-bugbottle*` is the library's own and is skipped. */
const ATTRIBUTES = ["id", "name", "role", "type", "href", "aria-label", "placeholder", "title"];
const MAX_SELECTOR_DEPTH = 5;
/**
 * Longest selector the builder writes. A selector is something a person reads
 * in a ticket and pastes into DevTools; past this it stops being either.
 */
const MAX_SELECTOR_LENGTH = 200;
/**
 * Longest id, test id or label used as an anchor. A longer one is usually
 * generated — a hash, a serialised state — and would eat the whole budget.
 */
const MAX_ANCHOR_LENGTH = 64;
function isUnique(selector, root) {
    if (!root)
        return false;
    try {
        return root.querySelectorAll(selector).length === 1;
    }
    catch {
        return false;
    }
}
function escape(value) {
    return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(value) : value.replace(/[^\w-]/g, "\\$&");
}
const anchor = (value) => !!value && value.length <= MAX_ANCHOR_LENGTH;
/**
 * One level of the selector. An id comes first, then `data-testid` — both are
 * there to be found again — then `aria-label`, which names the control the way
 * the reporter saw it. Only the first two end the walk on their own: a label is
 * often shared (every row's "Delete"), so it ends the walk only once it is
 * unique, like any other step.
 */
function step(node) {
    const tag = node.tagName.toLowerCase();
    if (anchor(node.id))
        return `${tag}#${escape(node.id)}`;
    const testId = node.getAttribute("data-testid");
    if (anchor(testId))
        return `${tag}[data-testid="${escape(testId)}"]`;
    const label = node.getAttribute("aria-label");
    if (anchor(label))
        return `${tag}[aria-label="${escape(label)}"]`;
    let index = 1;
    for (let s = node.previousElementSibling; s; s = s.previousElementSibling) {
        if (s.tagName === node.tagName)
            index++;
    }
    return index === 1 ? tag : `${tag}:nth-of-type(${index})`;
}
/**
 * A short CSS selector for the node. Stops at the first ancestor with an id or
 * a `data-testid`, or when the selector is unique in `root`, or after five
 * levels, or before it passes 200 characters — enough to find the element
 * again, short enough to read.
 */
export function buildSelector(node, root = null) {
    const parts = [];
    let current = node;
    while (current && parts.length < MAX_SELECTOR_DEPTH) {
        const part = step(current);
        // The nearest steps are the specific ones, so a selector that would grow
        // past the cap keeps what it has rather than an ancestor.
        if (parts.length > 0 && part.length + 3 + parts.join(" > ").length > MAX_SELECTOR_LENGTH)
            break;
        parts.unshift(part);
        const selector = parts.join(" > ");
        const anchored = anchor(current.id) || anchor(current.getAttribute("data-testid"));
        if (anchored || isUnique(selector, root))
            break;
        current = current.parentElement;
        if (current && current.tagName.toLowerCase() === "body")
            break;
    }
    return parts.join(" > ");
}
/** A serialisable description of an element: what it is, what it says, where it is. */
export function describeElement(el) {
    const attributes = {};
    for (const name of ATTRIBUTES) {
        const value = el.getAttribute(name);
        if (value)
            attributes[name] = value.slice(0, 200);
    }
    for (const attr of Array.from(el.attributes)) {
        if (attr.name.startsWith("data-") && !attr.name.startsWith("data-bugbottle")) {
            attributes[attr.name] = attr.value.slice(0, 200);
        }
    }
    const rect = el.getBoundingClientRect();
    const text = (el.innerText ?? el.textContent ?? "").trim().replace(/\s+/g, " ");
    return {
        selector: buildSelector(el, el.ownerDocument),
        tag: el.tagName.toLowerCase(),
        text: text.slice(0, MAX_ELEMENT_TEXT_LENGTH),
        rect: {
            x: Math.round(rect.x + (window.scrollX || 0)),
            y: Math.round(rect.y + (window.scrollY || 0)),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
        },
        attributes,
    };
}
//# sourceMappingURL=element-description.js.map