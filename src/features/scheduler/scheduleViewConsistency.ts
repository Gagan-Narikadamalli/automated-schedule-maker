/**
 * Staff and client calendar projections must refer to exactly the same saved
 * assignment IDs. Normalize both BSON IDs and populated references before
 * building either view; never stringify an arbitrary object as "[object Object]".
 */
export function scheduleStaffId(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";
  const record = value as { _id?: unknown; id?: unknown; toHexString?: () => string };
  if (typeof record.toHexString === "function") return record.toHexString();
  const raw = record._id ?? record.id;
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object" && typeof (raw as { toHexString?: () => string }).toHexString === "function")
    return (raw as { toHexString: () => string }).toHexString();
  return "";
}

export type ScheduleViewAssignment = {
  staffId: unknown;
  clientId?: unknown;
  startTime: string;
  assignmentType: string;
};
export type ScheduleViewStaff = {
  id: string;
  name: string;
  availableSlots: readonly string[];
  active?: boolean;
  role?: string;
  color?: string;
  teamId?: string | null;
};
export type ScheduleViewWarning = {
  code: "STAFF_NOT_FOUND" | "STAFF_INACTIVE" | "STAFF_UNAVAILABLE" | "STAFF_DOUBLE_BOOKED" | "CLIENT_DOUBLE_BOOKED";
  message: string;
  staffId?: string;
  startTime?: string;
};

/** Keep called-out staff visible when a saved row is still assigned to them. */
export function hiddenFullDayCallOutStaff(
  fullDayCallOutIds: readonly string[],
  staff: readonly ScheduleViewStaff[],
  assignments: readonly ScheduleViewAssignment[]
): string[] {
  const assigned = new Set(assignments.map(row => scheduleStaffId(row.staffId)).filter(Boolean));
  return fullDayCallOutIds.filter(id =>
    staff.some(person => person.id === id && person.availableSlots.length === 0) &&
    !assigned.has(id)
  );
}

/**
 * Check the persisted day, not the planner's draft. Every saved 1:1 assignment
 * has one staff column + one client projection. Keep invalid old rows visible
 * for correction, and warn instead of silently deleting or declaring success.
 */
export function auditSavedDayViewConsistency(
  staff: readonly ScheduleViewStaff[],
  assignments: readonly ScheduleViewAssignment[]
): ScheduleViewWarning[] {
  const byId = new Map(staff.map(person => [person.id,person]));
  const warnings: ScheduleViewWarning[]=[];
  const staffCells=new Set<string>(), clientCells=new Set<string>();
  for(const row of assignments) {
    const id=scheduleStaffId(row.staffId);
    const member=byId.get(id);
    const label=member?.name||"Archived staff";
    const key=id+"|"+row.startTime;
    if(!member) warnings.push({
      code:"STAFF_NOT_FOUND",staffId:id,startTime:row.startTime,
      message:`Saved ${row.startTime} assignment references a missing therapist record. It must remain visible for manager review.`
    });
    else {
      if(member.active===false) warnings.push({
        code:"STAFF_INACTIVE",staffId:id,startTime:row.startTime,
        message:`${label} has a saved ${row.startTime} assignment but their staff profile is inactive. Review coverage.`
      });
      if(!member.availableSlots.includes(row.startTime)) warnings.push({
        code:"STAFF_UNAVAILABLE",staffId:id,startTime:row.startTime,
        message:`${label} has a saved ${row.startTime} assignment outside current availability or during a call-out. Review coverage.`
      });
    }
    if(staffCells.has(key)) warnings.push({
      code:"STAFF_DOUBLE_BOOKED",staffId:id,startTime:row.startTime,
      message:`${label} has multiple saved activities at ${row.startTime}.`
    });
    staffCells.add(key);
    if (row.assignmentType!=="CLIENT_1_TO_1" || !row.clientId) continue;
    const clientId=typeof row.clientId==="object"
      ? scheduleStaffId(row.clientId):String(row.clientId);
    const clientKey=clientId+"|"+row.startTime;
    if(clientCells.has(clientKey)) warnings.push({
      code:"CLIENT_DOUBLE_BOOKED",staffId:id,startTime:row.startTime,
      message:`A client has multiple saved 1:1 assignments at ${row.startTime}. Review overlapping therapists.`
    });
    clientCells.add(clientKey);
  }
  return warnings;
}
