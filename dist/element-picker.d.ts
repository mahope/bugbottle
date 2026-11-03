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
 * for the reporter to choose something with the pointer or keyboard.
 */
import type { ElementRef } from "./report-core.ts";
export { buildSelector, describeElement } from "./element-description.ts";
export type PickOptions = {
    /** Cancels the pick. Resolves with null. */
    signal?: AbortSignal;
    /** Called when the pointer or keyboard selection changes. */
    onHover?: (el: Element | null) => void;
    /** Visible and accessible keyboard instructions. Defaults to English. */
    instructions?: string;
    /** Draw a highlight over the selected element. Default true. */
    highlight?: boolean;
    /** Elements that cannot be picked. Defaults to anything inside `[data-bugbottle]`. */
    ignore?: (el: Element) => boolean;
};
/**
 * Waits for a click, or Tab/arrow navigation followed by Enter/Space, and
 * resolves with the element's description. Escape, or the signal, resolves
 * with null. Selection never activates the chosen element.
 *
 * The highlight box carries `data-bugbottle`, so it never appears in a
 * screenshot and cannot be picked itself.
 */
export declare const pickElement: (options?: PickOptions) => Promise<ElementRef | null>;
//# sourceMappingURL=element-picker.d.ts.map