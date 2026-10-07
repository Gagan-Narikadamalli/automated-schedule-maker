import assert from "node:assert/strict";

import {
  repairSchedule,
  type RepairAffectedSlot,
} from "../src/features/scheduler/engine/repairSchedule";
import type {
  SchedulerAssignment,
  SchedulerClient,
  SchedulerInput,
  SchedulerRules,
  SchedulerStaff,
} from "../src/features/scheduler/engine/types";

const RULES: SchedulerRules = {
  maximumClientsPerTechPerDay: 6,
  maximumTechsPerClientPerDay: 4,
  minimumClientStaffAssignmentMinutes: 30,
  maximumClientStaffConsecutiveHours: 4,
  preventSameStaffClientRepeatSameDay: true,
  allowSameStaffClientRepeatForCoverageException: true,
  preferSameTeam: true,
  preferStaffContinuity: true,
  slotLengthMinutes: 30,
  preferredStaffPriority: 100,
  sameTeamPriority: 40,
  continuityPriority: 35,
  rotationPriority: 60,
  workloadBalancePriority: 10,
  clientHandoffPenaltyPriority: 25,
  staffScheduleCompactnessPriority: 8,
  minimalFixAllowProtectedRelocation: true,
  minimalFixAllowBreakRelocation: true,
  preserveManualOverrides: true,
  scheduleStabilityPriority: 140,
  weekdayTemplatePriority: 75,
  weeklyHoursPriority: 12,
  historicalPairingPriority: 70,
  historicalSlotPriority: 90,
  historicalBreakPriority: 80,
  btCoveragePriority: 500,
  internCoveragePriority: 300,
  managerCoveragePriority: 125,
  bcbaCoveragePriority: 25,
  otherCoveragePriority: 75,
  autoUseWeekdayTemplate: true,
  autoUsePreviousWeekdaySchedule: true,
  autoUseHistoricalPatterns: true,
};

function staff(
  id: string,
  name: string,
  availableSlots: string[]
): SchedulerStaff {
  return {
    id,
    name,
    role: "BT",
    serviceSetting: "IN_CENTER",
    availableSlots,
    maximumWeeklyHours: 40,
    scheduledWeeklyClientHoursBeforeDate: 0,
  };
}

function client(
  id: string,
  code: string,
  requiredSlots: string[]
): SchedulerClient {
  return {
    id,
    displayCode: code,
    serviceSetting: "IN_CENTER",
    supportLevel: "ONE_TO_ONE",
    requiredSlots,
    napSlots: [],
    speechSlots: [],
    staffRelationships: {},
  };
}

function assignment(
  id: string,
  staffId: string,
  clientId: string,
  startTime: string
): SchedulerAssignment {
  return {
    id,
    staffId,
    clientId,
    startTime,
    assignmentType: "CLIENT_1_TO_1",
    source: "AUTO",
    locked: false,
  };
}

function input(
  staffMembers: SchedulerStaff[],
  clients: SchedulerClient[],
  existingAssignments: SchedulerAssignment[]
): SchedulerInput {
  return {
    staff: staffMembers,
    clients,
    existingAssignments,
    referenceAssignments: [],
    callOutStaffIds: [],
    rules: RULES,
  };
}

function testOnlyAffectedSlotIsReplaced() {
  const staffMembers = [
    staff("bt-called-out", "Called Out BT", ["08:00"]),
    staff("bt-busy", "Busy BT", ["08:00", "09:00"]),
    staff("bt-relief", "Relief BT", ["09:00"]),
  ];

  const clients = [
    client("client-a", "AA", ["08:00", "09:00"]),
    client("client-b", "BB", ["09:00"]),
  ];

  const existingAssignments = [
    assignment(
      "existing-a-0800",
      "bt-called-out",
      "client-a",
      "08:00"
    ),
    assignment(
      "existing-a-0900",
      "bt-called-out",
      "client-a",
      "09:00"
    ),
    assignment(
      "existing-b-0900",
      "bt-busy",
      "client-b",
      "09:00"
    ),
  ];

  const affectedSlots: RepairAffectedSlot[] = [
    {
      staffId: "bt-called-out",
      startTime: "09:00",
    },
  ];

  const result = repairSchedule(
    input(staffMembers, clients, existingAssignments),
    ["bt-called-out"],
    affectedSlots
  );

  assert.ok(
    result.assignments.some(
      (item) => item.id === "existing-a-0800"
    ),
    "The called-out staff member's assignment outside the affected time must stay in place."
  );

  assert.ok(
    result.assignments.some(
      (item) => item.id === "existing-b-0900"
    ),
    "Assignments for unaffected staff must stay in place during repair."
  );

  assert.ok(
    !result.assignments.some(
      (item) => item.id === "existing-a-0900"
    ),
    "The assignment inside the call-out interval should be removed from the repair plan."
  );

  assert.ok(
    result.assignments.some(
      (item) =>
        item.clientId === "client-a" &&
        item.startTime === "09:00" &&
        item.staffId === "bt-relief"
    ),
    "The repair should fill the new client gap with an eligible relief staff member."
  );
}

function testEmptyAffectedSlotListDoesNotClearWholeStaffDay() {
  const staffMembers = [
    staff("bt-one", "BT One", ["08:00"]),
    staff("bt-two", "BT Two", ["08:00", "09:00"]),
  ];
  const clients = [
    client("client-a", "AA", ["08:00"]),
    client("client-b", "BB", ["09:00"]),
  ];
  const existingAssignments = [
    assignment("existing-a", "bt-one", "client-a", "08:00"),
  ];

  const result = repairSchedule(
    input(staffMembers, clients, existingAssignments),
    ["bt-one"],
    []
  );

  assert.ok(
    result.assignments.some((item) => item.id === "existing-a"),
    "An empty slot-scoped impact list must not remove every assignment for the staff member."
  );

  assert.ok(
    result.assignments.some(
      (item) =>
        item.clientId === "client-b" &&
        item.startTime === "09:00"
    ),
    "Repair may still fill an existing uncovered requirement while preserving all unaffected cells."
  );
}

function runRepairRegressionScenarios() {
  testOnlyAffectedSlotIsReplaced();
  testEmptyAffectedSlotListDoesNotClearWholeStaffDay();

  console.log("Targeted call-out repair regression scenarios passed.");
}

runRepairRegressionScenarios();
