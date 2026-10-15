/** Distinguish commands from questions that merely mention a schedule/action. */
export function isSchedulerActionRequest(message: string): boolean {
  if (/^\s*(?:please\s+)?(?:review|check|inspect|report|summari[sz]e|analy[sz]e|show|list|tell|compare|explain|which|what|who|when|where|why|how|help|recommend|suggest)\b/i.test(message)) return false;
  if (/\b(?:how to|why|what does|is it possible|what if)\b/i.test(message)) return false;
  return /\b(?:generate|regenerate|create|make|build|save|update|change|edit|delete|remove|archive|apply|replace|move|swap|repair|fix|add|assign|copy|import)\b/i.test(message) ||
    /^\s*(?:please\s+)?schedule\b(?!\s+(?:for|on|status|coverage|health)\b)/i.test(message);
}
