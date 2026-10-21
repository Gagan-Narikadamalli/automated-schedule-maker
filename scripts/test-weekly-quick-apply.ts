import assert from "node:assert/strict";
import {
  applyWeeklyQuickSelection,
  createWeeklySchedule,
  patternsFromWeeklySchedule,
  weeklyScheduleFromPatterns,
} from "../src/features/shared/weeklySchedule";

const weekdays=["MONDAY","TUESDAY","WEDNESDAY","THURSDAY","FRIDAY"];
const original=createWeeklySchedule("09:00","17:00",true);

// Reproduce the reported bug: select all, then uncheck Tuesday and reapply.
const allDays=applyWeeklyQuickSelection(original,weekdays,"09:00","17:00");
const withoutTuesday=applyWeeklyQuickSelection(
  allDays,["MONDAY","WEDNESDAY","THURSDAY","FRIDAY"],"09:00","17:00"
);
assert.equal(withoutTuesday.TUESDAY.enabled,false,"Unchecked Tuesday must be disabled.");
assert.deepEqual(
  weekdays.filter(day=>withoutTuesday[day].enabled),
  ["MONDAY","WEDNESDAY","THURSDAY","FRIDAY"]
);
assert.equal(original.TUESDAY.enabled,true,"Previous React state must not be mutated.");
assert.equal(withoutTuesday.TUESDAY.startTime,"09:00","Disabled day preserves its draft start time.");
assert.equal(withoutTuesday.TUESDAY.endTime,"17:00");

// Reapplying another selection is a replacement, not an additive merge.
const onlyThursday=applyWeeklyQuickSelection(
  withoutTuesday,["THURSDAY"],"08:00","16:00"
);
assert.deepEqual(weekdays.filter(day=>onlyThursday[day].enabled),["THURSDAY"]);
assert.equal(onlyThursday.THURSDAY.startTime,"08:00");

// Opt-in additive mode supports two or more different shift groups.
const monWed=applyWeeklyQuickSelection(
  createWeeklySchedule("08:00","16:00",false),
  ["MONDAY","TUESDAY","WEDNESDAY"],"09:00","17:00"
);
const splitWeek=applyWeeklyQuickSelection(
  monWed,["THURSDAY","FRIDAY"],"08:00","16:00",true
);
assert.deepEqual(weekdays.filter(day=>splitWeek[day].enabled),weekdays);
assert.equal(splitWeek.MONDAY.startTime,"09:00");
assert.equal(splitWeek.THURSDAY.startTime,"08:00");
assert.deepEqual(
  patternsFromWeeklySchedule(splitWeek,"Regular shift").map(pattern=>({
    days:pattern.days,startTime:pattern.startTime,endTime:pattern.endTime
  })),
  [
    {days:["MONDAY","TUESDAY","WEDNESDAY"],startTime:"09:00",endTime:"17:00"},
    {days:["THURSDAY","FRIDAY"],startTime:"08:00",endTime:"16:00"},
  ]
);
const roundTrip=weeklyScheduleFromPatterns(
  patternsFromWeeklySchedule(withoutTuesday,"Regular shift"),"08:00","17:00"
);
assert.equal(roundTrip.TUESDAY.enabled,false,"Unchecked day must stay off after save/reload.");
assert.equal(roundTrip.MONDAY.enabled,true);
assert.equal(roundTrip.THURSDAY.enabled,true);
const restored=applyWeeklyQuickSelection(withoutTuesday,["TUESDAY"],"10:00","15:00",true);
assert.equal(restored.TUESDAY.enabled,true);
assert.equal(restored.MONDAY.enabled,true);
assert.equal(restored.TUESDAY.startTime,"10:00");

console.log("PASS staff/client Quick Apply: replace deselected weekdays, preserve additive multi-shifts, persist disabled days and avoid state mutation.");
