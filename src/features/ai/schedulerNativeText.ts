import { damerauLevenshteinDistance } from "./stringSimilarity";

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
      .map((keyword) => ({ keyword, score: damerauLevenshteinDistance(lower, keyword) }))
      .sort((a, b) => a.score - b.score || a.keyword.localeCompare(b.keyword));

    if (!ranked[0] || ranked[0].score > threshold) return token;
    if (ranked[1] && ranked[1].score === ranked[0].score) return token;

    // Preserve obvious entity-like title case tokens. Entity names/codes are
    // resolved separately with fuzzy matching against live records.
    if (/^[A-Z][a-z]+$/.test(token)) return token;

    return ranked[0].keyword;
  });
}
