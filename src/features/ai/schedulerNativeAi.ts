import { connectToDatabase } from "@/lib/db";
import { NativeAiPendingAction } from "@/models/NativeAiPendingAction";

import {
  applyNativeOverrideApproval,
  describeNativePendingAction,
  isNativeCancellation,
  isNativeConfirmation,
  nativePlanNeedsConfirmation,
  reviseNativePendingAction,
  type NativePendingSnapshot,
} from "./schedulerNativeConversation";
import { buildNativeHistoricalKnowledge } from "./schedulerNativeKnowledge";
import { expandNativeFollowUp } from "./schedulerNativeFollowUp";
import { planNativeManagementAction } from "./schedulerNativeManagement";
import type { SchedulerAiHistoryMessage } from "./types";

export type SchedulerAiProviderMode = "gateway" | "native";

export type NativeSchedulerIntent =
  | "GENERATE"
  | "REPAIR"
  | "CALL_OUT"
  | "BREAK_EDIT"
  | "BULK_REPLACE"
  | "TEMPLATE"
  | "UNPLACED"
  | "HEALTH"
  | "FREE_STAFF"
  | "STAFF_LOOKUP"
  | "CLIENT_LOOKUP"
  | "STAFF_SUMMARY"
  | "CLIENT_SUMMARY"
  | "HISTORICAL"
  | "CONFIGURATION"
  | "STAFF_MANAGEMENT"
  | "CLIENT_MANAGEMENT"
  | "TEAM_MANAGEMENT"
  | "EVENT_MANAGEMENT"
  | "ATTENDANCE"
  | "RULES"
  | "SUPERVISION"
  | "UNPLACED_PLACE"
  | "CLARIFICATION"
  | "DAY_SUMMARY";

export type NativeSchedulerPlan = {
  intent: NativeSchedulerIntent;
  toolName: string;
  input: Record<string, unknown>;
  confidence: number;
  explanation: string;
};

export type NativeSchedulerAgentResult = {
  text: string;
  steps: Array<{
    toolCalls: Array<{ toolName: string; input: Record<string, unknown> }>;
    toolResults: Array<{
      toolName: string;
      input: Record<string, unknown>;
      output: unknown;
    }>;
  }>;
};

type ExecutableTool = {
  execute?: (input: any, options?: any) => unknown | Promise<unknown>;
};

const MAX_RESPONSE_ITEMS = 30;

export function resolveSchedulerAiProvider(
  raw = process.env.SCHEDULER_AI_PROVIDER
): SchedulerAiProviderMode {
  return raw?.trim().toLowerCase() === "native" ? "native" : "gateway";
}

