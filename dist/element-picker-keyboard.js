import { describeElement } from "./element-description.js";
import { MAX_ELEMENT_TEXT_LENGTH } from "./report-core.js";
export function pickElementWithKeyboard(options = {}) {
    if (typeof document === "undefined") {
        return Promise.reject(new Error("pickElement requires a browser environment"));
    }
    const ignore = options.ignore ?? ((el) => el.closest("[data-bugbottle]") !== null);
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
        const previousFocus = document.activeElement;
        const picker = document.createElement("div");
        picker.dataset.bugbottle = "picker";
        picker.tabIndex = -1;
        // This temporary keyboard surface needs arrow keys from screen readers too.
        picker.setAttribute("role", "application");
        const instructions = options.instructions ??
            "Click an element, or use Tab and arrow keys to move, Enter or Space to attach. Escape cancels.";
        picker.setAttribute("aria-label", instructions);
        picker.style.cssText = "position:fixed;bottom:8px;left:8px;right:8px;z-index:2147483647;pointer-events:none;" +
            "padding:12px;background:Canvas;color:CanvasText;border:2px solid;" +
            "font:16px/1.5 system-ui;max-height:30vh;overflow:auto";
        const hint = document.createElement("div");
        hint.textContent = instructions;
        const announcement = document.createElement("div");
        announcement.setAttribute("role", "status");
        announcement.setAttribute("aria-live", "polite");
        announcement.setAttribute("aria-atomic", "true");
        picker.append(hint, announcement);
        document.body.appendChild(picker);
        let selected = null;
        let confirming = null;
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
            document.removeEventListener("keyup", onKeyUp, true);
            window.removeEventListener("scroll", draw, true);
            window.removeEventListener("resize", draw);
            options.signal?.removeEventListener("abort", onAbort);
            document.documentElement.style.cursor = previousCursor;
            box?.remove();
            picker.remove();
            if (previousFocus?.isConnected)
                previousFocus.focus({ preventScroll: true });
            options.onHover?.(null);
            resolve(result);
        };
        const draw = () => {
            options.onHover?.(selected);
            if (selected) {
                const below = selected.getBoundingClientRect().top > window.innerHeight / 2;
                picker.style.top = below ? "8px" : "";
                picker.style.bottom = below ? "" : "8px";
            }
            if (!box)
                return;
            if (!selected?.isConnected) {
                box.style.display = "none";
                return;
            }
            const r = selected.getBoundingClientRect();
            box.style.display = "block";
            box.style.left = `${r.left}px`;
            box.style.top = `${r.top}px`;
            box.style.width = `${r.width}px`;
            box.style.height = `${r.height}px`;
        };
        const select = (el) => {
            selected = el;
            draw();
            announcement.textContent = el ? `${el.tagName.toLowerCase()}: ${el.getAttribute("aria-label") || el.getAttribute("alt") ||
                (el.innerText ?? el.textContent ?? "").trim().slice(0, MAX_ELEMENT_TEXT_LENGTH)}` : "";
        };
        const onMove = (e) => select(targetOf(e));
        const onClick = (e) => {
            const el = targetOf(e);
            if (!el)
                return;
            e.preventDefault();
            e.stopPropagation();
            finish(describeElement(el));
        };
        const onKey = (e) => {
            if (!["Escape", "Tab", "ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft", "Home", "End", "Enter", " "].includes(e.key))
                return;
            e.preventDefault();
            e.stopImmediatePropagation();
            if (e.key === "Escape") {
                finish(null);
                return;
            }
            if (e.key === "Enter" || e.key === " ") {
                if (selected)
                    confirming = e.key;
                return;
            }
            confirming = null;
            const candidates = Array.from(document.body.querySelectorAll("*")).filter(el => {
                if (el.closest('[data-bugbottle], [hidden], [inert], [aria-hidden="true"]') || ignore(el))
                    return false;
                for (let ancestor = el; ancestor; ancestor = ancestor.parentElement) {
                    if (window.getComputedStyle(ancestor).opacity === "0")
                        return false;
                }
                const style = window.getComputedStyle(el);
                const rect = el.getBoundingClientRect();
                return style.visibility === "visible" && style.display !== "none" && rect.width > 0 && rect.height > 0;
            });
            const backwards = ["ArrowUp", "ArrowLeft"].includes(e.key) || (e.key === "Tab" && e.shiftKey);
            const current = selected ? candidates.indexOf(selected) : -1;
            const index = e.key === "Home" ? 0 : e.key === "End" ? candidates.length - 1 :
                current < 0 ? (backwards ? candidates.length - 1 : 0) :
                    (current + (backwards ? -1 : 1) + candidates.length) % candidates.length;
            const next = candidates[index] ?? null;
            next?.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
            select(next);
        };
        // Finish on release so Space cannot click the restored panel control.
        const onKeyUp = (e) => {
            if (e.key !== "Enter" && e.key !== " ")
                return;
            e.preventDefault();
            e.stopImmediatePropagation();
            if (confirming === e.key && selected?.isConnected && !ignore(selected))
                finish(describeElement(selected));
            confirming = null;
        };
        const onAbort = () => finish(null);
        if (options.signal?.aborted) {
            finish(null);
            return;
        }
        document.addEventListener("pointermove", onMove, true);
        document.addEventListener("click", onClick, true);
        document.addEventListener("keydown", onKey, true);
        document.addEventListener("keyup", onKeyUp, true);
        window.addEventListener("scroll", draw, true);
        window.addEventListener("resize", draw);
        options.signal?.addEventListener("abort", onAbort);
        picker.focus({ preventScroll: true });
    });
}
//# sourceMappingURL=element-picker-keyboard.js.map