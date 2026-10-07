import type { SchedulerAiHistoryMessage } from "./types";

function lastUserMessage(history: SchedulerAiHistoryMessage[]): string {
  return [...history].reverse().find((entry) => entry.role === "user")?.text.trim() || "";
}

function cleanEntity(value: string): string {
  return value.replace(/[?.!,]+$/g, "").trim();
}

function replaceSubject(previous: string, replacement: string): string | null {
  const staffPatterns: Array<[RegExp, string]> = [
    [/\bwho\s+is\s+(.+?)\s+with\b/i, "who is $SUBJECT with"],
    [/\bwhat\s+clients?\s+does\s+(.+?)(?=\s+(?:have|from|at|today|tomorrow)\b|[?.!,]|$)/i, "what clients does $SUBJECT"],
    [/\bwhen\s+is\s+(.+?)\s+(?:on\s+)?break\b/i, "when is $SUBJECT on break"],
    [/\bshow\s+(.+?)'s\s+schedule\b/i, "show $SUBJECT's schedule"],
    [/\bschedule\s+for\s+(.+?)(?=\s+(?:from|between|at|today|tomorrow|on)\b|[?.!,]|$)/i, "schedule for $SUBJECT"],
  ];

  for (const [pattern, template] of staffPatterns) {
    const match = previous.match(pattern);
    if (!match?.[1]) continue;
    return previous.replace(match[0], template.replace("$SUBJECT", replacement));
  }

  const clientPatterns: Array<[RegExp, string]> = [
    [/\bwho\s+(?:is\s+)?covering\s+(.+?)(?=\s+(?:at|from|between|today|tomorrow|on)\b|[?.!,]|$)/i, "who is covering $SUBJECT"],
    [/\bcoverage\s+(?:for|of)\s+(.+?)(?=\s+(?:at|from|between|today|tomorrow|on)\b|[?.!,]|$)/i, "coverage for $SUBJECT"],
  ];

  for (const [pattern, template] of clientPatterns) {
    const match = previous.match(pattern);
    if (!match?.[1]) continue;
    return previous.replace(match[0], template.replace("$SUBJECT", replacement));
  }

  return null;
}

function replaceTime(previous: string, current: string): string | null {
  const currentRange = current.match(
    /\b(?:from|between)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*(?:to|-|and)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/i
  )?.[0];
  if (currentRange) {
    const priorRange = /\b(?:from|between)\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*(?:to|-|and)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/i;
    return priorRange.test(previous)
      ? previous.replace(priorRange, currentRange)
      : previous.replace(/[?.!]+$/g, "") + " " + currentRange;
  }

  const currentAt = current.match(
    /\bat\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/i
  )?.[0];
  if (currentAt) {
    const priorAt = /\bat\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/i;
    return priorAt.test(previous)
      ? previous.replace(priorAt, currentAt)
      : previous.replace(/[?.!]+$/g, "") + " " + currentAt;
  }

  return null;
}

export function expandNativeFollowUp(
  message: string,
  history: SchedulerAiHistoryMessage[]
): string {
  const current = message.trim();
  const previous = lastUserMessage(history);
  if (!current || !previous) return message;

  if (
    /^(?:what\s+about|same\s+(?:thing\s+)?(?:for)?|and)\s+(?:today|tomorrow|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\??$/i.test(
      current
    )
  ) {
    return previous.replace(/[?.!]+$/g, "") + ". " + current;
  }

  const sameFor = current.match(
    /^(?:same(?:\s+thing)?\s+for|what\s+about)\s+(.+?)[?.!]*$/i
  );
  if (sameFor?.[1]) {
    const candidate = cleanEntity(sameFor[1]);
    if (
      !/^(?:today|tomorrow|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i.test(
        candidate
      )
    ) {
      return replaceSubject(previous, candidate) || message;
    }
  }

  if (/^(?:and\s+)?(?:at|from|between)\b/i.test(current)) {
    return replaceTime(previous, current) || message;
  }

  return message;
}
