export type WeeklyTimePattern = {
  name: string;
  days: string[];
  startTime: string;
  endTime: string;
};

export type WeeklyDaySchedule = {
  enabled: boolean;
  startTime: string;
  endTime: string;
};

export type WeeklySchedule = Record<string, WeeklyDaySchedule>;

export const WEEKDAY_VALUES = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
] as const;

function earlierTime(left: string, right: string): string {
  return left <= right ? left : right;
}

function laterTime(left: string, right: string): string {
  return left >= right ? left : right;
}

export function createWeeklySchedule(
  defaultStartTime: string,
  defaultEndTime: string,
  enabled = true
): WeeklySchedule {
  return Object.fromEntries(
    WEEKDAY_VALUES.map((day) => [
      day,
      {
        enabled,
        startTime: defaultStartTime,
        endTime: defaultEndTime,
      },
    ])
  );
}

export function weeklyScheduleFromPatterns(
  patterns: WeeklyTimePattern[],
  defaultStartTime: string,
  defaultEndTime: string
): WeeklySchedule {
  const schedule = createWeeklySchedule(
    defaultStartTime,
    defaultEndTime,
    false
  );

  for (const pattern of patterns) {
    if (!pattern.startTime || !pattern.endTime) {
      continue;
    }

    for (const day of pattern.days ?? []) {
      if (!schedule[day]) {
        continue;
      }

      const current = schedule[day];

      if (!current.enabled) {
        schedule[day] = {
          enabled: true,
          startTime: pattern.startTime,
          endTime: pattern.endTime,
        };
        continue;
      }

      // Older profiles could contain overlapping patterns for the same day.
      // The weekly editor normalizes them into one continuous daily window.
      schedule[day] = {
        enabled: true,
        startTime: earlierTime(current.startTime, pattern.startTime),
        endTime: laterTime(current.endTime, pattern.endTime),
      };
    }
  }

  return schedule;
}

export function patternsFromWeeklySchedule(
  schedule: WeeklySchedule,
  namePrefix: string
): WeeklyTimePattern[] {
  const grouped = new Map<string, string[]>();

  for (const day of WEEKDAY_VALUES) {
    const daySchedule = schedule[day];

    if (
      !daySchedule?.enabled ||
      !daySchedule.startTime ||
      !daySchedule.endTime ||
      daySchedule.endTime <= daySchedule.startTime
    ) {
      continue;
    }

    const key = `${daySchedule.startTime}|${daySchedule.endTime}`;
    grouped.set(key, [...(grouped.get(key) ?? []), day]);
  }

  return [...grouped.entries()].map(([key, days], index) => {
    const [startTime, endTime] = key.split("|");

    return {
      name:
        grouped.size === 1
          ? namePrefix
          : `${namePrefix} ${index + 1}`,
      days,
      startTime,
      endTime,
    };
  });
}

export function validateWeeklySchedule(
  schedule: WeeklySchedule,
  subject: string
): string | null {
  const enabledDays = WEEKDAY_VALUES.filter(
    (day) => schedule[day]?.enabled
  );

  if (enabledDays.length === 0) {
    return `Select at least one ${subject} day.`;
  }

  for (const day of enabledDays) {
    const daySchedule = schedule[day];

    if (
      !daySchedule.startTime ||
      !daySchedule.endTime ||
      daySchedule.endTime <= daySchedule.startTime
    ) {
      return `${day.toLowerCase()} end time must be later than the start time.`;
    }
  }

  return null;
}
