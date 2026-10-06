import { buildSchedulerAdvisoryReplyFallback } from "./schedulerAdvisoryReplyFallback";

type ToolEvidence = {
  toolName: string;
  output: unknown;
};

type FallbackOptions = {
  date: string;
  locationName?: string;
  toolEvidence: ToolEvidence[];
  writeToolsUsed: string[];
};

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function arrayRecords(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.map(asRecord).filter((entry): entry is JsonRecord => Boolean(entry))
    : [];
}

function evidenceOutput(toolEvidence: ToolEvidence[], toolName: string): JsonRecord | null {
  const match = [...toolEvidence].reverse().find((entry) => entry.toolName === toolName);
  return asRecord(match?.output);
}

function missingSchedule(toolEvidence: ToolEvidence[]): boolean {
  return toolEvidence.some((entry) => {
    const output = asRecord(entry.output);
    return output?.scheduleAvailable === false;
  });
}

function humanIssue(issue: string): string {
  if (issue === "MISSING_BREAK") return "missing a required break";
  if (issue === "MULTIPLE_BREAKS") return "has multiple breaks";
  return issue.toLowerCase().replaceAll("_", " ");
}

function humanAssignmentType(value: string): string {
  if (value === "CLIENT_1_TO_1") return "1:1";
  if (value === "BREAK") return "Break";
  if (value === "BREAK_NAP") return "Break/Nap";
  if (value === "BREAK_SPEECH") return "Break/Speech";
  if (value === "NAP") return "Nap";
  if (value === "SPEECH") return "Speech";
  if (value === "UNAVAILABLE") return "Unavailable";
  if (value === "OPEN") return "Open";
  return value.replaceAll("_", " ").toLowerCase();
}

function displayTime(time: string): string {
  const match = time.match(/^(\d{2}):(\d{2})$/);
  if (!match) return time;
  const hour = Number(match[1]);
  const minute = match[2];
  const suffix = hour >= 12 ? "PM" : "AM";
  const twelveHour = hour % 12 || 12;
  return `${twelveHour}:${minute} ${suffix}`;
}

function formatLookupSegment(record: JsonRecord): string {
  const start = asString(record.startTime) || "?";
  const end = asString(record.endTime) || "?";
  const staff = asString(record.staffName);
  const client = asString(record.clientCode);
  const type = humanAssignmentType(asString(record.assignmentType) || "assignment");
  const subject = client
    ? type === "1:1"
      ? client
      : `${client} ${type}`
    : type;
  return `${displayTime(start)}–${displayTime(end)}: ${staff && client ? `${staff} with ${subject}` : subject}`;
}

function lookupAnswer(toolEvidence: ToolEvidence[], date: string): string | null {
  const lookup = evidenceOutput(toolEvidence, "lookup_schedule");
  if (!lookup) return null;

  if (lookup.scheduleAvailable === false) {
    return `The schedule for ${date} has not been generated yet. Would you like me to generate the schedule for ${date}?`;
  }

  if (lookup.needsClarification === true) {
    return (
      asString(lookup.message) ||
      "I'm unable to identify the staff member or client uniquely. Please clarify who you mean."
    );
  }

  const resolvedStaffName = asString(lookup.resolvedStaffName);
  const resolvedClientCode = asString(lookup.resolvedClientCode);
  const segments = arrayRecords(lookup.segments);
  const freeStaff = arrayRecords(lookup.freeStaff);

  if (freeStaff.length > 0) {
    const entirelyFree = freeStaff
      .filter((record) => record.freeForEntireRequestedRange === true)
      .map((record) => asString(record.name))
      .filter((name): name is string => Boolean(name));
    if (entirelyFree.length > 0) {
      return `For ${date}, staff free for the entire requested range: ${entirelyFree.join(", ")}.`;
    }

    const partlyFree = freeStaff
      .map((record) => {
        const name = asString(record.name);
        const slots = Array.isArray(record.freeSlots)
          ? record.freeSlots.filter((slot): slot is string => typeof slot === "string")
          : [];
        return name && slots.length
          ? `${name}: ${slots.map(displayTime).join(", ")}`
          : null;
      })
      .filter((entry): entry is string => Boolean(entry));
    if (partlyFree.length > 0) {
      return `For ${date}, available unassigned time in the requested range is: ${partlyFree.join("; ")}.`;
    }
  }

  if (segments.length === 0) {
    if (resolvedStaffName) {
      return `${resolvedStaffName} has no saved assignments in the requested time range on ${date}.`;
    }
    if (resolvedClientCode) {
      return `${resolvedClientCode} has no saved coverage assignments in the requested time range on ${date}.`;
    }
    return `I found no saved assignments matching that staff/client/time request on ${date}.`;
  }

  if (resolvedStaffName) {
    const details = segments.map((record) => {
      const start = asString(record.startTime) || "?";
      const end = asString(record.endTime) || "?";
      const client = asString(record.clientCode);
      const type = humanAssignmentType(asString(record.assignmentType) || "assignment");
      const label = client
        ? type === "1:1"
          ? `${client} 1:1`
          : `${client} ${type}`
        : type;
      return `${displayTime(start)}–${displayTime(end)} ${label}`;
    });
    return `${resolvedStaffName}'s schedule for the requested range on ${date}: ${details.join("; ")}.`;
  }

  if (resolvedClientCode) {
    const details = segments.map((record) => {
      const start = asString(record.startTime) || "?";
      const end = asString(record.endTime) || "?";
      const staff = asString(record.staffName) || "No staff listed";
      const type = humanAssignmentType(asString(record.assignmentType) || "assignment");
      return `${displayTime(start)}–${displayTime(end)} ${staff}${type === "1:1" ? "" : ` (${type})`}`;
    });
    return `${resolvedClientCode}'s coverage for the requested range on ${date}: ${details.join("; ")}.`;
  }

  return `For ${date}: ${segments.map(formatLookupSegment).join("; ")}.`;
}

