import type {
  SchedulerAiDateSource,
  SchedulerAiHistoryMessage,
} from "./types";

export type SchedulerDateResolution = {
  date: string;
  source: SchedulerAiDateSource;
  error?: string;
};

const WEEKDAYS = [
  { names: ["sunday", "sun"], index: 0 },
  { names: ["monday", "mon"], index: 1 },
  { names: ["tuesday", "tue", "tues"], index: 2 },
  { names: ["wednesday", "wed"], index: 3 },
  { names: ["thursday", "thu", "thur", "thurs"], index: 4 },
  { names: ["friday", "fri"], index: 5 },
  { names: ["saturday", "sat"], index: 6 },
] as const;

function parseIso(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return parsed;
}

export function isValidSchedulerIsoDate(value: string): boolean {
  return Boolean(parseIso(value));
}

export function shiftSchedulerDate(date: string, days: number): string {
  const value = parseIso(date);
  if (!value) return date;
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function formatDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function mondayOfWeek(date: string): string {
  const value = parseIso(date);
  if (!value) return date;
  const day = value.getUTCDay();
  const delta = day === 0 ? -6 : 1 - day;
  value.setUTCDate(value.getUTCDate() + delta);
  return formatDate(value);
}

function weekdayIndexFromText(message: string): {
  index: number;
  token: string;
} | null {
  for (const weekday of WEEKDAYS) {
    const match = message.match(
      new RegExp("\\b(" + weekday.names.join("|") + ")\\b", "i")
    );
    if (match) return { index: weekday.index, token: match[1] };
  }
  return null;
}

function weekdayInSameWeek(anchorDate: string, weekdayIndex: number): string {
  const monday = parseIso(mondayOfWeek(anchorDate));
  if (!monday) return anchorDate;
  const mondayBasedIndex = weekdayIndex === 0 ? 6 : weekdayIndex - 1;
  monday.setUTCDate(monday.getUTCDate() + mondayBasedIndex);
  return formatDate(monday);
}

export function weekdayOnOrAfter(
  anchorDate: string,
  weekdayIndex: number
): string {
  const anchor = parseIso(anchorDate);
  if (!anchor) return anchorDate;
  const delta = (weekdayIndex - anchor.getUTCDay() + 7) % 7;
  anchor.setUTCDate(anchor.getUTCDate() + delta);
  return formatDate(anchor);
}

export function weekdayOnOrBefore(
  anchorDate: string,
  weekdayIndex: number
): string {
  const anchor = parseIso(anchorDate);
  if (!anchor) return anchorDate;
  const delta = (anchor.getUTCDay() - weekdayIndex + 7) % 7;
  anchor.setUTCDate(anchor.getUTCDate() - delta);
  return formatDate(anchor);
}

function parseNamedOrNumericDate(
  message: string,
  anchorDate: string
): string | null {
  const slash = message.match(
    /\b(\d{1,2})\/(\d{1,2})(?:\/(20\d{2}|\d{2}))?\b/
  );
  if (slash) {
    const anchorYear = Number(anchorDate.slice(0, 4));
    const year = slash[3]
      ? Number(slash[3].length === 2 ? "20" + slash[3] : slash[3])
      : anchorYear;
    const month = Number(slash[1]);
    const day = Number(slash[2]);
    const candidate = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    if (
      candidate.getUTCFullYear() === year &&
      candidate.getUTCMonth() === month - 1 &&
      candidate.getUTCDate() === day
    ) {
      return formatDate(candidate);
    }
  }

  const monthNames =
    "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec";
  const named = message.match(
    new RegExp(
      "\\b(" +
        monthNames +
        ")\\s+(\\d{1,2})(?:,?\\s+(20\\d{2}))?\\b",
      "i"
    )
  );
  if (named) {
    const year = named[3] || anchorDate.slice(0, 4);
    const parsed = new Date(
      Date.parse(named[1] + " " + named[2] + ", " + year + " 12:00:00 UTC")
    );
    if (!Number.isNaN(parsed.getTime())) return formatDate(parsed);
  }

  return null;
}

function latestConversationDate(
  history: SchedulerAiHistoryMessage[],
  anchorDate: string
): string | null {
  for (const entry of [...history].reverse()) {
    if (
      entry.effectiveDate &&
      isValidSchedulerIsoDate(entry.effectiveDate)
    ) {
      return entry.effectiveDate;
    }
  }

  for (const entry of [...history].reverse()) {
    if (entry.role !== "user") continue;
    const iso = entry.text.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1];
    if (iso && isValidSchedulerIsoDate(iso)) return iso;
    const named = parseNamedOrNumericDate(entry.text, anchorDate);
    if (named) return named;
  }

  return null;
}

