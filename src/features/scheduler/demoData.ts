import type { AssignmentSource, AssignmentType, StaffColumn } from "./types";
import { DAILY_TIME_SLOTS } from "./constants";

export type DemoGridCell = {
  text: string;
  assignmentType: AssignmentType | "EMPTY";
  color?: string;
  clientId?: string | null;
  clientCode?: string | null;
  source?: AssignmentSource;
  locked?: boolean;
};

export const DEMO_STAFF: StaffColumn[] = [
  { id: "staff-areyana", name: "Areyana", color: "#00E5E5" },
  { id: "staff-ariana", name: "Ariana", color: "#00E5E5" },
  { id: "staff-anias", name: "Anias", color: "#E1696D" },
  { id: "staff-danielle", name: "Danielle", color: "#B10B12" },
  { id: "staff-danna", name: "Danna", color: "#C86E00" },
  { id: "staff-devonyah", name: "Devonyah", color: "#063E46" },
  { id: "staff-dezz", name: "Dezz", color: "#FFF1C9" },
  { id: "staff-juwell", name: "Juwell", color: "#FF00F5" },
];

const CLIENT_COLORS: Record<string, string> = {
  ZiBo: "#00E5E5",
  CaMe: "#19F31B",
  EyNa: "#E1696D",
  CaGr: "#B10B12",
  ChHa: "#C86E00",
  CaCr: "#063E46",
  AmAb: "#FFF1C9",
  LaRo: "#FF00F5",
  IsMo: "#FFA500",
  AdZh: "#D6D0E8",
};

const CLIENT_CODES = Object.keys(CLIENT_COLORS);

function emptyCell(): DemoGridCell {
  return {
    text: "",
    assignmentType: "EMPTY",
  };
}

function clientCell(clientCode: string): DemoGridCell {
  return {
    text: `${clientCode} 1:1`,
    assignmentType: "CLIENT_1_TO_1",
    color: CLIENT_COLORS[clientCode],
    clientCode,
    source: "AUTO",
    locked: false,
  };
}

export function createDemoGrid(): DemoGridCell[][] {
  return DAILY_TIME_SLOTS.map((_, rowIndex) =>
    DEMO_STAFF.map((_, columnIndex) => {
      if (rowIndex >= 18 && columnIndex % 2 === 1) {
        return {
          text: "",
          assignmentType: "UNAVAILABLE",
          color: "#8D8D8D",
          locked: true,
        };
      }

      if (rowIndex === 7 && columnIndex === 1) {
        return {
          text: "Break",
          assignmentType: "BREAK",
          source: "AUTO",
          locked: true,
        };
      }

      if (rowIndex === 8 && columnIndex === 2) {
        return {
          text: "Break/Nap",
          assignmentType: "BREAK_NAP",
          clientCode: "CaMe",
          color: "#FFF3D6",
          source: "MANUAL",
          locked: true,
        };
      }

      if (rowIndex === 9 && columnIndex === 5) {
        return {
          text: "Break/Speech",
          assignmentType: "BREAK_SPEECH",
          clientCode: "EyNa",
          color: "#E4F1FA",
          source: "MANUAL",
          locked: true,
        };
      }

      if (rowIndex < 16) {
        const clientCode =
          CLIENT_CODES[(rowIndex + columnIndex) % CLIENT_CODES.length];
        return clientCell(clientCode);
      }

      return emptyCell();
    })
  );
}
