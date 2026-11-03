/** Diagnostic observers must not change delivery or replace its original error. */
export function notifyObserver(observer, ...args) {
    try {
        observer?.(...args);
    }
    catch {
        // Diagnostics have no fallback observer: reporting this would risk recursion.
    }
}
//# sourceMappingURL=observer.js.map