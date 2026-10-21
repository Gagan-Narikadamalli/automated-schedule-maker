import { applyAttendanceWindow, type AttendanceWindow } from "@/features/scheduler/engine/attendanceWindows";
import { getEventStartSlotsInsideTimeRange, getSlotsInsideTimeRange, patternMatchesDate } from "@/features/scheduler/engine/dateUtils";

export type ClientNapAttendance = {
  startDate?: string | Date | null;
  endDate?: string | Date | null;
  attendancePatterns?: Array<{ days?: string[]; startTime?: string; endTime?: string }>;
};
export type ClientNapAttendanceChange = {
  changeType: "CALL_IN" | "CALL_OUT";
  startTime: string;
  endTime: string;
};

/** Clinic date strings are compared as dates, not as UTC timestamps at midnight. */
function datePart(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0,10);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : date.toISOString().slice(0,10);
}
export function isClientActiveOnDate(client: ClientNapAttendance, date: string): boolean {
  const start=datePart(client.startDate);
  const end=datePart(client.endDate);
  return (!start || date>=start) && (!end || date<=end);
}

/**
 * Each child's own attendance patterns drive nap eligibility. Date-specific
 * call-ins/outs and calendar overrides take precedence. Attendance/shift end
 * remains exclusive, even though the final allowed NAP START is inclusive.
 */
export function getEligibleClientNapStarts(
  client: ClientNapAttendance,
  date: string,
  napWindowStart: string,
  napWindowEnd: string,
  changes: ClientNapAttendanceChange[] = [],
  override?: AttendanceWindow
): string[] {
  if(!isClientActiveOnDate(client,date)) return [];
  const attendance=new Set<string>();
  for(const pattern of client.attendancePatterns??[]) {
    if(!patternMatchesDate(pattern.days,date)||!pattern.startTime||!pattern.endTime) continue;
    for(const slot of getSlotsInsideTimeRange(pattern.startTime,pattern.endTime)) attendance.add(slot);
  }
  for(const change of changes) {
    if(!change.startTime||!change.endTime||change.endTime<=change.startTime) continue;
    for(const slot of getSlotsInsideTimeRange(change.startTime,change.endTime)) {
      if(change.changeType==="CALL_IN") attendance.add(slot);
      else attendance.delete(slot);
    }
  }
  const finalSlots=new Set(applyAttendanceWindow([...attendance],override));
  return getEventStartSlotsInsideTimeRange(napWindowStart,napWindowEnd)
    .filter(start=>finalSlots.has(start));
}
