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
import type { ElementRef } from "./report-core.ts";
/** The subset of Element the selector builder needs, so it can be tested without a DOM. */
type SelectorNode = {
    tagName: string;
    id: string;
    parentElement: SelectorNode | null;
    previousElementSibling: SelectorNode | null;
    getAttribute(name: string): string | null;
};
/**
 * A short CSS selector for the node. Stops at the first ancestor with an id or
 * a `data-testid`, or when the selector is unique in `root`, or after five
 * levels — enough to find the element again, short enough to read.
 */
export declare function buildSelector(node: SelectorNode, root?: {
    querySelectorAll(s: string): ArrayLike<unknown>;
} | null): string;
/** A serialisable description of an element: what it is, what it says, where it is. */
export declare function describeElement(el: Element): ElementRef;
export type PickOptions = {
    /** Cancels the pick. Resolves with null. */
    signal?: AbortSignal;
    /** Called as the pointer moves, with the element that would be picked. */
    onHover?: (el: Element | null) => void;
    /** Draw a highlight over the hovered element. Default true. */
    highlight?: boolean;
    /** Elements that cannot be picked. Defaults to anything inside `[data-bugbottle]`. */
    ignore?: (el: Element) => boolean;
};
/**
 * Waits for the reporter to click an element and resolves with its
 * description. Escape, or the signal, resolves with null. The click is
 * swallowed so it does not also press the button it landed on.
 *
 * The highlight box carries `data-bugbottle`, so it never appears in a
 * screenshot and cannot be picked itself.
 */
export declare function pickElement(options?: PickOptions): Promise<ElementRef | null>;
export {};
//# sourceMappingURL=element-picker.d.ts.map