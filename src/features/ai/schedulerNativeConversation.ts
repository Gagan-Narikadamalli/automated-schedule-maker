import type { NativeSchedulerPlan } from "./schedulerNativeAi";

export type NativePendingSnapshot = {
  date?: string;
  intent: string;
  toolName: string;
  input: Record<string, unknown>;
  stage: "USER_CONFIRMATION" | "OVERRIDE_CONFIRMATION";
};

export function isNativeConfirmation(message: string): boolean {
  const value = message
    .trim()
    .toLowerCase()
    .replace(/[,.!?]+/g, "")
    .replace(/\s+/g, " ");
  return /^(yes|y|yeah|yep|sure|ok|okay|confirm|confirmed|proceed|go ahead|do it|apply it|yes please|please proceed|yes proceed|yes do it|approve|approved|override|yes override|allow override)$/.test(
    value
  );
}

export function isNativeCancellation(message: string): boolean {
  const value = message.trim().toLowerCase();
  return /^(no|nope|cancel|stop|never mind|nevermind|do not|don't|dont|do not proceed|don't proceed|cancel that|ignore that)[.!?]*$/.test(
    value
  );
}

function firstClock(message: string): string | null {
  const match = message.match(
    /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i
  );
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || "0");
  const suffix = match[3].toLowerCase();
  if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;
  if (suffix === "pm" && hour !== 12) hour += 12;
  if (suffix === "am" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function reviseNativePendingAction(
  pending: NativePendingSnapshot,
  message: string
): NativePendingSnapshot | null {
  if (!/\b(?:instead|actually|change|make it|use|not that|rather)\b/i.test(message)) {
    return null;
  }

  const input = structuredClone(pending.input);
  const clock = firstClock(message);

  if (clock && pending.intent === "BREAK_EDIT") {
    const changes = Array.isArray(input.changes)
      ? (input.changes as Array<Record<string, unknown>>)
      : [];
    if (changes.length === 1) {
      changes[0] = { ...changes[0], startTime: clock };
      input.changes = changes;
      return { ...pending, input, stage: "USER_CONFIRMATION" };
    }
  }

  if (clock && pending.intent === "CALL_OUT") {
    input.startTime = clock;
    return { ...pending, input, stage: "USER_CONFIRMATION" };
  }

  return null;
}

export function nativePlanNeedsConfirmation(plan: NativeSchedulerPlan): boolean {
  if (plan.intent === "TEMPLATE") {
    return plan.input.action !== "LIST";
  }
  return [
    "GENERATE",
    "REPAIR",
    "CALL_OUT",
    "BREAK_EDIT",
    "BULK_REPLACE",
    "STAFF_MANAGEMENT",
    "CLIENT_MANAGEMENT",
    "TEAM_MANAGEMENT",
    "EVENT_MANAGEMENT",
    "ATTENDANCE",
    "RULES",
    "SUPERVISION",
    "UNPLACED_PLACE",
  ].includes(plan.intent);
}

export function describeNativePendingAction(
  plan: Pick<NativeSchedulerPlan, "intent" | "input" | "explanation">,
  date: string
): string {
  const input = plan.input as Record<string, any>;

  if (plan.intent === "GENERATE") {
    return input.scope === "WORK_WEEK"
      ? `Generate the Monday-Friday work-week schedule containing ${date}.`
      : `Generate the schedule for ${date}.`;
  }

  if (plan.intent === "REPAIR") {
    return `Run Minimal Fix on ${date}, prioritizing Unplaced/coverage and required breaks while keeping existing valid work when possible.`;
  }

  if (plan.intent === "CALL_OUT") {
    const action = input.action === "REMOVE" ? "Remove the call-out for" : "Record a call-out for";
    const range =
      input.startTime || input.endTime
        ? ` (${input.startTime || "08:00"}-${input.endTime || "20:00"})`
        : "";
    return `${action} ${input.staff} on ${date}${range}.`;
  }

  if (plan.intent === "BREAK_EDIT") {
    const change = Array.isArray(input.changes) ? input.changes[0] : null;
    if (change) {
      return change.action === "CLEAR"
        ? `Remove ${change.staff}'s break at ${change.startTime} on ${date}.`
        : `Set ${change.staff}'s break at ${change.startTime} on ${date}.`;
    }
  }

  if (plan.intent === "BULK_REPLACE") {
    const range =
      input.startTime || input.endTime
        ? ` from ${input.startTime || "start"} to ${input.endTime || "end"}`
        : "";
    return `Replace ${input.entityType?.toLowerCase() || "schedule"} ${input.source} with ${input.replacement} on ${date}${range}.`;
  }

  if (plan.intent === "TEMPLATE") {
    if (input.action === "CREATE") {
      return `Create schedule template ${input.name} from ${input.sourceDate || date}.`;
    }
    if (input.action === "ARCHIVE") {
      return `Archive schedule template ${input.template}.`;
    }
    return `Apply schedule template ${input.template} to ${date}.`;
  }

  if (plan.intent === "STAFF_MANAGEMENT") {
    if (input.action === "CREATE") {
      return `Create staff profile ${input.fullName} as ${input.role} (${input.employeeType}) starting ${input.startDate}.`;
    }
    if (input.action === "ARCHIVE") return `Archive staff profile ${input.staff}.`;
    return `Update staff profile ${input.staff}: ${JSON.stringify(input)}.`;
  }

  if (plan.intent === "CLIENT_MANAGEMENT") {
    if (input.action === "CREATE") {
      return `Create client profile ${input.fullName} with display code ${input.displayCode}, starting ${input.startDate}.`;
    }
    if (input.action === "ARCHIVE") return `Archive client profile ${input.client}.`;
    return `Update client profile ${input.client}: ${JSON.stringify(input)}.`;
  }

  if (plan.intent === "TEAM_MANAGEMENT") {
    if (input.action === "CREATE") return `Create team ${input.name}.`;
    if (input.action === "ARCHIVE") return `Archive team ${input.team}.`;
    return `Update team ${input.team}: ${JSON.stringify(input)}.`;
  }

  if (plan.intent === "EVENT_MANAGEMENT") {
    return `${input.action === "ADD" ? "Add" : "Remove"} ${String(
      input.eventType || "scheduler"
    ).toLowerCase()} event for ${input.client} on ${input.date || date}${
      input.startTime ? ` from ${input.startTime}` : ""
    }${input.endTime ? ` to ${input.endTime}` : ""}.`;
  }

  if (plan.intent === "ATTENDANCE") {
    return `${input.action === "REMOVE" ? "Remove" : "Record"} client attendance change for ${input.client} on ${date}${
      input.changeType ? ` (${input.changeType})` : ""
    }.`;
  }

  if (plan.intent === "RULES") {
    return `Update scheduler rules: ${JSON.stringify(input)}.`;
  }

  if (plan.intent === "SUPERVISION") {
    return `Save supervision for ${input.staff}: ${input.serviceHours} service hours and ${input.supervisionHours} supervision hours for ${input.month || date.slice(0, 7)}.`;
  }

  if (plan.intent === "UNPLACED_PLACE") {
    return `Place unplaced client ${input.client} with ${input.staff} at ${input.startTime} on ${date}.`;
  }

  return plan.explanation;
}

export function applyNativeOverrideApproval(
  pending: NativePendingSnapshot,
  previousOutput: Record<string, unknown>
): NativePendingSnapshot {
  const input = { ...pending.input };

  if (
    previousOutput.requiresLockedOverride === true ||
    previousOutput.confirmationType === "LOCKED_OR_MANUAL"
  ) {
    input.allowLockedOverride = true;
  }
  if (
    previousOutput.requiresRuleOverride === true ||
    previousOutput.confirmationType === "RULE_CONFLICT"
  ) {
    input.allowRuleOverride = true;
  }
  if (
    previousOutput.requiresOccupiedReplacementConfirmation === true ||
    previousOutput.confirmationType === "OCCUPIED_TARGET"
  ) {
    input.allowOccupiedReplacement = true;
  }

  return {
    ...pending,
    input,
    stage: "OVERRIDE_CONFIRMATION",
  };
}
