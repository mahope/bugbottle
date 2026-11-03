/** Diagnostic observers must not change delivery or replace its original error. */
export declare function notifyObserver<Args extends unknown[]>(observer: ((...args: Args) => void) | undefined, ...args: Args): void;
//# sourceMappingURL=observer.d.ts.map