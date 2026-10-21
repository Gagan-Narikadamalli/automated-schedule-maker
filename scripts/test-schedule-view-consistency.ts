import assert from "node:assert/strict";
import {
  scheduleStaffId, hiddenFullDayCallOutStaff, auditSavedDayViewConsistency,
} from "../src/features/scheduler/scheduleViewConsistency";

const staff=[
  {id:"s1",name:"Danna",availableSlots:["12:00"],active:true},
  {id:"s2",name:"Suzy",availableSlots:[],active:true},
  {id:"s3",name:"Archived therapist",availableSlots:[],active:false},
  {id:"s4",name:"Bella",availableSlots:[],active:true}
];
const booked=[
  {staffId:"s1",clientId:"c1",startTime:"12:00",assignmentType:"CLIENT_1_TO_1"},
  {staffId:"s2",clientId:"c2",startTime:"12:00",assignmentType:"CLIENT_1_TO_1"},
  {staffId:"s3",clientId:"c3",startTime:"13:00",assignmentType:"CLIENT_1_TO_1"},
];
assert.equal(scheduleStaffId("s1"),"s1");
assert.equal(scheduleStaffId({_id:"s1"}),"s1");
assert.equal(scheduleStaffId({id:"s1"}),"s1");
assert.equal(scheduleStaffId({toHexString:()=>"s1"}),"s1");
assert.equal(scheduleStaffId({}),"","Never display [object Object] as a staff ID");
assert.deepEqual(hiddenFullDayCallOutStaff(["s2","s4"],staff,booked),["s4"],
  "A fully called-out therapist who still has saved client coverage must not disappear from Staff view");
const issues=auditSavedDayViewConsistency(staff,booked);
assert.equal(issues.some(x=>x.code==="STAFF_UNAVAILABLE"&&x.staffId==="s2"),true,
  "Persisted coverage during a call-out must be visibly flagged");
assert.equal(issues.some(x=>x.code==="STAFF_INACTIVE"&&x.staffId==="s3"),true,
  "Inactive staff with saved clients must be visible for manager review");
assert.equal(issues.some(x=>x.staffId==="s1"),false,
  "Valid live assignment must not trigger a false warning");
const missing=auditSavedDayViewConsistency(staff,[...booked,{
  staffId:{_id:"deletedStaff"},clientId:"c4",startTime:"12:30",assignmentType:"CLIENT_1_TO_1"
}]);
assert.equal(missing.some(x=>x.code==="STAFF_NOT_FOUND"&&x.staffId==="deletedStaff"),true);
const duplicate=auditSavedDayViewConsistency(staff,[...booked,
  {staffId:"s1",clientId:"c5",startTime:"12:00",assignmentType:"CLIENT_1_TO_1"},
  {staffId:"s4",clientId:"c1",startTime:"12:00",assignmentType:"CLIENT_1_TO_1"}]);
assert.equal(duplicate.some(x=>x.code==="STAFF_DOUBLE_BOOKED"),true);
assert.equal(duplicate.some(x=>x.code==="CLIENT_DOUBLE_BOOKED"),true);
assert.deepEqual(auditSavedDayViewConsistency(staff,[booked[0]]),[]);
console.log("PASS Staff and Client projections: saved coverage survives call-outs/inactive staff; staff ID normalization, warnings, and double-booking checks.");
