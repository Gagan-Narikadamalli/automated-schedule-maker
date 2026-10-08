import assert from "node:assert/strict";

import {
  applyTemplateLearningProfiles,
  type ExtendedSchedulerRules,
} from "../src/features/scheduler/server/buildDaySchedulerInput";

const baseRules = {
  autoUseWeekdayTemplate: true,
  humanStyleBlockBalancingEnabled: true,
  preferredClientsPerStaffPerDay: 2,
  preferredStaffPerClientPerDay: 2,
  continuityPriority: 200,
  clientHandoffPenaltyPriority: 200,
  workloadBalancePriority: 0,
  staffScheduleCompactnessPriority: 8,
} as ExtendedSchedulerRules;

const merged = applyTemplateLearningProfiles(baseRules, [
  {
    name: "Workbook learning",
    learningOnly: true,
    assignments: [],
    learningProfile: {
      humanStyleBlockBalancingEnabled: true,
      preferredClientsPerStaffPerDay: 2,
      preferredStaffPerClientPerDay: 2,
      continuityPriority: 240,
      clientHandoffPenaltyPriority: 250,
      workloadBalancePriority: 10,
      staffScheduleCompactnessPriority: 25,
    },
  },
  {
    name: "Saved live day",
    assignments: Array.from({ length: 32 }, () => ({})),
    learningProfile: {
      humanStyleBlockBalancingEnabled: true,
      preferredClientsPerStaffPerDay: 3,
      preferredStaffPerClientPerDay: 2,
      continuityPriority: 180,
      clientHandoffPenaltyPriority: 190,
      workloadBalancePriority: 0,
      staffScheduleCompactnessPriority: 5,
    },
  },
]);

assert.equal(
  Math.round(merged.continuityPriority),
  220,
  "Learning-only workbook templates should have meaningful weight when combined with saved-day templates."
);
assert.equal(
  Math.round(merged.clientHandoffPenaltyPriority),
  230,
  "All active same-weekday template learning profiles should contribute to the combined handoff preference."
);
assert.equal(
  Math.round((merged.preferredClientsPerStaffPerDay ?? 0) * 100) / 100,
  2.33,
  "Preferred clients per staff should be learned across all active same-weekday templates."
);
assert.equal(
  merged.humanStyleBlockBalancingEnabled,
  true,
  "Workbook learning should keep human-style block balancing enabled."
);

const unchanged = applyTemplateLearningProfiles(baseRules, [
  { name: "No profile", assignments: [] },
]);

assert.equal(
  unchanged,
  baseRules,
  "Templates with no learning profile should not change clinic rules."
);

console.log("Weekday template learning regression scenarios passed.");
