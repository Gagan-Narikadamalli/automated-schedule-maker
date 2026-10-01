"use client";

import {
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";

import { DAILY_TIME_SLOTS } from "./constants";
import type { CellPosition, StaffColumn } from "./types";
import type { DemoGridCell } from "./demoData";

type ScheduleGridProps = {
  staff: StaffColumn[];
  initialGrid: DemoGridCell[][];
  manualMode: boolean;
  onConflict: (message: string) => void;
  onDisplacedAssignment: (assignment: string) => void;
};

type Selection = {
  anchor: CellPosition;
  focus: CellPosition;
};

function normalizeSelection(selection: Selection) {
  return {
    firstRow: Math.min(selection.anchor.row, selection.focus.row),
    lastRow: Math.max(selection.anchor.row, selection.focus.row),
    firstColumn: Math.min(selection.anchor.column, selection.focus.column),
    lastColumn: Math.max(selection.anchor.column, selection.focus.column),
  };
}

function createCellFromText(text: string): DemoGridCell {
  const normalizedText = text.trim();
  const lowerText = normalizedText.toLowerCase();

  if (!normalizedText) {
    return {
      text: "",
      assignmentType: "EMPTY",
    };
  }

  if (lowerText === "break") {
    return {
      text: "Break",
      assignmentType: "BREAK",
    };
  }

  if (lowerText === "break/nap" || lowerText === "brk/nap") {
    return {
      text: "Break/Nap",
      assignmentType: "BREAK_NAP",
    };
  }

  if (lowerText === "speech" || lowerText === "brk/speech") {
    return {
      text: "Speech",
      assignmentType: "SPEECH",
      color: "#DCE9F8",
    };
  }

  if (lowerText === "unavailable" || lowerText === "out") {
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

function cellClassName(cell: DemoGridCell, selected: boolean): string {
  const classNames = ["schedule-cell"];

  if (cell.assignmentType === "BREAK" || cell.assignmentType === "BREAK_NAP") {
    classNames.push("schedule-cell-break");
  }

  if (cell.assignmentType === "UNAVAILABLE") {
    classNames.push("schedule-cell-unavailable");
  }

  if (cell.assignmentType === "SPEECH") {
    classNames.push("schedule-cell-speech");
  }

  if (selected) {
    classNames.push("schedule-cell-selected");
  }

  return classNames.join(" ");
}

export function ScheduleGrid({
  staff,
  initialGrid,
  manualMode,
  onConflict,
  onDisplacedAssignment,
}: ScheduleGridProps) {
  const [grid, setGrid] = useState<DemoGridCell[][]>(initialGrid);
  const [selection, setSelection] = useState<Selection>({
    anchor: { row: 0, column: 0 },
    focus: { row: 0, column: 0 },
  });
  const [editingCell, setEditingCell] = useState<CellPosition | null>(null);
  const [draggedCell, setDraggedCell] = useState<CellPosition | null>(null);
  const [dragSelecting, setDragSelecting] = useState(false);
  const editorRef = useRef<HTMLInputElement | null>(null);

  const normalizedSelection = useMemo(
    () => normalizeSelection(selection),
    [selection]
  );

  function isCellSelected(row: number, column: number): boolean {
    return (
      row >= normalizedSelection.firstRow &&
      row <= normalizedSelection.lastRow &&
      column >= normalizedSelection.firstColumn &&
      column <= normalizedSelection.lastColumn
    );
  }

  function selectSingleCell(row: number, column: number) {
    setSelection({
      anchor: { row, column },
      focus: { row, column },
    });
  }

  function handleCellMouseDown(
    event: MouseEvent<HTMLTableCellElement>,
    row: number,
    column: number
  ) {
    if (event.shiftKey) {
      setSelection((currentSelection) => ({
        ...currentSelection,
        focus: { row, column },
      }));
      return;
    }

    setDragSelecting(true);
    selectSingleCell(row, column);
  }

  function handleCellMouseEnter(row: number, column: number) {
    if (!dragSelecting) {
      return;
    }

    setSelection((currentSelection) => ({
      ...currentSelection,
      focus: { row, column },
    }));
  }

  function stopDragSelection() {
    setDragSelecting(false);
  }

  function moveSelection(
    rowDelta: number,
    columnDelta: number,
    extendSelection: boolean
  ) {
    const nextRow = Math.max(
      0,
      Math.min(DAILY_TIME_SLOTS.length - 1, selection.focus.row + rowDelta)
    );
    const nextColumn = Math.max(
      0,
      Math.min(staff.length - 1, selection.focus.column + columnDelta)
    );

    if (extendSelection) {
      setSelection((currentSelection) => ({
        ...currentSelection,
        focus: {
          row: nextRow,
          column: nextColumn,
        },
      }));
      return;
    }

    selectSingleCell(nextRow, nextColumn);
  }

  function clearSelectedCells() {
    setGrid((currentGrid) =>
      currentGrid.map((row, rowIndex) =>
        row.map((cell, columnIndex) => {
          if (!isCellSelected(rowIndex, columnIndex)) {
            return cell;
          }

          if (!manualMode && cell.assignmentType !== "EMPTY") {
            return cell;
          }

          return createCellFromText("");
        })
      )
    );

    if (!manualMode) {
      onConflict(
        "Auto-safe mode protects occupied assignments. Turn on Manual Mode to clear or replace assigned cells."
      );
    }
  }

  function handleGridKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (editingCell) {
      return;
    }

    switch (event.key) {
      case "ArrowUp":
        event.preventDefault();
        moveSelection(-1, 0, event.shiftKey);
        break;
      case "ArrowDown":
        event.preventDefault();
        moveSelection(1, 0, event.shiftKey);
        break;
      case "ArrowLeft":
        event.preventDefault();
        moveSelection(0, -1, event.shiftKey);
        break;
      case "ArrowRight":
        event.preventDefault();
        moveSelection(0, 1, event.shiftKey);
        break;
      case "Enter":
      case "F2":
        event.preventDefault();
        setEditingCell(selection.focus);
        window.setTimeout(() => editorRef.current?.focus(), 0);
        break;
      case "Delete":
      case "Backspace":
        event.preventDefault();
        clearSelectedCells();
        break;
      default:
        break;
    }
  }

  function handleCopy(event: ClipboardEvent<HTMLDivElement>) {
    const copiedRows: string[] = [];

    for (
      let rowIndex = normalizedSelection.firstRow;
      rowIndex <= normalizedSelection.lastRow;
      rowIndex += 1
    ) {
      const copiedColumns: string[] = [];

      for (
        let columnIndex = normalizedSelection.firstColumn;
        columnIndex <= normalizedSelection.lastColumn;
        columnIndex += 1
      ) {
        copiedColumns.push(grid[rowIndex][columnIndex].text);
      }

      copiedRows.push(copiedColumns.join("\t"));
    }

    event.clipboardData.setData("text/plain", copiedRows.join("\n"));
    event.preventDefault();
  }

  function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    const clipboardText = event.clipboardData.getData("text/plain");

    if (!clipboardText) {
      return;
    }

    const pastedRows = clipboardText
      .replace(/\r/g, "")
      .split("\n")
      .filter((row) => row.length > 0)
      .map((row) => row.split("\t"));

    const startRow = selection.focus.row;
    const startColumn = selection.focus.column;
    let protectedCellEncountered = false;

    setGrid((currentGrid) => {
      const nextGrid = currentGrid.map((row) => row.map((cell) => ({ ...cell })));

      pastedRows.forEach((pastedRow, pastedRowIndex) => {
        pastedRow.forEach((pastedValue, pastedColumnIndex) => {
          const targetRow = startRow + pastedRowIndex;
          const targetColumn = startColumn + pastedColumnIndex;

          if (
            targetRow >= nextGrid.length ||
            targetColumn >= staff.length
          ) {
            return;
          }

          const existingCell = nextGrid[targetRow][targetColumn];
          const pastedCell = createCellFromText(pastedValue);

          if (
            !manualMode &&
            existingCell.assignmentType !== "EMPTY" &&
            existingCell.text !== pastedCell.text
          ) {
            protectedCellEncountered = true;
            return;
          }

          nextGrid[targetRow][targetColumn] = pastedCell;
        });
      });

      return nextGrid;
    });

    if (protectedCellEncountered) {
      onConflict(
        "Some pasted cells were skipped because Auto-safe mode will not replace existing assignments. Turn on Manual Mode to force replacements."
      );
    }

    event.preventDefault();
  }

  function saveEditedCell(row: number, column: number, text: string) {
    const currentCell = grid[row][column];
    const updatedCell = createCellFromText(text);

    if (
      !manualMode &&
      currentCell.assignmentType !== "EMPTY" &&
      currentCell.text !== updatedCell.text
    ) {
      onConflict(
        "This cell already contains an assignment. Auto-safe mode will not replace it. Turn on Manual Mode if you need to force the change."
      );
      setEditingCell(null);
      return;
    }

    setGrid((currentGrid) =>
      currentGrid.map((gridRow, rowIndex) =>
        gridRow.map((cell, columnIndex) => {
          if (rowIndex === row && columnIndex === column) {
            return updatedCell;
          }

          return cell;
        })
      )
    );

    setEditingCell(null);
  }

  function handleDragStart(
    event: DragEvent<HTMLTableCellElement>,
    row: number,
    column: number
  ) {
    if (!manualMode || grid[row][column].assignmentType === "EMPTY") {
      event.preventDefault();
      return;
    }

    setDraggedCell({ row, column });
    event.dataTransfer.effectAllowed = "move";
  }

  function handleDrop(
    event: DragEvent<HTMLTableCellElement>,
    targetRow: number,
    targetColumn: number
  ) {
    event.preventDefault();

    if (!manualMode || !draggedCell) {
      return;
    }

    if (
      draggedCell.row === targetRow &&
      draggedCell.column === targetColumn
    ) {
      setDraggedCell(null);
      return;
    }

    const sourceCell = grid[draggedCell.row][draggedCell.column];
    const targetCell = grid[targetRow][targetColumn];

    if (
      targetCell.assignmentType !== "EMPTY" &&
      targetCell.assignmentType !== "UNAVAILABLE" &&
      targetCell.text
    ) {
      onDisplacedAssignment(targetCell.text);
    }

    setGrid((currentGrid) => {
      const nextGrid = currentGrid.map((row) => row.map((cell) => ({ ...cell })));

      nextGrid[targetRow][targetColumn] = {
        ...sourceCell,
      };
      nextGrid[draggedCell.row][draggedCell.column] = createCellFromText("");

      return nextGrid;
    });

    selectSingleCell(targetRow, targetColumn);
    setDraggedCell(null);
  }

  return (
    <div
      className="schedule-grid-wrapper"
      tabIndex={0}
      onKeyDown={handleGridKeyDown}
      onCopy={handleCopy}
      onPaste={handlePaste}
      onMouseUp={stopDragSelection}
      onMouseLeave={stopDragSelection}
      aria-label="SOS schedule spreadsheet"
    >
      <table className="schedule-grid">
        <thead>
          <tr>
            <th className="schedule-time-column">Time</th>
            {staff.map((staffMember) => (
              <th key={staffMember.id} className="schedule-staff-heading">
                {staffMember.name}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {DAILY_TIME_SLOTS.map((timeSlot, rowIndex) => (
            <tr key={timeSlot.startTime}>
              <th className="schedule-time-column">{timeSlot.label}</th>

              {staff.map((staffMember, columnIndex) => {
                const cell = grid[rowIndex][columnIndex];
                const selected = isCellSelected(rowIndex, columnIndex);
                const isEditing =
                  editingCell?.row === rowIndex &&
                  editingCell?.column === columnIndex;

                return (
                  <td
                    key={`${timeSlot.startTime}-${staffMember.id}`}
                    className={cellClassName(cell, selected)}
                    style={{ backgroundColor: cell.color }}
                    draggable={manualMode && cell.assignmentType !== "EMPTY"}
                    onMouseDown={(event) =>
                      handleCellMouseDown(event, rowIndex, columnIndex)
                    }
                    onMouseEnter={() =>
                      handleCellMouseEnter(rowIndex, columnIndex)
                    }
                    onDoubleClick={() => {
                      setEditingCell({ row: rowIndex, column: columnIndex });
                      window.setTimeout(() => editorRef.current?.focus(), 0);
                    }}
                    onDragStart={(event) =>
                      handleDragStart(event, rowIndex, columnIndex)
                    }
                    onDragOver={(event) => {
                      if (manualMode) {
                        event.preventDefault();
                      }
                    }}
                    onDrop={(event) =>
                      handleDrop(event, rowIndex, columnIndex)
                    }
                  >
                    {isEditing ? (
                      <input
                        ref={editorRef}
                        className="schedule-cell-editor"
                        defaultValue={cell.text}
                        onBlur={(event) =>
                          saveEditedCell(
                            rowIndex,
                            columnIndex,
                            event.currentTarget.value
                          )
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            saveEditedCell(
                              rowIndex,
                              columnIndex,
                              event.currentTarget.value
                            );
                          }

                          if (event.key === "Escape") {
                            event.preventDefault();
                            setEditingCell(null);
                          }
                        }}
                      />
                    ) : (
                      cell.text
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
