import { DAILY_TIME_SLOTS } from "@/features/scheduler/constants";

const DAY_NAMES = [
  "SUNDAY",
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
] as const;

const SHORT_DAY_NAMES = [
  "SUN",
  "MON",
  "TUE",
  "WED",
  "THU",
  "FRI",
  "SAT",
] as const;

export function getDayKeys(date: string): string[] {
  const parsedDate = new Date(`${date}T12:00:00`);

  if (Number.isNaN(parsedDate.getTime())) {
    return [];
  }

  const dayIndex = parsedDate.getDay();

  return [
    DAY_NAMES[dayIndex],
    SHORT_DAY_NAMES[dayIndex],
    SHORT_DAY_NAMES[dayIndex].charAt(0) +
      SHORT_DAY_NAMES[dayIndex].slice(1).toLowerCase(),
  ];
}

export function patternMatchesDate(
  patternDays: string[] | undefined,
  date: string
): boolean {
  if (!patternDays || patternDays.length === 0) {
    return false;
  }

  const dayKeys = getDayKeys(date).map((day) => day.toUpperCase());

  return patternDays.some((day) =>
    dayKeys.includes(day.trim().toUpperCase())
  );
}

export function getSlotsInsideTimeRange(
  startTime: string,
  endTime: string
): string[] {
  return DAILY_TIME_SLOTS.filter(
    (slot) => slot.startTime >= startTime && slot.endTime <= endTime
  ).map((slot) => slot.startTime);
}

export function isSlotInsideTimeRange(
  slotStartTime: string,
  startTime: string,
  endTime: string
): boolean {
  const slot = DAILY_TIME_SLOTS.find(
    (candidate) => candidate.startTime === slotStartTime
  );

  if (!slot) {
    return false;
  }

  return slot.startTime >= startTime && slot.endTime <= endTime;
}

export function getEndTimeForSlot(startTime: string): string {
  return (
    DAILY_TIME_SLOTS.find((slot) => slot.startTime === startTime)?.endTime ??
    startTime
  );
}
