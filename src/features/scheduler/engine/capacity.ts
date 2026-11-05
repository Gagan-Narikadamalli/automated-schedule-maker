import type { SchedulerStaff } from "./types";

/**
 * The staff member's maximum client-service hours available on this date.
 * Shift availability is capped by both the daily limit and the remaining
 * weekly limit after service hours already scheduled earlier in the week.
 */
export function calculateEffectiveStaffAvailableHours(
  staffMember: SchedulerStaff,
  slotLengthMinutes: number
): number {
  const shiftHours =
    (staffMember.availableSlots.length * slotLengthMinutes) / 60;
  const dailyLimit =
    staffMember.maximumDailyHours !== undefined &&
    Number.isFinite(staffMember.maximumDailyHours)
      ? Math.max(staffMember.maximumDailyHours, 0)
      : Number.POSITIVE_INFINITY;
  const weeklyLimit =
    staffMember.maximumWeeklyHours !== undefined &&
    Number.isFinite(staffMember.maximumWeeklyHours)
      ? Math.max(
          staffMember.maximumWeeklyHours -
            Math.max(staffMember.scheduledWeeklyClientHoursBeforeDate ?? 0, 0),
          0
        )
      : Number.POSITIVE_INFINITY;

  return Math.max(0, Math.min(shiftHours, dailyLimit, weeklyLimit));
}
