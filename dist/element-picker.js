/**
 * Pointing at the thing the report is about.
 *
 * "The button does nothing" is a different report when it arrives with
 * `button#save-order` and the text "Save", the page it sat on, and where on
 * the page it was. That is enough for a developer — or an agent reading the
 * report — to open the right file without asking.
 *
 * `describeElement` is the pure part: it turns an element into a small,
 * serialisable description. `pickElement` is the interactive part: it waits
 * for the reporter to click something and describes that.
 */
import { MAX_ELEMENT_TEXT_LENGTH } from "./report-core.js";
/** Attributes worth carrying. `data-bugbottle*` is the library's own and is skipped. */
const ATTRIBUTES = ["id", "name", "role", "type", "href", "aria-label", "placeholder", "title"];
const MAX_SELECTOR_DEPTH = 5;
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
function step(node) {
    const tag = node.tagName.toLowerCase();
    if (node.id)
        return `${tag}#${escape(node.id)}`;
    const testId = node.getAttribute("data-testid");
    if (testId)
        return `${tag}[data-testid="${testId.replace(/"/g, '\\"')}"]`;
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
 * levels — enough to find the element again, short enough to read.
 */
export function buildSelector(node, root = null) {
    const parts = [];
    let current = node;
    while (current && parts.length < MAX_SELECTOR_DEPTH) {
        const part = step(current);
        parts.unshift(part);
        const selector = parts.join(" > ");
        if (part.includes("#") || part.includes("[data-testid") || isUnique(selector, root))
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
const defaultIgnore = (el) => el.closest("[data-bugbottle]") !== null;
/**
 * Waits for the reporter to click an element and resolves with its
 * description. Escape, or the signal, resolves with null. The click is
 * swallowed so it does not also press the button it landed on.
 *
 * The highlight box carries `data-bugbottle`, so it never appears in a
 * screenshot and cannot be picked itself.
 */
export function pickElement(options = {}) {
    if (typeof document === "undefined") {
        return Promise.reject(new Error("pickElement requires a browser environment"));
    }
    const ignore = options.ignore ?? defaultIgnore;
    const highlight = options.highlight ?? true;
    return new Promise((resolve) => {
        let box = null;
        if (highlight) {
            box = document.createElement("div");
            box.dataset.bugbottle = "highlight";
            box.setAttribute("aria-hidden", "true");
            box.style.cssText =
                "position:fixed;pointer-events:none;z-index:2147483647;display:none;" +
                    "outline:2px solid #e11d48;outline-offset:1px;background:rgba(225,29,72,.08);border-radius:2px";
            document.body.appendChild(box);
        }
        const previousCursor = document.documentElement.style.cursor;
        document.documentElement.style.cursor = "crosshair";
        const targetOf = (e) => {
            const t = e.target;
            if (!(t instanceof Element))
                return null;
            return ignore(t) ? null : t;
        };
        const finish = (result) => {
            document.removeEventListener("pointermove", onMove, true);
            document.removeEventListener("click", onClick, true);
            document.removeEventListener("keydown", onKey, true);
            options.signal?.removeEventListener("abort", onAbort);
            document.documentElement.style.cursor = previousCursor;
            box?.remove();
            options.onHover?.(null);
            resolve(result);
        };
        const onMove = (e) => {
            const el = targetOf(e);
            options.onHover?.(el);
            if (!box)
                return;
            if (!el) {
                box.style.display = "none";
                return;
            }
            const r = el.getBoundingClientRect();
            box.style.display = "block";
            box.style.left = `${r.left}px`;
            box.style.top = `${r.top}px`;
            box.style.width = `${r.width}px`;
            box.style.height = `${r.height}px`;
        };
        const onClick = (e) => {
            const el = targetOf(e);
            if (!el)
                return;
            e.preventDefault();
            e.stopPropagation();
            finish(describeElement(el));
        };
        const onKey = (e) => {
            if (e.key === "Escape") {
                e.preventDefault();
                finish(null);
            }
        };
        const onAbort = () => finish(null);
        if (options.signal?.aborted) {
            finish(null);
            return;
        }
        document.addEventListener("pointermove", onMove, true);
        document.addEventListener("click", onClick, true);
        document.addEventListener("keydown", onKey, true);
        options.signal?.addEventListener("abort", onAbort);
    });
}
//# sourceMappingURL=element-picker.js.map