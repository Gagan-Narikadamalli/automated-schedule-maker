const SCHEDULER_KEYWORDS = [
  "replace",
  "client",
  "instead",
  "from",
  "between",
  "schedule",
  "scheduler",
  "rules",
  "settings",
  "staff",
  "teams",
  "team",
  "profiles",
  "events",
  "speech",
  "nap",
  "coverage",
  "available",
  "called",
  "break",
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

  const matrix = Array.from({ length: left.length + 1 }, () =>
    Array<number>(right.length + 1).fill(0)
  );
  for (let i = 0; i <= left.length; i += 1) matrix[i][0] = i;
  for (let j = 0; j <= right.length; j += 1) matrix[0][j] = j;

  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
      if (
        i > 1 &&
        j > 1 &&
        left[i - 1] === right[j - 2] &&
        left[i - 2] === right[j - 1]
      ) {
        matrix[i][j] = Math.min(matrix[i][j], matrix[i - 2][j - 2] + 1);
      }
    }
  }
  return matrix[left.length][right.length];
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
