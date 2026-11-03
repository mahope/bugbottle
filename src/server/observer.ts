/** Diagnostic observers must not change delivery or replace its original error. */
export function notifyObserver<Args extends unknown[]>(
  observer: ((...args: Args) => void) | undefined,
  ...args: Args
): void {
  try {
    observer?.(...args);
  } catch {
    // Diagnostics have no fallback observer: reporting this would risk recursion.
  }
}
