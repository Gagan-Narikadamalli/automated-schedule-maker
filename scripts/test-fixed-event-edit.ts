import assert from "node:assert/strict";
import { validateFixedEventEdit } from "../src/features/fixed-events/validateFixedEventEdit";

const nap=(scope:"SERIES"|"OCCURRENCE",startTime="11:30",endTime="12:30",date="2026-10-14")=>({
  scope,startTime,endTime,date,priorityCategory:"YOUNGER",
});
assert.equal(validateFixedEventEdit("NAP",nap("OCCURRENCE")),null);
assert.equal(validateFixedEventEdit("NAP",nap("SERIES")),null);
assert.equal(validateFixedEventEdit("NAP",nap("OCCURRENCE","13:00","14:00")),null);
assert.match(validateFixedEventEdit("NAP",nap("OCCURRENCE","11:00","12:00"))??"",/11:30/);
assert.match(validateFixedEventEdit("NAP",nap("OCCURRENCE","13:30","14:30"))??"",/11:30/);
assert.match(validateFixedEventEdit("NAP",nap("OCCURRENCE","11:45","12:15"))??"",/30-minute/);
assert.match(validateFixedEventEdit("NAP",nap("OCCURRENCE","13:00","12:30"))??"",/30-minute/);
assert.match(validateFixedEventEdit("NAP",nap("OCCURRENCE","11:30","12:30","2026-02-30"))??"",/valid date/);
assert.match(validateFixedEventEdit("NAP",{...nap("SERIES"),priorityCategory:"INVALID"})??"",/priority/);
assert.equal(validateFixedEventEdit("SPEECH",{scope:"OCCURRENCE",date:"2026-10-14",startTime:"10:00",endTime:"10:30"}),null);
assert.equal(validateFixedEventEdit("SPEECH",{scope:"SERIES",startTime:"10:30",endTime:"11:00"}),null);
assert.match(validateFixedEventEdit("SPEECH",{scope:"OCCURRENCE",date:"2026-10-14",startTime:"10:00",endTime:"11:00"})??"",/fixed 30-minute/);
assert.match(validateFixedEventEdit("SPEECH",{scope:"OCCURRENCE",date:"2026-10-14",startTime:"10:00",endTime:"10:45"})??"",/30-minute/);
assert.match(validateFixedEventEdit("SPEECH",{scope:"WHOLE_YEAR",startTime:"10:00",endTime:"10:30"})??"",/Choose whether/);
console.log("PASS editing nap and speech events: single occurrence, recurring series, invalid dates, time boundaries, durations and nap priorities");
