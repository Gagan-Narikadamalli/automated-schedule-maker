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

function revisionTimeRange(
  message: string
): { startTime: string; endTime: string } | null {
  const normalized = message.match(/\((\d{2}:\d{2})-(\d{2}:\d{2})\)/);
  if (normalized) {
    return { startTime: normalized[1], endTime: normalized[2] };
  }

  const matches = Array.from(
    message.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/gi)
  );
  if (matches.length < 2) return null;

  const toTime = (match: RegExpMatchArray): string | null => {
    let hour = Number(match[1]);
    const minute = Number(match[2] || "0");
    const suffix = match[3].toLowerCase();
    if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;
    if (suffix === "pm" && hour !== 12) hour += 12;
    if (suffix === "am" && hour === 12) hour = 0;
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  };

  const startTime = toTime(matches[0]);
  const endTime = toTime(matches[1]);
  return startTime && endTime ? { startTime, endTime } : null;
}

export function reviseNativePendingAction(
  pending: NativePendingSnapshot,
  message: string,
  resolvedDate?: string
): NativePendingSnapshot | null {
  const revisionLanguage =
    /\b(?:instead|actually|change|make it|use|not that|rather|do it|move it|same)\b/i.test(
      message
    );
  const dateOnlyRevision =
    /^(?:today|tomorrow|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:\s+instead)?[?.!]*$/i.test(
      message.trim()
    );

  if (!revisionLanguage && !dateOnlyRevision) {
    return null;
  }

  const input = structuredClone(pending.input);
  const clock = firstClock(message);
  const range = revisionTimeRange(message);
  let changed = false;
  let nextDate = pending.date;

  const dateBoundIntent =
    [
      "GENERATE",
      "REPAIR",
      "CALL_OUT",
      "BREAK_EDIT",
      "BULK_REPLACE",
      "ATTENDANCE",
      "UNPLACED_PLACE",
      "COPY_DAY",
    ].includes(pending.intent) ||
    (pending.intent === "TEMPLATE" && input.action === "APPLY") ||
    (pending.intent === "EVENT_MANAGEMENT" && !input.seriesEndDate);

  if (
    resolvedDate &&
    pending.date &&
    resolvedDate !== pending.date &&
    dateBoundIntent
  ) {
    nextDate = resolvedDate;
    if (pending.intent === "EVENT_MANAGEMENT" && input.date) {
      input.date = resolvedDate;
    }
    changed = true;
  }

  if (range) {
    if (pending.intent === "BREAK_EDIT") {
      const changes = Array.isArray(input.changes)
        ? (input.changes as Array<Record<string, unknown>>)
        : [];
      if (changes.length === 1) {
        changes[0] = { ...changes[0], startTime: range.startTime };
        input.changes = changes;
        changed = true;
      }
    } else if (
      ["CALL_OUT", "BULK_REPLACE", "EVENT_MANAGEMENT", "ATTENDANCE"].includes(
        pending.intent
      )
    ) {
      input.startTime = range.startTime;
      input.endTime = range.endTime;
      changed = true;
    } else if (pending.intent === "UNPLACED_PLACE") {
      input.startTime = range.startTime;
      changed = true;
    }
  } else if (clock && pending.intent === "BREAK_EDIT") {
    const changes = Array.isArray(input.changes)
      ? (input.changes as Array<Record<string, unknown>>)
      : [];
    if (changes.length === 1) {
      changes[0] = { ...changes[0], startTime: clock };
      input.changes = changes;
      changed = true;
    }
  } else if (clock && pending.intent === "CALL_OUT") {
    input.startTime = clock;
    changed = true;
  }

  return changed
    ? {
        ...pending,
        ...(nextDate ? { date: nextDate } : {}),
        input,
        stage: "USER_CONFIRMATION",
      }
    : null;
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
    "COPY_DAY",
  ].includes(plan.intent);
}

export function formatNativeDateLabel(date: string): string {
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? new Date(`${date}T12:00:00Z`)
    : null;
  if (!parsed || Number.isNaN(parsed.getTime())) return date;

  const readable = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(parsed);

  return `${readable} (${date})`;
}

export function describeNativePendingAction(
  plan: Pick<NativeSchedulerPlan, "intent" | "input" | "explanation">,
  date: string
): string {
  const input = plan.input as Record<string, any>;
  const dateLabel = formatNativeDateLabel(date);

  if (plan.intent === "GENERATE") {
    return input.scope === "WORK_WEEK"
      ? `Generate the Monday-Friday work-week schedule containing ${dateLabel}.`
      : `Generate the schedule for ${dateLabel}.`;
  }

  if (plan.intent === "REPAIR") {
    return `Run Minimal Fix on ${dateLabel}, prioritizing Unplaced/coverage and required breaks while keeping existing valid work when possible.`;
  }

  if (plan.intent === "CALL_OUT") {
    const action = input.action === "REMOVE" ? "Remove the call-out for" : "Record a call-out for";
    const range =
      input.startTime || input.endTime
        ? ` (${input.startTime || "08:00"}-${input.endTime || "20:00"})`
        : "";
    return `${action} ${input.staff} on ${dateLabel}${range}.`;
  }

  if (plan.intent === "BREAK_EDIT") {
    const change = Array.isArray(input.changes) ? input.changes[0] : null;
    if (change) {
      return change.action === "CLEAR"
        ? `Remove ${change.staff}'s break at ${change.startTime} on ${dateLabel}.`
        : `Set ${change.staff}'s break at ${change.startTime} on ${dateLabel}.`;
    }
  }

  if (plan.intent === "BULK_REPLACE") {
    const range =
      input.startTime || input.endTime
        ? ` from ${input.startTime || "start"} to ${input.endTime || "end"}`
        : "";
    if (input.entityType === "STAFF" && input.client) {
      return `Move client ${input.client} from ${input.source} to ${input.replacement} on ${dateLabel}${range}.`;
    }
    return `Replace ${input.entityType?.toLowerCase() || "schedule"} ${input.source} with ${input.replacement} on ${dateLabel}${range}.`;
  }

  if (plan.intent === "TEMPLATE") {
    if (input.action === "CREATE") {
      return `Create schedule template ${input.name} from ${input.sourceDate || date}.`;
    }
    if (input.action === "ARCHIVE") {
      return `Archive schedule template ${input.template}.`;
    }
    return `Apply schedule template ${input.template} to ${dateLabel}.`;
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
    ).toLowerCase()} event for ${input.client} on ${input.date ? formatNativeDateLabel(String(input.date)) : dateLabel}${
      input.startTime ? ` from ${input.startTime}` : ""
    }${input.endTime ? ` to ${input.endTime}` : ""}.`;
  }

  if (plan.intent === "ATTENDANCE") {
    return `${input.action === "REMOVE" ? "Remove" : "Record"} client attendance change for ${input.client} on ${dateLabel}${
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
    return `Place unplaced client ${input.client} with ${input.staff} at ${input.startTime} on ${dateLabel}.`;
  }

  if (plan.intent === "COPY_DAY") {
    return `Copy the saved schedule from ${input.sourceDate} into ${dateLabel} and revalidate it against that date's current staff/client constraints.`;
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
