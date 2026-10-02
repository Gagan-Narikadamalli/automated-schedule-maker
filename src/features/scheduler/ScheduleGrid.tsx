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
import styles from "./ScheduleGrid.module.css";
import {
  createEmptyScheduleCell,
  createPresetScheduleCell,
  createScheduleCellFromText,
  SCHEDULE_PRESETS,
  type SchedulePreset,
} from "./schedulePresets";
import type { CellPosition, StaffColumn } from "./types";
import { useSchedulerConfirm } from "./useSchedulerConfirm";

export type ScheduleGridMutation = {
  row: number;
  column: number;
  staffId: string;
  startTime: string;
  previousCell: DemoGridCell;
  nextCell: DemoGridCell;
};

type ScheduleGridProps = {
  staff: StaffColumn[];
  initialGrid: DemoGridCell[][];
  manualMode: boolean;
  placementCell?: DemoGridCell | null;
  onPlacementComplete?: () => Promise<void> | void;
  onConflict: (message: string) => void;
  onDisplacedAssignment: (assignment: string) => void;
  onMutations?: (
    mutations: ScheduleGridMutation[],
    force: boolean
  ) => Promise<boolean>;
};

type Selection = {
  anchor: CellPosition;
  focus: CellPosition;
};

type HistoryEntry = {
  mutations: ScheduleGridMutation[];
};

type GridColumn = StaffColumn & {
  temporary?: boolean;
};

const SCRATCH_COLUMNS: GridColumn[] = [
  {
    id: "__scratch-1",
    name: "Scratch 1",
    color: "#EEF2F4",
    temporary: true,
  },
  {
    id: "__scratch-2",
    name: "Scratch 2",
    color: "#EEF2F4",
    temporary: true,
  },
  {
    id: "__scratch-3",
    name: "Scratch 3",
    color: "#EEF2F4",
    temporary: true,
  },
  {
    id: "__scratch-4",
    name: "Scratch 4",
    color: "#EEF2F4",
    temporary: true,
  },
];

function normalizeSelection(selection: Selection) {
  return {
    firstRow: Math.min(selection.anchor.row, selection.focus.row),
    lastRow: Math.max(selection.anchor.row, selection.focus.row),
    firstColumn: Math.min(selection.anchor.column, selection.focus.column),
    lastColumn: Math.max(selection.anchor.column, selection.focus.column),
  };
}

function cloneGrid(grid: DemoGridCell[][]): DemoGridCell[][] {
  return grid.map((row) => row.map((cell) => ({ ...cell })));
}

function createScratchCell(): DemoGridCell {
  return {
    text: "",
    assignmentType: "EMPTY",
  };
}

