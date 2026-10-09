import assert from "node:assert/strict";
import { generateSchedule } from "../src/features/scheduler/engine/generateSchedule";
import type { SchedulerAssignment, SchedulerClient, SchedulerInput, SchedulerRules, SchedulerStaff } from "../src/features/scheduler/engine/types";

const SLOTS = ["08:00","08:30","09:00","09:30","10:00","10:30","11:00","11:30"];
const DAYS = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
const rules: SchedulerRules = {
  maximumClientsPerTechPerDay: 5, maximumTechsPerClientPerDay: 5,
  minimumClientStaffAssignmentMinutes: 30, maximumClientStaffConsecutiveHours: 4,
  preventSameStaffClientRepeatSameDay: false,
  allowSameStaffClientRepeatForCoverageException: true,
  preferSameTeam: false, preferStaffContinuity: true,
  slotLengthMinutes: 30, preferredStaffPriority: 100, sameTeamPriority: 40,
  continuityPriority: 200, rotationPriority: 60, workloadBalancePriority: 0,
  clientHandoffPenaltyPriority: 200, staffScheduleCompactnessPriority: 8,
  minimalFixAllowProtectedRelocation: true, minimalFixAllowBreakRelocation: true,
  preserveManualOverrides: true, scheduleStabilityPriority: 140,
  weekdayTemplatePriority: 75, weeklyHoursPriority: 12, btCoveragePriority: 500,
  internCoveragePriority: 300, managerCoveragePriority: 125,
  bcbaCoveragePriority: 25, otherCoveragePriority: 75,
  autoUseWeekdayTemplate: true, autoUsePreviousWeekdaySchedule: true,
};
const staff = (id: string, availableSlots = SLOTS): SchedulerStaff => ({
  id, name: id, role: "BT", serviceSetting: "IN_CENTER",
  availableSlots: [...availableSlots], maximumDailyHours: 4,
});
const client = (id: string, requiredSlots = SLOTS): SchedulerClient => ({
  id, displayCode: id, serviceSetting: "IN_CENTER", supportLevel: "ONE_TO_ONE",
  requiredSlots: [...requiredSlots], napSlots: [], speechSlots: [],
  staffRelationships: {},
});
const staffIds = ["s0", "s1", "s2", "s3", "relief"];
const clientIds = ["c0", "c1", "c2", "c3"];
const reference = (source: "COPIED" | "TEMPLATE", weekday: number): SchedulerAssignment[] =>
  clientIds.flatMap((clientId, index) => SLOTS.map((startTime) => ({
    id: `${source}-${weekday}-${clientId}-${startTime}`,
    staffId: source === "COPIED" ? staffIds[(index + weekday) % 4] : staffIds[(index + weekday + 1) % 4],
    clientId, startTime, assignmentType: "CLIENT_1_TO_1" as const,
    source, locked: false,
  })));
function schedule(weekday: number, absentStaffIds: string[] = [], absentClientIds: string[] = []) {
  const input: SchedulerInput = {
    staff: staffIds.map(id => staff(id, absentStaffIds.includes(id) ? [] : SLOTS)),
    clients: clientIds.filter(id => !absentClientIds.includes(id)).map(id => client(id)),
    existingAssignments: [],
    referenceAssignments: [...reference("COPIED", weekday), ...reference("TEMPLATE", weekday)],
    callOutStaffIds: absentStaffIds,
    rules: { ...rules },
  };
  const output = generateSchedule(input);
  const items = output.assignments.filter(a => a.assignmentType === "CLIENT_1_TO_1");
  const perStaff = new Set<string>();
  const perClient = new Set<string>();
  for (const a of items) {
    const skey = `${a.staffId}|${a.startTime}`;
    const ckey = `${a.clientId}|${a.startTime}`;
    assert.ok(!perStaff.has(skey), `Double booked staff ${skey}`);
    assert.ok(!perClient.has(ckey), `Double booked client ${ckey}`);
    perStaff.add(skey);
    perClient.add(ckey);
    assert.ok(!absentStaffIds.includes(a.staffId), `Absent staff assigned: ${a.staffId}`);
    assert.ok(!absentClientIds.includes(a.clientId ?? ""), `Absent client assigned: ${a.clientId}`);
  }
  assert.equal(output.metrics.coveragePercent, 100, "All feasible demand must be covered");
  assert.ok(output.assignments.every(a => a.source !== "AUTO" ||
    !["BREAK_NAP", "BREAK_SPEECH", "NAP"].includes(a.assignmentType)),
    "Auto generation may emit only plain BREAK staff time-off records");
  return items;
}
const signature = (items: SchedulerAssignment[]) => new Map(
  items.map(a => [`${a.clientId}|${a.startTime}`, a.staffId])
);
let workdays = 0, cases = 0, unchangedChecked = 0, previousMatches = 0, totalCells = 0;
const month: Array<{ date: string; weekday: string; cases: number }> = [];
for (let day = 1; day <= 31; day++) {
  const date = `2026-10-${String(day).padStart(2, "0")}`;
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  if (weekday === 0 || weekday === 6) continue;
  workdays++;
  const normal = schedule(weekday);
  const normalMap = signature(normal);
  assert.equal(normalMap.size, clientIds.length * SLOTS.length);
  const prior = signature(reference("COPIED", weekday));
  for (const [key, value] of normalMap) {
    assert.equal(value, prior.get(key), `${date}: last-week pairing must be first`);
    previousMatches++;
    totalCells++;
  }
  // Partial/full call-outs should never change independent client pairings.
  for (const absentStaffId of [staffIds[weekday % 4], staffIds[(weekday + 1) % 4]]) {
    const changed = signature(schedule(weekday, [absentStaffId]));
    for (const [key, staffId] of normalMap) {
      if (staffId !== absentStaffId) {
        assert.equal(changed.get(key), staffId,
          `${date}: staff call-out must not disturb ${key}`);
        unchangedChecked++;
      }
    }
    cases++;
    const restored = signature(schedule(weekday));
    assert.deepEqual([...restored], [...normalMap], `${date}: staff call-in must restore baseline`);
    cases++;
  }
  for (const absentClientId of [clientIds[weekday % 4], clientIds[(weekday + 1) % 4]]) {
    const changed = signature(schedule(weekday, [], [absentClientId]));
    for (const [key, staffId] of normalMap) {
      if (!key.startsWith(`${absentClientId}|`)) {
        assert.equal(changed.get(key), staffId,
          `${date}: client call-out must not disturb ${key}`);
        unchangedChecked++;
      }
    }
    cases++;
    const restored = signature(schedule(weekday));
    assert.deepEqual([...restored], [...normalMap], `${date}: client call-in must restore baseline`);
    cases++;
  }
  cases++;
  month.push({ date, weekday: DAYS[weekday], cases: 9 });
}
assert.equal(workdays, 22, "October 2026 has 22 weekdays");
console.table(month);
console.log(JSON.stringify({
  month: "2026-10", weekdaySchedules: workdays, simulatedScenarios: cases,
  previousWeekMatchingCells: previousMatches, totalCells, matchPercent: (100 * previousMatches / totalCells).toFixed(1),
  unchangedAssignmentsChecked: unchangedChecked, mode: "isolated synthetic in-memory simulation; no production MongoDB writes",
}));
