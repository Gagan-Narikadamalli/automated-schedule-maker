const SCHEDULER_KEYWORDS = [
  "replace",
  "client",
  "instead",
  "from",
  "between",
  "schedule",
  "break",
  "called",
  "archive",
  "create",
  "update",
  "remove",
  "generate",
  "repair",
  "unplaced",
  "attendance",
  "template",
  "historical",
  "supervision",
] as const;

function distance(left: string, right: string): number {
  if (left === right) return 0;
  if (!left) return right.length;
  if (!right) return left.length;

  const previous = Array.from({ length: right.length + 1 }, (_, i) => i);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost
      );
    }
    for (let j = 0; j < current.length; j += 1) previous[j] = current[j];
  }
  return previous[right.length];
}

function correctionThreshold(token: string): number {
  if (token.length < 4) return 0;
  if (token.length <= 5) return 1;
  return 2;
}

export function normalizeNativeCommandTypos(message: string): string {
  return message.replace(/\b[A-Za-z]+\b/g, (token) => {
    const lower = token.toLowerCase();
    if ((SCHEDULER_KEYWORDS as readonly string[]).includes(lower)) return token;

    const threshold = correctionThreshold(lower);
    if (threshold === 0) return token;

    const ranked = SCHEDULER_KEYWORDS
      .map((keyword) => ({ keyword, score: distance(lower, keyword) }))
      .sort((a, b) => a.score - b.score || a.keyword.localeCompare(b.keyword));

    if (!ranked[0] || ranked[0].score > threshold) return token;
    if (ranked[1] && ranked[1].score === ranked[0].score) return token;

    // Preserve obvious entity-like title case tokens. Entity names/codes are
    // resolved separately with fuzzy matching against live records.
    if (/^[A-Z][a-z]+$/.test(token)) return token;

    return ranked[0].keyword;
  });
}
