/** Distinguish commands from questions that merely mention a schedule/action. */
export function isSchedulerActionRequest(message: string): boolean {
  if (/^\s*(?:please\s+)?(?:review|check|inspect|report|summari[sz]e|analy[sz]e|show|list|tell|compare|explain|which|what|who|when|where|why|how|help|recommend|suggest)\b/i.test(message)) return false;
  if (/\b(?:how to|why|what does|is it possible|what if)\b/i.test(message)) return false;
  return /\b(?:generate|regenerate|create|make|build|save|update|change|edit|delete|remove|archive|apply|replace|move|swap|repair|fix|add|assign|copy|import)\b/i.test(message) ||
    /^\s*(?:please\s+)?schedule\b(?!\s+(?:for|on|status|coverage|health)\b)/i.test(message);
}

/** Only an explicit action or a reply to a pending action exposes edit tools. */
export function hasSchedulerActionIntent(message:string,history:Array<{role:string;text:string}>=[]):boolean {
  if(isSchedulerActionRequest(message))return true;
  const pending=history.at(-1);
  const previousRequest=[...history].reverse().find(item=>item.role==="user");
  return !!pending&&pending.role==="assistant"&&/\?/.test(pending.text)&&
    !!previousRequest&&isSchedulerActionRequest(previousRequest.text)&&
    /^\s*(?:yes|yep|yeah|sure|okay|ok|proceed|confirm|go ahead|do it|at\s+\d|\d{1,2}(?::\d{2})?\s*(?:am|pm)|today|tomorrow)\b/i.test(message);
}

/** Small website replies do not need a quota-consuming provider call. */
export function localSchedulerChatReply(message:string):string|null {
  if(/^\s*(?:hi|hello|hey|good morning|good afternoon|good evening|can we (?:just )?chat|can i (?:just )?(?:chat|talk)(?: with you)?)[!?.\s]*$/i.test(message))
    return "Hi! You can ask me questions about this scheduling website without making any changes. What would you like to know?";
  if(/^\s*(?:thanks|thank you|thankyou|thank you so much)[!?.\s]*$/i.test(message))return "You're welcome. You can keep asking about the schedule or the website.";
  return null;
}