function addScratchColumns(initialGrid: DemoGridCell[][]): DemoGridCell[][] {
  return DAILY_TIME_SLOTS.map((_, rowIndex) => {
    const scheduleRow = initialGrid[rowIndex] ?? [];

    return [
      ...scheduleRow.map((cell) => ({ ...cell })),
      ...SCRATCH_COLUMNS.map(() => createScratchCell()),
    ];
  });
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

function isOccupied(cell: DemoGridCell): boolean {
  return (
    cell.assignmentType !== "EMPTY" &&
    cell.assignmentType !== "UNAVAILABLE"
  );
}

export function ScheduleGrid({
  staff,
  initialGrid,
  manualMode,
  placementCell = null,
  onPlacementComplete,
  onConflict,
  onDisplacedAssignment,
  onMutations,
}: ScheduleGridProps) {
  const columns = useMemo<GridColumn[]>(
    () => [...staff, ...SCRATCH_COLUMNS],
    [staff]
  );
  const [grid, setGrid] = useState<DemoGridCell[][]>(() =>
    addScratchColumns(initialGrid)
  );
  const [selection, setSelection] = useState<Selection>({
    anchor: { row: 0, column: 0 },
    focus: { row: 0, column: 0 },
  });
  const [editingCell, setEditingCell] = useState<CellPosition | null>(null);
  const [draggedCell, setDraggedCell] = useState<CellPosition | null>(null);
  const [dragOverCell, setDragOverCell] = useState<CellPosition | null>(null);
  const [moveSource, setMoveSource] = useState<CellPosition | null>(null);
  const [dragSelecting, setDragSelecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [undoStack, setUndoStack] = useState<HistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryEntry[]>([]);
  const scheduleAreaRef = useRef<HTMLDivElement | null>(null);
  const gridWrapperRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<HTMLInputElement | null>(null);
  const confirmation = useSchedulerConfirm();

  const normalizedSelection = useMemo(
    () => normalizeSelection(selection),
    [selection]
  );

  const selectedCell = grid[selection.focus.row]?.[selection.focus.column];

  function focusGrid() {
    window.requestAnimationFrame(() => gridWrapperRef.current?.focus());
  }

  function isScratchColumn(column: number): boolean {
    return Boolean(columns[column]?.temporary);
  }

  function isCellSelected(row: number, column: number): boolean {
    return (
      row >= normalizedSelection.firstRow &&
      row <= normalizedSelection.lastRow &&
      column >= normalizedSelection.firstColumn &&
      column <= normalizedSelection.lastColumn
    );
  }

  function isEntireRowSelected(row: number): boolean {
    return (
      row >= normalizedSelection.firstRow &&
      row <= normalizedSelection.lastRow &&
      normalizedSelection.firstColumn === 0 &&
      normalizedSelection.lastColumn === columns.length - 1
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
    focusGrid();
  }

  function selectEntireRow(row: number, extendSelection: boolean) {
    setSelection((currentSelection) => ({
      anchor: {
        row: extendSelection ? currentSelection.anchor.row : row,
        column: 0,
      },
      focus: {
        row,
        column: columns.length - 1,
      },
    }));
    focusGrid();
  }

  function mutationForCell(
    row: number,
    column: number,
    previousCell: DemoGridCell,
    nextCell: DemoGridCell
  ): ScheduleGridMutation {
    return {
      row,
      column,
      staffId: columns[column].id,
      startTime: DAILY_TIME_SLOTS[row].startTime,
      previousCell,
      nextCell,
    };
  }

  async function commitMutations(
    nextGrid: DemoGridCell[][],
    mutations: ScheduleGridMutation[],
    force: boolean,
    recordHistory = true
  ): Promise<boolean> {
    if (mutations.length === 0) {
      return true;
    }

    const previousGrid = grid;
    setGrid(nextGrid);

    const persistentMutations = mutations.filter(
      (mutation) => !isScratchColumn(mutation.column)
    );

    if (!onMutations || persistentMutations.length === 0) {
      if (recordHistory) {
        setUndoStack((current) => [...current, { mutations }].slice(-50));
        setRedoStack([]);
      }
      return true;
    }

    try {
      setSaving(true);
      const saved = await onMutations(persistentMutations, force);

      if (!saved) {
        setGrid(previousGrid);
        return false;
      }

      if (recordHistory) {
        setUndoStack((current) => [...current, { mutations }].slice(-50));
        setRedoStack([]);
      }

      return true;
    } catch {
      setGrid(previousGrid);
      onConflict(
        "The schedule change could not be saved, so the grid was restored."
      );
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function confirmReplacement(count: number): Promise<boolean> {
    if (count <= 0) {
      return true;
    }

    return confirmation.ask({
      eyebrow: "MANAGER OVERRIDE",
      title: `Replace ${count} occupied schedule block${count === 1 ? "" : "s"}?`,
      message:
        `${count} occupied schedule block${count === 1 ? "" : "s"} will be replaced. ` +
        "Each displaced client assignment will be moved to the Unplaced Assignments tray until it is placed again or marked covered.",
      confirmLabel: "Override",
      cancelLabel: "Cancel",
    });
  }

  async function undoLastChange() {
    const entry = undoStack[undoStack.length - 1];

    if (!entry || saving) {
      return;
    }

    const nextGrid = cloneGrid(grid);
    const inverseMutations = entry.mutations.map((mutation) => {
      nextGrid[mutation.row][mutation.column] = {
        ...mutation.previousCell,
      };

      return {
        ...mutation,
        previousCell: mutation.nextCell,
        nextCell: mutation.previousCell,
      };
    });

    const saved = await commitMutations(
      nextGrid,
      inverseMutations,
      true,
      false
    );

    if (saved) {
      setUndoStack((current) => current.slice(0, -1));
      setRedoStack((current) => [...current, entry].slice(-50));
      onConflict("Last schedule edit undone and saved.");
    }
  }

  async function redoLastChange() {
    const entry = redoStack[redoStack.length - 1];

    if (!entry || saving) {
      return;
    }

    const nextGrid = cloneGrid(grid);

    entry.mutations.forEach((mutation) => {
      nextGrid[mutation.row][mutation.column] = {
        ...mutation.nextCell,
      };
    });

    const saved = await commitMutations(nextGrid, entry.mutations, true, false);

    if (saved) {
      setRedoStack((current) => current.slice(0, -1));
      setUndoStack((current) => [...current, entry].slice(-50));
      onConflict("Schedule edit redone and saved.");
    }
  }

  async function placeExternalAssignment(row: number, column: number) {
    if (!placementCell || saving) {
      return;
    }

    if (isScratchColumn(column)) {
      onConflict(
        "Unplaced client assignments must be placed into a real staff column. Scratch columns are temporary only."
      );
      return;
    }

    const targetCell = grid[row][column];

    if (targetCell.assignmentType === "UNAVAILABLE") {
      onConflict(
        "That destination is unavailable because the staff member is off shift or called out."
      );
      return;
    }

    if (isOccupied(targetCell) && !(await confirmReplacement(1))) {
      return;
    }

    if (isOccupied(targetCell) && targetCell.text) {
      onDisplacedAssignment(targetCell.text);
    }

    const nextCell: DemoGridCell = {
      ...placementCell,
      source: "MANUAL",
      locked: true,
    };
    const nextGrid = cloneGrid(grid);
    nextGrid[row][column] = nextCell;
    const saved = await commitMutations(
      nextGrid,
      [mutationForCell(row, column, targetCell, nextCell)],
      true
    );

    if (saved) {
      selectSingleCell(row, column);
      await onPlacementComplete?.();
    }
  }

  function handleCellMouseDown(
    event: MouseEvent<HTMLTableCellElement>,
    row: number,
    column: number
  ) {
    if (saving) {
      return;
    }

    focusGrid();

    if (placementCell) {
      event.preventDefault();
      void placeExternalAssignment(row, column);
      return;
    }

    if (moveSource) {
      event.preventDefault();
      void moveAssignment(moveSource, { row, column });
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
    if (!dragSelecting || moveSource || placementCell || saving) {
      return;
    }

    setSelection((currentSelection) => ({
      ...currentSelection,
      focus: { row, column },
    }));
  }

  function handleRowHeaderMouseDown(
    event: MouseEvent<HTMLTableCellElement>,
    row: number
  ) {
    if (saving || moveSource || placementCell) {
      return;
    }

    event.preventDefault();
    setDragSelecting(true);
    selectEntireRow(row, event.shiftKey);
  }

  function handleRowHeaderMouseEnter(row: number) {
    if (!dragSelecting || moveSource || placementCell || saving) {
      return;
    }

    setSelection((currentSelection) => ({
      anchor: {
        row: currentSelection.anchor.row,
        column: 0,
      },
      focus: {
        row,
        column: columns.length - 1,
      },
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
      Math.min(columns.length - 1, selection.focus.column + columnDelta)
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

  async function applyPresetToSelection(preset: SchedulePreset) {
    const nextGrid = cloneGrid(grid);
    const mutations: ScheduleGridMutation[] = [];
    const displaced: string[] = [];
    let protectedCells = 0;
    let unavailableCells = 0;

    for (
      let row = normalizedSelection.firstRow;
      row <= normalizedSelection.lastRow;
      row += 1
    ) {
      for (
        let column = normalizedSelection.firstColumn;
        column <= normalizedSelection.lastColumn;
        column += 1
      ) {
        const currentCell = grid[row][column];

        if (currentCell.assignmentType === "UNAVAILABLE") {
          unavailableCells += 1;
          continue;
        }

        if (
          !manualMode &&
          isOccupied(currentCell) &&
          currentCell.text !== preset.text
        ) {
          protectedCells += 1;
          continue;
        }

        const nextCell = createPresetScheduleCell(preset, currentCell);

        if (
          manualMode &&
          isOccupied(currentCell) &&
          currentCell.text !== nextCell.text
        ) {
          displaced.push(currentCell.text);
        }

        nextGrid[row][column] = nextCell;
        mutations.push(
          mutationForCell(row, column, currentCell, nextCell)
        );
      }
    }

    if (
      displaced.length > 0 &&
      !(await confirmReplacement(displaced.length))
    ) {
      return;
    }

    displaced.forEach(onDisplacedAssignment);
    await commitMutations(nextGrid, mutations, manualMode);

    if (unavailableCells > 0) {
      onConflict(
        "Unavailable staff blocks were left unchanged because the staff member is off shift or called out."
      );
      return;
    }

    if (protectedCells > 0) {
      onConflict(
        "Some occupied cells were protected by Auto-safe mode. Turn on Manual Mode to replace them."
      );
    }
  }

  async function clearSelectedCells() {
    const nextGrid = cloneGrid(grid);
    const mutations: ScheduleGridMutation[] = [];
    const displaced: string[] = [];
    let protectedCells = 0;

    for (
      let row = normalizedSelection.firstRow;
      row <= normalizedSelection.lastRow;
      row += 1
    ) {
      for (
        let column = normalizedSelection.firstColumn;
        column <= normalizedSelection.lastColumn;
        column += 1
      ) {
        const currentCell = grid[row][column];

        if (currentCell.assignmentType === "UNAVAILABLE") {
          continue;
        }

        if (!manualMode && isOccupied(currentCell)) {
          protectedCells += 1;
          continue;
        }

        if (currentCell.assignmentType === "EMPTY") {
          continue;
        }

        if (currentCell.text && !isScratchColumn(column)) {
          displaced.push(currentCell.text);
        }

        const nextCell = createEmptyScheduleCell();
        nextGrid[row][column] = nextCell;
        mutations.push(
          mutationForCell(row, column, currentCell, nextCell)
        );
      }
    }

    if (
      displaced.length > 0 &&
      manualMode &&
      !(await confirmReplacement(displaced.length))
    ) {
      return;
    }

    displaced.forEach(onDisplacedAssignment);
    await commitMutations(nextGrid, mutations, manualMode);

    if (protectedCells > 0) {
      onConflict(
        "Auto-safe mode protects occupied assignments. Turn on Manual Mode to clear assigned cells."
      );
    }
  }

  function handleGridKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (editingCell || saving) {
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();

      if (event.shiftKey) {
        void redoLastChange();
      } else {
        void undoLastChange();
      }
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
      event.preventDefault();
      void redoLastChange();
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
        void clearSelectedCells();
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

  async function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    const clipboardText = event.clipboardData.getData("text/plain");

    if (!clipboardText || saving) {
      return;
    }

    const normalizedClipboardText = clipboardText
      .replace(/\r/g, "")
      .replace(/\n+$/, "");
    const pastedRows = normalizedClipboardText
      .split("\n")
      .map((row) => row.split("\t"));

    const startRow = normalizedSelection.firstRow;
    const startColumn = normalizedSelection.firstColumn;
    const nextGrid = cloneGrid(grid);
    const mutations: ScheduleGridMutation[] = [];
    const displaced: string[] = [];
    let protectedCellEncountered = false;

    pastedRows.forEach((pastedRow, pastedRowIndex) => {
      pastedRow.forEach((pastedValue, pastedColumnIndex) => {
        const targetRow = startRow + pastedRowIndex;
        const targetColumn = startColumn + pastedColumnIndex;

        if (targetRow >= nextGrid.length || targetColumn >= columns.length) {
          return;
        }

        const existingCell = nextGrid[targetRow][targetColumn];
        const pastedCell = createScheduleCellFromText(
          pastedValue,
          existingCell
        );

        if (existingCell.assignmentType === "UNAVAILABLE") {
          protectedCellEncountered = true;
          return;
        }

        if (
          !manualMode &&
          isOccupied(existingCell) &&
          existingCell.text !== pastedCell.text
        ) {
          protectedCellEncountered = true;
          return;
        }

        if (
          manualMode &&
          isOccupied(existingCell) &&
          existingCell.text !== pastedCell.text &&
          !isScratchColumn(targetColumn)
        ) {
          displaced.push(existingCell.text);
        }

        nextGrid[targetRow][targetColumn] = pastedCell;
        mutations.push(
          mutationForCell(
            targetRow,
            targetColumn,
            existingCell,
            pastedCell
          )
        );
      });
    });

    if (
      displaced.length > 0 &&
      !(await confirmReplacement(displaced.length))
    ) {
      event.preventDefault();
      return;
    }

    displaced.forEach(onDisplacedAssignment);
    await commitMutations(nextGrid, mutations, manualMode);

    if (protectedCellEncountered) {
      onConflict(
        "Some pasted cells were skipped because they are unavailable or protected by Auto-safe mode."
      );
    }

    event.preventDefault();
  }

  async function saveEditedCell(row: number, column: number, text: string) {
    const currentCell = grid[row][column];
    const updatedCell = createScheduleCellFromText(text, currentCell);

    if (currentCell.assignmentType === "UNAVAILABLE") {
      onConflict("Unavailable staff blocks cannot be edited.");
      setEditingCell(null);
      return;
    }

    if (
      !manualMode &&
      isOccupied(currentCell) &&
      currentCell.text !== updatedCell.text
    ) {
      onConflict(
        "This cell already contains an assignment. Auto-safe mode will not replace it. Turn on Manual Mode to force the change."
      );
      setEditingCell(null);
      return;
    }

    const replacing =
      manualMode &&
      isOccupied(currentCell) &&
      currentCell.text !== updatedCell.text;

    if (
      replacing &&
      !isScratchColumn(column) &&
      !(await confirmReplacement(1))
    ) {
      setEditingCell(null);
      return;
    }

    if (
      replacing &&
      currentCell.text &&
      !isScratchColumn(column)
    ) {
      onDisplacedAssignment(currentCell.text);
    }

    const nextGrid = cloneGrid(grid);
    nextGrid[row][column] = updatedCell;
    setEditingCell(null);

    await commitMutations(
      nextGrid,
      [mutationForCell(row, column, currentCell, updatedCell)],
      manualMode
    );
  }

  async function moveAssignment(source: CellPosition, target: CellPosition) {
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
    const sourceIsScratch = isScratchColumn(source.column);
    const targetIsScratch = isScratchColumn(target.column);

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

    if (targetIsScratch && !sourceIsScratch) {
      const nextGrid = cloneGrid(grid);
      const nextCell: DemoGridCell = {
        ...sourceCell,
        source: "MANUAL",
        locked: false,
      };

      nextGrid[target.row][target.column] = nextCell;

      await commitMutations(
        nextGrid,
        [
          mutationForCell(
            target.row,
            target.column,
            targetCell,
            nextCell
          ),
        ],
        false
      );

      selectSingleCell(target.row, target.column);
      setMoveSource(null);
      onConflict(
        "Copied to temporary Scratch space. The original scheduled assignment was left unchanged. Scratch cells are not saved to MongoDB."
      );
      return;
    }

    if (
      isOccupied(targetCell) &&
      !targetIsScratch &&
      !(await confirmReplacement(1))
    ) {
      setMoveSource(null);
      return;
    }

    if (isOccupied(targetCell) && targetCell.text && !targetIsScratch) {
      onDisplacedAssignment(targetCell.text);
    }

    const nextGrid = cloneGrid(grid);
    nextGrid[target.row][target.column] = {
      ...sourceCell,
      source: "MANUAL",
      locked: !targetIsScratch,
    };

    const mutations: ScheduleGridMutation[] = [
      mutationForCell(
        target.row,
        target.column,
        targetCell,
        nextGrid[target.row][target.column]
      ),
    ];

    if (!sourceIsScratch) {
      nextGrid[source.row][source.column] = createEmptyScheduleCell();
      mutations.unshift(
        mutationForCell(
          source.row,
          source.column,
          sourceCell,
          nextGrid[source.row][source.column]
        )
      );
    }

    await commitMutations(nextGrid, mutations, true);
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
      placementCell ||
      saving ||
      cell.assignmentType === "EMPTY" ||
      cell.assignmentType === "UNAVAILABLE"
    ) {
      event.preventDefault();
      return;
    }

    setDraggedCell({ row, column });
    event.dataTransfer.effectAllowed = "copyMove";
    event.dataTransfer.setData("text/plain", cell.text);
  }

  function handleDrop(
    event: DragEvent<HTMLTableCellElement>,
    targetRow: number,
    targetColumn: number
  ) {
    event.preventDefault();

    if (!manualMode || !draggedCell || placementCell || saving) {
      return;
    }

    void moveAssignment(draggedCell, {
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
          <strong>
            {placementCell
              ? `Placement mode: ${placementCell.text}`
              : "Selected cell actions"}
          </strong>
          <span>
            {placementCell
              ? "Click or tap an available destination cell to place this unassigned client."
              : "Set Break, Nap, Speech, or a combined Break activity without typing."}
            {saving ? " Saving changes..." : ""}
          </span>
        </div>

        <div className="schedule-grid-tools-actions">
          {SCHEDULE_PRESETS.map((preset) => (
            <button
              key={preset.assignmentType}
              type="button"
              className="quick-action-button"
              disabled={saving || Boolean(placementCell)}
              onClick={() => void applyPresetToSelection(preset)}
            >
              {preset.label}
            </button>
          ))}

          <button
            type="button"
            className="quick-action-button"
            disabled={saving || Boolean(placementCell)}
            onClick={() => void clearSelectedCells()}
          >
            Clear
          </button>

          <button
            type="button"
            className={`quick-action-button ${
              moveSource ? "quick-action-button-active" : ""
            }`}
            disabled={saving || Boolean(placementCell)}
            onClick={moveSource ? () => setMoveSource(null) : beginMoveSelected}
          >
            {moveSource ? "Cancel Move" : "Move Selected"}
          </button>

          <button
            type="button"
            className="quick-action-button"
            disabled={saving || undoStack.length === 0 || Boolean(placementCell)}
            onClick={() => void undoLastChange()}
          >
            Undo
          </button>

          <button
            type="button"
            className="quick-action-button"
            disabled={saving || redoStack.length === 0 || Boolean(placementCell)}
            onClick={() => void redoLastChange()}
          >
            Redo
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
        ref={gridWrapperRef}
        className={`schedule-grid-wrapper ${styles.scrollWindow} ${
          moveSource || placementCell ? "schedule-grid-move-mode" : ""
        }`}
        tabIndex={0}
        onKeyDown={handleGridKeyDown}
        onCopy={handleCopy}
        onPaste={(event) => void handlePaste(event)}
        onMouseUp={stopDragSelection}
        onMouseLeave={stopDragSelection}
        aria-label="SOS schedule spreadsheet"
      >
        <table className="schedule-grid">
          <thead>
            <tr>
              <th className="schedule-time-column">Time</th>
              {columns.map((column, columnIndex) => (
                <th
                  key={column.id}
                  className={`schedule-staff-heading ${
                    column.temporary ? styles.scratchHeader : ""
                  } ${
                    columnIndex === staff.length ? styles.scratchDivider : ""
                  }`}
                  title={
                    column.temporary
                      ? "Temporary Excel-like scratch space. Scratch cells are kept only in this browser view and are not saved to MongoDB."
                      : undefined
                  }
                >
                  {column.name}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {DAILY_TIME_SLOTS.map((timeSlot, rowIndex) => (
              <tr key={timeSlot.startTime}>
                <th
                  className={`schedule-time-column ${
                    isEntireRowSelected(rowIndex) ? styles.selectedRowHeader : ""
                  }`}
                  title="Click to select this entire row. Shift-click another time to select multiple rows."
                  onMouseDown={(event) =>
                    handleRowHeaderMouseDown(event, rowIndex)
                  }
                  onMouseEnter={() => handleRowHeaderMouseEnter(rowIndex)}
                >
                  {timeSlot.label}
                </th>

                {columns.map((column, columnIndex) => {
                  const cell = grid[rowIndex][columnIndex];
                  const selected = isCellSelected(rowIndex, columnIndex);
                  const dragTarget = isDragTarget(rowIndex, columnIndex);
                  const isEditing =
                    editingCell?.row === rowIndex &&
                    editingCell?.column === columnIndex;
                  const scratchColumn = Boolean(column.temporary);

                  return (
                    <td
                      key={`${timeSlot.startTime}-${column.id}`}
                      className={`${cellClassName(cell, selected)} ${
                        scratchColumn ? styles.scratchCell : ""
                      } ${
                        columnIndex === staff.length ? styles.scratchDivider : ""
                      } ${
                        dragTarget ? "schedule-cell-drop-target" : ""
                      }`}
                      style={{ backgroundColor: cell.color }}
                      draggable={
                        manualMode &&
                        !placementCell &&
                        !saving &&
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
                        if (saving || placementCell) {
                          return;
                        }

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
                          event.dataTransfer.dropEffect = scratchColumn
                            ? "copy"
                            : "move";
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
                            void saveEditedCell(
                              rowIndex,
                              columnIndex,
                              event.currentTarget.value
                            )
                          }
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              void saveEditedCell(
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

      {confirmation.dialog}
    </div>
  );
}
