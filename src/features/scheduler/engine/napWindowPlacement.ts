export type NapWindowStaffAvailability = {
  role: string;
  availableSlots: string[];
  hardRestricted: boolean;
};

/**
 * Select exactly 30 minutes from a flexible nap window. Only the first or last
 * contiguous portion is considered. Prefer the edge that leaves the greatest
 * eligible BT/RBT availability immediately before or after the nap so the
 * assigned caregiver can combine the nap with their own break.
 */
export function selectThirtyMinuteNapSlots(
  windowSlots: string[],
  slotLengthMinutes: number,
  staff: NapWindowStaffAvailability[]
): string[] {
  if (windowSlots.length === 0 || slotLengthMinutes <= 0) return [];

  const napSlotCount = Math.max(
    Math.ceil(30 / slotLengthMinutes),
    1
  );
  const firstNapSlots = windowSlots.slice(0, napSlotCount);
  const lastNapSlots = windowSlots.slice(-napSlotCount);
  const candidates = [
    ...new Map(
      [firstNapSlots, lastNapSlots].map((slots) => [slots.join("|"), slots])
    ).values(),
  ];

  const shiftTime = (time: string, minutes: number): string | null => {
    const [hours, minute] = time.split(":").map(Number);
    if (!Number.isFinite(hours) || !Number.isFinite(minute)) return null;
    const total = hours * 60 + minute + minutes;
    if (total < 0 || total >= 24 * 60) return null;
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  };

  const scoreCandidate = (slots: string[]) => {
    const boundarySlots = [
      shiftTime(slots[0], -slotLengthMinutes),
      shiftTime(slots[slots.length - 1], slotLengthMinutes),
    ].filter((slot): slot is string => Boolean(slot));
    let btAvailability = 0;
    let otherAvailability = 0;

    for (const staffMember of staff) {
      if (
        staffMember.hardRestricted ||
        !boundarySlots.some((slot) =>
          staffMember.availableSlots.includes(slot)
        )
      ) {
        continue;
      }

      if (staffMember.role === "BT" || staffMember.role === "RBT") {
        btAvailability += 1;
      } else {
        otherAvailability += 1;
      }
    }

    return btAvailability * 100 + otherAvailability;
  };

  return [...candidates].sort((left, right) => {
    const scoreDifference = scoreCandidate(right) - scoreCandidate(left);
    if (scoreDifference !== 0) return scoreDifference;
    // Stable tie-break: choose the first 30 minutes of the window.
    return left[0].localeCompare(right[0]);
  })[0] ?? [];
}
