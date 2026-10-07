import { expandNativeClarificationFollowUp } from "./schedulerNativeClarification";
import type { SchedulerAiHistoryMessage } from "./types";

function lastUserMessage(history: SchedulerAiHistoryMessage[]): string {
  return [...history].reverse().find((entry) => entry.role === "user")?.text.trim() || "";
}

function lastAssistantMessage(history: SchedulerAiHistoryMessage[]): string {
  return (
    [...history]
      .reverse()
      .find((entry) => entry.role === "assistant")
      ?.text.trim() || ""
  );
}

function normalizeProfileDetailReply(value: string): string {
  return value
    .replace(/\bfull[- _0]*time\b/gi, "full-time")
    .replace(/\bpart[- _0]*time\b/gi, "part-time")
    .replace(/\boffice[- _]*manager\b/gi, "office manager")
    .replace(/\s+/g, " ")
    .trim();
}

function staffCreationContinuation(
  current: string,
  previousUser: string,
  previousAssistant: string
): string | null {
  if (
    !/creating a staff member requires the full name, role/i.test(
      previousAssistant
    ) ||
    !/\b(?:create|add)\s+(?:a\s+)?(?:new\s+)?staff(?:\s+member)?\b/i.test(
      previousUser
    )
  ) {
    return null;
  }

  const normalized = normalizeProfileDetailReply(current);
  const role =
    normalized.match(
      /\b(office manager|rbt|bt|intern|bcba|other)\b/i
    )?.[1] || "";
  const employeeType =
    normalized.match(/\b(full-time|part-time)\b/i)?.[1] || "";
  const date =
    normalized.match(
      /\b(20\d{2}-\d{2}-\d{2}|today|tomorrow|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i
    )?.[1] || "";

  const originalName =
    previousUser.match(
      /\bstaff(?:\s+member)?(?:\s+named)?\s+(.+?)(?=\s+(?:as\s+)?(?:office\s+manager|rbt|bt|intern|bcba|other)\b|\s+(?:full[- ]?time|part[- ]?time)\b|\s+(?:starting|start\s+date|from)\b|[,.!?]|$)/i
    )?.[1] || "";

  const detailParts = normalized
    .split(/[,;]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  const nameParts = detailParts.filter(
    (part) =>
      !/^(?:office manager|rbt|bt|intern|bcba|other)$/i.test(part) &&
      !/^(?:full-time|part-time)$/i.test(part) &&
      !/^(?:20\d{2}-\d{2}-\d{2}|today|tomorrow|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i.test(
        part
      )
  );

  let fullName = cleanEntity(nameParts.join(" "));
  if (!fullName || /^named?\b/i.test(fullName)) {
    fullName = cleanEntity(originalName.replace(/^named?\s+/i, ""));
  }

  // If the reply includes a fuller version of the originally supplied name,
  // prefer it (e.g. "anias" -> "anias regias").
  const originalClean = cleanEntity(
    originalName.replace(/^named?\s+/i, "")
  );
  if (
    fullName &&
    originalClean &&
    fullName.toLowerCase() === originalClean.toLowerCase()
  ) {
    fullName = originalClean;
  }

  if (!fullName || !role || !employeeType || !date) return null;

  return `create a new staff member ${fullName} as ${role} ${employeeType} starting ${date}`;
}

function clientCreationContinuation(
  current: string,
  previousUser: string,
  previousAssistant: string
): string | null {
  if (
    !/creating a client requires the full name, display code, and start date/i.test(
      previousAssistant
    ) ||
    !/\b(?:create|add)\s+(?:a\s+)?(?:new\s+)?client\b/i.test(
      previousUser
    )
  ) {
    return null;
  }

  const normalized = normalizeProfileDetailReply(current);
  const parts = normalized
    .split(/[,;]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const date =
    parts.find((part) =>
      /^(?:20\d{2}-\d{2}-\d{2}|today|tomorrow|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i.test(
        part
      )
    ) || "";

  const nonDate = parts.filter((part) => part !== date);
  if (nonDate.length < 2 || !date) return null;
  const displayCode = nonDate[nonDate.length - 1];
  const fullName = nonDate.slice(0, -1).join(" ").trim();
  if (!fullName || !displayCode) return null;

  return `create a new client ${fullName} with display code ${displayCode} starting ${date}`;
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
  const previousAssistant = lastAssistantMessage(history);
  if (!current || !previous) return message;

  const clarificationContinuation = expandNativeClarificationFollowUp(
    current,
    history
  );
  if (clarificationContinuation) return clarificationContinuation;

  const staffContinuation = staffCreationContinuation(
    current,
    previous,
    previousAssistant
  );
  if (staffContinuation) return staffContinuation;

  const clientContinuation = clientCreationContinuation(
    current,
    previous,
    previousAssistant
  );
  if (clientContinuation) return clientContinuation;

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
