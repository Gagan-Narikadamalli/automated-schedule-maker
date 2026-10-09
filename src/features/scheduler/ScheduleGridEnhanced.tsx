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
  managerConfirmedBoundaryOverride?: boolean;
  managerConfirmedSameTimeSwap?: boolean;
  stagedInScratch?: boolean;
};

type ScheduleGridProps = {
  staff: StaffColumn[];
  initialGrid: DemoGridCell[][];
  manualMode: boolean;
  clients?: Array<{ id: string; code: string; color?: string }>;
  placementCell?: DemoGridCell | null;
  onPlacementComplete?: () => Promise<void> | void;
  onConflict: (message: string) => void;
  onDisplacedAssignment: (assignment: string) => void;
  onMutations?: (
    mutations: ScheduleGridMutation[],
    allowForce: boolean
  ) => Promise<boolean>;
};

type Selection = {
  anchor: CellPosition;
  focus: CellPosition;
};

type HistoryEntry = {
  mutations: ScheduleGridMutation[];
};

type CutBuffer = {
  text: string;
  cells: Array<{
    row: number;
    column: number;
    rowOffset: number;
    columnOffset: number;
    cell: DemoGridCell;
  }>;
  rowCount: number;
  columnCount: number;
};

type GridColumn = StaffColumn & {
  temporary?: boolean;
};

const SCRATCH_COLUMNS: GridColumn[] = [
  { id: "__scratch-1", name: "Scratch 1", color: "#EEF2F4", temporary: true },
  { id: "__scratch-2", name: "Scratch 2", color: "#EEF2F4", temporary: true },
  { id: "__scratch-3", name: "Scratch 3", color: "#EEF2F4", temporary: true },
  { id: "__scratch-4", name: "Scratch 4", color: "#EEF2F4", temporary: true },
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
  return { text: "", assignmentType: "EMPTY" };
}

