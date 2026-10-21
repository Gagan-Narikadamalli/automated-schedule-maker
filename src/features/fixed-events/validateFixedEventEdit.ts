export type FixedEventEditScope = "OCCURRENCE" | "SERIES";
export type FixedEventKind = "NAP" | "SPEECH";

const DATE = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;
const HALF_HOUR = /^(?:[01]\d|2[0-3]):(?:00|30)$/;

function minutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

export function validateFixedEventEdit(
  kind: FixedEventKind,
  edit: { scope?: string; date?: string; startTime?: string; endTime?: string; priorityCategory?: string }
): string | null {
  if (edit.scope !== "OCCURRENCE" && edit.scope !== "SERIES")
    return "Choose whether to edit this occurrence or the entire recurring series.";
  if (edit.scope === "OCCURRENCE" &&
      (!edit.date || !DATE.test(edit.date) || Number.isNaN(Date.parse(edit.date+"T12:00:00Z")) ||
       new Date(edit.date+"T12:00:00Z").toISOString().slice(0,10)!==edit.date))
    return "Choose a valid date in YYYY-MM-DD format.";
  const start = edit.startTime ?? "", end = edit.endTime ?? "";
  if (!HALF_HOUR.test(start) || !HALF_HOUR.test(end) || minutes(end) <= minutes(start))
    return "Start and end must be increasing 30-minute schedule boundaries.";
  if (kind === "SPEECH" && minutes(end)-minutes(start)!==30)
    return "Speech is a fixed 30-minute event.";
  if (kind === "NAP" && (start<"11:30" || end>"14:00"))
    return "Nap windows must stay within 11:30 AM-2:00 PM.";
  if (kind === "NAP" && !["YOUNGER","OLDER"].includes(edit.priorityCategory ?? ""))
    return "Select a valid nap priority.";
  return null;
}
