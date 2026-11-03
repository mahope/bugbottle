/** Pointer-only picker retained by the slim script-tag build. */
import { describeElement } from "./element-description.js";
export function pickElementWithPointer(options = {}) {
    const ignore = options.ignore ?? ((el) => !!el.closest("[data-bugbottle]"));
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
        const cursorStyle = document.documentElement.style;
        const previousCursor = cursorStyle.cursor;
        cursorStyle.cursor = "crosshair";
        const targetOf = (e) => {
            const t = e.target;
            return t instanceof Element && !ignore(t) ? t : null;
        };
        const finish = (result) => {
            document.removeEventListener("pointermove", onMove, true);
            document.removeEventListener("click", onClick, true);
            document.removeEventListener("keydown", onKey, true);
            options.signal?.removeEventListener("abort", onAbort);
            cursorStyle.cursor = previousCursor;
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
//# sourceMappingURL=element-picker-pointer.js.map