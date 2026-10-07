import { matchEntityReference } from "./entityReference";
import { buildDateRecommendations } from "./schedulerDateRecommendations";

type JsonRecord = Record<string, any>;

type DateContextFallbackOptions = {
  request: string;
  date: string;
  dateContext: JsonRecord;
};

type TimeRange = {
  startTime: string | null;
  endTime: string | null;
};

function displayTime(time: string): string {
  const match = time.match(/^(\d{2}):(\d{2})$/);
  if (!match) return time;
  const hour = Number(match[1]);
  const minute = match[2];
  const suffix = hour >= 12 ? "PM" : "AM";
  const twelveHour = hour % 12 || 12;
  return `${twelveHour}:${minute} ${suffix}`;
}

function toMinutes(time: string): number {
  const match = time.match(/^(\d{2}):(\d{2})$/);
  if (!match) return Number.NaN;
  return Number(match[1]) * 60 + Number(match[2]);
}

function minutesToTime(minutes: number): string {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(normalized / 60)).padStart(2, "0")}:${String(
    normalized % 60
  ).padStart(2, "0")}`;
}

function inferHour(hour: number, meridiem: string | undefined): number {
  if (meridiem) {
    const normalized = meridiem.toLowerCase();
    if (normalized === "am") return hour === 12 ? 0 : hour;
    return hour === 12 ? 12 : hour + 12;
  }
  if (hour === 12) return 12;
  if (hour >= 1 && hour <= 7) return hour + 12;
  return hour;
}

function parseTimeToken(
  hourText: string,
  minuteText: string | undefined,
  meridiem: string | undefined
): string | null {
  const hour = Number(hourText);
  const minute = Number(minuteText ?? "0");
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    return null;
  }
  if (hour < 1 || hour > 23) return null;
  const convertedHour = meridiem ? inferHour(hour, meridiem) : inferHour(hour, undefined);
  if (convertedHour < 0 || convertedHour > 23) return null;
  return `${String(convertedHour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function parseTimeRange(request: string, slotMinutes: number): TimeRange {
  const timeRequest = request.replace(/\b20\d{2}-\d{2}-\d{2}\b/g, " ");
  const range = timeRequest.match(
    /\b(?:from\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|–|to|until|through)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i
  );
  if (range) {
    let firstMeridiem = range[3];
    let secondMeridiem = range[6];
    const firstHour = Number(range[1]);
    const secondHour = Number(range[4]);

    if (!firstMeridiem && secondMeridiem) {
      firstMeridiem = firstHour >= 8 && secondHour <= 7 ? "am" : secondMeridiem;
    }
    if (firstMeridiem && !secondMeridiem) {
      secondMeridiem =
        firstMeridiem.toLowerCase() === "am" && secondHour <= 7 ? "pm" : firstMeridiem;
    }

    const startTime = parseTimeToken(range[1], range[2], firstMeridiem);
    const endTime = parseTimeToken(range[4], range[5], secondMeridiem);
    return { startTime, endTime };
  }

  const at = timeRequest.match(/\b(?:at|around)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  if (at) {
    const startTime = parseTimeToken(at[1], at[2], at[3]);
    if (!startTime) return { startTime: null, endTime: null };
    const endTime = minutesToTime(toMinutes(startTime) + slotMinutes);
    return { startTime, endTime };
  }

  return { startTime: null, endTime: null };
}

function overlaps(segment: JsonRecord, range: TimeRange): boolean {
  if (!range.startTime && !range.endTime) return true;
  const start = String(segment.startTime ?? "");
  const end = String(segment.endTime ?? "");
  if (!start || !end) return false;
  if (range.startTime && end <= range.startTime) return false;
  if (range.endTime && start >= range.endTime) return false;
  return true;
}

function humanType(type: string): string {
  if (type === "CLIENT_1_TO_1") return "1:1";
  if (type === "BREAK") return "Break";
  if (type === "BREAK_NAP") return "Break/Nap";
  if (type === "BREAK_SPEECH") return "Break/Speech";
  if (type === "NAP") return "Nap";
  if (type === "SPEECH") return "Speech";
  if (type === "UNAVAILABLE") return "Unavailable";
  if (type === "OPEN") return "Open";
  return type.replaceAll("_", " ");
}

function formatSegment(segment: JsonRecord, perspective: "staff" | "client" | "generic"): string {
  const start = displayTime(String(segment.startTime ?? "?"));
  const end = displayTime(String(segment.endTime ?? "?"));
  const type = humanType(String(segment.assignmentType ?? "assignment"));
  const staffName = segment.staffName ? String(segment.staffName) : null;
  const clientCode = segment.clientCode ? String(segment.clientCode) : null;

  if (perspective === "staff") {
    if (type === "1:1" && clientCode) return `${start}–${end}: ${clientCode} 1:1`;
    if (clientCode) return `${start}–${end}: ${clientCode} ${type}`;
    return `${start}–${end}: ${type}`;
  }
  if (perspective === "client") {
    if (type === "1:1") return `${start}–${end}: ${staffName ?? "No staff listed"}`;
    return `${start}–${end}: ${staffName ?? "No staff listed"} (${type})`;
  }
  return `${start}–${end}: ${staffName ?? "No staff"}${clientCode ? ` with ${clientCode}` : ""}${type === "1:1" ? "" : ` (${type})`}`;
}

function findStaff(request: string, staff: JsonRecord[]): JsonRecord | null {
  const matched = matchEntityReference(
    request,
    staff.map((member) => ({
      record: member,
      labels: [String(member.name ?? "")],
    }))
  );
  return matched.status === "MATCH" ? matched.record : null;
}

function findClient(request: string, clients: JsonRecord[]): JsonRecord | null {
  const matched = matchEntityReference(
    request,
    clients.map((client) => ({
      record: client,
      labels: [String(client.displayCode ?? "")],
    }))
  );
  return matched.status === "MATCH" ? matched.record : null;
}

function slotWithinRange(slot: string, range: TimeRange): boolean {
  if (range.startTime && slot < range.startTime) return false;
  if (range.endTime && slot >= range.endTime) return false;
  return true;
}

function rangeLabel(range: TimeRange): string {
  if (range.startTime && range.endTime) {
    return `${displayTime(range.startTime)}–${displayTime(range.endTime)}`;
  }
  if (range.startTime) return `from ${displayTime(range.startTime)}`;
  return "for the requested period";
}

export function buildSchedulerDateContextFallback({
  request,
  date,
  dateContext,
}: DateContextFallbackOptions): string | null {
  if (dateContext.scheduleAvailable === false) {
    return `The schedule for ${date} has not been generated yet. Would you like me to generate the schedule for ${date}?`;
  }

  const staff = Array.isArray(dateContext.staff) ? dateContext.staff : [];
  const clients = Array.isArray(dateContext.clients) ? dateContext.clients : [];
  const slotMinutes = Number(dateContext.rules?.slotLengthMinutes ?? 30) || 30;
  const range = parseTimeRange(request, slotMinutes);
  const normalizedRequest = request.toLowerCase();
  const matchedStaff = findStaff(request, staff);
  const matchedClient = findClient(request, clients);

  const wantsFree = /\b(free|available|availability|unassigned|open)\b/i.test(request);
  const wantsBreak = /\bbreaks?\b/i.test(request);
  const wantsCoverageIssue = /\b(uncovered|coverage issue|coverage problem|needs coverage|unplaced|missing coverage)\b/i.test(request);
  const wantsWho = /\b(who|taking care|covering|covers|with whom|scheduled with)\b/i.test(request);
  const wantsSuggestion = /\b(recommend|recommendation|recommendations|suggest|suggestion|suggestions|what should|best way|improve|improvement)\b/i.test(request) || /cover\s+(?:any\s+)?gaps?/i.test(request);

  if (wantsSuggestion) {
    return buildDateRecommendations(dateContext, date, range);
  }

  if (wantsFree) {
    const fullyFree = staff
      .filter((member: JsonRecord) => member.calledOut !== true)
      .filter((member: JsonRecord) => {
        const availableSlots = Array.isArray(member.availableSlots) ? member.availableSlots : [];
        const freeSlots = Array.isArray(member.freeSlots) ? member.freeSlots : [];
        const requestedAvailable = availableSlots.filter((slot: string) => slotWithinRange(slot, range));
        const requestedFree = freeSlots.filter((slot: string) => slotWithinRange(slot, range));
        if (range.startTime || range.endTime) {
          return requestedAvailable.length > 0 && requestedFree.length === requestedAvailable.length;
        }
        return freeSlots.length > 0;
      })
      .map((member: JsonRecord) => String(member.name));

    if (fullyFree.length > 0) {
      return `On ${date}, staff available and unassigned ${rangeLabel(range)}: ${fullyFree.join(", ")}.`;
    }

    return `On ${date}, I did not find any staff who are both available and unassigned for the entire ${rangeLabel(range)}.`;
  }

  if (matchedStaff) {
    const name = String(matchedStaff.name);
    if (matchedStaff.calledOut === true) {
      return `${name} is marked called out on ${date}.`;
    }

    if (wantsBreak) {
      const breaks = (Array.isArray(matchedStaff.breaks) ? matchedStaff.breaks : []).filter(
        (segment: JsonRecord) => overlaps(segment, range)
      );
      if (breaks.length === 0) {
        return `${name} has no saved break in ${rangeLabel(range)} on ${date}.`;
      }
      return `${name}'s break information for ${date}: ${breaks
        .map((segment: JsonRecord) => formatSegment(segment, "staff"))
        .join("; ")}.`;
    }

    const schedule = (Array.isArray(matchedStaff.schedule) ? matchedStaff.schedule : []).filter(
      (segment: JsonRecord) => overlaps(segment, range)
    );
    if (schedule.length === 0) {
      const availableSlots = Array.isArray(matchedStaff.availableSlots)
        ? matchedStaff.availableSlots.filter((slot: string) => slotWithinRange(slot, range))
        : [];
      if (availableSlots.length > 0) {
        return `${name} has no saved assignment in ${rangeLabel(range)} on ${date}, but is available during at least part of that period.`;
      }
      return `${name} has no saved assignment and is not listed as available in ${rangeLabel(range)} on ${date}.`;
    }
    return `${name}'s schedule for ${date}${range.startTime || range.endTime ? ` (${rangeLabel(range)})` : ""}: ${schedule
      .map((segment: JsonRecord) => formatSegment(segment, "staff"))
      .join("; ")}.`;
  }

  if (matchedClient) {
    const code = String(matchedClient.displayCode);
    const coverage = (Array.isArray(matchedClient.coverage) ? matchedClient.coverage : []).filter(
      (segment: JsonRecord) => overlaps(segment, range)
    );
    const uncovered = (Array.isArray(dateContext.uncoveredRequirements)
      ? dateContext.uncoveredRequirements
      : []
    ).filter(
      (item: JsonRecord) =>
        String(item.clientCode ?? "") === code &&
        slotWithinRange(String(item.startTime ?? ""), range)
    );

    if (coverage.length === 0) {
      if (uncovered.length > 0) {
        return `${code} has uncovered required time on ${date} ${rangeLabel(range)} at ${uncovered
          .map((item: JsonRecord) => displayTime(String(item.startTime)))
          .join(", ")}.`;
      }
      const requiredSlots = Array.isArray(matchedClient.requiredSlots)
        ? matchedClient.requiredSlots.filter((slot: string) => slotWithinRange(slot, range))
        : [];
      if (requiredSlots.length === 0) {
        return `${code} is not scheduled to require coverage in ${rangeLabel(range)} on ${date}.`;
      }
      return `${code} has required time in ${rangeLabel(range)} on ${date}, but I could not find a saved covering assignment for that period.`;
    }

    const coverageText = coverage
      .map((segment: JsonRecord) => formatSegment(segment, "client"))
      .join("; ");
    const issueText = uncovered.length
      ? ` Uncovered required slots remain at ${uncovered
          .map((item: JsonRecord) => displayTime(String(item.startTime)))
          .join(", ")}.`
      : "";
    return `${code}'s coverage for ${date}${range.startTime || range.endTime ? ` (${rangeLabel(range)})` : ""}: ${coverageText}.${issueText}`;
  }

  if (wantsCoverageIssue) {
    const uncovered = Array.isArray(dateContext.uncoveredRequirements)
      ? dateContext.uncoveredRequirements
      : [];
    const unplaced = Array.isArray(dateContext.unplacedAssignments)
      ? dateContext.unplacedAssignments
      : [];
    if (uncovered.length === 0 && unplaced.length === 0) {
      return `I found no uncovered required client slots and no Unplaced assignments on ${date}.`;
    }
    const pieces: string[] = [];
    if (uncovered.length > 0) {
      pieces.push(
        `uncovered: ${uncovered
          .slice(0, 12)
          .map(
            (item: JsonRecord) =>
              `${String(item.clientCode ?? "client")} at ${displayTime(String(item.startTime ?? ""))}`
          )
          .join(", ")}${uncovered.length > 12 ? `, plus ${uncovered.length - 12} more` : ""}`
      );
    }
    if (unplaced.length > 0) {
      pieces.push(`${unplaced.length} assignment${unplaced.length === 1 ? "" : "s"} in Unplaced`);
    }
    return `For ${date}, ${pieces.join("; ")}.`;
  }

  if (wantsWho && (range.startTime || range.endTime)) {
    const assignments = (Array.isArray(dateContext.assignments) ? dateContext.assignments : []).filter(
      (segment: JsonRecord) => overlaps(segment, range)
    );
    if (assignments.length > 0) {
      return `For ${date} ${rangeLabel(range)}: ${assignments
        .slice(0, 24)
        .map((segment: JsonRecord) => formatSegment(segment, "generic"))
        .join("; ")}${assignments.length > 24 ? `; plus ${assignments.length - 24} more assignments` : ""}.`;
    }
  }

  const summary = dateContext.summary ?? {};
  if (/\b(summary|overview|how does|how is|status|health|today's schedule|day look)\b/i.test(request)) {
    return `For ${date}, the saved schedule has ${Number(summary.assignmentCount ?? 0)} assignments covering ${Number(
      summary.coveredClientSlots ?? 0
    )}/${Number(summary.requiredClientSlots ?? 0)} required client blocks. There are ${Number(
      summary.uncoveredClientSlots ?? 0
    )} uncovered required blocks and ${Number(summary.unplacedCount ?? 0)} Unplaced assignments.`;
  }

  if (normalizedRequest.trim()) return null;
  return null;
}
