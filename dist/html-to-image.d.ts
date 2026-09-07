/**
 * A screenshot renderer backed by `html-to-image`.
 *
 * This is its own entry point (`bugbottle/html-to-image`) so the dependency is
 * only pulled into a bundle that imports it. Install it alongside:
 *
 *     npm install html-to-image
 *
 * Any function matching `ScreenshotRenderer` works in its place — another
 * DOM-to-image library, or your own.
 */
import type { ScreenshotRenderer } from "./capture.ts";
export declare const htmlToImage: ScreenshotRenderer;
//# sourceMappingURL=html-to-image.d.ts.map