function visibleMessage(value: string): string {
  return value.split(/\n\n\[SCHEDULER TIME NORMALIZATION:/i)[0].trim();
}

function cleanEntity(value: string): string {
  return value
    .replace(/[?!.,]+$/g, "")
    .replace(/\s+(?:today|tomorrow|yesterday|this\s+(?:day|week)|next\s+week)$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeClock(
  hourText: string,
  minuteText?: string,
  meridiem?: string
): string | null {
  let hour = Number(hourText);
  const minute = Number(minuteText || "0");
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  const suffix = meridiem?.toLowerCase();
  if (suffix) {
    if (hour < 1 || hour > 12) return null;
    if (suffix === "pm" && hour !== 12) hour += 12;
    if (suffix === "am" && hour === 12) hour = 0;
  } else if (hour < 0 || hour > 23) {
    return null;
  }

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function extractNativeTimeRange(message: string): {
  startTime?: string;
  endTime?: string;
} {
  const normalized = message.match(
    /SCHEDULER TIME NORMALIZATION:[\s\S]*?\((\d{2}:\d{2})-(\d{2}:\d{2})\)/i
  );
  if (normalized) {
    return { startTime: normalized[1], endTime: normalized[2] };
  }

  const raw = visibleMessage(message);
  const range = raw.match(
    /\b(?:from|between)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:to|-|and)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i
  );
  if (range) {
    const startSuffix = range[3] || range[6];
    const endSuffix = range[6] || range[3];
    const startTime = normalizeClock(range[1], range[2], startSuffix);
    const endTime = normalizeClock(range[4], range[5], endSuffix);
    if (startTime && endTime) return { startTime, endTime };
  }

  const at = raw.match(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (at) {
    const startTime = normalizeClock(at[1], at[2], at[3]);
    if (startTime) return { startTime };
  }

  return {};
}

function firstEntity(message: string, patterns: RegExp[]): string | null {
  const raw = visibleMessage(message);
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match?.[1]) return cleanEntity(match[1]);
  }
  return null;
}

function extractCallOutStaff(message: string): string | null {
  return firstEntity(message, [
    /^(.+?)\s+(?:called\s+out|called\s+off|is\s+absent|is\s+out)\b/i,
    /\bcall[- ]?out\s+(?:for\s+)?(.+?)(?=\s+(?:from|between|at|today|tomorrow|on)\b|[?.!,]|$)/i,
    /\bmark\s+(.+?)\s+(?:as\s+)?(?:absent|called\s+out)\b/i,
  ]);
}

function extractBreakStaff(message: string): string | null {
  return firstEntity(message, [
    /\b(?:give|add|set|schedule)\s+(.+?)\s+(?:a\s+)?break\s+(?:at|from)\b/i,
    /\b(?:give|add|set|schedule)\s+(?:a\s+)?break\s+(?:for\s+)?(.+?)\s+(?:at|from)\b/i,
    /\b(?:remove|delete|clear)\s+(.+?)(?:'s)?\s+break\s+(?:at|from)\b/i,
    /\b(?:remove|delete|clear)\s+(?:the\s+)?break\s+(?:for\s+)?(.+?)\s+(?:at|from)\b/i,
  ]);
}

function extractStaffLookup(message: string): string | null {
  return firstEntity(message, [
    /\bwho\s+is\s+(.+?)\s+with\b/i,
    /\bwhat\s+clients?\s+(?:does|is)\s+(.+?)(?:\s+(?:have|with|from|at|today|tomorrow)\b|[?.!,]|$)/i,
    /\bwhen\s+is\s+(.+?)\s+(?:on\s+)?break\b/i,
    /\b(?:show|what(?:'s|\s+is))\s+(.+?)'s\s+schedule\b/i,
    /\bschedule\s+for\s+(.+?)(?=\s+(?:from|between|at|today|tomorrow|on)\b|[?.!,]|$)/i,
  ]);
}

function extractClientLookup(message: string): string | null {
  return firstEntity(message, [
    /\bwho\s+(?:is\s+)?(?:covering|with)\s+(.+?)(?=\s+(?:at|from|between|today|tomorrow|on)\b|[?.!,]|$)/i,
    /\bcoverage\s+(?:for|of)\s+(.+?)(?=\s+(?:at|from|between|today|tomorrow|on)\b|[?.!,]|$)/i,
    /\bclient\s+(?:code\s+)?([A-Z][A-Za-z0-9_-]{1,8})\b/,
  ]);
}

function extractReplacement(message: string): {
  source: string;
  replacement: string;
  entityType: "STAFF" | "CLIENT";
} | null {
  const raw = visibleMessage(message);
  const match = raw.match(
    /\breplace\s+(?:all\s+)?(.+?)\s+(?:blocks?\s+)?with\s+(.+?)(?=\s+(?:from|between|at|today|tomorrow|on)\b|[?.!,]|$)/i
  );
  if (!match) return null;
  return {
    source: cleanEntity(match[1].replace(/^client\s+/i, "")),
    replacement: cleanEntity(match[2].replace(/^client\s+/i, "")),
    entityType: /\bclient\b/i.test(raw) ? "CLIENT" : "STAFF",
  };
}

function extractTemplateReference(message: string): string | null {
  return firstEntity(message, [
    /\b(?:use|apply)\s+(?:the\s+)?(?:schedule\s+)?template\s+["']?(.+?)["']?(?=\s+(?:for|on|today|tomorrow)\b|[?.!,]|$)/i,
  ]);
}

export function planNativeSchedulerAction(args: {
  message: string;
  history?: SchedulerAiHistoryMessage[];
  writeToolsEnabled?: boolean;
  date?: string;
}): NativeSchedulerPlan {
  const raw = visibleMessage(args.message);
  const times = extractNativeTimeRange(args.message);

  const managementPlan = planNativeManagementAction({
    message: args.message,
    date: args.date,
    times,
  });
  if (managementPlan) return managementPlan;

  if (/\b(?:list|show|what)\b[\s\S]*\btemplates?\b/i.test(raw)) {
    return {
      intent: "TEMPLATE",
      toolName: "manage_schedule_template",
      input: { action: "LIST" },
      confidence: 0.99,
      explanation: "List saved scheduler templates.",
    };
  }

  const templateReference = extractTemplateReference(args.message);
  if (templateReference) {
    return {
      intent: "TEMPLATE",
      toolName: "manage_schedule_template",
      input: { action: "APPLY", template: templateReference },
      confidence: 0.96,
      explanation: "Apply a named scheduler template.",
    };
  }

  const removeCallOut =
    /\b(?:remove|delete|clear|cancel)\b[\s\S]*\bcall[- ]?out\b/i.test(raw);
  const callOutStaff = extractCallOutStaff(args.message);
  if (callOutStaff || removeCallOut) {
    const staff =
      callOutStaff ||
      cleanEntity(
        raw
          .replace(/\b(?:remove|delete|clear|cancel)\b/gi, "")
          .replace(/\bcall[- ]?out\b/gi, "")
          .replace(/\bfor\b/gi, "")
      );
    return {
      intent: "CALL_OUT",
      toolName: "record_call_out",
      input: {
        action: removeCallOut ? "REMOVE" : "ADD",
        staff,
        ...(times.startTime ? { startTime: times.startTime } : {}),
        ...(times.endTime ? { endTime: times.endTime } : {}),
        ...(!removeCallOut
          ? { reason: "Call out", note: "Recorded by Native Scheduler AI" }
          : {}),
      },
      confidence: 0.98,
      explanation: "Record or remove a staff call-out through scheduler validation.",
    };
  }

  const replacement = extractReplacement(args.message);
  if (replacement) {
    return {
      intent: "BULK_REPLACE",
      toolName: "replace_schedule_blocks",
      input: {
        ...replacement,
        ...(times.startTime ? { startTime: times.startTime } : {}),
        ...(times.endTime ? { endTime: times.endTime } : {}),
        allowLockedOverride: false,
        allowRuleOverride: false,
        allowOccupiedReplacement: false,
      },
      confidence: 0.95,
      explanation: "Replace matching blocks without bypassing safety checks.",
    };
  }

  const breakStaff = extractBreakStaff(args.message);
  if (breakStaff && times.startTime) {
    const clearing = /\b(?:remove|delete|clear)\b/i.test(raw);
    return {
      intent: "BREAK_EDIT",
      toolName: "edit_schedule_cells",
      input: {
        changes: [
          clearing
            ? { action: "CLEAR", staff: breakStaff, startTime: times.startTime }
            : {
                action: "SET",
                staff: breakStaff,
                startTime: times.startTime,
                assignmentType: "BREAK",
                text: "Break",
              },
        ],
        allowLockedOverride: false,
        allowRuleOverride: false,
      },
      confidence: 0.97,
      explanation: "Edit the requested break without forcing an override.",
    };
  }

  if (
    /\b(?:minimal\s+fix|repair\s+(?:the\s+)?schedule|fix\s+(?:the\s+)?schedule|cover\s+(?:the\s+)?uncovered|make\s+sure\s+all\s+clients?\s+(?:are\s+)?covered)\b/i.test(
      raw
    )
  ) {
    return {
      intent: "REPAIR",
      toolName: "repair_schedule",
      input: {},
      confidence: 0.99,
      explanation: "Run deterministic Minimal Fix.",
    };
  }

  if (
    /\b(?:generate|regenerate|build|auto[- ]?generate|autofill|auto[- ]?fill|make)\b[\s\S]*\bschedule\b/i.test(
      raw
    )
  ) {
    return {
      intent: "GENERATE",
      toolName: "generate_schedule",
      input: {
        scope: /\b(?:work\s+week|week|monday\s*(?:-|to)\s*friday)\b/i.test(raw)
          ? "WORK_WEEK"
          : "DAY",
      },
      confidence: 0.98,
      explanation: "Generate the schedule using the deterministic engine.",
    };
  }

  if (/\b(?:unplaced|unassigned|still\s+needs?\s+schedul(?:e|ed|ing)|needs?\s+to\s+be\s+scheduled)\b/i.test(raw)) {
    return {
      intent: "UNPLACED",
      toolName: "get_unplaced_assignments",
      input: {},
      confidence: 0.98,
      explanation: "Inspect unresolved Unplaced work.",
    };
  }

  if (
    /\b(?:health|conflicts?|incomplete|missing\s+coverage|coverage\s+gaps?|validate|check\s+(?:the\s+)?schedule)\b/i.test(
      raw
    )
  ) {
    return {
      intent: "HEALTH",
      toolName: "check_schedule",
      input: {},
      confidence: 0.96,
      explanation: "Run the schedule health check.",
    };
  }

  if (
    /\b(?:today|tomorrow|yesterday|this\s+day|selected\s+day)(?:'s)?\s+schedule\b/i.test(
      raw
    )
  ) {
    return {
      intent: "DAY_SUMMARY",
      toolName: "get_day_schedule",
      input: {},
      confidence: 0.98,
      explanation: "Read the selected/resolved day's saved schedule.",
    };
  }

  if (/\b(?:who\s+is\s+free|who(?:'s|\s+is)\s+available|free\s+staff|available\s+staff)\b/i.test(raw)) {
    return {
      intent: "FREE_STAFF",
      toolName: "lookup_schedule",
      input: { ...times, includeBreaks: true, includeFreeStaff: true },
      confidence: 0.97,
      explanation: "Find staff who are available and unscheduled.",
    };
  }

  const staffName = extractStaffLookup(args.message);
  if (staffName) {
    return {
      intent: "STAFF_LOOKUP",
      toolName: "lookup_schedule",
      input: { staffName, ...times, includeBreaks: true },
      confidence: 0.94,
      explanation: "Look up the named staff member's schedule.",
    };
  }

  const clientCode = extractClientLookup(args.message);
  if (clientCode) {
    return {
      intent: "CLIENT_LOOKUP",
      toolName: "lookup_schedule",
      input: { clientCode, ...times, includeBreaks: true },
      confidence: 0.94,
      explanation: "Look up the named client's coverage.",
    };
  }

  if (
    /\b(?:historically|history|historical|normally|usually|typically|past|previous|last\s+year|pattern|patterns)\b/i.test(
      raw
    )
  ) {
    return {
      intent: "HISTORICAL",
      toolName: "__native_history__",
      input: {},
      confidence: 0.92,
      explanation:
        "Use the scheduler's own historical assignments, templates, and manager feedback as advisory memory.",
    };
  }

  if (/\b(?:breaks?|called\s+out|call[- ]?outs?|staff|employees?|technicians?|bts?)\b/i.test(raw)) {
    return {
      intent: "STAFF_SUMMARY",
      toolName: "get_staff",
      input: {},
      confidence: 0.84,
      explanation: "Read selected-day staff state.",
    };
  }

  if (/\b(?:clients?|nap|speech|support\s+level|attendance)\b/i.test(raw)) {
    return {
      intent: "CLIENT_SUMMARY",
      toolName: "get_clients",
      input: {},
      confidence: 0.84,
      explanation: "Read selected-day client requirements.",
    };
  }

  return {
    intent: "DAY_SUMMARY",
    toolName: "get_day_schedule",
    input: {},
    confidence: 0.68,
    explanation: "Use the live day schedule as the safest scheduler-only fallback.",
  };
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function summarizeSegments(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_RESPONSE_ITEMS).map((segment) => {
    const item = asRecord(segment);
    const label =
      item.clientCode ||
      (item.assignmentType === "BREAK"
        ? "Break"
        : item.assignmentType || "Assignment");
    const staff = item.staffName ? `${item.staffName} — ` : "";
    return `${staff}${label} ${item.startTime || "?"}-${item.endTime || "?"}`;
  });
}

function summarizeNativeToolResult(
  plan: NativeSchedulerPlan,
  outputValue: unknown,
  date: string
): string {
  const output = asRecord(outputValue);

  if (output.requiresConfirmation || output.requiresClarification) {
    return String(
      output.message ||
        "The scheduler needs confirmation or clarification before this action can continue."
    );
  }
  if (output.ok === false || output.error) {
    return String(
      output.error ||
        output.message ||
        "The scheduler could not complete that action."
    );
  }

  if (
    [
      "GENERATE",
      "REPAIR",
      "CALL_OUT",
      "BREAK_EDIT",
      "BULK_REPLACE",
      "TEMPLATE",
      "STAFF_MANAGEMENT",
      "CLIENT_MANAGEMENT",
      "TEAM_MANAGEMENT",
      "EVENT_MANAGEMENT",
      "ATTENDANCE",
      "RULES",
      "SUPERVISION",
      "UNPLACED_PLACE",
    ].includes(plan.intent)
  ) {
    if (typeof output.message === "string" && output.message.trim()) {
      return output.message.trim();
    }
    if (output.changed === true || output.ok === true) {
      return `The scheduler operation completed for ${date}.`;
    }
  }

  if (plan.intent === "UNPLACED") {
    const items = Array.isArray(output.unplacedAssignments)
      ? output.unplacedAssignments
      : [];
    if (!items.length) {
      return `There are no unresolved Unplaced assignments for ${date}.`;
    }
    const rows = items.slice(0, MAX_RESPONSE_ITEMS).map((value: unknown) => {
      const item = asRecord(value);
      return `${item.clientCode || item.displayText || "Client"} at ${
        item.originalStartTime || "unknown time"
      } — ${item.reason || "needs scheduling"}`;
    });
    return `Unplaced assignments for ${date} (${items.length}):\n${
      rows.map((row: string) => `- ${row}`).join("\n")
    }`;
  }

  if (plan.intent === "HEALTH") {
    if (output.scheduleAvailable === false) {
      return `The schedule for ${date} has not been generated yet.`;
    }
    const uncovered = Array.isArray(output.uncoveredRequirements)
      ? output.uncoveredRequirements
      : [];
    const breakProblems = Array.isArray(output.staffBreakProblems)
      ? output.staffBreakProblems
      : [];
    const lines = [
      `Coverage: ${output.coveredClientSlots ?? 0}/${
        output.requiredClientSlots ?? 0
      } required client blocks`,
      `Uncovered: ${output.uncoveredClientSlots ?? uncovered.length}`,
      `Unplaced: ${output.unplacedCount ?? 0}`,
      `Locked/manual blocks: ${output.lockedOrManualBlocks ?? 0}`,
    ];
    if (uncovered.length) {
      lines.push(
        `Missing coverage: ${
          uncovered
            .slice(0, 12)
            .map((value: unknown) => {
              const item = asRecord(value);
              return `${item.clientCode || "client"} ${item.startTime || ""}`.trim();
            })
            .join(", ")
        }`
      );
    }
    if (breakProblems.length) {
      lines.push(
        `Break issues: ${
          breakProblems
            .slice(0, 12)
            .map((value: unknown) => {
              const item = asRecord(value);
              return `${item.staffName || "staff"} (${
                item.issue || "break issue"
              })`;
            })
            .join(", ")
        }`
      );
    }
    return `Schedule health for ${date}:\n${
      lines.map((line) => `- ${line}`).join("\n")
    }`;
  }

  if (plan.intent === "FREE_STAFF") {
    if (output.scheduleAvailable === false) {
      return `The schedule for ${date} has not been generated yet, so I cannot reliably identify free staff from the live schedule.`;
    }
    const staff = Array.isArray(output.freeStaff) ? output.freeStaff : [];
    const entire = staff
      .map((value: unknown) => asRecord(value))
      .filter((item) => item.freeForEntireRequestedRange);
    if (entire.length) {
      return `Staff free for the entire requested range on ${date}: ${
        entire.map((item) => item.name).filter(Boolean).join(", ")
      }.`;
    }
    const partial = staff
      .map((value: unknown) => asRecord(value))
      .filter((item) => Array.isArray(item.freeSlots) && item.freeSlots.length)
      .slice(0, 15)
      .map((item) => `${item.name}: ${item.freeSlots.join(", ")}`);
    return partial.length
      ? `No staff member is free for the entire requested range. Partial availability:\n${
          partial.map((line) => `- ${line}`).join("\n")
        }`
      : `No free staff were found in the requested range on ${date}.`;
  }

  if (plan.intent === "STAFF_LOOKUP" || plan.intent === "CLIENT_LOOKUP") {
    if (output.needsClarification) {
      return String(
        output.message || "I need a more specific staff or client reference."
      );
    }
    if (output.scheduleAvailable === false) {
      return `The schedule for ${date} has not been generated yet.`;
    }
    const rows = summarizeSegments(output.segments);
    return rows.length
      ? `Schedule results for ${date}:\n${
          rows.map((row) => `- ${row}`).join("\n")
        }`
      : `I found no matching scheduled blocks for ${date}.`;
  }

  if (plan.intent === "CONFIGURATION") {
    const area = String(plan.input.area || "");
    if (area === "TEAMS") {
      const teams = Array.isArray(output.teams) ? output.teams : [];
      return teams.length
        ? `Active teams (${teams.length}): ${teams
            .slice(0, 30)
            .map((value: unknown) => asRecord(value).name)
            .filter(Boolean)
            .join(", ")}.`
        : "No active teams were found.";
    }
    if (area === "PEOPLE") {
      const staff = Array.isArray(output.staff) ? output.staff : [];
      const clients = Array.isArray(output.clients) ? output.clients : [];
      const staffNames = staff
        .slice(0, 25)
        .map((value: unknown) => asRecord(value).fullName)
        .filter(Boolean);
      const clientCodes = clients
        .slice(0, 30)
        .map((value: unknown) => asRecord(value).displayCode)
        .filter(Boolean);
      return [
        `Active staff: ${staff.length}${staffNames.length ? ` — ${staffNames.join(", ")}` : ""}`,
        `Active clients: ${clients.length}${clientCodes.length ? ` — ${clientCodes.join(", ")}` : ""}`,
      ].join("\n");
    }
    if (area === "EVENTS") {
      const naps = Array.isArray(output.napSessions) ? output.napSessions : [];
      const speech = Array.isArray(output.speechSessions) ? output.speechSessions : [];
      return `Selected-day scheduler events: ${naps.length} nap session(s), ${speech.length} speech session(s).`;
    }
    const safe = { ...output };
    delete safe.ok;
    delete safe.status;
    return `${area || "Scheduler"} configuration:\n${JSON.stringify(safe, null, 2).slice(0, 5000)}`;
  }

  if (plan.intent === "STAFF_SUMMARY") {
    const staff = Array.isArray(output.staff) ? output.staff : [];
    const calledOut = staff
      .map((value: unknown) => asRecord(value))
      .filter((item) => item.calledOut)
      .map((item) => item.name);
    const breakProblems = staff
      .map((value: unknown) => asRecord(value))
      .filter(
        (item) =>
          item.breakStatus === "MISSING_BREAK" ||
          item.breakStatus === "MULTIPLE_BREAKS"
      )
      .map((item) => `${item.name}: ${item.breakStatus}`);
    return [
      `Staff summary for ${date}: ${staff.length} active staff record(s).`,
      calledOut.length
        ? `Called out: ${calledOut.join(", ")}.`
        : "No call-outs are shown in the selected-day staff data.",
      breakProblems.length
        ? `Break issues: ${breakProblems.join(", ")}.`
        : "No break issue is shown for eligible staff.",
    ].join("\n");
  }

  if (plan.intent === "CLIENT_SUMMARY") {
    const clients = Array.isArray(output.clients) ? output.clients : [];
    const rows = clients.slice(0, MAX_RESPONSE_ITEMS).map((value: unknown) => {
      const item = asRecord(value);
      const special: string[] = [];
      if (Array.isArray(item.napSlots) && item.napSlots.length) {
        special.push(`nap ${item.napSlots.join(", ")}`);
      }
      if (Array.isArray(item.speechSlots) && item.speechSlots.length) {
        special.push(`speech ${item.speechSlots.join(", ")}`);
      }
      return `${item.displayCode || "Client"}: ${
        Array.isArray(item.requiredSlots) ? item.requiredSlots.length : 0
      } required blocks${special.length ? `; ${special.join("; ")}` : ""}`;
    });
    return `Client requirements for ${date} (${clients.length}):\n${
      rows.map((row: string) => `- ${row}`).join("\n")
    }`;
  }

  if (output.scheduleAvailable === false) {
    return `The schedule for ${date} has not been generated yet.`;
  }
  const rows = summarizeSegments(output.segments);
  return rows.length
    ? `Schedule for ${date}:\n${rows.map((row) => `- ${row}`).join("\n")}`
    : `There are no saved schedule blocks for ${date}.`;
}

function outputNeedsNativeConfirmation(outputValue: unknown): boolean {
  const output = asRecord(outputValue);
  return Boolean(
    output.requiresConfirmation === true ||
      output.requiresLockedOverride === true ||
      output.requiresRuleOverride === true ||
      output.requiresOccupiedReplacementConfirmation === true ||
      output.confirmationType === "LOCKED_OR_MANUAL" ||
      output.confirmationType === "RULE_CONFLICT" ||
      output.confirmationType === "OCCUPIED_TARGET"
  );
}

function pendingToPlan(pending: NativePendingSnapshot): NativeSchedulerPlan {
  return {
    intent: pending.intent as NativeSchedulerIntent,
    toolName: pending.toolName,
    input: pending.input,
    confidence: 1,
    explanation: "Previously confirmed Native Scheduler AI action.",
  };
}

async function loadPendingAction(args: {
  locationId: string;
  userId: string;
}): Promise<(NativePendingSnapshot & { preview: string }) | null> {
  await connectToDatabase();
  const found = (await NativeAiPendingAction.findOne({
    locationId: args.locationId,
    userId: args.userId,
  }).lean()) as Record<string, any> | null;

  if (!found) return null;
  if (new Date(found.expiresAt).getTime() <= Date.now()) {
    await NativeAiPendingAction.deleteOne({ _id: found._id });
    return null;
  }

  return {
    date: String(found.date || ""),
    intent: String(found.intent),
    toolName: String(found.toolName),
    input:
      found.input && typeof found.input === "object"
        ? (found.input as Record<string, unknown>)
        : {},
    stage:
      found.stage === "OVERRIDE_CONFIRMATION"
        ? "OVERRIDE_CONFIRMATION"
        : "USER_CONFIRMATION",
    preview: String(found.preview || ""),
  };
}

async function savePendingAction(args: {
  locationId: string;
  userId: string;
  date: string;
  pending: NativePendingSnapshot;
  preview: string;
}) {
  await connectToDatabase();
  await NativeAiPendingAction.findOneAndUpdate(
    { locationId: args.locationId, userId: args.userId },
    {
      locationId: args.locationId,
      userId: args.userId,
      date: args.date,
      intent: args.pending.intent,
      toolName: args.pending.toolName,
      input: args.pending.input,
      stage: args.pending.stage,
      preview: args.preview,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

async function clearPendingAction(args: {
  locationId: string;
  userId: string;
}) {
  await connectToDatabase();
  await NativeAiPendingAction.deleteOne({
    locationId: args.locationId,
    userId: args.userId,
  });
}

function emptyNativeResult(text: string): NativeSchedulerAgentResult {
  return {
    text,
    steps: [{ toolCalls: [], toolResults: [] }],
  };
}

async function executeNativePlan(args: {
  plan: NativeSchedulerPlan;
  tools: Record<string, unknown>;
  date: string;
}): Promise<{
  result: NativeSchedulerAgentResult;
  output: unknown;
}> {
  const rawTool = args.tools[args.plan.toolName] as ExecutableTool | undefined;
  if (!rawTool?.execute) {
    return {
      result: emptyNativeResult(
        `The Native Scheduler AI understood this as ${args.plan.intent
          .toLowerCase()
          .replace(/_/g, " ")}, but the required scheduler tool (${args.plan.toolName}) is not available in this mode.`
      ),
      output: {
        ok: false,
        error: "Required scheduler tool is unavailable.",
      },
    };
  }

  let output: unknown;
  try {
    output = await rawTool.execute(args.plan.input, {
      toolCallId: `native-${args.plan.intent.toLowerCase()}`,
      messages: [],
    });
  } catch (error) {
    output = {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "The scheduler tool failed while processing the request.",
    };
  }

  return {
    result: {
      text: summarizeNativeToolResult(args.plan, output, args.date),
      steps: [
        {
          toolCalls: [
            { toolName: args.plan.toolName, input: args.plan.input },
          ],
          toolResults: [
            {
              toolName: args.plan.toolName,
              input: args.plan.input,
              output,
            },
          ],
        },
      ],
    },
    output,
  };
}

export async function runNativeSchedulerAi(args: {
  message: string;
  history: SchedulerAiHistoryMessage[];
  tools: Record<string, unknown>;
  date: string;
  locationId: string;
  userId: string;
  writeToolsEnabled: boolean;
}): Promise<NativeSchedulerAgentResult> {
  const pending = await loadPendingAction({
    locationId: args.locationId,
    userId: args.userId,
  });

  if (pending && isNativeCancellation(args.message)) {
    await clearPendingAction({
      locationId: args.locationId,
      userId: args.userId,
    });
    return emptyNativeResult(
      "Cancelled. No pending Native Scheduler AI change was applied."
    );
  }

  if (pending && isNativeConfirmation(args.message)) {
    if (pending.date && pending.date !== args.date) {
      return emptyNativeResult(
        `The pending Native Scheduler AI change is for ${pending.date}, but the current conversation resolved to ${args.date}. No database change was made. Mention/select ${pending.date} and confirm again, or cancel the pending action.`
      );
    }

    if (!args.writeToolsEnabled) {
      return emptyNativeResult(
        "The pending action is understood, but scheduler write actions are currently disabled. No database change was made."
      );
    }

    const plan = pendingToPlan(pending);
    const executed = await executeNativePlan({
      plan,
      tools: args.tools,
      date: args.date,
    });

    if (outputNeedsNativeConfirmation(executed.output)) {
      const revised = applyNativeOverrideApproval(
        pending,
        asRecord(executed.output)
      );
      const preview =
        String(asRecord(executed.output).message || "").trim() ||
        "The scheduler found a protected or conflicting destination that needs explicit override permission.";
      await savePendingAction({
        locationId: args.locationId,
        userId: args.userId,
        date: args.date,
        pending: { ...revised, date: pending.date || args.date },
        preview,
      });
      return {
        ...executed.result,
        text:
          `${preview}\n\nNo override has been applied yet. Confirm again only if you want the Native Scheduler AI to apply the required override.`,
      };
    }

    await clearPendingAction({
      locationId: args.locationId,
      userId: args.userId,
    });
    return executed.result;
  }

  if (pending) {
    const revised = reviseNativePendingAction(pending, args.message);
    if (revised) {
      const revisedPlan = pendingToPlan(revised);
      const preview = describeNativePendingAction(revisedPlan, args.date);
      await savePendingAction({
        locationId: args.locationId,
        userId: args.userId,
        date: args.date,
        pending: revised,
        preview,
      });
      return emptyNativeResult(
        `Updated pending action: ${preview}\n\nNo database change has been made yet. Reply "yes" or "proceed" to confirm, or "cancel" to discard it.`
      );
    }

    await clearPendingAction({
      locationId: args.locationId,
      userId: args.userId,
    });
  }

  const expandedMessage = expandNativeFollowUp(args.message, args.history);
  const plan = planNativeSchedulerAction({
    message: expandedMessage,
    history: args.history,
    writeToolsEnabled: args.writeToolsEnabled,
    date: args.date,
  });

  if (plan.intent === "CLARIFICATION") {
    return emptyNativeResult(String(plan.input.message || plan.explanation));
  }

  if (plan.intent === "HISTORICAL") {
    const knowledge = await buildNativeHistoricalKnowledge({
      locationId: args.locationId,
      date: args.date,
      query: expandedMessage,
    });
    return emptyNativeResult(knowledge);
  }

  if (nativePlanNeedsConfirmation(plan)) {
    if (!args.writeToolsEnabled) {
      return emptyNativeResult(
        "The Native Scheduler AI understood the requested database change, but scheduler write actions are disabled. No database change was made."
      );
    }

    const pendingPlan: NativePendingSnapshot = {
      date: args.date,
      intent: plan.intent,
      toolName: plan.toolName,
      input: plan.input,
      stage: "USER_CONFIRMATION",
    };
    const preview = describeNativePendingAction(plan, args.date);
    await savePendingAction({
      locationId: args.locationId,
      userId: args.userId,
      date: args.date,
      pending: pendingPlan,
      preview,
    });

    return emptyNativeResult(
      `Proposed change: ${preview}\n\nNo database change has been made yet. Reply "yes" or "proceed" to confirm this exact action, or "cancel" to discard it.`
    );
  }

  const executed = await executeNativePlan({
    plan,
    tools: args.tools,
    date: args.date,
  });
  return executed.result;
}
