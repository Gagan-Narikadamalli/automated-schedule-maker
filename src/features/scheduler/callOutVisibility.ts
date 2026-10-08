export const STAFF_GRID_DAY_START = "08:00";
export const STAFF_GRID_DAY_END = "17:00";

export type CallOutWindow = {
  staffId: string;
  startTime: string;
  endTime: string;
};

export function isFullDayCallOutWindow(
  startTime: string,
  endTime: string
): boolean {
  return (
    startTime <= STAFF_GRID_DAY_START &&
    endTime >= STAFF_GRID_DAY_END
  );
}

export function getFullDayCallOutStaffIds(
  callOuts: CallOutWindow[]
): string[] {
  return Array.from(
    new Set(
      callOuts
        .filter((callOut) =>
          isFullDayCallOutWindow(callOut.startTime, callOut.endTime)
        )
        .map((callOut) => callOut.staffId)
        .filter(Boolean)
    )
  );
}

export function getVisibleStaffIndexes(
  staffIds: string[],
  hiddenStaffIds: string[]
): number[] {
  const hidden = new Set(hiddenStaffIds);
  return staffIds
    .map((staffId, index) => ({ staffId, index }))
    .filter(({ staffId }) => !hidden.has(staffId))
    .map(({ index }) => index);
}
