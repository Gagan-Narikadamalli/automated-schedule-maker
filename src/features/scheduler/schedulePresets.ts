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

export function createPresetScheduleCell(
  preset: SchedulePreset
): DemoGridCell {
  return {
    text: preset.text,
    assignmentType: preset.assignmentType,
    color: preset.color,
  };
}

export function createScheduleCellFromText(text: string): DemoGridCell {
  const normalizedText = text.trim();
  const normalizedKey = normalizedText.toLowerCase().replaceAll(" ", "");

  if (!normalizedText) {
    return createEmptyScheduleCell();
  }

  if (normalizedKey === "break" || normalizedKey === "brk") {
    return createPresetScheduleCell(SCHEDULE_PRESETS[0]);
  }

  if (normalizedKey === "nap") {
    return createPresetScheduleCell(SCHEDULE_PRESETS[1]);
  }

  if (normalizedKey === "speech") {
    return createPresetScheduleCell(SCHEDULE_PRESETS[2]);
  }

  if (
    normalizedKey === "break/nap" ||
    normalizedKey === "brk/nap" ||
    normalizedKey === "break+nap"
  ) {
    return createPresetScheduleCell(SCHEDULE_PRESETS[3]);
  }

  if (
    normalizedKey === "break/speech" ||
    normalizedKey === "brk/speech" ||
    normalizedKey === "break+speech"
  ) {
    return createPresetScheduleCell(SCHEDULE_PRESETS[4]);
  }

  if (normalizedKey === "unavailable" || normalizedKey === "out") {
    return {
      text: "",
      assignmentType: "UNAVAILABLE",
      color: "#8D8D8D",
    };
  }

  return {
    text: normalizedText,
    assignmentType: "CLIENT_1_TO_1",
    color: "#D9F4EE",
  };
}