function isShortDateContinuation(message: string): boolean {
  const value = message
    .trim()
    .toLowerCase()
    .replace(/[?.!]+$/g, "")
    .replace(/\s+/g, " ");

  const dayToken =
    "(?:today|tomorrow|yesterday|the next day|next day|the day after|monday|mon|tuesday|tue|tues|wednesday|wed|thursday|thu|thur|thurs|friday|fri|saturday|sat|sunday|sun)";

  return (
    new RegExp(
      "^(?:what about|how about|same(?: thing)?(?: for)?|and|then)\\s+" +
        dayToken +
        "$"
    ).test(value) ||
    new RegExp("^" + dayToken + "(?: instead)?$").test(value) ||
    new RegExp(
      "^(?:actually|instead|rather|make it|move it|do it|change it(?: to)?)\\s+" +
        dayToken +
        "(?: instead)?$"
    ).test(value)
  );
}

function parseWeekdayDate(
  message: string,
  anchorDate: string
): string | null {
  const weekday = weekdayIndexFromText(message);
  if (!weekday) return null;

  const before = message
    .slice(
      Math.max(
        0,
        message.toLowerCase().indexOf(weekday.token.toLowerCase()) - 12
      ),
      message.toLowerCase().indexOf(weekday.token.toLowerCase())
    )
    .toLowerCase();

  if (/\bnext\s*$/.test(before)) {
    return shiftSchedulerDate(
      weekdayInSameWeek(anchorDate, weekday.index),
      7
    );
  }
  if (/\b(?:last|previous)\s*$/.test(before)) {
    return shiftSchedulerDate(
      weekdayInSameWeek(anchorDate, weekday.index),
      -7
    );
  }
  if (/\bthis\s*$/.test(before)) {
    return weekdayInSameWeek(anchorDate, weekday.index);
  }

  return weekdayOnOrAfter(anchorDate, weekday.index);
}

function explicitTargetForCopy(args: {
  message: string;
  selectedDate: string;
  todayDate: string;
  conversationDate: string | null;
}): { date: string; source: SchedulerAiDateSource } | null {
  if (!/\b(?:copy|use)\b[\s\S]*\bschedule\b/i.test(args.message)) {
    return null;
  }

  const targetMatch = args.message.match(
    /\b(?:to|into|onto)\s+(.+?)(?:[?.!,]|$)/i
  );
  if (!targetMatch?.[1]) {
    return {
      date: args.selectedDate,
      source: "SELECTED_DAY",
    };
  }

  const targetText = targetMatch[1].trim();
  const iso = targetText.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1];
  if (iso && isValidSchedulerIsoDate(iso)) {
    return { date: iso, source: "EXPLICIT_DATE" };
  }

  const named = parseNamedOrNumericDate(targetText, args.selectedDate);
  if (named) return { date: named, source: "EXPLICIT_DATE" };

  const normalized = targetText.toLowerCase();
  if (/\btoday\b/.test(normalized)) {
    return { date: args.todayDate, source: "TODAY" };
  }
  if (/\btomorrow\b/.test(normalized)) {
    return {
      date: shiftSchedulerDate(args.todayDate, 1),
      source: "RELATIVE_DATE",
    };
  }
  if (/\byesterday\b/.test(normalized)) {
    return {
      date: shiftSchedulerDate(args.todayDate, -1),
      source: "RELATIVE_DATE",
    };
  }

  const weekdayAnchor =
    args.conversationDate || args.selectedDate || args.todayDate;
  const weekday = parseWeekdayDate(targetText, weekdayAnchor);
  if (weekday) return { date: weekday, source: "WEEKDAY" };

  return {
    date: args.selectedDate,
    source: "SELECTED_DAY",
  };
}

