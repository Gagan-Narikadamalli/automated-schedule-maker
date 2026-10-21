/** Distinguish commands from questions that merely mention a schedule/action. */
export function isSchedulerActionRequest(message: string): boolean {
  if (/^\s*(?:please\s+)?(?:review|check|inspect|report|summari[sz]e|analy[sz]e|show|list|tell|compare|explain|which|what|who|when|where|why|how|help|recommend|suggest)\b/i.test(message)) return false;
  if (/\b(?:how to|why|what does|is it possible|what if)\b/i.test(message)) return false;
  return /\b(?:generate|regenerate|create|make|build|save|update|change|edit|delete|remove|archive|apply|replace|move|swap|repair|fix|add|assign|copy|import)\b/i.test(message) ||
    /^\s*(?:please\s+)?schedule\b(?!\s+(?:for|on|status|coverage|health)\b)/i.test(message);
}


/** A direct whole-day generation command (not a question about generation). */
export function isExplicitDayGenerationCommand(message: string): boolean {
  if (!isSchedulerActionRequest(message)) return false;
  if (/\b(?:week|weekly|month|monthly)\b/i.test(message)) return false;
  return /\b(?:generate|regenerate|rebuild)\b[^\n]{0,100}\b(?:schedule|day)\b/i.test(message);
}

/**
 * Consent is only inferred from an affirmative immediately following an exact
 * protected-schedule regeneration question for this same date. No generic
 * "yes" ever bypasses locked cells.
 */
export function isProtectedDayGenerationApproval(
  message: string,
  history: Array<{role:string;text:string}>,
  date: string
): boolean {
  if (!/^(?:yes|yes please|yes override|yes proceed|go ahead|proceed|allow it|i approve(?: the override)?)\s*[.!]?$/i.test(message.trim())) return false;
  const previous = history.at(-1);
  if (previous?.role !== "assistant") return false;
  return previous.text.includes(date) &&
    /protected assignments/i.test(previous.text) &&
    /do you allow me to override/i.test(previous.text) &&
    /rebuild/i.test(previous.text);
}
