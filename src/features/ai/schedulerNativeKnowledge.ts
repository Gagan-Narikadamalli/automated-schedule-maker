import { connectToDatabase } from "@/lib/db";
import { AITrainingExample } from "@/models/AITrainingExample";
import { Client } from "@/models/Client";
import { HistoricalScheduleAssignment } from "@/models/HistoricalScheduleAssignment";
import { ScheduleAssignment } from "@/models/ScheduleAssignment";
import { ScheduleTemplate } from "@/models/ScheduleTemplate";
import { Staff } from "@/models/Staff";

type Row = Record<string, any>;

function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function weekday(date: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    timeZone: "UTC",
  })
    .format(new Date(`${date}T12:00:00Z`))
    .toUpperCase();
}

function topCounts(
  counts: Map<string, number>,
  limit: number
): Array<{ key: string; count: number }> {
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, limit);
}

export async function buildNativeHistoricalKnowledge(args: {
  locationId: string;
  date: string;
  query?: string;
}): Promise<string> {
  await connectToDatabase();

  const startDate = shiftDate(args.date, -365);
  const targetWeekday = weekday(args.date);

  const [
    assignments,
    historicalWorkbookRows,
    staffRecords,
    clientRecords,
    templates,
    feedback,
  ] = await Promise.all([
      ScheduleAssignment.find({
        locationId: args.locationId,
        date: { $gte: startDate, $lt: args.date },
      })
        .select("date staffId clientId startTime assignmentType")
        .sort({ date: -1 })
        .limit(12000)
        .lean(),
      HistoricalScheduleAssignment.find({
        locationId: args.locationId,
        dayOfWeek: targetWeekday,
        scheduleDate: { $lt: args.date },
      })
        .select(
          "sourceName sheetName scheduleDate rawStaffName rawClientCode staffId clientId startTime assignmentType rawText"
        )
        .sort({ scheduleDate: -1, startTime: 1 })
        .limit(8000)
        .lean(),
      Staff.find({ locationId: args.locationId })
        .select("_id fullName active")
        .lean(),
      Client.find({ locationId: args.locationId })
        .select("_id displayCode active")
        .lean(),
      ScheduleTemplate.find({
        locationId: args.locationId,
        active: true,
        dayOfWeek: targetWeekday,
      })
        .select(
          "name dayOfWeek assignments sourceType sourceName sourceDate styleNotes learningOnly learningProfile"
        )
        .sort({ name: 1 })
        .lean(),
      AITrainingExample.find({
        locationId: args.locationId,
        managerAccepted: { $in: [true, false] },
      })
        .select("request managerAccepted managerCorrection toolsSelected")
        .sort({ createdAt: -1 })
        .limit(200)
        .lean(),
    ]);

  const staffNames = new Map(
    (staffRecords as Row[]).map((item) => [String(item._id), String(item.fullName)])
  );
  const clientCodes = new Map(
    (clientRecords as Row[]).map((item) => [
      String(item._id),
      String(item.displayCode),
    ])
  );

  const pairings = new Map<string, number>();
  const exactSlots = new Map<string, number>();
  const breaks = new Map<string, number>();
  const workbookPairings = new Map<string, number>();
  const workbookExactSlots = new Map<string, number>();
  const workbookBreaks = new Map<string, number>();
  const workbookSheets = new Set<string>();
  const workbookDates = new Set<string>();
  const workbookStaffClients = new Map<string, Set<string>>();
  const workbookClientStaff = new Map<string, Set<string>>();
  const scheduleDates = new Set<string>();
  const sameWeekdayDates = new Set<string>();

  for (const raw of assignments as Row[]) {
    const date = String(raw.date || "");
    if (!date) continue;
    scheduleDates.add(date);
    if (weekday(date) === targetWeekday) sameWeekdayDates.add(date);

    const staffName = staffNames.get(String(raw.staffId || "")) || "Unknown staff";
    const clientCode = clientCodes.get(String(raw.clientId || "")) || "";
    const startTime = String(raw.startTime || "");
    const type = String(raw.assignmentType || "");

    if (type === "CLIENT_1_TO_1" && clientCode) {
      const pairKey = `${staffName} ↔ ${clientCode}`;
      pairings.set(pairKey, (pairings.get(pairKey) || 0) + 1);
      const exactKey = `${staffName} ↔ ${clientCode} @ ${startTime}`;
      exactSlots.set(exactKey, (exactSlots.get(exactKey) || 0) + 1);
    }
    if (["BREAK", "BREAK_NAP", "BREAK_SPEECH"].includes(type)) {
      const key = `${staffName} @ ${startTime}`;
      breaks.set(key, (breaks.get(key) || 0) + 1);
    }
  }

  for (const raw of historicalWorkbookRows as Row[]) {
    const scheduleDate = String(raw.scheduleDate || "");
    const sourceName = String(raw.sourceName || "Workbook");
    const sheetName = String(raw.sheetName || targetWeekday);
    const staffName =
      staffNames.get(String(raw.staffId || "")) ||
      String(raw.rawStaffName || "Unknown staff");
    const clientCode =
      clientCodes.get(String(raw.clientId || "")) ||
      String(raw.rawClientCode || "");
    const startTime = String(raw.startTime || "");
    const type = String(raw.assignmentType || "");

    if (scheduleDate) {
      workbookDates.add(scheduleDate);
    }
    workbookSheets.add(`${sourceName} / ${sheetName}`);

    if (type === "CLIENT_1_TO_1" && clientCode) {
      const pairKey = `${staffName} ↔ ${clientCode}`;
      workbookPairings.set(
        pairKey,
        (workbookPairings.get(pairKey) || 0) + 1
      );

      if (startTime) {
        const exactKey = `${staffName} ↔ ${clientCode} @ ${startTime}`;
        workbookExactSlots.set(
          exactKey,
          (workbookExactSlots.get(exactKey) || 0) + 1
        );
      }

      if (scheduleDate) {
        const staffDayKey = `${scheduleDate}|${staffName}`;
        const clientDayKey = `${scheduleDate}|${clientCode}`;
        const staffClients =
          workbookStaffClients.get(staffDayKey) ?? new Set<string>();
        staffClients.add(clientCode);
        workbookStaffClients.set(staffDayKey, staffClients);

        const clientStaff =
          workbookClientStaff.get(clientDayKey) ?? new Set<string>();
        clientStaff.add(staffName);
        workbookClientStaff.set(clientDayKey, clientStaff);
      }
    }

    if (
      ["BREAK", "BREAK_NAP", "BREAK_SPEECH"].includes(type) &&
      startTime
    ) {
      const key = `${staffName} @ ${startTime}`;
      workbookBreaks.set(
        key,
        (workbookBreaks.get(key) || 0) + 1
      );
    }
  }

  const averageSetSize = (values: Iterable<Set<string>>) => {
    const sizes = [...values].map((value) => value.size);
    if (!sizes.length) return 0;
    return sizes.reduce((sum, value) => sum + value, 0) / sizes.length;
  };
  const averageWorkbookClientsPerStaffDay = averageSetSize(
    workbookStaffClients.values()
  );
  const averageWorkbookStaffPerClientDay = averageSetSize(
    workbookClientStaff.values()
  );

  const accepted = (feedback as Row[]).filter(
    (item) => item.managerAccepted === true
  ).length;
  const corrected = (feedback as Row[]).filter(
    (item) => item.managerAccepted === false
  ).length;
  const correctionSignals = (feedback as Row[])
    .filter(
      (item) =>
        item.managerAccepted === false &&
        typeof item.managerCorrection === "string" &&
        item.managerCorrection.trim()
    )
    .slice(0, 8)
    .map((item) => item.managerCorrection.trim().slice(0, 240));

  const lines = [
    `Historical scheduler memory for the 365 days before ${args.date}:`,
    `- Saved schedule days: ${scheduleDates.size}`,
    `- Same-${targetWeekday.toLowerCase()} schedule days: ${sameWeekdayDates.size}`,
    `- Historical assignment records reviewed: ${assignments.length}`,
    `- Imported same-${targetWeekday.toLowerCase()} workbook rows reviewed: ${historicalWorkbookRows.length} across ${workbookDates.size} historical date(s).`,
  ];

  const topPairs = topCounts(pairings, 8);
  if (topPairs.length) {
    lines.push(
      "- Frequent staff/client pairings: " +
        topPairs.map((item) => `${item.key} (${item.count})`).join(", ")
    );
  }

  const topSlots = topCounts(exactSlots, 8);
  if (topSlots.length) {
    lines.push(
      "- Frequent exact staff/client/time patterns: " +
        topSlots.map((item) => `${item.key} (${item.count})`).join(", ")
    );
  }

  const topBreaks = topCounts(breaks, 8);
  if (topBreaks.length) {
    lines.push(
      "- Frequent break patterns: " +
        topBreaks.map((item) => `${item.key} (${item.count})`).join(", ")
    );
  }

  const topWorkbookPairs = topCounts(workbookPairings, 10);
  if (topWorkbookPairs.length) {
    lines.push(
      "- Workbook staff/client pairings: " +
        topWorkbookPairs
          .map((item) => `${item.key} (${item.count})`)
          .join(", ")
    );
  }

  const topWorkbookSlots = topCounts(workbookExactSlots, 10);
  if (topWorkbookSlots.length) {
    lines.push(
      "- Workbook exact-time patterns: " +
        topWorkbookSlots
          .map((item) => `${item.key} (${item.count})`)
          .join(", ")
    );
  }

  const topWorkbookBreaks = topCounts(workbookBreaks, 8);
  if (topWorkbookBreaks.length) {
    lines.push(
      "- Workbook break patterns: " +
        topWorkbookBreaks
          .map((item) => `${item.key} (${item.count})`)
          .join(", ")
    );
  }

  if (workbookSheets.size) {
    lines.push(
      "- Workbook sheet sources: " +
        [...workbookSheets].slice(0, 8).join(", ")
    );
  }

  if (
    averageWorkbookClientsPerStaffDay > 0 ||
    averageWorkbookStaffPerClientDay > 0
  ) {
    lines.push(
      `- Workbook structure: average ${averageWorkbookClientsPerStaffDay.toFixed(
        1
      )} distinct clients per staff/day and ${averageWorkbookStaffPerClientDay.toFixed(
        1
      )} distinct staff per client/day on historical ${targetWeekday.toLowerCase()} sheets.`
    );
  }

  if (templates.length) {
    lines.push(
      `- Active ${targetWeekday} templates: ${
        (templates as Row[])
          .map((item) => {
            const source =
              item.sourceType === "HISTORICAL_WORKBOOK"
                ? ` workbook ${item.sourceDate || ""}`
                : "";
            const notes = Array.isArray(item.styleNotes)
              ? item.styleNotes.filter(Boolean).slice(0, 3).join("; ")
              : "";
            const profile =
              item.learningProfile &&
              typeof item.learningProfile === "object"
                ? item.learningProfile
                : null;
            const learning =
              item.learningOnly === true
                ? ` learning-only profile; preferred clients/staff=${profile?.preferredClientsPerStaffPerDay ?? 2}; preferred staff/client=${profile?.preferredStaffPerClientPerDay ?? 2}; continuity=${profile?.continuityPriority ?? "default"}; handoff penalty=${profile?.clientHandoffPenaltyPriority ?? "default"}`
                : "";
            return `${item.name} (${item.assignments?.length || 0} blocks${source ? `,${source}` : ""}${learning ? `,${learning}` : ""})${notes ? ` — style: ${notes}` : ""}`;
          })
          .join(", ")
      }`
    );
  } else {
    lines.push(`- Active ${targetWeekday} templates: none.`);
  }

  lines.push(
    `- Manager feedback examples: ${accepted} accepted, ${corrected} corrected.`
  );

  if (correctionSignals.length) {
    lines.push(
      "- Recent manager correction signals: " +
        correctionSignals.map((item) => `“${item}”`).join(" | ")
    );
  }

  lines.push(
    "- Livingston workbook/template learning is structural, not blind copying: prefer long continuous client/staff blocks, natural handoffs around Speech/Nap/breaks, roughly 2-3 clients per staff when practical, and about 2 stable staff blocks for a long-day client when that improves balance."
  );
  lines.push(
    "- If a staff member still needs a break, temporarily hand the client to a free eligible staff member for that 30-minute break when possible, then return the client to the prior staff member if continuity and coverage remain valid."
  );
  lines.push(
    "- Historical patterns and templates are advisory only. Current availability, attendance, restrictions, call-outs, protected cells, required coverage, Speech, Nap, staff breaks, and scheduler validation remain authoritative."
  );

  return lines.join("\n");
}
