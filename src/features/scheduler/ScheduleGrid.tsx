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
import type { DemoGridCell } from "./demoData";
import {
  createEmptyScheduleCell,
  createPresetScheduleCell,
  createScheduleCellFromText,
  SCHEDULE_PRESETS,
  type SchedulePreset,
} from "./schedulePresets";
import type { CellPosition, StaffColumn } from "./types";

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

function cellClassName(cell: DemoGridCell, selected: boolean): string {
  const classNames = ["schedule-cell"];

  if (cell.assignmentType === "BREAK") {
    classNames.push("schedule-cell-break");
  }

  if (cell.assignmentType === "NAP") {
    classNames.push("schedule-cell-nap");
  }

  if (cell.assignmentType === "SPEECH") {
    classNames.push("schedule-cell-speech");
  }

  if (cell.assignmentType === "BREAK_NAP") {
    classNames.push("schedule-cell-break-nap");
  }

  if (cell.assignmentType === "BREAK_SPEECH") {
    classNames.push("schedule-cell-break-speech");
  }

  if (cell.assignmentType === "UNAVAILABLE") {
    classNames.push("schedule-cell-unavailable");
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
  const [dragOverCell, setDragOverCell] = useState<CellPosition | null>(null);
  const [moveSource, setMoveSource] = useState<CellPosition | null>(null);
  const [dragSelecting, setDragSelecting] = useState(false);
  const scheduleAreaRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<HTMLInputElement | null>(null);

  const normalizedSelection = useMemo(
    () => normalizeSelection(selection),
    [selection]
  );

  const selectedCell = grid[selection.focus.row]?.[selection.focus.column];

  function isCellSelected(row: number, column: number): boolean {
    return (
      row >= normalizedSelection.firstRow &&
      row <= normalizedSelection.lastRow &&
      column >= normalizedSelection.firstColumn &&
      column <= normalizedSelection.lastColumn
    );
  }

  function isDragTarget(row: number, column: number): boolean {
    return dragOverCell?.row === row && dragOverCell?.column === column;
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
    if (moveSource) {
      event.preventDefault();
      moveAssignment(moveSource, { row, column });
      return;
    }

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
    if (!dragSelecting || moveSource) {
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

  function applyPresetToSelection(preset: SchedulePreset) {
    let protectedCells = 0;
    let unavailableCells = 0;

    setGrid((currentGrid) =>
      currentGrid.map((row, rowIndex) =>
        row.map((cell, columnIndex) => {
          if (!isCellSelected(rowIndex, columnIndex)) {
            return cell;
          }

          if (cell.assignmentType === "UNAVAILABLE") {
            unavailableCells += 1;
            return cell;
          }

          if (
            !manualMode &&
            cell.assignmentType !== "EMPTY" &&
            cell.text !== preset.text
          ) {
            protectedCells += 1;
            return cell;
          }

          if (
            manualMode &&
            cell.assignmentType !== "EMPTY" &&
            cell.text &&
            cell.text !== preset.text
          ) {
            onDisplacedAssignment(cell.text);
          }

          return createPresetScheduleCell(preset);
        })
      )
    );

    if (unavailableCells > 0) {
      onConflict(
        "Unavailable staff blocks were left unchanged. Staff who are off shift or called out cannot receive schedule assignments."
      );
      return;
    }

    if (protectedCells > 0) {
      onConflict(
        "Some occupied cells were protected by Auto-safe mode. Turn on Manual Mode if you need to replace existing assignments."
      );
    }
  }

  function clearSelectedCells() {
    let protectedCells = 0;

    setGrid((currentGrid) =>
      currentGrid.map((row, rowIndex) =>
        row.map((cell, columnIndex) => {
          if (!isCellSelected(rowIndex, columnIndex)) {
            return cell;
          }

          if (cell.assignmentType === "UNAVAILABLE") {
            return cell;
          }

          if (!manualMode && cell.assignmentType !== "EMPTY") {
            protectedCells += 1;
            return cell;
          }

          return createEmptyScheduleCell();
        })
      )
    );

    if (protectedCells > 0) {
      onConflict(
        "Auto-safe mode protects occupied assignments. Turn on Manual Mode to clear assigned cells."
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
      case "Escape":
        setMoveSource(null);
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
      const nextGrid = currentGrid.map((row) =>
        row.map((cell) => ({ ...cell }))
      );

      pastedRows.forEach((pastedRow, pastedRowIndex) => {
        pastedRow.forEach((pastedValue, pastedColumnIndex) => {
          const targetRow = startRow + pastedRowIndex;
          const targetColumn = startColumn + pastedColumnIndex;

          if (targetRow >= nextGrid.length || targetColumn >= staff.length) {
            return;
          }

          const existingCell = nextGrid[targetRow][targetColumn];
          const pastedCell = createScheduleCellFromText(pastedValue);

          if (existingCell.assignmentType === "UNAVAILABLE") {
            protectedCellEncountered = true;
            return;
          }

          if (
            !manualMode &&
            existingCell.assignmentType !== "EMPTY" &&
            existingCell.text !== pastedCell.text
          ) {
            protectedCellEncountered = true;
            return;
          }

          if (
            manualMode &&
            existingCell.assignmentType !== "EMPTY" &&
            existingCell.text &&
            existingCell.text !== pastedCell.text
          ) {
            onDisplacedAssignment(existingCell.text);
          }

          nextGrid[targetRow][targetColumn] = pastedCell;
        });
      });

      return nextGrid;
    });

    if (protectedCellEncountered) {
      onConflict(
        "Some pasted cells were skipped because they are unavailable or protected by Auto-safe mode."
      );
    }

    event.preventDefault();
  }

  function saveEditedCell(row: number, column: number, text: string) {
    const currentCell = grid[row][column];
    const updatedCell = createScheduleCellFromText(text);

    if (currentCell.assignmentType === "UNAVAILABLE") {
      onConflict("Unavailable staff blocks cannot be edited.");
      setEditingCell(null);
      return;
    }

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

    if (
      manualMode &&
      currentCell.assignmentType !== "EMPTY" &&
      currentCell.text &&
      currentCell.text !== updatedCell.text
    ) {
      onDisplacedAssignment(currentCell.text);
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

  function moveAssignment(source: CellPosition, target: CellPosition) {
    if (!manualMode) {
      onConflict("Turn on Manual Mode before moving assignments.");
      setMoveSource(null);
      return;
    }

    if (source.row === target.row && source.column === target.column) {
      setMoveSource(null);
      return;
    }

    const sourceCell = grid[source.row][source.column];
    const targetCell = grid[target.row][target.column];

    if (sourceCell.assignmentType === "EMPTY") {
      onConflict("Select an assignment before choosing Move Selected.");
      setMoveSource(null);
      return;
    }

    if (targetCell.assignmentType === "UNAVAILABLE") {
      onConflict(
        "That destination is unavailable because the staff member is off shift or called out."
      );
      setMoveSource(null);
      return;
    }

    if (targetCell.assignmentType !== "EMPTY" && targetCell.text) {
      onDisplacedAssignment(targetCell.text);
    }

    setGrid((currentGrid) => {
      const nextGrid = currentGrid.map((row) =>
        row.map((cell) => ({ ...cell }))
      );

      nextGrid[target.row][target.column] = {
        ...sourceCell,
      };
      nextGrid[source.row][source.column] = createEmptyScheduleCell();

      return nextGrid;
    });

    selectSingleCell(target.row, target.column);
    setMoveSource(null);
  }

  function handleDragStart(
    event: DragEvent<HTMLTableCellElement>,
    row: number,
    column: number
  ) {
    const cell = grid[row][column];

    if (
      !manualMode ||
      cell.assignmentType === "EMPTY" ||
      cell.assignmentType === "UNAVAILABLE"
    ) {
      event.preventDefault();
      return;
    }

    setDraggedCell({ row, column });
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", cell.text);
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

    moveAssignment(draggedCell, {
      row: targetRow,
      column: targetColumn,
    });
    setDraggedCell(null);
    setDragOverCell(null);
  }

  function beginMoveSelected() {
    if (!manualMode) {
      onConflict("Turn on Manual Mode to move assignments.");
      return;
    }

    if (!selectedCell || selectedCell.assignmentType === "EMPTY") {
      onConflict("Select an assignment first, then choose Move Selected.");
      return;
    }

    if (selectedCell.assignmentType === "UNAVAILABLE") {
      onConflict("Unavailable blocks cannot be moved.");
      return;
    }

    setMoveSource(selection.focus);
    onConflict(
      "Move mode is active. Click or tap the destination cell. Press Escape or Cancel Move to stop."
    );
  }

  async function toggleFocusView() {
    const scheduleArea = scheduleAreaRef.current;

    if (!scheduleArea) {
      return;
    }

    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }

    if (scheduleArea.requestFullscreen) {
      await scheduleArea.requestFullscreen();
    }
  }

  return (
    <div ref={scheduleAreaRef} className="schedule-grid-area">
      <div className="schedule-grid-tools" aria-label="Selected cell actions">
        <div className="schedule-grid-tools-label">
          <strong>Selected cell actions</strong>
          <span>
            Set Break, Nap, Speech, or a combined Break activity without typing.
          </span>
        </div>

        <div className="schedule-grid-tools-actions">
          {SCHEDULE_PRESETS.map((preset) => (
            <button
              key={preset.assignmentType}
              type="button"
              className="quick-action-button"
              onClick={() => applyPresetToSelection(preset)}
            >
              {preset.label}
            </button>
          ))}

          <button
            type="button"
            className="quick-action-button"
            onClick={clearSelectedCells}
          >
            Clear
          </button>

          <button
            type="button"
            className={`quick-action-button ${
              moveSource ? "quick-action-button-active" : ""
            }`}
            onClick={moveSource ? () => setMoveSource(null) : beginMoveSelected}
          >
            {moveSource ? "Cancel Move" : "Move Selected"}
          </button>

          <button
            type="button"
            className="quick-action-button quick-action-button-focus"
            onClick={() => void toggleFocusView()}
          >
            Focus View
          </button>
        </div>
      </div>

      <div
        className={`schedule-grid-wrapper ${
          moveSource ? "schedule-grid-move-mode" : ""
        }`}
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
                  const dragTarget = isDragTarget(rowIndex, columnIndex);
                  const isEditing =
                    editingCell?.row === rowIndex &&
                    editingCell?.column === columnIndex;

                  return (
                    <td
                      key={`${timeSlot.startTime}-${staffMember.id}`}
                      className={`${cellClassName(cell, selected)} ${
                        dragTarget ? "schedule-cell-drop-target" : ""
                      }`}
                      style={{ backgroundColor: cell.color }}
                      draggable={
                        manualMode &&
                        cell.assignmentType !== "EMPTY" &&
                        cell.assignmentType !== "UNAVAILABLE"
                      }
                      onMouseDown={(event) =>
                        handleCellMouseDown(event, rowIndex, columnIndex)
                      }
                      onMouseEnter={() =>
                        handleCellMouseEnter(rowIndex, columnIndex)
                      }
                      onDoubleClick={() => {
                        if (cell.assignmentType === "UNAVAILABLE") {
                          onConflict("Unavailable staff blocks cannot be edited.");
                          return;
                        }

                        setEditingCell({
                          row: rowIndex,
                          column: columnIndex,
                        });
                        window.setTimeout(
                          () => editorRef.current?.focus(),
                          0
                        );
                      }}
                      onDragStart={(event) =>
                        handleDragStart(event, rowIndex, columnIndex)
                      }
                      onDragEnd={() => {
                        setDraggedCell(null);
                        setDragOverCell(null);
                      }}
                      onDragEnter={() => {
                        if (manualMode && draggedCell) {
                          setDragOverCell({
                            row: rowIndex,
                            column: columnIndex,
                          });
                        }
                      }}
                      onDragOver={(event) => {
                        if (manualMode) {
                          event.preventDefault();
                          event.dataTransfer.dropEffect = "move";
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
    </div>
  );
}
