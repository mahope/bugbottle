/**
 * Marking the picture: a rectangle to point at something, an arrow to point
 * from somewhere, and a blur that pixelates a region.
 *
 * This is a canvas and nothing else — no dialog, no toolbar, no dependency —
 * so the ready-made panel and a hand-built form can both use it. The panel
 * draws the toolbar around it (see `src/ui/index.ts`); a custom form supplies
 * its own controls and passes `toDataUrl()` to `screenshotDataUrl`.
 *
 * Two decisions are worth spelling out.
 *
 * The blur is not a filter. It reads the pixels of the region back out of the
 * canvas, averages them in blocks and paints the averages over the top, so the
 * original pixels are gone from the exported PNG rather than merely hidden
 * behind something. That is what makes the tool a privacy control and not a
 * decoration: whoever receives the report cannot undo it.
 *
 * Shapes are kept as a list and the picture is redrawn from the original image
 * on every change, which is what makes undo one line rather than a stack of
 * saved bitmaps. The backing store is the picture's own pixels — a capture at
 * `devicePixelRatio` 2 gives a canvas twice the size it is displayed at — and
 * pointer coordinates are scaled through `getBoundingClientRect`, so a mark
 * lands where it was drawn on any screen.
 */
/** The three tools. `blur` is destructive by design; see the note above. */
export type AnnotateTool = "rect" | "arrow" | "blur";
export type AnnotatorOptions = {
    /** Tool selected to begin with. Default `"rect"`. */
    tool?: AnnotateTool;
    /**
     * Stroke colour. Defaults to the computed `--bb-primary` of the canvas, so
     * a mark made inside the panel is the brand colour without being told, and
     * falls back to the panel's own blue outside it.
     */
    colour?: string;
    /** Stroke width in picture pixels. Default 4. */
    lineWidth?: number;
    /** Edge of one blur block in picture pixels. Default 12. */
    blockSize?: number;
    /** Called after a shape is added, undone or cleared, with how many remain. */
    onChange?: (shapes: number) => void;
};
export type Annotator = {
    /** Resolves once the picture is drawn; rejects if the data URL will not load. */
    ready: Promise<void>;
    setTool(tool: AnnotateTool): void;
    getTool(): AnnotateTool;
    /** Removes the last shape. Returns false when there was nothing to remove. */
    undo(): boolean;
    clear(): void;
    /** How many shapes have been drawn. */
    count(): number;
    /** The marked picture as a PNG data URL. */
    toDataUrl(): string;
    /** Removes the listeners. The canvas keeps whatever is drawn on it. */
    destroy(): void;
};
/**
 * Wires a canvas up as an annotator over one PNG data URL.
 *
 * The canvas is resized to the picture, given a tab stop if it has none, and
 * left for the caller to style and to name; every string around it belongs to
 * a locale, and this module has none.
 */
export declare function createAnnotator(canvas: HTMLCanvasElement, dataUrl: string, options?: AnnotatorOptions): Annotator;
//# sourceMappingURL=annotate.d.ts.map