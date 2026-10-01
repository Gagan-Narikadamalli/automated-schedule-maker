import type { DemoGridCell } from "./demoData";
import type { AssignmentType } from "./types";

export type SchedulePreset = {
  label: string;
  text: string;
  assignmentType: AssignmentType | "EMPTY";
  color?: string;
};

export const SCHEDULE_PRESETS: SchedulePreset[] = [
  {
    label: "Break",
    text: "Break",
    assignmentType: "BREAK",
    color: "#FFFFFF",
  },
  {
    label: "Nap",
    text: "Nap",
    assignmentType: "NAP",
    color: "#F4EFE3",
  },
  {
    label: "Speech",
    text: "Speech",
    assignmentType: "SPEECH",
    color: "#DCE9F8",
  },
  {
    label: "Break + Nap",
    text: "Break/Nap",
    assignmentType: "BREAK_NAP",
    color: "#FFF3D6",
  },
  {
    label: "Break + Speech",
    text: "Break/Speech",
    assignmentType: "BREAK_SPEECH",
    color: "#E4F1FA",
  },
];

export function createEmptyScheduleCell(): DemoGridCell {
  return {
    text: "",
    assignmentType: "EMPTY",
  };
}

function activityKeepsClient(assignmentType: AssignmentType | "EMPTY"): boolean {
  return ["NAP", "SPEECH", "BREAK_NAP", "BREAK_SPEECH"].includes(
    assignmentType
  );
}

export function createPresetScheduleCell(
  preset: SchedulePreset,
  previousCell?: DemoGridCell
): DemoGridCell {
  const keepClient = activityKeepsClient(preset.assignmentType);

  return {
    text: preset.text,
    assignmentType: preset.assignmentType,
    color: preset.color,
    clientId: keepClient ? previousCell?.clientId ?? null : null,
    clientCode: keepClient ? previousCell?.clientCode ?? null : null,
    source: "MANUAL",
    locked: true,
  };
}

export function createScheduleCellFromText(
  text: string,
  previousCell?: DemoGridCell
): DemoGridCell {
  const normalizedText = text.trim();
  const normalizedKey = normalizedText.toLowerCase().replaceAll(" ", "");

  if (!normalizedText) {
    return createEmptyScheduleCell();
  }

  if (normalizedKey === "break" || normalizedKey === "brk") {
    return createPresetScheduleCell(SCHEDULE_PRESETS[0], previousCell);
  }

  if (normalizedKey === "nap") {
    return createPresetScheduleCell(SCHEDULE_PRESETS[1], previousCell);
  }

  if (normalizedKey === "speech") {
    return createPresetScheduleCell(SCHEDULE_PRESETS[2], previousCell);
  }

  if (
    normalizedKey === "break/nap" ||
    normalizedKey === "brk/nap" ||
    normalizedKey === "break+nap"
  ) {
    return createPresetScheduleCell(SCHEDULE_PRESETS[3], previousCell);
  }

  if (
    normalizedKey === "break/speech" ||
    normalizedKey === "brk/speech" ||
    normalizedKey === "break+speech"
  ) {
    return createPresetScheduleCell(SCHEDULE_PRESETS[4], previousCell);
  }

  if (normalizedKey === "unavailable" || normalizedKey === "out") {
    return {
      text: "",
      assignmentType: "UNAVAILABLE",
      color: "#8D8D8D",
      source: "MANUAL",
      locked: true,
    };
  }

  const clientCode = normalizedText.replace(/\s+1:1$/i, "").split(/\s+/)[0];
  const sameClient =
    previousCell?.clientCode?.toLowerCase() === clientCode.toLowerCase();

  return {
    text: normalizedText,
    assignmentType: "CLIENT_1_TO_1",
    color: sameClient ? previousCell?.color ?? "#D9F4EE" : "#D9F4EE",
    clientId: sameClient ? previousCell?.clientId ?? null : null,
    clientCode,
    source: "MANUAL",
    locked: true,
  };
}
