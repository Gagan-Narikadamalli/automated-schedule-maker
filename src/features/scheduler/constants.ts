export const SCHEDULE_START_MINUTES = 8 * 60;
export const SCHEDULE_END_MINUTES = 18 * 60;
export const SLOT_LENGTH_MINUTES = 30;

export type TimeSlot = {
  startTime: string;
  endTime: string;
  label: string;
};

function formatMinutes(totalMinutes: number): string {
  const hours24 = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const period = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  const minuteText = minutes.toString().padStart(2, "0");

  return `${hours12}:${minuteText} ${period}`;
}

function formatStorageTime(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60)
    .toString()
    .padStart(2, "0");
  const minutes = (totalMinutes % 60).toString().padStart(2, "0");

  return `${hours}:${minutes}`;
}

export function buildDailyTimeSlots(): TimeSlot[] {
  const timeSlots: TimeSlot[] = [];

  for (
    let currentMinutes = SCHEDULE_START_MINUTES;
    currentMinutes < SCHEDULE_END_MINUTES;
    currentMinutes += SLOT_LENGTH_MINUTES
  ) {
    const nextMinutes = currentMinutes + SLOT_LENGTH_MINUTES;

    timeSlots.push({
      startTime: formatStorageTime(currentMinutes),
      endTime: formatStorageTime(nextMinutes),
      label: `${formatMinutes(currentMinutes)} - ${formatMinutes(nextMinutes)}`,
    });
  }

  return timeSlots;
}

export const DAILY_TIME_SLOTS = buildDailyTimeSlots();
