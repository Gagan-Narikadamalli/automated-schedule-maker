type JsonRecord = Record<string, any>;

type TimeRange = {
  startTime: string | null;
  endTime: string | null;
};

function displayTime(time: unknown): string {
  const value = String(time ?? "");
  const match = value.match(/^(\d{2}):(\d{2})$/);
  if (!match) return value || "unknown time";
  const hour = Number(match[1]);
  const suffix = hour >= 12 ? "PM" : "AM";
  return `${hour % 12 || 12}:${match[2]} ${suffix}`;
}

function withinRange(slot: string, range: TimeRange): boolean {
  if (range.startTime && slot < range.startTime) return false;
  if (range.endTime && slot >= range.endTime) return false;
  return true;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function recordArray(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.filter(
        (entry): entry is JsonRecord =>
          Boolean(entry) && typeof entry === "object" && !Array.isArray(entry)
      )
    : [];
}

function freeStaffAt(staff: JsonRecord[], slot: string, excludedName?: string): JsonRecord[] {
  return staff.filter((member) => {
    if (member.calledOut === true) return false;
    if (excludedName && String(member.name) === excludedName) return false;
    return (
      stringArray(member.availableSlots).includes(slot) &&
      stringArray(member.freeSlots).includes(slot)
    );
  });
}

function assignmentAt(
  assignments: JsonRecord[],
  staffName: string,
  slot: string
): JsonRecord | null {
  return (
    assignments.find(
      (assignment) =>
        String(assignment.staffName ?? "") === staffName &&
        String(assignment.startTime ?? "") === slot
    ) ?? null
  );
}

function assignmentSlotsForStaff(
  assignments: JsonRecord[],
  staffName: string,
  start: string,
  end: string,
  range: TimeRange
): JsonRecord[] {
  return assignments.filter((assignment) => {
    const slot = String(assignment.startTime ?? "");
    return (
      String(assignment.staffName ?? "") === staffName &&
      slot >= start &&
      slot < end &&
      withinRange(slot, range)
    );
  });
}

export function buildDateRecommendations(
  dateContext: JsonRecord,
  date: string,
  range: TimeRange
): string | null {
  if (dateContext.scheduleAvailable === false) {
    return `The schedule for ${date} has not been generated yet. Would you like me to generate the schedule for ${date}?`;
  }

  const staff = recordArray(dateContext.staff);
  const assignments = recordArray(dateContext.assignments);
  const uncovered = recordArray(dateContext.uncoveredRequirements).filter((item) =>
    withinRange(String(item.startTime ?? ""), range)
  );
  const rules = (dateContext.rules ?? {}) as JsonRecord;
  const breakEligibilityHours = Number(rules.breakEligibilityHours ?? 0);
  const breakStart = String(rules.breakWindowStart ?? "11:00");
  const breakEnd = String(rules.breakWindowEnd ?? "14:00");

  const lines: string[] = [
    `Based on the analyzed schedule for ${date}, these are the changes I would recommend. I have not changed the schedule.`,
  ];

  lines.push("Coverage recommendations:");
  if (uncovered.length === 0) {
    lines.push("• No uncovered required client slots were found in the requested range.");
  } else {
    for (const gap of uncovered.slice(0, 10)) {
      const slot = String(gap.startTime ?? "");
      const clientCode = String(gap.clientCode ?? "client");
      const direct = freeStaffAt(staff, slot);
      if (direct.length > 0) {
        const bestNames = direct.slice(0, 3).map((member) => String(member.name));
        lines.push(
          `• ${clientCode} at ${displayTime(slot)}: I would first try ${bestNames.join(
            ", "
          )} because they are available and currently unassigned at that time.`
        );
        continue;
      }

      let chain: string | null = null;
      for (const occupied of assignments.filter(
        (assignment) =>
          String(assignment.startTime ?? "") === slot &&
          String(assignment.assignmentType ?? "") === "CLIENT_1_TO_1" &&
          Boolean(assignment.staffName) &&
          Boolean(assignment.clientCode)
      )) {
        const currentStaff = String(occupied.staffName);
        const alternatives = freeStaffAt(staff, slot, currentStaff);
        if (alternatives.length === 0) continue;
        chain = `move ${String(occupied.clientCode)} from ${currentStaff} to ${String(
          alternatives[0].name
        )}, then use ${currentStaff} for ${clientCode}`;
        break;
      }

      if (chain) {
        lines.push(`• ${clientCode} at ${displayTime(slot)}: I would ${chain}.`);
      } else {
        lines.push(
          `• ${clientCode} at ${displayTime(slot)}: I did not find a simple free-staff or one-handoff option, so this slot needs a more involved reassignment or an approved override.`
        );
      }
    }
    if (uncovered.length > 10) {
      lines.push(`• ${uncovered.length - 10} more uncovered slot(s) also need attention.`);
    }
  }

  const eligibleWithoutBreak = staff.filter((member) => {
    const availableHours = Number(member.availableHours ?? 0);
    const breaks = recordArray(member.breaks);
    return availableHours >= breakEligibilityHours && breaks.length === 0;
  });

  lines.push("Break recommendations:");
  if (eligibleWithoutBreak.length === 0) {
    lines.push("• I did not find an eligible staff member missing a saved break.");
  } else {
    for (const member of eligibleWithoutBreak.slice(0, 10)) {
      const staffName = String(member.name ?? "staff member");
      const freeBreakSlots = stringArray(member.freeSlots).filter(
        (slot) => slot >= breakStart && slot < breakEnd && withinRange(slot, range)
      );

      if (freeBreakSlots.length > 0) {
        lines.push(
          `• ${staffName}: I would add the break at ${displayTime(
            freeBreakSlots[0]
          )} because that slot is already available and unassigned.`
        );
        continue;
      }

      const occupiedBreakSlots = assignmentSlotsForStaff(
        assignments,
        staffName,
        breakStart,
        breakEnd,
        range
      );
      let handoff: string | null = null;
      for (const occupied of occupiedBreakSlots) {
        if (
          String(occupied.assignmentType ?? "") !== "CLIENT_1_TO_1" ||
          !occupied.clientCode
        ) {
          continue;
        }
        const slot = String(occupied.startTime ?? "");
        const alternatives = freeStaffAt(staff, slot, staffName);
        if (alternatives.length === 0) continue;
        handoff = `at ${displayTime(slot)}, move ${String(occupied.clientCode)} to ${String(
          alternatives[0].name
        )}, then give ${staffName} the break`;
        break;
      }

      if (handoff) {
        lines.push(`• ${staffName}: I would ${handoff}.`);
      } else {
        lines.push(
          `• ${staffName}: there is no simple free break-window slot or one-step handoff, so creating the break will require a more involved reassignment or an approved override.`
        );
      }
    }
    if (eligibleWithoutBreak.length > 10) {
      lines.push(`• ${eligibleWithoutBreak.length - 10} more staff member(s) also need break review.`);
    }
  }

  lines.push(
    "These recommendations use broad scheduling judgment rather than every soft clinic optimization preference. If you ask me to apply one, the actual scheduler tools will validate it. If a rule or protected-cell override is required, I will show you the exact conflict and ask for permission before overriding it."
  );

  return lines.join("\n");
}
