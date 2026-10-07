import { NextResponse } from "next/server";

import { PUT as updateScheduleBatch } from "@/app/api/schedule/batch/route";
import { POST as repairScheduleDay } from "@/app/api/schedule/repair/route";
import { connectToDatabase } from "@/lib/db";
import { analyzeNaturalTimeRange } from "@/features/ai/naturalTime";
import { ScheduleAssignment } from "@/models/ScheduleAssignment";
import { Staff } from "@/models/Staff";

import { POST as basePOST, maxDuration } from "./routeBase";

export { maxDuration };

type JsonRecord = Record<string, any>;

type HistoryMessage = {
  role?: string;
  text?: string;
};

type AiRequestBody = {
  message?: string;
  locationId?: string;
  locationName?: string;
  date?: string;
  dateSelectionExplicit?: boolean;
  history?: HistoryMessage[];
  attachments?: unknown[];
};

type BreakAction = "ADD" | "REMOVE";

type PendingBreakRequest = {
  intentMessage: string;
  overrideConfirmed: boolean;
  action: BreakAction;
};

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isAffirmative(value: string): boolean {
  const text = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return /^(yes|yeah|yep|sure|ok|okay|yes please|please do|go ahead|proceed|do it|allow it|override it|yes override|yes override it|yes proceed|yes go ahead)$/.test(text);
}

function isMinimalRepairIntent(value: string): boolean {
  const text = value.toLowerCase();
  return (
    /\b(?:fix|repair)\b[\s\S]*\b(?:schedule|coverage|uncovered|unplaced|clients?|gaps?)\b/.test(text) ||
    /\b(?:cover|fill)\b[\s\S]*\b(?:uncovered|unplaced|all\s+clients?|coverage\s+gaps?)\b/.test(text) ||
    /\bmake\s+sure\b[\s\S]*\ball\s+clients?\b[\s\S]*\bcovered\b/.test(text)
  );
}

