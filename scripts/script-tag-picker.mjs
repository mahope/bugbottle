import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

/** Keep the ESM picker synchronous and choose the script-tag implementation at build time. */
export function scriptTagPicker(keyboard) {
  return {
    name: "script-tag-picker",
    setup(build) {
      build.onResolve({ filter: /element-picker-keyboard\.ts$/ }, () => !keyboard
        ? { path: "pointer-picker", namespace: "pointer-picker" }
        : { path: "keyboard-picker", namespace: "lazy-picker" });
      build.onLoad({ filter: /.*/, namespace: "pointer-picker" }, () => ({
        contents: `export { pickElementWithPointer as pickElementWithKeyboard } from "${root}src/element-picker-pointer.ts";`,
        resolveDir: root,
      }));
      build.onLoad({ filter: /.*/, namespace: "lazy-picker" }, () => ({
        contents: "export const pickElementWithKeyboard = options => import(__bugbottlePickerUrl).then(module => module.pickElementWithKeyboard(options));",
      }));
    },
  };
}
