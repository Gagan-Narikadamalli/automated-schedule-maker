/** Unwrap SDK retry errors without exposing request bodies or credentials. */
export function schedulerProviderStatus(error: unknown): number | undefined {
  let current = error;
  const visited = new Set<unknown>();
  while (current && typeof current === "object" && !visited.has(current)) {
    visited.add(current);
    const failure = current as { statusCode?: unknown; lastError?: unknown; errors?: unknown[]; cause?: unknown };
    if (typeof failure.statusCode === "number") return failure.statusCode;
    current = failure.lastError ?? failure.errors?.at(-1) ?? failure.cause;
  }
  return undefined;
}
