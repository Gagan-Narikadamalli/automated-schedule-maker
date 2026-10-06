export type NaturalTimeRangeAnalysis =
  | { status: "NONE" }
  | {
      status: "PARSED";
      startTime: string;
      endTime: string;
      normalizedText: string;
      needsConfirmation: false;
    }
  | {
      status: "CONFIRM";
      startTime: string;
      endTime: string;
      normalizedText: string;
      needsConfirmation: true;
      reason: string;
    };

type ParsedToken = {
  time: string;
  meridiem?: "am" | "pm";
  confidence: "HIGH" | "CONFIRM";
};

function inferHour(hour: number, meridiem?: string): number {
  if (meridiem) {
    const suffix = meridiem.toLowerCase();
    if (suffix === "am") return hour === 12 ? 0 : hour;
    return hour === 12 ? 12 : hour + 12;
  }
  if (hour === 12) return 12;
  // The scheduler day is 08:00-20:00, so bare 1-7 normally means PM.
  return hour >= 1 && hour <= 7 ? hour + 12 : hour;
}

function toTime(hour: number, minute: number, meridiem?: string): string | null {
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  if (meridiem && (hour < 1 || hour > 12)) return null;
  const converted = inferHour(hour, meridiem);
  if (converted < 0 || converted > 23) return null;
  return `${String(converted).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function cleanToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\b(a\.?m\.?)\b/g, "am")
    .replace(/\b(p\.?m\.?)\b/g, "pm")
    .replace(/[,.;]+/g, ":")
    .replace(/\s+/g, " ")
    .trim();
}

function parseToken(raw: string, inheritedMeridiem?: "am" | "pm"): ParsedToken | null {
  const value = cleanToken(raw);
  const meridiemMatch = value.match(/\b(am|pm)\b/i);
  const explicitMeridiem = meridiemMatch?.[1]?.toLowerCase() as "am" | "pm" | undefined;
  const meridiem = explicitMeridiem ?? inheritedMeridiem;
  const numeric = value.replace(/\b(am|pm)\b/gi, "").trim();

  // Normal forms: 11, 11:30, 11 30.
  let match = numeric.match(/^(\d{1,2})(?:[:\s](\d{1,2}))?$/);
  if (match) {
    const hour = Number(match[1]);
    let minute = match[2] === undefined ? 0 : Number(match[2]);
    let confidence: "HIGH" | "CONFIRM" = "HIGH";

    // A single minute digit is commonly a dropped zero in this 30-minute scheduler:
    // "11 3" -> suggest 11:30, but require confirmation before a write.
    if (match[2]?.length === 1) {
      if (minute === 0) minute = 0;
      else if (minute === 3) minute = 30;
      else return null;
      confidence = "CONFIRM";
    }

    // Scheduler cells are 30-minute increments. Values such as 11:20 are valid
    // clock times but ambiguous for a cell edit, so require confirmation.
    if (minute !== 0 && minute !== 30) confidence = "CONFIRM";

    const time = toTime(hour, minute, meridiem);
    return time ? { time, meridiem, confidence } : null;
  }

  // Compact forms such as 1130 or 930.
  match = numeric.match(/^(\d{3,4})$/);
  if (match) {
    const digits = match[1];
    const hour = Number(digits.slice(0, -2));
    const minute = Number(digits.slice(-2));
    const time = toTime(hour, minute, meridiem);
    if (!time) return null;
    return {
      time,
      meridiem,
      confidence: minute === 0 || minute === 30 ? "HIGH" : "CONFIRM",
    };
  }

  return null;
}

function displayTime(time: string): string {
  const [hourText, minute] = time.split(":");
  const hour = Number(hourText);
  const suffix = hour >= 12 ? "PM" : "AM";
  return `${hour % 12 || 12}:${minute} ${suffix}`;
}

function stripDates(message: string): string {
  return message
    .replace(/\b20\d{2}-\d{2}-\d{2}\b/g, " ")
    .replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, " ");
}

export function analyzeNaturalTimeRange(message: string): NaturalTimeRangeAnalysis {
  const source = stripDates(message)
    .replace(/[–—]/g, "-")
    .replace(/\b(?:till|til)\b/gi, "to")
    .replace(/\buntil\b/gi, "to")
    .replace(/\bthrough\b/gi, "to")
    .replace(/\s+/g, " ")
    .trim();

  // Capture a reasonably small time token on each side of a range separator.
  const range = source.match(
    /(?:\bfrom\s+|\bat\s+)?(\d{1,4}(?:\s*[:.,]\s*\d{1,3}|\s+\d{1,3})?\s*(?:a\.?m\.?|p\.?m\.?)?)\s*(?:-|\bto\b)\s*(\d{1,4}(?:\s*[:.,]\s*\d{1,3}|\s+\d{1,3})?\s*(?:a\.?m\.?|p\.?m\.?)?)/i
  );

  if (!range) return { status: "NONE" };

  const leftRaw = range[1].trim();
  const rightRaw = range[2].trim();
  const leftMeridiem = leftRaw.match(/\b(am|pm)\b/i)?.[1]?.toLowerCase() as
    | "am"
    | "pm"
    | undefined;
  const rightMeridiem = rightRaw.match(/\b(am|pm)\b/i)?.[1]?.toLowerCase() as
    | "am"
    | "pm"
    | undefined;

  let left = parseToken(leftRaw, rightMeridiem);
  let right = parseToken(rightRaw, leftMeridiem);

  if (!left || !right) {
    // Handle a common larger typo like "11 to 11 3" by suggesting 11:30.
    const fuzzy = source.match(
      /(?:\bfrom\s+)?(\d{1,2})\s*(?:-|\bto\b)\s*(\d{1,2})\s+([03])\s*(am|pm)?\b/i
    );
    if (!fuzzy) return { status: "NONE" };
    const suffix = fuzzy[4]?.toLowerCase() as "am" | "pm" | undefined;
    left = parseToken(fuzzy[1], suffix);
    right = parseToken(`${fuzzy[2]} ${fuzzy[3]}`, suffix);
    if (!left || !right) return { status: "NONE" };
    const normalizedText = `${displayTime(left.time)}–${displayTime(right.time)}`;
    return {
      status: "CONFIRM",
      startTime: left.time,
      endTime: right.time,
      normalizedText,
      needsConfirmation: true,
      reason: "The time text contains an ambiguous or likely mistyped minute value.",
    };
  }

  // If only one side supplied AM/PM, reparse both using that suffix so
  // "11 to 11 30 am" means 11:00 AM-11:30 AM.
  const sharedMeridiem = rightMeridiem ?? leftMeridiem;
  if (sharedMeridiem) {
    left = parseToken(leftRaw, leftMeridiem ?? sharedMeridiem) ?? left;
    right = parseToken(rightRaw, rightMeridiem ?? sharedMeridiem) ?? right;
  }

  if (right.time <= left.time) {
    // A same-hour end with a missing/ambiguous minute should never collapse to
    // an empty range. Ask before changing anything.
    const normalizedText = `${displayTime(left.time)}–${displayTime(right.time)}`;
    return {
      status: "CONFIRM",
      startTime: left.time,
      endTime: right.time,
      normalizedText,
      needsConfirmation: true,
      reason: "The end time is not later than the start time.",
    };
  }

  const normalizedText = `${displayTime(left.time)}–${displayTime(right.time)}`;
  const needsConfirmation =
    left.confidence === "CONFIRM" ||
    right.confidence === "CONFIRM" ||
    // Schedule edits use 30-minute cells. Off-grid minutes must be confirmed.
    !/:(00|30)$/.test(left.time) ||
    !/:(00|30)$/.test(right.time);

  if (needsConfirmation) {
    return {
      status: "CONFIRM",
      startTime: left.time,
      endTime: right.time,
      normalizedText,
      needsConfirmation: true,
      reason: "The time appears understandable but is not a clean 30-minute scheduler range.",
    };
  }

  return {
    status: "PARSED",
    startTime: left.time,
    endTime: right.time,
    normalizedText,
    needsConfirmation: false,
  };
}

export function naturalTimeConfirmationQuestion(
  analysis: Extract<NaturalTimeRangeAnalysis, { status: "CONFIRM" }>
): string {
  return `I want to make sure I understood the time correctly. Do you mean ${analysis.normalizedText}?`;
}

export function displayNaturalTimeRange(startTime: string, endTime: string): string {
  return `${displayTime(startTime)}–${displayTime(endTime)}`;
}
