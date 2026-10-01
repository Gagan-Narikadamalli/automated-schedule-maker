export type AssignmentType =
  | "CLIENT_1_TO_1"
  | "BREAK"
  | "BREAK_NAP"
  | "NAP"
  | "SPEECH"
  | "UNAVAILABLE"
  | "OPEN";

export type AssignmentSource =
  | "AUTO"
  | "MANUAL"
  | "TEMPLATE"
  | "COPIED";

export type ScheduleCell = {
  rowIndex: number;
  columnIndex: number;
  staffId: string;
  staffName: string;
  startTime: string;
  endTime: string;
  assignmentType: AssignmentType;
  displayText: string;
  clientId?: string;
  color?: string;
  source: AssignmentSource;
  locked: boolean;
  manuallyOverridden: boolean;
};

export type StaffColumn = {
  id: string;
  name: string;
  color: string;
};

export type CellPosition = {
  row: number;
  column: number;
};

export type SelectionRange = {
  start: CellPosition;
  end: CellPosition;
};

export type ScheduleConflict = {
  code:
    | "STAFF_DOUBLE_BOOKED"
    | "STAFF_UNAVAILABLE"
    | "CLIENT_DOUBLE_BOOKED"
    | "HARD_RELATIONSHIP"
    | "SPEECH_CONFLICT"
    | "LOCKED_ASSIGNMENT"
    | "OUTSIDE_ATTENDANCE";
  message: string;
  blocking: boolean;
};
