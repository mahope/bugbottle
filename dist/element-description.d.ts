import { type ElementRef } from "./report-core.ts";
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
 * levels, or before it passes 200 characters — enough to find the element
 * again, short enough to read.
 */
export declare function buildSelector(node: SelectorNode, root?: {
    querySelectorAll(s: string): ArrayLike<unknown>;
} | null): string;
/** A serialisable description of an element: what it is, what it says, where it is. */
export declare function describeElement(el: Element): ElementRef;
export {};
//# sourceMappingURL=element-description.d.ts.map