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
import { pickElementWithKeyboard } from "./element-picker-keyboard.js";
export { buildSelector, describeElement } from "./element-description.js";
/**
 * Waits for a click, or Tab/arrow navigation followed by Enter/Space, and
 * resolves with the element's description. Escape, or the signal, resolves
 * with null. Selection never activates the chosen element.
 *
 * The highlight box carries `data-bugbottle`, so it never appears in a
 * screenshot and cannot be picked itself.
 */
export const pickElement = pickElementWithKeyboard;
//# sourceMappingURL=element-picker.js.map