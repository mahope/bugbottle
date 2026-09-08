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
/** Below this a drag is a click that missed, not a shape somebody wanted. */
const MIN_DRAG = 3;
/**
 * Wires a canvas up as an annotator over one PNG data URL.
 *
 * The canvas is resized to the picture, given a tab stop if it has none, and
 * left for the caller to style and to name; every string around it belongs to
 * a locale, and this module has none.
 */
export function createAnnotator(canvas, dataUrl, options = {}) {
    const context = canvas.getContext("2d");
    if (!context)
        throw new Error("createAnnotator needs a canvas with a 2D context");
    // Bound again so the closures below see the narrowed type rather than the
    // nullable one the getter returns.
    const ctx = context;
    const lineWidth = options.lineWidth ?? 4;
    const block = Math.max(2, options.blockSize ?? 12);
    const themed = typeof getComputedStyle === "function"
        ? getComputedStyle(canvas).getPropertyValue("--bb-primary").trim()
        : "";
    const colour = options.colour || themed || "#2563eb";
    let tool = options.tool ?? "rect";
    let image = null;
    const shapes = [];
    let drawing = null;
    if (!canvas.hasAttribute("tabindex"))
        canvas.tabIndex = 0;
    const ready = new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            image = img;
            canvas.width = img.naturalWidth || img.width;
            canvas.height = img.naturalHeight || img.height;
            redraw();
            resolve();
        };
        // A picture that will not decode is not the reporter's problem to solve;
        // the caller decides whether to say so or to drop the editor entirely.
        img.onerror = () => reject(new Error("the screenshot could not be loaded"));
        img.src = dataUrl;
    });
    /** Replaces the region with the average colour of each block in it. */
    function pixelate(x, y, w, h) {
        // Both edges are rounded outwards and then clamped, rather than the origin
        // being floored and the *extent* ceiled: with a fractional origin the
        // latter stops a pixel short of the drag, and with a drag that began off
        // the canvas it slides the whole region sideways. A pixel this tool was
        // asked to destroy and did not is the one failure that matters here, so it
        // covers a fraction of a pixel too much rather than too little.
        const sx = Math.max(0, Math.floor(x));
        const sy = Math.max(0, Math.floor(y));
        const sw = Math.min(canvas.width, Math.ceil(x + w)) - sx;
        const sh = Math.min(canvas.height, Math.ceil(y + h)) - sy;
        if (sw < 1 || sh < 1)
            return;
        const data = ctx.getImageData(sx, sy, sw, sh).data;
        for (let by = 0; by < sh; by += block) {
            for (let bx = 0; bx < sw; bx += block) {
                const bw = Math.min(block, sw - bx);
                const bh = Math.min(block, sh - by);
                let r = 0;
                let g = 0;
                let b = 0;
                for (let j = 0; j < bh; j++) {
                    for (let i = 0; i < bw; i++) {
                        const p = ((by + j) * sw + bx + i) * 4;
                        r += data[p] ?? 0;
                        g += data[p + 1] ?? 0;
                        b += data[p + 2] ?? 0;
                    }
                }
                const n = bw * bh;
                ctx.fillStyle = `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})`;
                ctx.fillRect(sx + bx, sy + by, bw, bh);
            }
        }
    }
    function paint(shape) {
        const x = Math.min(shape.x, shape.x + shape.w);
        const y = Math.min(shape.y, shape.y + shape.h);
        const w = Math.abs(shape.w);
        const h = Math.abs(shape.h);
        if (shape.tool === "blur") {
            pixelate(x, y, w, h);
            return;
        }
        ctx.strokeStyle = colour;
        ctx.lineWidth = lineWidth;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        if (shape.tool === "rect") {
            ctx.strokeRect(x, y, w, h);
            return;
        }
        // The arrow keeps the signed offsets: it points where the drag ended.
        const ex = shape.x + shape.w;
        const ey = shape.y + shape.h;
        const angle = Math.atan2(shape.h, shape.w);
        const head = Math.max(10, lineWidth * 4);
        ctx.beginPath();
        ctx.moveTo(shape.x, shape.y);
        ctx.lineTo(ex, ey);
        for (const spread of [-0.45, 0.45]) {
            ctx.moveTo(ex, ey);
            ctx.lineTo(ex - head * Math.cos(angle + spread), ey - head * Math.sin(angle + spread));
        }
        ctx.stroke();
    }
    /** The picture, then every shape in the order it was drawn. */
    function redraw() {
        if (!image)
            return;
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        for (const shape of shapes)
            paint(shape);
        if (drawing)
            paint(drawing);
    }
    /** Client coordinates in the picture's own pixels. */
    function at(event) {
        const box = canvas.getBoundingClientRect();
        return {
            x: (event.clientX - box.left) * (canvas.width / (box.width || canvas.width || 1)),
            y: (event.clientY - box.top) * (canvas.height / (box.height || canvas.height || 1)),
        };
    }
    const onDown = (event) => {
        if (drawing)
            return;
        const p = at(event);
        drawing = { tool, x: p.x, y: p.y, w: 0, h: 0 };
        // A drag on a canvas is otherwise a text selection or a scroll gesture.
        event.preventDefault();
        canvas.setPointerCapture?.(event.pointerId);
        canvas.focus();
    };
    const onMove = (event) => {
        if (!drawing)
            return;
        const p = at(event);
        drawing.w = p.x - drawing.x;
        drawing.h = p.y - drawing.y;
        redraw();
    };
    const onUp = () => {
        const shape = drawing;
        drawing = null;
        if (!shape)
            return;
        if (Math.abs(shape.w) < MIN_DRAG && Math.abs(shape.h) < MIN_DRAG) {
            redraw();
            return;
        }
        shapes.push(shape);
        redraw();
        options.onChange?.(shapes.length);
    };
    const onKey = (event) => {
        if (event.key === "Escape") {
            // Only a shape in progress is cancelled here. With nothing being drawn
            // the key belongs to whatever the canvas is inside — the panel closes on
            // it — so it is left to travel.
            if (!drawing)
                return;
            drawing = null;
            redraw();
            event.stopPropagation();
            event.preventDefault();
            return;
        }
        if (event.key === "Backspace" || event.key === "Delete") {
            event.preventDefault();
            undo();
        }
    };
    function undo() {
        if (shapes.length === 0)
            return false;
        shapes.pop();
        redraw();
        options.onChange?.(shapes.length);
        return true;
    }
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointercancel", onUp);
    canvas.addEventListener("keydown", onKey);
    return {
        ready,
        setTool(next) {
            tool = next;
        },
        getTool: () => tool,
        undo,
        clear() {
            shapes.length = 0;
            drawing = null;
            redraw();
            options.onChange?.(0);
        },
        count: () => shapes.length,
        toDataUrl: () => canvas.toDataURL("image/png"),
        destroy() {
            canvas.removeEventListener("pointerdown", onDown);
            canvas.removeEventListener("pointermove", onMove);
            canvas.removeEventListener("pointerup", onUp);
            canvas.removeEventListener("pointercancel", onUp);
            canvas.removeEventListener("keydown", onKey);
        },
    };
}
//# sourceMappingURL=annotate.js.map