export function resolveSchedulerDateContext(args: {
  message: string;
  selectedDate: string;
  todayDate: string;
  dateSelectionExplicit: boolean;
  history: SchedulerAiHistoryMessage[];
}): SchedulerDateResolution {
  const {
    message,
    selectedDate,
    todayDate,
    dateSelectionExplicit,
    history,
  } = args;
  const normalized = message.toLowerCase();

  for (const match of message.matchAll(/\b(20\d{2}-\d{2}-\d{2})\b/g)) {
    if (!isValidSchedulerIsoDate(match[1])) {
      return {
        date: selectedDate,
        source: "PASSIVE_SELECTION",
        error:
          'The date "' +
          match[1] +
          '" is not a valid calendar date. Please use a real date in YYYY-MM-DD format.',
      };
    }
  }

  const conversationDate = latestConversationDate(history, selectedDate);

  const copyTarget = explicitTargetForCopy({
    message,
    selectedDate,
    todayDate,
    conversationDate,
  });
  if (copyTarget) return copyTarget;

  const isoDate = message.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1];
  if (isoDate) return { date: isoDate, source: "EXPLICIT_DATE" };

  const namedOrNumeric = parseNamedOrNumericDate(message, selectedDate);
  if (namedOrNumeric) {
    return { date: namedOrNumeric, source: "EXPLICIT_DATE" };
  }

  if (/\b(today|current date|right now|now)\b/.test(normalized)) {
    return { date: todayDate, source: "TODAY" };
  }

  const shortContinuation = isShortDateContinuation(message);
  const relativeAnchor =
    shortContinuation && conversationDate ? conversationDate : todayDate;

  if (/\b(?:the\s+)?(?:next day|day after)\b/.test(normalized)) {
    return {
      date: shiftSchedulerDate(
        conversationDate || selectedDate || todayDate,
        1
      ),
      source: conversationDate ? "CONVERSATION" : "RELATIVE_DATE",
    };
  }
  if (/\btomorrow\b/.test(normalized)) {
    return {
      date: shiftSchedulerDate(relativeAnchor, 1),
      source:
        shortContinuation && conversationDate
          ? "CONVERSATION"
          : "RELATIVE_DATE",
    };
  }
  if (/\byesterday\b/.test(normalized)) {
    return {
      date: shiftSchedulerDate(relativeAnchor, -1),
      source:
        shortContinuation && conversationDate
          ? "CONVERSATION"
          : "RELATIVE_DATE",
    };
  }

  const weekdayAnchor =
    shortContinuation && conversationDate
      ? conversationDate
      : dateSelectionExplicit
        ? selectedDate
        : todayDate;
  const weekday = parseWeekdayDate(message, weekdayAnchor);
  if (weekday) {
    return {
      date: weekday,
      source:
        shortContinuation && conversationDate ? "CONVERSATION" : "WEEKDAY",
    };
  }

  const weekAnchor =
    conversationDate && history.length > 0
      ? conversationDate
      : dateSelectionExplicit
        ? selectedDate
        : todayDate;
  if (/\bnext\s+(?:work\s+)?week\b/.test(normalized)) {
    return {
      date: shiftSchedulerDate(mondayOfWeek(weekAnchor), 7),
      source: "SELECTED_WEEK",
    };
  }
  if (/\b(?:last|previous)\s+(?:work\s+)?week\b/.test(normalized)) {
    return {
      date: shiftSchedulerDate(mondayOfWeek(weekAnchor), -7),
      source: "SELECTED_WEEK",
    };
  }
  if (
    /\b(this|current|the)\s+(work\s+)?week\b/.test(normalized) ||
    /\b(generate|build|make|fix|repair)\s+(the\s+)?(work\s+)?week\b/.test(
      normalized
    )
  ) {
    return { date: mondayOfWeek(weekAnchor), source: "SELECTED_WEEK" };
  }

  if (
    /\b(this|selected)\s+day\b/.test(normalized) ||
    /\b(current|this)\s+schedule\b/.test(normalized)
  ) {
    return { date: selectedDate, source: "SELECTED_DAY" };
  }

  if (conversationDate && history.length > 0) {
    return { date: conversationDate, source: "CONVERSATION" };
  }

  if (dateSelectionExplicit) {
    return { date: selectedDate, source: "SELECTED_DAY" };
  }

  return { date: selectedDate, source: "PASSIVE_SELECTION" };
}