async function invokeRepair(body: JsonRecord): Promise<JsonRecord> {
  const response = await repairScheduleDay(
    new Request("http://scheduler-ai.internal/api/schedule/repair", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
  let data: JsonRecord = {};
  try {
    data = (await response.json()) as JsonRecord;
  } catch {
    data = {};
  }
  return { ok: response.ok, status: response.status, ...data };
}

function breakAction(value: string): BreakAction | null {
  if (!/\bbreak\b/i.test(value)) return null;
  if (/\b(remove|delete|clear|cancel)\b[\s\S]*\bbreak\b/i.test(value)) {
    return "REMOVE";
  }
  if (/\b(add|give|set|put|schedule|insert)\b[\s\S]*\bbreak\b/i.test(value)) {
    return "ADD";
  }
  return null;
}

function pendingBreakRequest(
  message: string,
  history: HistoryMessage[]
): PendingBreakRequest | null {
  const directAction = breakAction(message);
  if (directAction) {
    return {
      intentMessage: message,
      overrideConfirmed: false,
      action: directAction,
    };
  }

  if (!isAffirmative(message)) return null;
  const recent = history.slice(-8);
  const assistantMatch = [...recent]
    .map((entry, index) => ({ entry, index }))
    .reverse()
    .find(
      ({ entry }) =>
        entry.role === "assistant" &&
        (/do you allow me to override|allow me to override|override this and proceed/i.test(
          entry.text ?? ""
        ) ||
          /want to make sure i understood the time|do you mean .*\d{1,2}:\d{2}/i.test(
            entry.text ?? ""
          ))
    );
  if (!assistantMatch) return null;

  const assistantText = assistantMatch.entry.text ?? "";
  const isOverrideConfirmation =
    /do you allow me to override|allow me to override|override this and proceed/i.test(
      assistantText
    );
  const confirmedTime = analyzeNaturalTimeRange(assistantText);

  for (let index = assistantMatch.index - 1; index >= 0; index -= 1) {
    const entry = recent[index];
    if (entry.role !== "user") continue;
    const action = breakAction(entry.text ?? "");
    if (!action) continue;

    if (!isOverrideConfirmation && confirmedTime.status === "PARSED") {
      return {
        intentMessage: `${entry.text ?? ""} from ${confirmedTime.startTime} to ${confirmedTime.endTime}`,
        overrideConfirmed: false,
        action,
      };
    }

    return {
      intentMessage: entry.text ?? "",
      overrideConfirmed: isOverrideConfirmation,
      action,
    };
  }
  return null;
}

function inferHour(hour: number, meridiem?: string): number {
  if (meridiem) {
    const suffix = meridiem.toLowerCase();
    if (suffix === "am") return hour === 12 ? 0 : hour;
    return hour === 12 ? 12 : hour + 12;
  }
  if (hour === 12) return 12;
  return hour >= 1 && hour <= 7 ? hour + 12 : hour;
}

function parseTimeToken(
  hourText: string,
  minuteText?: string,
  meridiem?: string
): string | null {
  const hour = Number(hourText);
  const minute = Number(minuteText ?? "0");
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    return null;
  }
  const converted = inferHour(hour, meridiem);
  if (converted < 0 || converted > 23) return null;
  return `${String(converted).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function parseBreakRange(message: string): { startTime: string; endTime: string } | null {
  const natural = analyzeNaturalTimeRange(message);
  if (natural.status === "PARSED") {
    return { startTime: natural.startTime, endTime: natural.endTime };
  }
  if (natural.status === "CONFIRM") {
    // routeBase asks the user to confirm this range before any deterministic write.
    return null;
  }

  // Preserve the convenient single-time shorthand: "add a break at 10:30"
  // means the 10:30-11:00 scheduler cell.
  const withoutDates = message.replace(/\b20\d{2}-\d{2}-\d{2}\b/g, " ");
  const normalizedSpacing = withoutDates.replace(
    /\b(\d{1,2})\s+(\d{2})\s*(am|pm)\b/gi,
    "$1:$2 $3"
  );
  const single = normalizedSpacing.match(
    /\b(?:at|from)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i
  );
  if (!single) return null;
  const startTime = parseTimeToken(single[1], single[2], single[3]);
  if (!startTime) return null;
  const [hourText, minuteText] = startTime.split(":");
  const total = Number(hourText) * 60 + Number(minuteText) + 30;
  const endTime = `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  return { startTime, endTime };
}

function timeToMinutes(time: string): number {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function minutesToTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

function breakSlots(startTime: string, endTime: string): string[] {
  const slots: string[] = [];
  for (
    let cursor = timeToMinutes(startTime);
    cursor < timeToMinutes(endTime);
    cursor += 30
  ) {
    slots.push(minutesToTime(cursor));
  }
  return slots;
}

function displayTime(time: string): string {
  const [hourText, minute] = time.split(":");
  const hour = Number(hourText);
  const suffix = hour >= 12 ? "PM" : "AM";
  return `${hour % 12 || 12}:${minute} ${suffix}`;
}

function isBreakType(value: unknown): boolean {
  return ["BREAK", "BREAK_NAP", "BREAK_SPEECH"].includes(String(value ?? ""));
}

function isProtected(record: JsonRecord): boolean {
  return record.locked === true || record.manuallyOverridden === true;
}

function normalizeChangedFlag(data: JsonRecord): JsonRecord {
  if (data.changed !== true) return data;
  const reply = String(data.reply ?? "");
  if (
    /\bno changes? (?:were|was) made\b/i.test(reply) ||
    /\bdid not change anything\b/i.test(reply) ||
    /\bdo you allow me to override\b/i.test(reply) ||
    /\brequires an override\b/i.test(reply) ||
    /\bblocked by locked\/manual cells\b/i.test(reply) ||
    (/\bexplicit override permission\b/i.test(reply) &&
      /\b(?:confirm|proceed)\b/i.test(reply))
  ) {
    return { ...data, changed: false };
  }
  return data;
}

async function invokeBatch(body: JsonRecord): Promise<JsonRecord> {
  const response = await updateScheduleBatch(
    new Request("http://scheduler-ai.internal/api/schedule/batch", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
  let data: JsonRecord = {};
  try {
    data = (await response.json()) as JsonRecord;
  } catch {
    data = {};
  }
  return { ok: response.ok, status: response.status, ...data };
}

function conflictText(conflicts: unknown): string {
  if (!Array.isArray(conflicts) || conflicts.length === 0) {
    return "the scheduler reported a rule conflict";
  }
  return conflicts
    .slice(0, 6)
    .map((conflict) => {
      const item = conflict as JsonRecord;
      const time = typeof item.startTime === "string" ? displayTime(item.startTime) : "the requested time";
      return `${time}: ${String(item.message ?? item.code ?? "scheduler conflict")}`;
    })
    .join("; ");
}

async function runMinimalRepairFallback(
  body: AiRequestBody,
  baseData: JsonRecord,
  responseStatus: number
): Promise<Response | null> {
  const message = body.message?.trim() ?? "";
  if (
    !isMinimalRepairIntent(message) ||
    breakAction(message) !== null ||
    baseData.mode !== "AUTONOMOUS" ||
    baseData.changed === true
  ) {
    return null;
  }

  const baseReply = String(baseData.reply ?? "");
  if (
    /which day|what date|has not been generated|would you like me to generate|want to make sure i understood/i.test(
      baseReply
    )
  ) {
    return null;
  }

  const locationId = body.locationId?.trim() ?? "";
  const date = String(baseData.effectiveDate ?? body.date ?? "");
  if (!locationId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return null;
  }

  await connectToDatabase();
  const savedCount = await ScheduleAssignment.countDocuments({
    locationId,
    date,
  });
  if (savedCount === 0) {
    return NextResponse.json({
      ...baseData,
      reply:
        "The schedule for " +
        date +
        " has not been generated yet. Would you like me to generate the schedule for " +
        date +
        "?",
      changed: false,
      writeToolsUsed: [],
      effectiveDate: date,
    });
  }

  const repair = await invokeRepair({
    locationId,
    date,
    mode: "COVERAGE",
  });

  if (!repair.ok) {
    return NextResponse.json(
      {
        ...baseData,
        reply:
          "I could not complete the minimal schedule repair for " +
          date +
          ": " +
          String(repair.error ?? "the scheduler rejected the repair") +
          ". No additional repair changes were made.",
        changed: false,
        writeToolsUsed: [],
        effectiveDate: date,
      },
      { status: responseStatus }
    );
  }

  const metrics =
    repair.metrics && typeof repair.metrics === "object"
      ? (repair.metrics as JsonRecord)
      : {};
  const covered = Number(metrics.coveredClientSlots ?? 0);
  const required = Number(metrics.requiredClientSlots ?? 0);
  const uncovered = Number(metrics.uncoveredClientSlots ?? 0);
  const priority = Number(repair.priorityUnplacedCount ?? 0);
  const resolved = Number(repair.resolvedUnplacedCount ?? 0);
  const remainingUnplaced = Number(repair.unplacedRemainingCount ?? 0);
  const added = Number(repair.addedAssignmentCount ?? 0);
  const removed = Number(repair.removedAssignmentCount ?? 0);
  const uncoveredItems = Array.isArray(repair.uncoveredRequirements)
    ? (repair.uncoveredRequirements as JsonRecord[])
    : [];

  const unresolvedText =
    uncoveredItems.length > 0
      ? " Remaining uncovered: " +
        uncoveredItems
          .slice(0, 8)
          .map((item) => {
            const code = String(item.clientCode ?? "client");
            const start = String(item.startTime ?? "");
            return code + " at " + (start ? displayTime(start) : "unknown time");
          })
          .join(", ") +
        (uncoveredItems.length > 8
          ? ", plus " + String(uncoveredItems.length - 8) + " more"
          : "") +
        "."
      : "";

  let reply = "Done. I minimally repaired the schedule for " + date + ". ";
  if (priority > 0) {
    reply +=
      "I handled existing Unplaced assignments first and resolved " +
      resolved +
      " of " +
      priority +
      ". ";
  }
  reply +=
    "Then I filled the remaining coverage gaps with the minimum necessary changes, automatically relocating/overriding blocks when required, and repaired eligible staff breaks. " +
    covered +
    "/" +
    required +
    " required client blocks are covered, with " +
    uncovered +
    " still uncovered. " +
    "The repair added " +
    added +
    " assignment" +
    (added === 1 ? "" : "s") +
    " and moved/removed " +
    removed +
    " existing schedule assignment" +
    (removed === 1 ? "" : "s") +
    ". " +
    remainingUnplaced +
    " assignment" +
    (remainingUnplaced === 1 ? " remains" : "s remain") +
    " in Unplaced." +
    unresolvedText;
  if (uncovered === 0 && remainingUnplaced === 0) {
    reply += "\n\nIs there anything else you would like help with?";
  }

  return NextResponse.json({
    ...baseData,
    reply,
    toolsUsed: [
      ...new Set([
        ...(Array.isArray(baseData.toolsUsed) ? baseData.toolsUsed : []),
        "repair_schedule",
      ]),
    ],
    writeToolsUsed: ["repair_schedule"],
    changed: added > 0 || removed > 0 || resolved > 0,
    effectiveDate: date,
  });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  let body: AiRequestBody;
  try {
    body = JSON.parse(rawBody) as AiRequestBody;
  } catch {
    return basePOST(
      new Request(request.url, {
        method: "POST",
        headers: request.headers,
        body: rawBody,
      })
    );
  }

  const message = body.message?.trim() ?? "";
  const history = Array.isArray(body.history) ? body.history : [];
  const pendingBreak = pendingBreakRequest(message, history);

  const baseResponse = await basePOST(
    new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body: rawBody,
    })
  );

  let baseData: JsonRecord = {};
  try {
    baseData = normalizeChangedFlag((await baseResponse.json()) as JsonRecord);
  } catch {
    return baseResponse;
  }

  if (!baseResponse.ok) {
    return NextResponse.json(baseData, { status: baseResponse.status });
  }

  // A new screenshot/image is always analysis + preview only. Do not allow the
  // deterministic repair/break fallbacks below to turn that same upload into a write.
  if (baseData.attachmentPreviewOnly === true) {
    return NextResponse.json(baseData, { status: baseResponse.status });
  }

  const minimalRepairResponse = await runMinimalRepairFallback(
    body,
    baseData,
    baseResponse.status
  );
  if (minimalRepairResponse) {
    return minimalRepairResponse;
  }

  if (!pendingBreak || baseData.mode !== "AUTONOMOUS") {
    return NextResponse.json(baseData, { status: baseResponse.status });
  }

  // If the general Scheduler AI already completed and verified this write,
  // do not run the deterministic break fallback a second time.
  if (
    baseData.changed === true &&
    Array.isArray(baseData.writeToolsUsed) &&
    baseData.writeToolsUsed.length > 0
  ) {
    return NextResponse.json(baseData, { status: baseResponse.status });
  }

  const baseReply = String(baseData.reply ?? "");
  if (
    /which day|what date|has not been generated|would you like me to generate|want to make sure i understood the time|do you mean .*\d{1,2}:\d{2}/i.test(
      baseReply
    )
  ) {
    return NextResponse.json(baseData, { status: baseResponse.status });
  }

  const locationId = body.locationId?.trim() ?? "";
  const date = String(baseData.effectiveDate ?? body.date ?? "");
  const range = parseBreakRange(pendingBreak.intentMessage);
  if (!locationId || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !range) {
    return NextResponse.json(baseData, { status: baseResponse.status });
  }

  const slots = breakSlots(range.startTime, range.endTime);
  if (slots.length === 0 || slots.length > 12) {
    return NextResponse.json(baseData, { status: baseResponse.status });
  }

  await connectToDatabase();
  const activeStaff = (await Staff.find({ locationId, active: true })
    .select("_id fullName")
    .lean()) as unknown as JsonRecord[];
  const normalizedIntent = normalize(pendingBreak.intentMessage);
  const matchedStaff = activeStaff.filter((member) => {
    const name = normalize(String(member.fullName ?? ""));
    return Boolean(name) && normalizedIntent.includes(name);
  });
  if (matchedStaff.length !== 1) {
    return NextResponse.json(baseData, { status: baseResponse.status });
  }

  const staff = matchedStaff[0];
  const staffId = String(staff._id);
  const staffName = String(staff.fullName);

  const dayAssignmentCount = await ScheduleAssignment.countDocuments({
    locationId,
    date,
  });
  if (dayAssignmentCount === 0) {
    return NextResponse.json({
      ...baseData,
      reply: `The schedule for ${date} has not been generated yet. Would you like me to generate the schedule for ${date}?`,
      changed: false,
      writeToolsUsed: [],
    });
  }

  const existing = (await ScheduleAssignment.find({
    locationId,
    date,
    staffId,
    startTime: { $in: slots },
  })
    .select("startTime assignmentType clientId locked manuallyOverridden")
    .sort({ startTime: 1 })
    .lean()) as unknown as JsonRecord[];

  if (pendingBreak.action === "REMOVE") {
    const breakAssignments = existing.filter((assignment) =>
      isBreakType(assignment.assignmentType)
    );

    if (breakAssignments.length === 0) {
      return NextResponse.json({
        ...baseData,
        reply: `${staffName} has no saved break from ${displayTime(range.startTime)} to ${displayTime(range.endTime)} on ${date}.\n\nIs there anything else you'd like help with?`,
        changed: false,
        writeToolsUsed: [],
        effectiveDate: date,
      });
    }

    const protectedBreaks = breakAssignments.filter(isProtected);
    if (protectedBreaks.length > 0 && !pendingBreak.overrideConfirmed) {
      const protectedTimes = protectedBreaks
        .map((assignment) => displayTime(String(assignment.startTime)))
        .join(", ");
      return NextResponse.json({
        ...baseData,
        reply: `I found ${staffName}'s break on ${date} at ${protectedTimes}, but the break cell is locked/manual. Removing it requires an override. Do you allow me to override this and proceed?`,
        changed: false,
        writeToolsUsed: [],
        effectiveDate: date,
      });
    }

    const removal = await invokeBatch({
      locationId,
      date,
      force: pendingBreak.overrideConfirmed,
      changes: breakAssignments.map((assignment) => ({
        staffId,
        startTime: String(assignment.startTime),
        assignmentType: "EMPTY",
        text: "Removed break by Scheduler AI",
      })),
    });

    if (!removal.ok) {
      if (removal.status === 409 || removal.requiresConfirmation === true) {
        return NextResponse.json({
          ...baseData,
          reply: `I checked the break removal for ${staffName} on ${date}. The scheduler would normally block it because ${conflictText(removal.conflicts)}. Do you allow me to override this and proceed?`,
          changed: false,
          writeToolsUsed: [],
          effectiveDate: date,
        });
      }
      return NextResponse.json({
        ...baseData,
        reply: `I could not remove the break for ${staffName} on ${date}: ${String(removal.error ?? "the scheduler rejected the change")}. No schedule changes were made.`,
        changed: false,
        writeToolsUsed: [],
        effectiveDate: date,
      });
    }

    const remainingBreaks = await ScheduleAssignment.countDocuments({
      locationId,
      date,
      staffId,
      startTime: { $in: breakAssignments.map((assignment) => String(assignment.startTime)) },
      assignmentType: { $in: ["BREAK", "BREAK_NAP", "BREAK_SPEECH"] },
    });

    if (remainingBreaks > 0) {
      return NextResponse.json({
        ...baseData,
        reply: `The break removal returned successfully, but I could not verify that every requested break cell was removed for ${staffName} on ${date}. Please refresh the schedule before making another change.`,
        changed: true,
        toolsUsed: ["edit_schedule_cells"],
        writeToolsUsed: ["edit_schedule_cells"],
        effectiveDate: date,
      });
    }

    return NextResponse.json({
      ...baseData,
      reply: `Done. I removed ${staffName}'s break from ${displayTime(range.startTime)} to ${displayTime(range.endTime)} on ${date} and verified the schedule.\n\nIs there anything else you'd like help with?`,
      toolsUsed: [
        ...new Set([
          ...(Array.isArray(baseData.toolsUsed) ? baseData.toolsUsed : []),
          "edit_schedule_cells",
        ]),
      ],
      writeToolsUsed: ["edit_schedule_cells"],
      changed: true,
      effectiveDate: date,
    });
  }

  if (existing.length > 0) {
    const alreadyBreak = existing.every((assignment) => assignment.assignmentType === "BREAK");
    if (alreadyBreak && existing.length === slots.length) {
      return NextResponse.json({
        ...baseData,
        reply: `${staffName} already has a break from ${displayTime(range.startTime)} to ${displayTime(range.endTime)} on ${date}.\n\nIs there anything else you'd like help with?`,
        changed: false,
        writeToolsUsed: [],
        effectiveDate: date,
      });
    }

    const details = existing
      .map((assignment) => `${displayTime(String(assignment.startTime))}: ${String(assignment.assignmentType).replaceAll("_", " ")}`)
      .join("; ");
    return NextResponse.json({
      ...baseData,
      reply: `I did not add the break because ${staffName} already has scheduled work in that period on ${date}: ${details}. Replacing an occupied block could affect client coverage. I can analyze a safe handoff or replacement first if you want.`,
      changed: false,
      writeToolsUsed: [],
      effectiveDate: date,
    });
  }

  const batchResult = await invokeBatch({
    locationId,
    date,
    force: pendingBreak.overrideConfirmed,
    changes: slots.map((startTime) => ({
      staffId,
      startTime,
      assignmentType: "BREAK",
      text: "Break",
      clientId: null,
    })),
  });

  if (!batchResult.ok) {
    if (batchResult.status === 409 || batchResult.requiresConfirmation === true) {
      return NextResponse.json({
        ...baseData,
        reply: `I checked the requested break for ${staffName} on ${date}. The scheduler would normally block it because ${conflictText(batchResult.conflicts)}. Do you allow me to override this and proceed?`,
        changed: false,
        writeToolsUsed: [],
        effectiveDate: date,
      });
    }
    return NextResponse.json({
      ...baseData,
      reply: `I could not add the break for ${staffName} on ${date}: ${String(batchResult.error ?? "the scheduler rejected the change")}. No schedule changes were made.`,
      changed: false,
      writeToolsUsed: [],
      effectiveDate: date,
    });
  }

  const verifiedCount = await ScheduleAssignment.countDocuments({
    locationId,
    date,
    staffId,
    startTime: { $in: slots },
    assignmentType: "BREAK",
  });

  if (verifiedCount !== slots.length) {
    return NextResponse.json({
      ...baseData,
      reply: `The break update returned successfully, but I could not verify every requested break cell for ${staffName} on ${date}. Please refresh the schedule before making another change.`,
      changed: true,
      toolsUsed: ["edit_schedule_cells"],
      writeToolsUsed: ["edit_schedule_cells"],
      effectiveDate: date,
    });
  }

  return NextResponse.json({
    ...baseData,
    reply: `Done. I added ${staffName}'s break from ${displayTime(range.startTime)} to ${displayTime(range.endTime)} on ${date} and verified the saved break block.\n\nIs there anything else you'd like help with?`,
    toolsUsed: [
      ...new Set([...(Array.isArray(baseData.toolsUsed) ? baseData.toolsUsed : []), "edit_schedule_cells"]),
    ],
    writeToolsUsed: ["edit_schedule_cells"],
    changed: true,
    effectiveDate: date,
  });
}
