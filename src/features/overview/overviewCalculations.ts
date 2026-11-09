export function calculateCappedWeeklyStaffHours(
  staffMembers: Array<{ scheduledHours: number }>
): number {
  return staffMembers.reduce(
    (total, staffMember) =>
      total + Math.min(Math.max(staffMember.scheduledHours, 0), 40),
    0
  );
}
