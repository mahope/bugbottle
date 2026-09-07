/**
 * Hiding what the reporter typed, for the length of one render.
 *
 * A renderer works from a clone of the live DOM, and the clone is made inside
 * the renderer where we cannot reach it. So masking happens in the live
 * document instead: the values are swapped for bullets, the marked regions are
 * covered, the picture is taken, and everything is put back. The swap is
 * synchronous and every renderer we know of clones synchronously too, so the
 * page is never painted in its masked state and no flicker is visible. Should
 * a renderer ever clone asynchronously, the worst case is a frame of bullets —
 * not lost data, which is the direction that matters.
 *
 * The element is kept, only its content is hidden. Layout therefore survives:
 * the screenshot still shows a filled-in form of the right shape, with the
 * right fields highlighted in red, which is usually the whole point of the
 * picture. That is what makes this different from `exclude`, which removes the
 * node and takes the layout with it.
 *
 * The attribute names are rrweb's, so a team that already annotated its
 * templates for session replay does not annotate them twice.
 */
export type MaskOptions = {
    /**
     * Mask the value of every `input` and `textarea`, and the text of every
     * `contenteditable` region. Default true. Buttons, checkboxes and the other
     * types that carry no typed text are left alone.
     */
    inputs?: boolean;
    /**
     * Elements whose text is replaced with bullets. Default
     * `[data-bugbottle-mask]`; `false` switches this pass off.
     */
    selector?: string | false;
    /**
     * Elements covered by a solid overlay, for a region whose shape is as
     * telling as its text — a chart, a photograph, an avatar. Default
     * `[data-bugbottle-block]`; `false` switches this pass off.
     */
    block?: string | false;
    /**
     * Colour of that overlay. Defaults to the element's `--bb-mask` custom
     * property, then to `#999`.
     */
    colour?: string;
};
export declare const DEFAULT_MASK_SELECTOR = "[data-bugbottle-mask]";
export declare const DEFAULT_BLOCK_SELECTOR = "[data-bugbottle-block]";
export declare const DEFAULT_MASK_COLOUR = "#999";
/**
 * Masks everything under `root` and returns the function that puts it back.
 * Call the returned function in a `finally`: an unrestored page is a page the
 * reporter cannot type in.
 */
export declare function applyMask(root: HTMLElement, options?: MaskOptions): () => void;
//# sourceMappingURL=mask.d.ts.map