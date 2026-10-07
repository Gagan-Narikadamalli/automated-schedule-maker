export const SCHEDULER_CLOSING_QUESTION =
  "Is there anything else you'd like me to do?";

export function normalizeSchedulerShortReply(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[,.!?]+$/g, "")
    .replace(/\s+/g, " ");
}

export function isSchedulerConversationEndReply(value: string): boolean {
  const normalized = normalizeSchedulerShortReply(value);
  return /^(no|nope|nah|no thanks|no thank you|nothing else|that's all|thats all|all done|done|i'm done|im done|that is all|finished|we're done|were done)$/.test(
    normalized
  );
}

export function assistantInvitedMoreSchedulerWork(text: string): boolean {
  return /is there anything else (you('|’)d|you would) like (?:me to do|help with)\??/i.test(
    text
  );
}

export function schedulerAnswerNeedsFollowUp(reply: string): boolean {
  const normalized = reply.trim().toLowerCase();
  if (!normalized) return true;
  if (normalized.endsWith("?")) return true;
  return (
    normalized.includes("please explain or elaborate") ||
    normalized.includes("please clarify") ||
    normalized.includes("which day") ||
    normalized.includes("what date") ||
    normalized.includes("would you like me to generate") ||
    normalized.includes("would you like to proceed") ||
    normalized.includes("still want to proceed") ||
    normalized.includes("want me to proceed") ||
    normalized.includes("do you allow me to override") ||
    normalized.includes("reply \"yes\"") ||
    normalized.includes("reply 'yes'") ||
    normalized.includes("reply yes") ||
    normalized.includes("confirm again") ||
    normalized.includes("i need a few required details") ||
    normalized.includes("i need the following required") ||
    normalized.includes("i just need") ||
    normalized.includes("i need two more") ||
    normalized.includes("please provide") ||
    normalized.includes("please send") ||
    normalized.includes("before i can create") ||
    normalized.includes("before i can update") ||
    normalized.includes("before i can continue") ||
    normalized.includes("which person do you mean") ||
    normalized.includes("which client do you mean") ||
    normalized.includes("which staff member do you mean")
  );
}

export function ensureSchedulerConversationClosing(reply: string): string {
  const genericClosing =
    /\n*is there anything else (you('|’)d|you would) like (?:me to do|help with)\??\s*$/i;
  const withoutGenericClosing = reply.replace(genericClosing, "").trim();

  if (schedulerAnswerNeedsFollowUp(withoutGenericClosing)) {
    return withoutGenericClosing;
  }

  if (assistantInvitedMoreSchedulerWork(reply)) {
    return reply;
  }

  return `${withoutGenericClosing}\n\n${SCHEDULER_CLOSING_QUESTION}`;
}
