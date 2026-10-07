import { connectToDatabase } from "@/lib/db";
import { AITrainingExample } from "@/models/AITrainingExample";
import { Client } from "@/models/Client";
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

  const [assignments, staffRecords, clientRecords, templates, feedback] =
    await Promise.all([
      ScheduleAssignment.find({
        locationId: args.locationId,
        date: { $gte: startDate, $lt: args.date },
      })
        .select("date staffId clientId startTime assignmentType")
        .sort({ date: -1 })
        .limit(12000)
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
        .select("name dayOfWeek assignments")
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

  if (templates.length) {
    lines.push(
      `- Active ${targetWeekday} templates: ${
        (templates as Row[])
          .map((item) => `${item.name} (${item.assignments?.length || 0} blocks)`)
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
    "- Historical patterns are advisory only. Current availability, attendance, restrictions, call-outs, protected cells, and scheduler validation remain authoritative."
  );

  return lines.join("\n");
}