function createOpenOverrideCell(): DemoGridCell {
  return {
    text: "",
    assignmentType: "OPEN",
    source: "MANUAL",
    locked: true,
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

  if (cell.assignmentType === "BREAK") classNames.push("schedule-cell-break");
  if (cell.assignmentType === "NAP") classNames.push("schedule-cell-nap");
  if (cell.assignmentType === "SPEECH") classNames.push("schedule-cell-speech");
  if (cell.assignmentType === "BREAK_NAP") classNames.push("schedule-cell-break-nap");
  if (cell.assignmentType === "BREAK_SPEECH") classNames.push("schedule-cell-break-speech");
  if (cell.assignmentType === "UNAVAILABLE") classNames.push("schedule-cell-unavailable");
  if (selected) classNames.push("schedule-cell-selected");

  return classNames.join(" ");
}

function isOccupied(cell: DemoGridCell): boolean {
  return !["EMPTY", "OPEN", "UNAVAILABLE"].includes(cell.assignmentType);
}

function isClientAssignment(cell: DemoGridCell): boolean {
  return cell.assignmentType === "CLIENT_1_TO_1" && Boolean(cell.text);
}

export function ScheduleGridEnhanced({
  staff,
  initialGrid,
  manualMode,
  clients = [],
  placementCell = null,
  onPlacementComplete,
  onConflict,
  onDisplacedAssignment,
  onMutations,
}: ScheduleGridProps) {
  const columns = useMemo<GridColumn[]>(() => [...staff, ...SCRATCH_COLUMNS], [staff]);
  const [grid, setGrid] = useState<DemoGridCell[][]>(() => addScratchColumns(initialGrid));
  const [selection, setSelection] = useState<Selection>({
    anchor: { row: 0, column: 0 },
    focus: { row: 0, column: 0 },
  });
  const [editingCell, setEditingCell] = useState<CellPosition | null>(null);
  const [draggedCell, setDraggedCell] = useState<CellPosition | null>(null);
  const [draggedCells, setDraggedCells] = useState<CellPosition[]>([]);
  const [napPicker, setNapPicker] = useState<{ preset: SchedulePreset; rows: CellPosition[] } | null>(null);
  const [napClientId, setNapClientId] = useState("");
  const [dragOverCell, setDragOverCell] = useState<CellPosition | null>(null);
  const [moveSource, setMoveSource] = useState<CellPosition | null>(null);
  const [dragSelecting, setDragSelecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [undoStack, setUndoStack] = useState<HistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryEntry[]>([]);
  const [cutBuffer, setCutBuffer] = useState<CutBuffer | null>(null);
  const scheduleAreaRef = useRef<HTMLDivElement | null>(null);
  const gridWrapperRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<HTMLInputElement | null>(null);
  const confirmation = useSchedulerConfirm();

  const normalizedSelection = useMemo(() => normalizeSelection(selection), [selection]);
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

  function selectSingleCell(row: number, column: number) {
    setSelection({ anchor: { row, column }, focus: { row, column } });
    focusGrid();
  }

  function selectEntireRow(row: number, extend: boolean) {
    setSelection((current) => ({
      anchor: { row: extend ? current.anchor.row : row, column: 0 },
      focus: { row, column: columns.length - 1 },
    }));
    focusGrid();
  }

  function mutationForCell(
    row: number,
    column: number,
    previousCell: DemoGridCell,
    nextCell: DemoGridCell,
    managerConfirmedBoundaryOverride = false
  ): ScheduleGridMutation {
    return {
      row,
      column,
      staffId: columns[column].id,
      startTime: DAILY_TIME_SLOTS[row].startTime,
      previousCell,
      nextCell,
      managerConfirmedBoundaryOverride,
    };
  }

  async function commitMutations(
    nextGrid: DemoGridCell[][],
    mutations: ScheduleGridMutation[],
    allowForce: boolean,
    recordHistory = true
  ): Promise<boolean> {
    if (mutations.length === 0) return true;

    const previousGrid = grid;
    setGrid(nextGrid);
    const persistentMutations = mutations.filter((mutation) => !isScratchColumn(mutation.column));

    if (!onMutations || persistentMutations.length === 0) {
      if (recordHistory) {
        setUndoStack((current) => [...current, { mutations }].slice(-50));
        setRedoStack([]);
      }
      return true;
    }

    try {
      setSaving(true);
      const saved = await onMutations(persistentMutations, allowForce);
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
      onConflict("The schedule change could not be saved, so the grid was restored.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function confirmManualOverride(
    occupiedCount: number,
    unavailableCount: number,
    verb: string
  ): Promise<boolean> {
    const total = occupiedCount + unavailableCount;
    if (total === 0) return true;

    const details: string[] = [];
    if (occupiedCount > 0) {
      details.push(
        `${occupiedCount} occupied block${occupiedCount === 1 ? "" : "s"} will be ${verb}. Client assignments that lose coverage will move to Unplaced Assignments.`
      );
    }
    if (unavailableCount > 0) {
      details.push(
        `${unavailableCount} gray unavailable block${unavailableCount === 1 ? "" : "s"} represent an off-shift or call-out boundary. This manual change will create an explicit manager override for those cells.`
      );
    }

    return confirmation.ask({
      eyebrow: "MANAGER OVERRIDE",
      title: `Override ${total} protected schedule block${total === 1 ? "" : "s"}?`,
      message: details.join("\n"),
      confirmLabel: "Override",
      cancelLabel: "Cancel",
    });
  }

  async function undoLastChange() {
    const entry = undoStack[undoStack.length - 1];
    if (!entry || saving) return;

    const nextGrid = cloneGrid(grid);
    const inverse = entry.mutations.map((mutation) => {
      nextGrid[mutation.row][mutation.column] = { ...mutation.previousCell };
      return {
        ...mutation,
        previousCell: mutation.nextCell,
        nextCell: mutation.previousCell,
      };
    });

    const saved = await commitMutations(nextGrid, inverse, true, false);
    if (saved) {
      setUndoStack((current) => current.slice(0, -1));
      setRedoStack((current) => [...current, entry].slice(-50));
      onConflict("Last schedule edit undone and saved.");
    }
  }

  async function redoLastChange() {
    const entry = redoStack[redoStack.length - 1];
    if (!entry || saving) return;

    const nextGrid = cloneGrid(grid);
    entry.mutations.forEach((mutation) => {
      nextGrid[mutation.row][mutation.column] = { ...mutation.nextCell };
    });

    const saved = await commitMutations(nextGrid, entry.mutations, true, false);
    if (saved) {
      setRedoStack((current) => current.slice(0, -1));
      setUndoStack((current) => [...current, entry].slice(-50));
      onConflict("Schedule edit redone and saved.");
    }
  }

  async function placeExternalAssignment(row: number, column: number) {
    if (!placementCell || saving || isScratchColumn(column)) return;

    const targetCell = grid[row][column];
    const unavailableCount = targetCell.assignmentType === "UNAVAILABLE" ? 1 : 0;
    const occupiedCount = isOccupied(targetCell) ? 1 : 0;

    if (!manualMode && unavailableCount > 0) {
      onConflict("That gray block is an automatic boundary. Turn on Manual Mode to override it.");
      return;
    }

    if (!manualMode && occupiedCount > 0) {
      onConflict("Auto-safe mode protects occupied assignments. Turn on Manual Mode to replace this block.");
      return;
    }

    if (
      manualMode &&
      !(await confirmManualOverride(occupiedCount, unavailableCount, "replaced"))
    ) {
      return;
    }

    if (isClientAssignment(targetCell)) onDisplacedAssignment(targetCell.text);

    const nextCell: DemoGridCell = {
      ...placementCell,
      source: "MANUAL",
      locked: true,
    };
    const nextGrid = cloneGrid(grid);
    nextGrid[row][column] = nextCell;
    const saved = await commitMutations(
      nextGrid,
      [mutationForCell(row, column, targetCell, nextCell, unavailableCount > 0)],
      manualMode
    );

    if (saved) {
      selectSingleCell(row, column);
      await onPlacementComplete?.();
    }
  }

  function nearbyClientsForStaff(column: number, row: number): string[] {
    const found: string[] = [];
    for (let distance = 1; distance <= grid.length; distance++) {
      for (const nearRow of [row - distance, row + distance]) {
        const cell = grid[nearRow]?.[column];
        if (cell?.assignmentType === "CLIENT_1_TO_1" && cell.clientId && !found.includes(cell.clientId)) {
          found.push(cell.clientId);
        }
      }
      if (found.length) break;
    }
    return found;
  }

  function requestNapSelection(preset: SchedulePreset) {
    if (!manualMode) {
      onConflict("Turn on Manual Mode to link a staff break with a client's nap.");
      return;
    }
    const positions: CellPosition[] = [];
    for (let row = normalizedSelection.firstRow; row <= normalizedSelection.lastRow; row++) {
      for (let column = normalizedSelection.firstColumn; column <= normalizedSelection.lastColumn; column++) {
        if (!isScratchColumn(column)) positions.push({ row, column });
      }
    }
    if (!positions.length) return;
    const nearby = nearbyClientsForStaff(positions[0].column, positions[0].row);
    setNapClientId(nearby[0] ?? "");
    setNapPicker({ preset, rows: positions });
  }

  async function applyLinkedNap() {
    if (!napPicker || !napClientId) return;
    const client = clients.find((item) => item.id === napClientId);
    if (!client) {
      onConflict("Select a valid client before saving the Break + Nap.");
      return;
    }
    const preset = napPicker.preset;
    const nextGrid = cloneGrid(grid);
    const mutations: ScheduleGridMutation[] = [];
    let occupied = 0;
    let unavailable = 0;
    const selected = napPicker.rows;
    for (const { row, column } of selected) {
      const current = grid[row][column];
      if (current.assignmentType === "UNAVAILABLE") unavailable++;
      else if (isOccupied(current)) occupied++;
      const next = {
        ...createPresetScheduleCell(preset, current),
        text: `Break/Nap · ${client.code}`,
        clientId: client.id,
        clientCode: client.code,
      };
      nextGrid[row][column] = next;
      mutations.push(mutationForCell(row, column, current, next, current.assignmentType === "UNAVAILABLE"));
    }
    if (!(await confirmManualOverride(occupied, unavailable, "replaced by Break + Nap"))) return;
    const saved = await commitMutations(nextGrid, mutations, true);
    if (saved) {
      setNapPicker(null);
      setNapClientId("");
      onConflict(`Linked ${client.code}'s nap to ${selected.length} staff break block(s). Existing staff-client assignments outside these blocks are unchanged.`);
    }
  }

  async function applyPresetToSelection(preset: SchedulePreset) {
    if (preset.assignmentType === "BREAK_NAP") {
      requestNapSelection(preset);
      return;
    }
    const nextGrid = cloneGrid(grid);
    const mutations: ScheduleGridMutation[] = [];
    const displaced: string[] = [];
    let occupiedOverrides = 0;
    let unavailableOverrides = 0;
    let protectedCells = 0;

    for (let row = normalizedSelection.firstRow; row <= normalizedSelection.lastRow; row += 1) {
      for (let column = normalizedSelection.firstColumn; column <= normalizedSelection.lastColumn; column += 1) {
        const currentCell = grid[row][column];
        const unavailable = currentCell.assignmentType === "UNAVAILABLE";
        const occupied = isOccupied(currentCell) && currentCell.text !== preset.text;

        if (!manualMode && (unavailable || occupied)) {
          protectedCells += 1;
          continue;
        }

        const nextCell = createPresetScheduleCell(preset, currentCell);
        if (manualMode && unavailable) unavailableOverrides += 1;
        if (manualMode && occupied) occupiedOverrides += 1;
        if (manualMode && occupied && isClientAssignment(currentCell)) displaced.push(currentCell.text);

        nextGrid[row][column] = nextCell;
        mutations.push(
          mutationForCell(row, column, currentCell, nextCell, unavailable)
        );
      }
    }

    if (
      manualMode &&
      !(await confirmManualOverride(occupiedOverrides, unavailableOverrides, "replaced"))
    ) {
      return;
    }

    displaced.forEach(onDisplacedAssignment);
    await commitMutations(nextGrid, mutations, manualMode);

    if (protectedCells > 0) {
      onConflict("Auto-safe mode left protected occupied or unavailable blocks unchanged. Turn on Manual Mode to override them.");
    }
  }

  async function deleteSelectedCells() {
    const nextGrid = cloneGrid(grid);
    const mutations: ScheduleGridMutation[] = [];
    const displaced: string[] = [];
    let occupiedOverrides = 0;
    let unavailableOverrides = 0;
    let protectedCells = 0;

    for (let row = normalizedSelection.firstRow; row <= normalizedSelection.lastRow; row += 1) {
      for (let column = normalizedSelection.firstColumn; column <= normalizedSelection.lastColumn; column += 1) {
        const currentCell = grid[row][column];
        const scratch = isScratchColumn(column);
        const unavailable = currentCell.assignmentType === "UNAVAILABLE";
        const occupied = isOccupied(currentCell);

        if (!manualMode && (unavailable || occupied)) {
          protectedCells += 1;
          continue;
        }

        if (["EMPTY", "OPEN"].includes(currentCell.assignmentType)) continue;

        let nextCell: DemoGridCell;
        if (unavailable && !scratch) {
          // OPEN is persisted as a manager-created availability exception. It
          // renders like an empty cell on reload but intentionally overrides the
          // automatic gray boundary for this exact staff/time block.
          nextCell = createOpenOverrideCell();
          unavailableOverrides += 1;
        } else {
          nextCell = createEmptyScheduleCell();
          if (occupied) occupiedOverrides += 1;
        }

        if (occupied && isClientAssignment(currentCell) && !scratch) {
          displaced.push(currentCell.text);
        }

        nextGrid[row][column] = nextCell;
        mutations.push(
          mutationForCell(row, column, currentCell, nextCell, unavailable && !scratch)
        );
      }
    }

    if (
      manualMode &&
      !(await confirmManualOverride(occupiedOverrides, unavailableOverrides, "deleted"))
    ) {
      return;
    }

    displaced.forEach(onDisplacedAssignment);
    const saved = await commitMutations(nextGrid, mutations, manualMode);

    if (saved && mutations.length > 0) {
      onConflict(
        `${mutations.length} selected schedule block${mutations.length === 1 ? "" : "s"} deleted${unavailableOverrides > 0 ? "; gray boundary overrides were opened for manual scheduling" : ""}.`
      );
    } else if (protectedCells > 0) {
      onConflict("Auto-safe mode protects occupied assignments and gray boundaries. Turn on Manual Mode to delete or replace them.");
    }
  }

  function handleCellMouseDown(
    event: MouseEvent<HTMLTableCellElement>,
    row: number,
    column: number
  ) {
    if (saving || event.button !== 0) return;
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
      setSelection((current) => ({ ...current, focus: { row, column } }));
      return;
    }

    // Preserve an existing rectangular selection when the user starts dragging
    // one of its occupied cells, rather than collapsing it to a single cell.
    if (manualMode && (normalizedSelection.firstRow !== normalizedSelection.lastRow || normalizedSelection.firstColumn !== normalizedSelection.lastColumn) && isCellSelected(row, column) &&
        !["EMPTY", "OPEN", "UNAVAILABLE"].includes(grid[row][column].assignmentType)) {
      setDragSelecting(false);
      return;
    }
    setDragSelecting(true);
    selectSingleCell(row, column);
  }

  function handleCellMouseEnter(event: MouseEvent<HTMLTableCellElement>, row: number, column: number) {
    if (!dragSelecting || !(event.buttons & 1) || moveSource || placementCell || saving) {
      if (!(event.buttons & 1)) setDragSelecting(false);
      return;
    }
    setSelection((current) => ({ ...current, focus: { row, column } }));
  }

  function handleRowHeaderMouseDown(event: MouseEvent<HTMLTableCellElement>, row: number) {
    if (saving || moveSource || placementCell) return;
    event.preventDefault();
    setDragSelecting(true);
    selectEntireRow(row, event.shiftKey);
  }

  function handleRowHeaderMouseEnter(event: MouseEvent<HTMLTableCellElement>, row: number) {
    if (!dragSelecting || !(event.buttons & 1) || moveSource || placementCell || saving) {
      if (!(event.buttons & 1)) setDragSelecting(false);
      return;
    }
    setSelection((current) => ({
      anchor: { row: current.anchor.row, column: 0 },
      focus: { row, column: columns.length - 1 },
    }));
  }

  function moveSelection(rowDelta: number, columnDelta: number, extend: boolean) {
    const nextRow = Math.max(0, Math.min(DAILY_TIME_SLOTS.length - 1, selection.focus.row + rowDelta));
    const nextColumn = Math.max(0, Math.min(columns.length - 1, selection.focus.column + columnDelta));
    if (extend) {
      setSelection((current) => ({ ...current, focus: { row: nextRow, column: nextColumn } }));
    } else {
      selectSingleCell(nextRow, nextColumn);
    }
  }

  function selectedMovablePositions(): CellPosition[] {
    const positions: CellPosition[] = [];

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
        const cell = grid[row][column];

        if (!["EMPTY", "OPEN", "UNAVAILABLE"].includes(cell.assignmentType)) {
          positions.push({ row, column });
        }
      }
    }

    return positions;
  }

  function selectionClipboardText(): string {
    const copiedRows: string[] = [];

    for (
      let row = normalizedSelection.firstRow;
      row <= normalizedSelection.lastRow;
      row += 1
    ) {
      const values: string[] = [];

      for (
        let column = normalizedSelection.firstColumn;
        column <= normalizedSelection.lastColumn;
        column += 1
      ) {
        values.push(grid[row][column].text);
      }

      copiedRows.push(values.join("\t"));
    }

    return copiedRows.join("\n");
  }

  function handleCopy(event: ClipboardEvent<HTMLDivElement>) {
    const text = selectionClipboardText();
    event.clipboardData.setData("text/plain", text);
    setCutBuffer(null);
    event.preventDefault();
  }

  function handleCut(event: ClipboardEvent<HTMLDivElement>) {
    if (saving) return;

    const movable = selectedMovablePositions();

    if (movable.length === 0) {
      event.preventDefault();
      return;
    }

    const hasPersistentSource = movable.some(
      (position) => !isScratchColumn(position.column)
    );

    if (hasPersistentSource && !manualMode) {
      onConflict("Turn on Manual Mode before cutting scheduled blocks.");
      event.preventDefault();
      return;
    }

    const text = selectionClipboardText();
    const cells: CutBuffer["cells"] = [];

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
        const movableCell = !["EMPTY", "OPEN", "UNAVAILABLE"].includes(
          currentCell.assignmentType
        );

        cells.push({
          row,
          column,
          rowOffset: row - normalizedSelection.firstRow,
          columnOffset: column - normalizedSelection.firstColumn,
          cell: movableCell
            ? { ...currentCell }
            : createEmptyScheduleCell(),
        });
      }
    }

    event.clipboardData.setData("text/plain", text);
    setCutBuffer({
      text,
      cells,
      rowCount:
        normalizedSelection.lastRow - normalizedSelection.firstRow + 1,
      columnCount:
        normalizedSelection.lastColumn -
        normalizedSelection.firstColumn +
        1,
    });

    onConflict(
      `Cut ${movable.length} block${movable.length === 1 ? "" : "s"}. Select the destination and press Ctrl+V to move them.`
    );
    event.preventDefault();
  }

  async function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    const clipboardText = event.clipboardData.getData("text/plain");

    if (!clipboardText || saving) return;

    const internalCut =
      cutBuffer?.text === clipboardText ? cutBuffer : null;
    const nextGrid = cloneGrid(grid);
    const mutations: ScheduleGridMutation[] = [];
    const displaced: string[] = [];
    let occupiedOverrides = 0;
    let unavailableOverrides = 0;
    let protectedCells = 0;

    const targetStartRow = normalizedSelection.firstRow;
    const targetStartColumn = normalizedSelection.firstColumn;
    const sourceKeys = new Set(
      internalCut?.cells.map((item) => `${item.row}:${item.column}`) ?? []
    );
    const targetKeys = new Set<string>();
    const placements: Array<{
      row: number;
      column: number;
      nextCell: DemoGridCell;
    }> = [];

    if (internalCut) {
      for (const item of internalCut.cells) {
        const row = targetStartRow + item.rowOffset;
        const column = targetStartColumn + item.columnOffset;

        if (
          row < 0 ||
          row >= nextGrid.length ||
          column < 0 ||
          column >= columns.length
        ) {
          onConflict("The cut selection does not fit at that destination.");
          event.preventDefault();
          return;
        }

        placements.push({
          row,
          column,
          nextCell: {
            ...item.cell,
            source:
              item.cell.assignmentType === "EMPTY"
                ? item.cell.source
                : "MANUAL",
            locked:
              item.cell.assignmentType === "EMPTY"
                ? item.cell.locked
                : !isScratchColumn(column),
          },
        });
        targetKeys.add(`${row}:${column}`);
      }
    } else {
      const rows = clipboardText
        .replace(/\r/g, "")
        .replace(/\n+$/, "")
        .split("\n")
        .map((row) => row.split("\t"));

      rows.forEach((values, rowOffset) => {
        values.forEach((value, columnOffset) => {
          const row = targetStartRow + rowOffset;
          const column = targetStartColumn + columnOffset;

          if (row >= nextGrid.length || column >= columns.length) return;

          placements.push({
            row,
            column,
            nextCell: createScheduleCellFromText(
              value,
              nextGrid[row][column]
            ),
          });
          targetKeys.add(`${row}:${column}`);
        });
      });
    }

    const movingEntireCutIntoScratch =
      Boolean(internalCut) &&
      placements.some(
        (placement) => placement.nextCell.assignmentType !== "EMPTY"
      ) &&
      placements
        .filter((placement) => placement.nextCell.assignmentType !== "EMPTY")
        .every((placement) => isScratchColumn(placement.column));

    for (const placement of placements) {
      const { row, column } = placement;
      const currentCell = nextGrid[row][column];
      let nextCell = { ...placement.nextCell };
      const scratch = isScratchColumn(column);
      const unavailable =
        currentCell.assignmentType === "UNAVAILABLE";
      const replacing =
        isOccupied(currentCell) &&
        (currentCell.text !== nextCell.text ||
          currentCell.clientId !== nextCell.clientId);

      if (
        internalCut &&
        scratch &&
        nextCell.assignmentType !== "EMPTY" &&
        replacing &&
        !sourceKeys.has(`${row}:${column}`)
      ) {
        onConflict(
          "That Scratch destination is already occupied. Choose an empty Scratch area so nothing temporary is lost."
        );
        event.preventDefault();
        return;
      }

      if (!manualMode && !scratch && (unavailable || replacing)) {
        protectedCells += 1;
        continue;
      }

      if (
        manualMode &&
        unavailable &&
        nextCell.assignmentType === "EMPTY" &&
        !scratch
      ) {
        nextCell = createOpenOverrideCell();
      }

      if (manualMode && !scratch && unavailable) {
        unavailableOverrides += 1;
      }

      if (manualMode && !scratch && replacing) {
        occupiedOverrides += 1;
      }

      if (
        manualMode &&
        !scratch &&
        replacing &&
        isClientAssignment(currentCell) &&
        !sourceKeys.has(`${row}:${column}`)
      ) {
        displaced.push(currentCell.text);
      }

      nextGrid[row][column] = nextCell;
      mutations.push(
        mutationForCell(
          row,
          column,
          grid[row][column],
          nextCell,
          unavailable
        )
      );
    }

    if (internalCut) {
      for (const item of internalCut.cells) {
        if (item.cell.assignmentType === "EMPTY") continue;

        const key = `${item.row}:${item.column}`;

        if (targetKeys.has(key)) continue;

        const sourceCurrent = nextGrid[item.row][item.column];

        if (
          ["EMPTY", "OPEN", "UNAVAILABLE"].includes(
            sourceCurrent.assignmentType
          )
        ) {
          continue;
        }

        const empty = createEmptyScheduleCell();
        nextGrid[item.row][item.column] = empty;
        mutations.push({
          ...mutationForCell(
            item.row,
            item.column,
            grid[item.row][item.column],
            empty
          ),
          stagedInScratch:
            movingEntireCutIntoScratch &&
            !isScratchColumn(item.column),
        });
      }
    }

    if (
      manualMode &&
      !(await confirmManualOverride(
        occupiedOverrides,
        unavailableOverrides,
        internalCut
          ? "replaced by the moved selection"
          : "replaced"
      ))
    ) {
      event.preventDefault();
      return;
    }

    displaced.forEach(onDisplacedAssignment);
    const saved = await commitMutations(
      nextGrid,
      mutations,
      manualMode
    );

    if (saved && internalCut) {
      setCutBuffer(null);
      setSelection({
        anchor: {
          row: targetStartRow,
          column: targetStartColumn,
        },
        focus: {
          row: Math.min(
            DAILY_TIME_SLOTS.length - 1,
            targetStartRow + internalCut.rowCount - 1
          ),
          column: Math.min(
            columns.length - 1,
            targetStartColumn + internalCut.columnCount - 1
          ),
        },
      });

      onConflict(
        movingEntireCutIntoScratch
          ? "Cut selection moved into temporary Scratch space. The original schedule cells were cleared; finish the move before refreshing the page."
          : "Cut selection moved to the new destination."
      );
    } else if (protectedCells > 0) {
      onConflict(
        "Some pasted cells were skipped because Auto-safe mode protects occupied assignments and unavailable boundaries."
      );
    }

    event.preventDefault();
  }

  async function saveEditedCell(row: number, column: number, text: string) {
    const currentCell = grid[row][column];
    let updatedCell = createScheduleCellFromText(text, currentCell);
    const unavailable = currentCell.assignmentType === "UNAVAILABLE";
    const replacing = isOccupied(currentCell) && currentCell.text !== updatedCell.text;

    if (!manualMode && unavailable) {
      onConflict("That gray block is an automatic boundary. Turn on Manual Mode to override it.");
      setEditingCell(null);
      return;
    }
    if (!manualMode && replacing) {
      onConflict("Auto-safe mode protects occupied assignments. Turn on Manual Mode to replace this block.");
      setEditingCell(null);
      return;
    }

    if (manualMode && unavailable && updatedCell.assignmentType === "EMPTY" && !isScratchColumn(column)) {
      updatedCell = createOpenOverrideCell();
    }

    if (
      manualMode &&
      !(await confirmManualOverride(replacing ? 1 : 0, unavailable ? 1 : 0, "replaced"))
    ) {
      setEditingCell(null);
      return;
    }

    if (replacing && isClientAssignment(currentCell) && !isScratchColumn(column)) {
      onDisplacedAssignment(currentCell.text);
    }

    const nextGrid = cloneGrid(grid);
    nextGrid[row][column] = updatedCell;
    setEditingCell(null);
    await commitMutations(
      nextGrid,
      [mutationForCell(row, column, currentCell, updatedCell, unavailable)],
      manualMode
    );
  }

  async function moveAssignment(
    source: CellPosition,
    target: CellPosition
  ) {
    if (!manualMode) {
      onConflict("Turn on Manual Mode before moving assignments.");
      setMoveSource(null);
      return;
    }

    if (
      source.row === target.row &&
      source.column === target.column
    ) {
      setMoveSource(null);
      return;
    }

    const sourceCell = grid[source.row][source.column];
    const targetCell = grid[target.row][target.column];
    const sourceIsScratch = isScratchColumn(source.column);
    const targetIsScratch = isScratchColumn(target.column);

    if (
      ["EMPTY", "OPEN", "UNAVAILABLE"].includes(
        sourceCell.assignmentType
      )
    ) {
      onConflict("Select a scheduled assignment before moving it.");
      setMoveSource(null);
      return;
    }

    // Manual drag within the same time row is an Excel-like swap. No client
    // coverage disappears and nothing is sent to Unplaced.
    if (
      source.row === target.row &&
      !sourceIsScratch &&
      !targetIsScratch &&
      isOccupied(targetCell)
    ) {
      const nextGrid = cloneGrid(grid);
      const sourceNext: DemoGridCell = {
        ...targetCell,
        source: "MANUAL",
        locked: true,
      };
      const targetNext: DemoGridCell = {
        ...sourceCell,
        source: "MANUAL",
        locked: true,
      };

      nextGrid[source.row][source.column] = sourceNext;
      nextGrid[target.row][target.column] = targetNext;

      const saved = await commitMutations(
        nextGrid,
        [
          {
            ...mutationForCell(
              source.row,
              source.column,
              sourceCell,
              sourceNext
            ),
            managerConfirmedSameTimeSwap: true,
          },
          {
            ...mutationForCell(
              target.row,
              target.column,
              targetCell,
              targetNext
            ),
            managerConfirmedSameTimeSwap: true,
          },
        ],
        true
      );

      if (saved) {
        selectSingleCell(target.row, target.column);
        onConflict(
          "Same-time manual move completed as a swap. Both assignments stayed scheduled and no client block was sent to Unplaced."
        );
      }

      setMoveSource(null);
      return;
    }

    // Scratch is a temporary browser workspace. Moving into it clears the live
    // source cell instead of copying it, but does not create an Unplaced record.
    if (targetIsScratch && !sourceIsScratch) {
      if (isOccupied(targetCell)) {
        onConflict(
          "That Scratch cell is already occupied. Choose an empty Scratch cell."
        );
        setMoveSource(null);
        return;
      }

      const nextGrid = cloneGrid(grid);
      const stagedCell: DemoGridCell = {
        ...sourceCell,
        source: "MANUAL",
        locked: false,
      };
      const emptySource = createEmptyScheduleCell();

      nextGrid[target.row][target.column] = stagedCell;
      nextGrid[source.row][source.column] = emptySource;

      const saved = await commitMutations(
        nextGrid,
        [
          {
            ...mutationForCell(
              source.row,
              source.column,
              sourceCell,
              emptySource
            ),
            stagedInScratch: true,
          },
          mutationForCell(
            target.row,
            target.column,
            targetCell,
            stagedCell
          ),
        ],
        true
      );

      if (saved) {
        selectSingleCell(target.row, target.column);
        onConflict(
          "Moved to temporary Scratch space. The original schedule cell was cleared; Scratch is browser-only, so finish placing it before refreshing."
        );
      }

      setMoveSource(null);
      return;
    }

    const unavailable =
      targetCell.assignmentType === "UNAVAILABLE";
    const occupied = isOccupied(targetCell);

    if (
      !(await confirmManualOverride(
        occupied ? 1 : 0,
        unavailable ? 1 : 0,
        "replaced"
      ))
    ) {
      setMoveSource(null);
      return;
    }

    if (
      occupied &&
      isClientAssignment(targetCell) &&
      !targetIsScratch
    ) {
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
        nextGrid[target.row][target.column],
        unavailable
      ),
    ];

    nextGrid[source.row][source.column] =
      createEmptyScheduleCell();
    mutations.unshift(
      mutationForCell(
        source.row,
        source.column,
        sourceCell,
        nextGrid[source.row][source.column]
      )
    );

    const saved = await commitMutations(
      nextGrid,
      mutations,
      true
    );

    if (saved) {
      selectSingleCell(target.row, target.column);

      if (occupied && !targetIsScratch) {
        onConflict(
          "Manual move completed. The replaced destination client block was moved to Unplaced Assignments."
        );
      }
    }

    setMoveSource(null);
  }

  async function moveSelectedAssignmentsToScratch(
    sources: CellPosition[],
    target: CellPosition
  ) {
    if (!manualMode || sources.length === 0) return;

    const firstRow = Math.min(
      ...sources.map((position) => position.row)
    );
    const firstColumn = Math.min(
      ...sources.map((position) => position.column)
    );
    const destinations = sources.map((source) => ({
      source,
      target: {
        row: target.row + (source.row - firstRow),
        column:
          target.column + (source.column - firstColumn),
      },
    }));

    if (
      destinations.some(
        ({ target: destination }) =>
          destination.row < 0 ||
          destination.row >= DAILY_TIME_SLOTS.length ||
          destination.column < 0 ||
          destination.column >= columns.length
      )
    ) {
      onConflict(
        "The selected blocks do not fit at the destination. Drop them closer to the top-left of the grid."
      );
      return;
    }

    const sourceKeys = new Set(sources.map(({ row, column }) => `${row}:${column}`));
    const destinationKeys = new Set(destinations.map(({ target: cell }) => `${cell.row}:${cell.column}`));
    const replacing = destinations.filter(({ target: cell }) =>
      !sourceKeys.has(`${cell.row}:${cell.column}`) && isOccupied(grid[cell.row][cell.column])
    );
    const unavailable = destinations.filter(({ target: cell }) =>
      !isScratchColumn(cell.column) && grid[cell.row][cell.column].assignmentType === "UNAVAILABLE"
    );
    if (replacing.some(({ target: cell }) => isScratchColumn(cell.column))) {
      onConflict("A Scratch destination is occupied. Choose empty Scratch cells.");
      return;
    }
    if (!(await confirmManualOverride(replacing.length, unavailable.length, "replaced by the moved selection"))) return;
    const nextGrid = cloneGrid(grid);
    const mutations: ScheduleGridMutation[] = [];
    const movedEntirelyIntoScratch = destinations.every(({ target: destination }) => isScratchColumn(destination.column));
    const affected = new Map<string, CellPosition>();
    for (const source of sources) affected.set(`${source.row}:${source.column}`, source);
    for (const item of destinations) affected.set(`${item.target.row}:${item.target.column}`, item.target);

    // Build final state first: overlapping source/destination cells must only
    // produce ONE persisted mutation and ONE undo history entry per coordinate.
    for (const source of sources) {
      nextGrid[source.row][source.column] = createEmptyScheduleCell();
    }
    for (const item of destinations) {
      const scratch = isScratchColumn(item.target.column);
      nextGrid[item.target.row][item.target.column] = {
        ...grid[item.source.row][item.source.column],
        source: "MANUAL",
        locked: !scratch,
      };
    }
    for (const position of affected.values()) {
      const oldCell = grid[position.row][position.column];
      const newCell = nextGrid[position.row][position.column];
      mutations.push({
        ...mutationForCell(
          position.row,
          position.column,
          oldCell,
          newCell,
          !isScratchColumn(position.column) && oldCell.assignmentType === "UNAVAILABLE" && newCell.assignmentType !== "EMPTY"
        ),
        stagedInScratch: movedEntirelyIntoScratch &&
          sourceKeys.has(`${position.row}:${position.column}`) &&
          !destinationKeys.has(`${position.row}:${position.column}`) &&
          !isScratchColumn(position.column),
      });
    }
    const saved = await commitMutations(
      nextGrid,
      mutations,
      true
    );

    if (saved) {
      const lastDestination =
        destinations[destinations.length - 1].target;
      setSelection({
        anchor: { ...target },
        focus: { ...lastDestination },
      });
      onConflict(
        `${sources.length} selected blocks moved together to the new grid position.`
      );
    }
  }

  function handleGridKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (editingCell || saving) return;

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) void redoLastChange();
      else void undoLastChange();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "y") {
      event.preventDefault();
      void redoLastChange();
      return;
    }

    switch (event.key) {
      case "ArrowUp": event.preventDefault(); moveSelection(-1, 0, event.shiftKey); break;
      case "ArrowDown": event.preventDefault(); moveSelection(1, 0, event.shiftKey); break;
      case "ArrowLeft": event.preventDefault(); moveSelection(0, -1, event.shiftKey); break;
      case "ArrowRight": event.preventDefault(); moveSelection(0, 1, event.shiftKey); break;
      case "Enter":
      case "F2":
        event.preventDefault();
        if (selectedCell?.assignmentType === "UNAVAILABLE" && !manualMode) {
          onConflict("Turn on Manual Mode to edit a gray unavailable boundary.");
          break;
        }
        setEditingCell(selection.focus);
        window.setTimeout(() => editorRef.current?.focus(), 0);
        break;
      case "Delete":
      case "Backspace":
        event.preventDefault();
        void deleteSelectedCells();
        break;
      case "Escape":
        setMoveSource(null);
        break;
      default:
        break;
    }
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
      ["EMPTY", "OPEN", "UNAVAILABLE"].includes(
        cell.assignmentType
      )
    ) {
      event.preventDefault();
      return;
    }

    const sources = isCellSelected(row, column)
      ? selectedMovablePositions()
      : [{ row, column }];

    setDraggedCell({ row, column });
    setDraggedCells(
      sources.length > 0 ? sources : [{ row, column }]
    );
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", cell.text);
  }

  function handleDrop(
    event: DragEvent<HTMLTableCellElement>,
    row: number,
    column: number
  ) {
    event.preventDefault();

    if (placementCell) {
      void placeExternalAssignment(row, column);
      return;
    }

    if (!manualMode || !draggedCell || saving) return;

    const sources =
      draggedCells.length > 0
        ? draggedCells
        : [draggedCell];

    if (sources.length > 1) {
      void moveSelectedAssignmentsToScratch(sources, { row, column });
    } else {
      void moveAssignment(sources[0], { row, column });
    }

    setDraggedCell(null);
    setDraggedCells([]);
    setDragOverCell(null);
  }

  function beginMoveSelected() {
    if (!manualMode) {
      onConflict("Turn on Manual Mode to move assignments.");
      return;
    }
    if (!selectedCell || ["EMPTY", "OPEN", "UNAVAILABLE"].includes(selectedCell.assignmentType)) {
      onConflict("Select a scheduled assignment first, then choose Move Selected.");
      return;
    }
    setMoveSource(selection.focus);
    onConflict("Move mode is active. Click or tap the destination cell. Press Escape or Cancel Move to stop.");
  }

  async function toggleFocusView() {
    const scheduleArea = scheduleAreaRef.current;
    if (!scheduleArea) return;
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    await scheduleArea.requestFullscreen?.();
  }

  const breakPreset = SCHEDULE_PRESETS[0];
  const remainingPresets = SCHEDULE_PRESETS.slice(1);

  return (
    <div ref={scheduleAreaRef} className="schedule-grid-area">
      <div className="schedule-grid-tools" aria-label="Selected cell actions">
        <div className="schedule-grid-tools-label">
          <strong>{placementCell ? `Placement mode: ${placementCell.text}` : "Selected cell actions"}</strong>
          <span>
            {placementCell
              ? "Drop or click an available destination cell. In Manual Mode, gray boundaries can be overridden after confirmation."
              : "Select one cell or a range. Ctrl+C copies, Ctrl+X cuts for moving, and dragging a selected range into Scratch moves it out of the live schedule."}
            {saving ? " Saving changes..." : ""}
          </span>
        </div>

        <div className="schedule-grid-tools-actions">
          <button
            type="button"
            className="quick-action-button"
            disabled={saving || Boolean(placementCell)}
            onClick={() => void applyPresetToSelection(breakPreset)}
          >
            Break
          </button>

          <button
            type="button"
            className="quick-action-button quick-action-button-delete"
            disabled={saving || Boolean(placementCell)}
            onClick={() => void deleteSelectedCells()}
            title="Delete the selected schedule block or all selected blocks"
          >
            Delete
          </button>

          {remainingPresets.map((preset) => (
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
            className={`quick-action-button ${moveSource ? "quick-action-button-active" : ""}`}
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
        className={`schedule-grid-wrapper ${styles.scrollWindow} ${moveSource || placementCell ? "schedule-grid-move-mode" : ""}`}
        tabIndex={0}
        onKeyDown={handleGridKeyDown}
        onCopy={handleCopy}
        onCut={handleCut}
        onPaste={(event) => void handlePaste(event)}
        onMouseUp={() => setDragSelecting(false)}
        onMouseLeave={() => setDragSelecting(false)}
        aria-label="SOS schedule spreadsheet"
      >
        <table className="schedule-grid">
          <thead>
            <tr>
              <th className="schedule-time-column">Time</th>
              {columns.map((column, columnIndex) => (
                <th
                  key={column.id}
                  className={`schedule-staff-heading ${column.temporary ? styles.scratchHeader : ""} ${columnIndex === staff.length ? styles.scratchDivider : ""}`}
                  title={column.temporary ? "Temporary scratch space. Scratch cells are not saved to MongoDB." : undefined}
                  style={
                    column.temporary
                      ? undefined
                      : {
                          boxShadow: `inset 0 4px 0 ${column.color || "#9BB8CA"}`,
                        }
                  }
                >
                  <span className={styles.staffHeadingContent}>
                    {!column.temporary ? (
                      <i
                        className={styles.staffHeadingDot}
                        style={{ backgroundColor: column.color || "#9BB8CA" }}
                        aria-hidden="true"
                      />
                    ) : null}
                    {column.name}
                  </span>
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {DAILY_TIME_SLOTS.map((timeSlot, rowIndex) => (
              <tr key={timeSlot.startTime}>
                <th
                  className={`schedule-time-column ${isEntireRowSelected(rowIndex) ? styles.selectedRowHeader : ""}`}
                  title="Click to select the whole row. Shift-click another time to select multiple rows."
                  onMouseDown={(event) => handleRowHeaderMouseDown(event, rowIndex)}
                  onMouseEnter={(event) => handleRowHeaderMouseEnter(event, rowIndex)}
                >
                  {timeSlot.label}
                </th>

                {columns.map((column, columnIndex) => {
                  const cell = grid[rowIndex][columnIndex];
                  const selected = isCellSelected(rowIndex, columnIndex);
                  const isEditing = editingCell?.row === rowIndex && editingCell?.column === columnIndex;
                  const scratchColumn = Boolean(column.temporary);
                  const dragTarget = dragOverCell?.row === rowIndex && dragOverCell?.column === columnIndex;

                  return (
                    <td
                      key={`${timeSlot.startTime}-${column.id}`}
                      className={`${cellClassName(cell, selected)} ${scratchColumn ? styles.scratchCell : ""} ${columnIndex === staff.length ? styles.scratchDivider : ""} ${dragTarget ? "schedule-cell-drop-target" : ""}`}
                      style={{ backgroundColor: cell.color }}
                      draggable={
                        manualMode &&
                        !placementCell &&
                        !saving &&
                        !["EMPTY", "OPEN", "UNAVAILABLE"].includes(cell.assignmentType)
                      }
                      onMouseDown={(event) => handleCellMouseDown(event, rowIndex, columnIndex)}
                      onMouseEnter={(event) => handleCellMouseEnter(event, rowIndex, columnIndex)}
                      onDoubleClick={() => {
                        if (saving || placementCell) return;
                        if (cell.assignmentType === "UNAVAILABLE" && !manualMode) {
                          onConflict("Turn on Manual Mode to edit a gray unavailable boundary.");
                          return;
                        }
                        setEditingCell({ row: rowIndex, column: columnIndex });
                        window.setTimeout(() => editorRef.current?.focus(), 0);
                      }}
                      onDragStart={(event) => handleDragStart(event, rowIndex, columnIndex)}
                      onDragEnd={() => {
                        setDraggedCell(null);
                        setDraggedCells([]);
                        setDragOverCell(null);
                      }}
                      onDragEnter={() => {
                        if ((manualMode && draggedCell) || placementCell) {
                          setDragOverCell({ row: rowIndex, column: columnIndex });
                        }
                      }}
                      onDragOver={(event) => {
                        if ((manualMode && draggedCell) || placementCell) {
                          event.preventDefault();
                          event.dataTransfer.dropEffect = "move";
                        }
                      }}
                      onDrop={(event) => handleDrop(event, rowIndex, columnIndex)}
                    >
                      {isEditing ? (
                        <input
                          ref={editorRef}
                          className="schedule-cell-editor"
                          defaultValue={cell.text}
                          onBlur={(event) => void saveEditedCell(rowIndex, columnIndex, event.currentTarget.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              void saveEditedCell(rowIndex, columnIndex, event.currentTarget.value);
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

      {napPicker && (
        <div role="dialog" aria-modal="true" aria-label="Link client nap to staff break"
          style={{ position: "fixed", inset: 0, background: "rgba(5,24,42,.55)", display: "grid", placeItems: "center", zIndex: 1000, padding: 20 }}>
          <div style={{ width: "min(100%, 480px)", padding: 24, background: "#fff", borderRadius: 16, boxShadow: "0 16px 54px #081d3260" }}>
            <h3 style={{ marginTop: 0 }}>Break + Client Nap</h3>
            <p>Choose the child who is napping while the selected staff member takes a break. Clients already paired with this staff member are listed first.</p>
            <label style={{ display: "grid", gap: 8, fontWeight: 700 }}>
              Client
              <select value={napClientId} onChange={(event) => setNapClientId(event.target.value)}
                style={{ width: "100%", padding: 12, borderRadius: 9, border: "1px solid #b9cbd9" }}>
                <option value="">Select a client</option>
                {[...clients].sort((a,b) => {
                  const first = napPicker.rows[0];
                  const preferred = nearbyClientsForStaff(first.column, first.row);
                  return Number(preferred.includes(b.id)) - Number(preferred.includes(a.id)) || a.code.localeCompare(b.code);
                }).map((client) => <option key={client.id} value={client.id}>
                  {client.code}{napPicker.rows.some((pos) => nearbyClientsForStaff(pos.column, pos.row).includes(client.id)) ? " · Existing staff pairing" : ""}
                </option>)}
              </select>
            </label>
            <p style={{ fontSize: 13, color: "#516879" }}>This assigns the nap to the client and the break to the selected staff/time blocks. It does not create a new 1:1 pairing.</p>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button type="button" className="button button-secondary" disabled={saving} onClick={() => setNapPicker(null)}>Cancel</button>
              <button type="button" className="button button-primary" disabled={saving || !napClientId} onClick={() => void applyLinkedNap()}>Save Break + Nap</button>
            </div>
          </div>
        </div>
      )}
      {confirmation.dialog}
    </div>
  );
}