function writeErrors(toolEvidence: ToolEvidence[], writeToolsUsed: string[]): string[] {
  const writeNames = new Set(writeToolsUsed);
  return toolEvidence.flatMap((entry) => {
    if (!writeNames.has(entry.toolName)) return [];
    const output = asRecord(entry.output);
    if (!output) return [];
    const failed = output.ok === false || (typeof output.status === "number" && output.status >= 400);
    if (!failed) return [];
    const error = asString(output.error) || asString(output.message);
    return error ? [error] : [`${entry.toolName} did not complete successfully.`];
  });
}

export function buildSchedulerReplyFallback({
  date,
  locationName,
  toolEvidence,
  writeToolsUsed,
}: FallbackOptions): string {
  const advisory = buildSchedulerAdvisoryReplyFallback({ date, toolEvidence });
  if (advisory) return advisory;

  if (writeToolsUsed.length === 0 && missingSchedule(toolEvidence)) {
    return `The schedule for ${date} has not been generated yet. Would you like me to generate the schedule for ${date}?`;
  }

  const directLookupAnswer = lookupAnswer(toolEvidence, date);
  if (directLookupAnswer && writeToolsUsed.length === 0) {
    return directLookupAnswer;
  }

  const clinic = locationName?.trim() || "the selected clinic";
  const errors = writeErrors(toolEvidence, writeToolsUsed);
  const wrote = writeToolsUsed.length > 0;
  const sentences: string[] = [];

  if (errors.length > 0) {
    sentences.push(`I could not complete every requested scheduler change for ${date}: ${errors.join(" ")}`);
  } else if (wrote) {
    sentences.push(`I completed the requested scheduler action for ${date}.`);
  } else {
    sentences.push(`I checked ${clinic} for ${date}.`);
  }

  if (directLookupAnswer) {
    sentences.push(directLookupAnswer);
  }

  const health = evidenceOutput(toolEvidence, "check_schedule");
  if (health) {
    const required = asNumber(health.requiredClientSlots);
    const covered = asNumber(health.coveredClientSlots);
    const uncovered = asNumber(health.uncoveredClientSlots);

    if (required !== null && covered !== null) {
      sentences.push(`${covered}/${required} required client blocks are covered${uncovered !== null ? `, with ${uncovered} uncovered` : ""}.`);
    }

    const uncoveredRequirements = arrayRecords(health.uncoveredRequirements);
    if (uncoveredRequirements.length > 0) {
      const examples = uncoveredRequirements.slice(0, 8).map((record) => {
        const code = asString(record.clientCode) || "client";
        const time = asString(record.startTime) || "unknown time";
        return `${code} at ${displayTime(time)}`;
      });
      const suffix = uncoveredRequirements.length > examples.length
        ? `, plus ${uncoveredRequirements.length - examples.length} more`
        : "";
      sentences.push(`Coverage still needs attention for ${examples.join(", ")}${suffix}.`);
    }

    const breakProblems = arrayRecords(health.staffBreakProblems);
    if (breakProblems.length > 0) {
      const details = breakProblems.slice(0, 6).map((record) => {
        const staffName = asString(record.staffName) || "A staff member";
        const issue = asString(record.issue) || "break issue";
        const breakSlots = Array.isArray(record.breakSlots)
          ? record.breakSlots.filter((slot): slot is string => typeof slot === "string")
          : [];
        return `${staffName} ${humanIssue(issue)}${breakSlots.length ? ` (${breakSlots.map(displayTime).join(", ")})` : ""}`;
      });
      sentences.push(`Break review: ${details.join("; ")}.`);
    }

    const unplacedCount = asNumber(health.unplacedCount);
    if (unplacedCount !== null) {
      sentences.push(unplacedCount === 0
        ? "There are no unresolved Unplaced assignments."
        : `${unplacedCount} assignment${unplacedCount === 1 ? " remains" : "s remain"} in Unplaced.`);
    }

    if ((uncovered ?? 0) === 0 && breakProblems.length === 0 && (unplacedCount ?? 0) === 0) {
      sentences.push("The main coverage, break, and Unplaced checks look clear.");
    }
  } else if (!directLookupAnswer) {
    const day = evidenceOutput(toolEvidence, "get_day_schedule");
    const unplaced = evidenceOutput(toolEvidence, "get_unplaced_assignments");
    const assignmentCount = asNumber(day?.assignmentCount);
    const required = asNumber(day?.requiredClientSlots);
    const unplacedCount = asNumber(unplaced?.count);

    if (assignmentCount !== null) {
      sentences.push(`The saved day currently contains ${assignmentCount} assignment${assignmentCount === 1 ? "" : "s"}${required !== null ? ` for ${required} required client blocks` : ""}.`);
    }
    if (unplacedCount !== null) {
      sentences.push(unplacedCount === 0
        ? "There are no unresolved Unplaced assignments."
        : `${unplacedCount} assignment${unplacedCount === 1 ? " remains" : "s remain"} in Unplaced.`);
    }
  }

  if (!wrote && !directLookupAnswer) {
    sentences.push("I did not make any schedule changes.");
  } else if (errors.length === 0 && wrote && !health) {
    sentences.push("The scheduler write completed, but no final health-check result was available in this run.");
  }

  return sentences.join(" ");
}
