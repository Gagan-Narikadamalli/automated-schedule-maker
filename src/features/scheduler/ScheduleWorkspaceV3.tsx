"use client";

import { useEffect, useMemo, useState, type DragEvent } from "react";

import { ManagementModal } from "@/components/ManagementModal";
import { DAILY_TIME_SLOTS } from "./constants";
import {
  createDemoGrid,
  DEMO_STAFF,
  type DemoGridCell,
} from "./demoData";
import {
  ScheduleGridEnhanced,
  type ScheduleGridMutation,
} from "./ScheduleGridEnhanced";
import styles from "./ScheduleWorkspaceV3.module.css";
import type { AssignmentType, StaffColumn } from "./types";
import { useSchedulerConfirm } from "./useSchedulerConfirm";

type LocationOption = {
  id: string;
  name: string;
  code: string;
};

type ScheduleStaff = StaffColumn & {
  role: string;
  teamId: string | null;
  availableSlots: string[];
};

type PopulatedClient = {
  _id?: string;
  id?: string;
  displayCode?: string;
  fullName?: string;
  color?: string;
};

type ScheduleAssignment = {
  id: string;
  staffId: string;
  clientId: string | PopulatedClient | null;
  startTime: string;
  endTime: string;
  assignmentType: AssignmentType;
  source: "AUTO" | "MANUAL" | "TEMPLATE" | "COPIED";
  locked: boolean;
  manuallyOverridden: boolean;
};

type UnplacedRecord = {
  id: string;
  clientId: string | null;
  clientCode: string | null;
  clientColor: string | null;
  displayText: string;
  originalStaffId: string | null;
  originalStartTime: string;
  reason: string;
  origin?: "MANUAL_DISPLACEMENT" | "AUTO_UNCOVERED";
};

type ScheduleResponse = {
  locationId?: string;
  date?: string;
  staff?: ScheduleStaff[];
  assignments?: ScheduleAssignment[];
  requiredClientSlots?: number;
  error?: string;
};

type LocationsResponse = {
  locations?: LocationOption[];
  error?: string;
};

type UnplacedResponse = {
  unplacedAssignments?: UnplacedRecord[];
  unplacedAssignment?: UnplacedRecord;
  success?: boolean;
  error?: string;
};

type GenerateMetrics = {
  requiredClientSlots?: number;
  coveredClientSlots?: number;
  uncoveredClientSlots?: number;
};

type GenerateResponse = {
  success?: boolean;
  metrics?: GenerateMetrics;
  warnings?: unknown[];
  uncoveredRequirements?: unknown[];
  affectedStaffIds?: string[];
  error?: string;
};

type GenerateRangeResponse = {
  success?: boolean;
  results?: Array<{
    date: string;
    skipped: boolean;
    metrics?: GenerateMetrics;
    warningCount?: number;
  }>;
  error?: string;
};

type BatchResponse = {
  success?: boolean;
  updatedCount?: number;
  forced?: boolean;
  requiresConfirmation?: boolean;
  conflicts?: Array<{
    code: string;
    message: string;
  }>;
  error?: string;
};

type CopyDayResponse = {
  success?: boolean;
  copiedCount?: number;
  warnings?: string[];
  error?: string;
};

type SimpleApiResponse = {
  error?: string;
};

const DEMO_LOCATIONS: LocationOption[] = [
  { id: "demo-livingston", name: "Livingston Demo", code: "LIVINGSTON_DEMO" },
  { id: "demo-parsippany", name: "Parsippany Demo", code: "PARSIPPANY_DEMO" },
];

const ALL_DEMO_SLOTS = DAILY_TIME_SLOTS.map((slot) => slot.startTime);

function createDemoStaff(): ScheduleStaff[] {
  return DEMO_STAFF.map((staffMember) => ({
    ...staffMember,
    role: "BT",
    teamId: null,
    availableSlots: [...ALL_DEMO_SLOTS],
  }));
}

function getTodayForDateInput(): string {
  const now = new Date();
  const localTime = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return localTime.toISOString().slice(0, 10);
}

function addDays(dateText: string, numberOfDays: number): string {
  const date = new Date(`${dateText}T12:00:00`);
  date.setDate(date.getDate() + numberOfDays);
  return date.toISOString().slice(0, 10);
}

function getMonday(dateText: string): string {
  const date = new Date(`${dateText}T12:00:00`);
  const day = date.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

async function readJson<T>(response: Response): Promise<T> {
  const data = (await response.json()) as T;
  if (response.status === 401) {
    window.location.href = "/login";
    throw new Error("Your session expired. Please sign in again.");
  }
  return data;
}

function createEmptyCell(): DemoGridCell {
  return { text: "", assignmentType: "EMPTY" };
}

function createUnavailableCell(): DemoGridCell {
  return {
    text: "",
    assignmentType: "UNAVAILABLE",
    color: "#8D8D8D",
    locked: true,
  };
}

function clientFromAssignment(assignment: ScheduleAssignment): PopulatedClient | null {
  return assignment.clientId && typeof assignment.clientId === "object"
    ? assignment.clientId
    : null;
}

function clientIdFromAssignment(assignment: ScheduleAssignment): string | null {
  if (!assignment.clientId) return null;
  if (typeof assignment.clientId === "string") return assignment.clientId;
  return String(assignment.clientId._id ?? assignment.clientId.id ?? "") || null;
}

function assignmentToGridCell(assignment: ScheduleAssignment): DemoGridCell {
  const client = clientFromAssignment(assignment);
  const clientId = clientIdFromAssignment(assignment);
  const clientCode = client?.displayCode ?? null;
  const common = {
    clientId,
    clientCode,
    source: assignment.source,
    locked: assignment.locked || assignment.manuallyOverridden,
  };

  switch (assignment.assignmentType) {
    case "CLIENT_1_TO_1":
      return {
        ...common,
        text: clientCode ? `${clientCode} 1:1` : "Client 1:1",
        assignmentType: "CLIENT_1_TO_1",
        color: client?.color || "#D9F4EE",
      };
    case "BREAK":
      return { ...common, clientId: null, clientCode: null, text: "Break", assignmentType: "BREAK", color: "#FFFFFF" };
    case "BREAK_NAP":
      return { ...common, text: "Break/Nap", assignmentType: "BREAK_NAP", color: "#FFF3D6" };
    case "BREAK_SPEECH":
      return { ...common, text: "Break/Speech", assignmentType: "BREAK_SPEECH", color: "#E4F1FA" };
    case "NAP":
      return { ...common, text: clientCode ? `${clientCode} Nap` : "Nap", assignmentType: "NAP", color: "#F4EFE3" };
    case "SPEECH":
      return { ...common, text: clientCode ? `${clientCode} Speech` : "Speech", assignmentType: "SPEECH", color: "#DCE9F8" };
    case "UNAVAILABLE":
      return createUnavailableCell();
    case "OPEN":
      return {
        ...common,
        clientId: null,
        clientCode: null,
        text: "",
        assignmentType: "OPEN",
      };
    default:
      return createEmptyCell();
  }
}

function buildGrid(staff: ScheduleStaff[], assignments: ScheduleAssignment[]): DemoGridCell[][] {
  const staffIndexById = new Map(staff.map((staffMember, index) => [staffMember.id, index]));
  const timeIndexByStartTime = new Map(DAILY_TIME_SLOTS.map((slot, index) => [slot.startTime, index]));

  const grid = DAILY_TIME_SLOTS.map((timeSlot) =>
    staff.map((staffMember) =>
      staffMember.availableSlots.includes(timeSlot.startTime)
        ? createEmptyCell()
        : createUnavailableCell()
    )
  );

  assignments.forEach((assignment) => {
    const row = timeIndexByStartTime.get(assignment.startTime);
    const column = staffIndexById.get(String(assignment.staffId));
    if (row === undefined || column === undefined) return;
    grid[row][column] = assignmentToGridCell(assignment);
  });

  return grid;
}

function countDemoClientBlocks(grid: DemoGridCell[][]): number {
  return grid.reduce(
    (total, row) => total + row.filter((cell) => cell.assignmentType === "CLIENT_1_TO_1").length,
    0
  );
}

function formatMetrics(metrics: GenerateMetrics | undefined): string {
  if (!metrics) return "Schedule operation completed.";
  const required = metrics.requiredClientSlots ?? 0;
  const covered = metrics.coveredClientSlots ?? 0;
  const uncovered = metrics.uncoveredClientSlots ?? Math.max(required - covered, 0);
  return `${covered}/${required} required client blocks covered; ${uncovered} uncovered.`;
}

function clientWasMovedInsideBatch(clientId: string, mutations: ScheduleGridMutation[]): boolean {
  return mutations.some(
    (mutation) =>
      mutation.nextCell.assignmentType === "CLIENT_1_TO_1" &&
      mutation.nextCell.clientId === clientId
  );
}

function unplacedLabel(record: UnplacedRecord): string {
  return record.clientCode || record.displayText.replace(/\s+1:1$/i, "").split(/\s+/)[0] || "Client";
}

export function ScheduleWorkspaceV3() {
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [locationId, setLocationId] = useState("");
  const [selectedDate, setSelectedDate] = useState(getTodayForDateInput);
  const [staff, setStaff] = useState<ScheduleStaff[]>([]);
  const [initialGrid, setInitialGrid] = useState<DemoGridCell[][]>([]);
  const [requiredClientSlots, setRequiredClientSlots] = useState(0);
  const [gridVersion, setGridVersion] = useState(0);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [statusMessage, setStatusMessage] = useState("Loading the clinic schedule...");
  const [unplacedAssignments, setUnplacedAssignments] = useState<UnplacedRecord[]>([]);
  const [placementRecord, setPlacementRecord] = useState<UnplacedRecord | null>(null);
  const [detailsRecord, setDetailsRecord] = useState<UnplacedRecord | null>(null);
  const [showCallOutPanel, setShowCallOutPanel] = useState(false);
  const [callOutStaffIds, setCallOutStaffIds] = useState<string[]>([]);
  const [showCopyPanel, setShowCopyPanel] = useState(false);
  const [copySourceDate, setCopySourceDate] = useState(() => addDays(getTodayForDateInput(), -1));
  const confirmation = useSchedulerConfirm();

  const demoMode = locationId.startsWith("demo-");
  const locationName = useMemo(
    () => locations.find((location) => location.id === locationId)?.name ?? "Clinic",
    [locations, locationId]
  );

  const placementCell = useMemo<DemoGridCell | null>(() => {
    if (!placementRecord) return null;
    const clientCode = unplacedLabel(placementRecord);
    return {
      text: placementRecord.displayText || `${clientCode} 1:1`,
      assignmentType: "CLIENT_1_TO_1",
      color: placementRecord.clientColor || "#D9F4EE",
      clientId: placementRecord.clientId,
      clientCode,
      source: "MANUAL",
      locked: true,
    };
  }, [placementRecord]);

  useEffect(() => {
    let cancelled = false;
    async function loadLocations() {
      try {
        const response = await fetch("/api/locations", { cache: "no-store" });
        const data = await readJson<LocationsResponse>(response);
        if (!response.ok) throw new Error(data.error || "Locations could not be loaded.");
        if (cancelled) return;
        const nextLocations = data.locations ?? [];
        if (nextLocations.length === 0) throw new Error("No clinic locations are currently stored.");
        setLocations(nextLocations);
        setLocationId(nextLocations[0].id);
      } catch {
        if (cancelled) return;
        setLocations(DEMO_LOCATIONS);
        setLocationId(DEMO_LOCATIONS[0].id);
        setStatusMessage("Preview mode is active because the live clinic database could not be loaded.");
      }
    }
    void loadLocations();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    setPlacementRecord(null);
    setDetailsRecord(null);
    if (!locationId || !selectedDate) return;
    void loadSchedule(locationId, selectedDate);
  }, [locationId, selectedDate]);

  function loadDemoSchedule() {
    const nextGrid = createDemoGrid();
    setStaff(createDemoStaff());
    setInitialGrid(nextGrid);
    setRequiredClientSlots(countDemoClientBlocks(nextGrid));
    setUnplacedAssignments([]);
    setGridVersion((current) => current + 1);
    setLoading(false);
  }

  async function loadUnplacedAssignments(requestedLocationId = locationId, requestedDate = selectedDate) {
    if (!requestedLocationId || requestedLocationId.startsWith("demo-")) return;
    try {
      const response = await fetch(
        `/api/unplaced?locationId=${encodeURIComponent(requestedLocationId)}&date=${encodeURIComponent(requestedDate)}`,
        { cache: "no-store" }
      );
      const data = await readJson<UnplacedResponse>(response);
      if (!response.ok) throw new Error(data.error || "Unplaced assignments could not be loaded.");
      setUnplacedAssignments(data.unplacedAssignments ?? []);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Unplaced assignments could not be loaded.");
    }
  }

  async function loadSchedule(requestedLocationId = locationId, requestedDate = selectedDate) {
    if (!requestedLocationId || !requestedDate) return;
    if (requestedLocationId.startsWith("demo-")) {
      loadDemoSchedule();
      return;
    }

    try {
      setLoading(true);
      const response = await fetch(
        `/api/schedule?locationId=${encodeURIComponent(requestedLocationId)}&date=${encodeURIComponent(requestedDate)}`,
        { cache: "no-store" }
      );
      const data = await readJson<ScheduleResponse>(response);
      if (!response.ok) throw new Error(data.error || "Schedule could not be loaded.");
      const nextStaff = data.staff ?? [];
      const nextAssignments = data.assignments ?? [];
      setStaff(nextStaff);
      setInitialGrid(buildGrid(nextStaff, nextAssignments));
      setRequiredClientSlots(data.requiredClientSlots ?? 0);
      setGridVersion((current) => current + 1);
      await loadUnplacedAssignments(requestedLocationId, requestedDate);
      setStatusMessage(
        `Loaded ${nextAssignments.length} saved assignment${nextAssignments.length === 1 ? "" : "s"}. ${data.requiredClientSlots ?? 0} client blocks require coverage.`
      );
    } catch (error) {
      setLocations(DEMO_LOCATIONS);
      setLocationId(DEMO_LOCATIONS[0].id);
      loadDemoSchedule();
      setStatusMessage(error instanceof Error ? `${error.message} Preview mode has been enabled.` : "The live schedule could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  function toggleManualMode() {
    setManualMode((current) => {
      const next = !current;
      setStatusMessage(
        next
          ? "Manual Mode is on. Occupied cells and gray availability boundaries can be changed after an in-app override confirmation."
          : "Auto-safe mode is on. Existing assignments and gray unavailable boundaries are protected."
      );
      if (!next) setPlacementRecord(null);
      return next;
    });
  }

  function handleConflict(message: string) {
    setStatusMessage(message);
  }

  function handleDisplacedAssignment(assignment: string) {
    if (!demoMode || !/\s1:1$/i.test(assignment.trim())) return;
    setUnplacedAssignments((current) => [
      ...current,
      {
        id: `demo-unplaced-${Date.now()}-${current.length}`,
        clientId: null,
        clientCode: assignment.replace(/\s+1:1$/i, "").split(/\s+/)[0],
        clientColor: null,
        displayText: assignment,
        originalStaffId: null,
        originalStartTime: "",
        reason: "Displaced during preview mode.",
        origin: "MANUAL_DISPLACEMENT",
      },
    ]);
  }

  async function saveDisplacedAssignments(mutations: ScheduleGridMutation[]) {
    if (demoMode) return;
    const displacedMutations = mutations.filter((mutation) => {
      const previousClientId = mutation.previousCell.clientId;
      if (mutation.previousCell.assignmentType !== "CLIENT_1_TO_1" || !previousClientId) return false;
      const sameClientRemains =
        mutation.nextCell.assignmentType === "CLIENT_1_TO_1" &&
        mutation.nextCell.clientId === previousClientId;
      if (sameClientRemains) return false;
      return !clientWasMovedInsideBatch(previousClientId, mutations);
    });

    for (const mutation of displacedMutations) {
      const response = await fetch("/api/unplaced", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locationId,
          date: selectedDate,
          clientId: mutation.previousCell.clientId ?? null,
          displayText: mutation.previousCell.text,
          originalStaffId: mutation.staffId,
          originalStartTime: mutation.startTime,
          reason: "Displaced by a confirmed manager schedule change.",
        }),
      });
      const data = await readJson<UnplacedResponse>(response);
      if (!response.ok) throw new Error(data.error || "A displaced assignment could not be saved to the tray.");
    }
  }

  async function sendBatchRequest(mutations: ScheduleGridMutation[], force: boolean) {
    const response = await fetch("/api/schedule/batch", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        locationId,
        date: selectedDate,
        force,
        changes: mutations.map((mutation) => ({
          staffId: mutation.staffId,
          startTime: mutation.startTime,
          assignmentType: mutation.nextCell.assignmentType,
          text: mutation.nextCell.text,
          clientId: mutation.nextCell.clientId ?? null,
        })),
      }),
    });
    const data = await readJson<BatchResponse>(response);
    return { response, data };
  }

  async function persistGridMutations(mutations: ScheduleGridMutation[], allowForce: boolean): Promise<boolean> {
    if (demoMode) {
      setStatusMessage(`${mutations.length} preview cell change(s) applied locally. Preview changes are not saved.`);
      return true;
    }

    try {
      let { response, data } = await sendBatchRequest(mutations, false);
      if (response.status === 409 && data.requiresConfirmation && data.conflicts?.length && allowForce) {
        const onlyUnavailableConflicts = data.conflicts.every((conflict) => conflict.code === "STAFF_UNAVAILABLE");
        const boundaryAlreadyConfirmed = mutations.some((mutation) => mutation.managerConfirmedBoundaryOverride);

        if (onlyUnavailableConflicts && boundaryAlreadyConfirmed) {
          ({ response, data } = await sendBatchRequest(mutations, true));
        } else {
          const details = data.conflicts.map((conflict, index) => `${index + 1}. ${conflict.message}`).join("\n");
          const confirmed = await confirmation.ask({
            eyebrow: "SCHEDULING RULE CONFLICT",
            title: "Override scheduling rule conflict?",
            message: `${details}\nChoose Override only if you intentionally want to save this manager exception.`,
            confirmLabel: "Override",
            cancelLabel: "Cancel",
          });
          if (!confirmed) {
            setStatusMessage("Manual override canceled. The schedule was not changed.");
            return false;
          }
          ({ response, data } = await sendBatchRequest(mutations, true));
        }
      }

      if (!response.ok) {
        setStatusMessage(data.conflicts?.[0]?.message || data.error || "The schedule change could not be saved.");
        return false;
      }

      await saveDisplacedAssignments(mutations);
      await loadUnplacedAssignments();
      const conflictSuffix = data.conflicts?.length
        ? ` ${data.conflicts.length} conflict(s) were saved as explicit manager overrides.`
        : "";
      setStatusMessage(`${data.updatedCount ?? mutations.length} schedule cell change(s) saved to MongoDB.${conflictSuffix}`);
      return true;
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "The schedule change could not be saved.");
      return false;
    }
  }

  async function resolveUnplaced(unplacedId: string) {
    if (demoMode) {
      setUnplacedAssignments((current) => current.filter((assignment) => assignment.id !== unplacedId));
      setPlacementRecord(null);
      setDetailsRecord(null);
      return;
    }

    const response = await fetch("/api/unplaced", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ locationId, unplacedId }),
    });
    const data = await readJson<UnplacedResponse>(response);
    if (!response.ok) throw new Error(data.error || "The unplaced assignment could not be resolved.");
    setPlacementRecord(null);
    setDetailsRecord(null);
    await loadUnplacedAssignments();
  }

  function beginPlacement(record: UnplacedRecord) {
    setManualMode(true);
    setPlacementRecord(record);
    setStatusMessage(`${record.displayText} is ready to place. Drag it onto the calendar or click a destination cell.`);
  }

  function beginUnplacedDrag(event: DragEvent<HTMLButtonElement>, record: UnplacedRecord) {
    beginPlacement(record);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", record.displayText);
    event.dataTransfer.setData("application/x-sos-unplaced-id", record.id);
  }

  async function completePlacement() {
    if (!placementRecord) return;
    try {
      const placedText = placementRecord.displayText;
      await resolveUnplaced(placementRecord.id);
      setStatusMessage(`${placedText} was placed and removed from the Unplaced tray.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "The unplaced assignment could not be marked resolved.");
    }
  }

  function toggleCallOutStaff(staffId: string) {
    setCallOutStaffIds((current) => current.includes(staffId) ? current.filter((id) => id !== staffId) : [...current, staffId]);
  }

  async function saveCallOuts() {
    if (demoMode) {
      setShowCallOutPanel(false);
      setCallOutStaffIds([]);
      setStatusMessage("Call-outs are not persisted in preview mode.");
      return;
    }
    if (!locationId || callOutStaffIds.length === 0) {
      setStatusMessage("Select at least one staff member before saving call-outs.");
      return;
    }

    try {
      setWorking(true);
      setStatusMessage("Saving call-outs to MongoDB...");
      for (const staffId of callOutStaffIds) {
        const response = await fetch("/api/call-outs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            locationId,
            staffId,
            date: selectedDate,
            startTime: "08:00",
            endTime: "18:00",
            reason: "Call out",
          }),
        });
        const data = await readJson<SimpleApiResponse>(response);
        if (!response.ok) throw new Error(data.error || "A call-out could not be saved.");
      }
      const savedCount = callOutStaffIds.length;
      setCallOutStaffIds([]);
      setShowCallOutPanel(false);
      await loadSchedule();
      setStatusMessage(`${savedCount} call-out${savedCount === 1 ? "" : "s"} saved. Use Repair Schedule to refill coverage and clear automatic break blocks inside the call-out window.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Call-outs could not be saved.");
    } finally {
      setWorking(false);
    }
  }

  async function requestAutoGenerate() {
    if (demoMode) {
      loadDemoSchedule();
      setStatusMessage("A sample day was regenerated locally in preview mode.");
      return;
    }
    try {
      setWorking(true);
      setStatusMessage("Generating the day from shifts, attendance, call-outs, fixed events, relationships, breaks, teams, and clinic rules...");
      const response = await fetch("/api/schedule/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locationId, date: selectedDate }),
      });
      const data = await readJson<GenerateResponse>(response);
      if (!response.ok) throw new Error(data.error || "The schedule could not be generated.");
      await loadSchedule();
      setStatusMessage(`Auto Generate finished. ${formatMetrics(data.metrics)}${data.warnings?.length ? ` ${data.warnings.length} scheduler warning(s) need review.` : ""}`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "The schedule could not be generated.");
    } finally {
      setWorking(false);
    }
  }

  async function requestGenerateWeek() {
    if (demoMode) {
      setStatusMessage("Week generation is disabled in preview mode.");
      return;
    }
    const startDate = getMonday(selectedDate);
    const endDate = addDays(startDate, 4);
    try {
      setWorking(true);
      setStatusMessage(`Generating work week ${startDate} through ${endDate}...`);
      const response = await fetch("/api/schedule/generate-range", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locationId, startDate, endDate }),
      });
      const data = await readJson<GenerateRangeResponse>(response);
      if (!response.ok) throw new Error(data.error || "The work week could not be generated.");
      const generatedDays = data.results?.filter((result) => !result.skipped).length ?? 0;
      await loadSchedule();
      setStatusMessage(`${generatedDays} work-day schedule(s) generated for ${startDate} through ${endDate}. Manual locked assignments were preserved.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "The work week could not be generated.");
    } finally {
      setWorking(false);
    }
  }

  async function requestRepair() {
    if (demoMode) {
      setStatusMessage("Repair Schedule is available only with live clinic data.");
      return;
    }
    try {
      setWorking(true);
      setStatusMessage("Repairing only schedule areas affected by recorded staff call-outs, including removing automatic break blocks inside those call-out windows...");
      const response = await fetch("/api/schedule/repair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locationId, date: selectedDate }),
      });
      const data = await readJson<GenerateResponse>(response);
      if (!response.ok) throw new Error(data.error || "The schedule could not be repaired.");
      await loadSchedule();
      setStatusMessage(`Repair finished for ${data.affectedStaffIds?.length ?? 0} affected staff member(s). ${formatMetrics(data.metrics)}`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "The schedule could not be repaired.");
    } finally {
      setWorking(false);
    }
  }

  async function copyDay() {
    if (demoMode) {
      setStatusMessage("Copy Day is disabled in preview mode.");
      return;
    }
    if (!copySourceDate) {
      setStatusMessage("Choose a source date to copy.");
      return;
    }
    try {
      setWorking(true);
      setStatusMessage(`Copying ${copySourceDate} into ${selectedDate} and revalidating constraints...`);
      const response = await fetch("/api/schedule/copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locationId, sourceDate: copySourceDate, targetDate: selectedDate }),
      });
      const data = await readJson<CopyDayResponse>(response);
      if (!response.ok) throw new Error(data.error || "The schedule day could not be copied.");
      setShowCopyPanel(false);
      await loadSchedule();
      setStatusMessage(`${data.copiedCount ?? 0} block(s) copied from ${copySourceDate}.${data.warnings?.length ? ` ${data.warnings.length} block(s) were skipped during target-date revalidation.` : ""}`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "The schedule day could not be copied.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="schedule-page">
      <header className="page-header">
        <div>
          <p className="page-eyebrow">SOS CLINIC SCHEDULING</p>
          <h1>Daily Schedule</h1>
          <p className="page-subtitle">Excel-style 30-minute scheduling from 8:00 AM to 6:00 PM</p>
        </div>
        <div className="schedule-context-controls">
          <label className="field-label">
            Location
            <select value={locationId} disabled={working || loading} onChange={(event) => setLocationId(event.target.value)}>
              {locations.length === 0 && <option value="">No locations</option>}
              {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
            </select>
          </label>
          <label className="field-label">
            Date
            <input type="date" value={selectedDate} disabled={working} onChange={(event) => setSelectedDate(event.target.value)} />
          </label>
        </div>
      </header>

      <section className="toolbar-card" aria-label="Schedule actions">
        <div className="toolbar-group">
          <button type="button" className="button button-secondary" disabled={working || loading || staff.length === 0} onClick={() => setShowCallOutPanel((open) => !open)}>Call Outs</button>
          <button type="button" className="button button-secondary" disabled={working || loading || staff.length === 0} onClick={() => void requestRepair()}>Repair Schedule</button>
          <button type="button" className="button button-secondary" disabled={working || loading} onClick={() => setShowCopyPanel((open) => !open)}>Copy Day</button>
        </div>
        <div className="toolbar-group">
          <button type="button" className={`button ${manualMode ? "button-warning" : "button-secondary"}`} disabled={working || loading || staff.length === 0} onClick={toggleManualMode}>Manual Mode: {manualMode ? "On" : "Off"}</button>
          <button type="button" className="button button-secondary" disabled={working || loading || staff.length === 0} onClick={() => void requestGenerateWeek()}>Auto Generate Week</button>
          <button type="button" className="button button-primary" disabled={working || loading || staff.length === 0} onClick={() => void requestAutoGenerate()}>{working ? "Working..." : "Auto Generate Day"}</button>
        </div>
      </section>

      {showCopyPanel && (
        <section className="callout-panel">
          <div className="panel-heading-row">
            <div><h2>Copy Schedule into {selectedDate}</h2><p>The copied day is revalidated against the target date.</p></div>
            <button type="button" className="button button-secondary" onClick={() => setShowCopyPanel(false)}>Close</button>
          </div>
          <div className="form-grid form-grid-compact">
            <label className="form-field"><span>Copy from date</span><input type="date" value={copySourceDate} onChange={(event) => setCopySourceDate(event.target.value)} /></label>
          </div>
          <button type="button" className="button button-primary" disabled={working || !copySourceDate} onClick={() => void copyDay()}>Copy and Revalidate</button>
        </section>
      )}

      {showCallOutPanel && (
        <section className="callout-panel">
          <div className="panel-heading-row">
            <div><h2>Call Outs for {selectedDate}</h2><p>Saved call-outs become hard automatic-scheduling boundaries.</p></div>
            <button type="button" className="button button-secondary" disabled={working} onClick={() => setShowCallOutPanel(false)}>Close</button>
          </div>
          <div className="callout-staff-list">
            {staff.map((staffMember) => (
              <label key={staffMember.id} className="checkbox-card">
                <input type="checkbox" disabled={working} checked={callOutStaffIds.includes(staffMember.id)} onChange={() => toggleCallOutStaff(staffMember.id)} />
                <span>{staffMember.name}</span>
              </label>
            ))}
          </div>
          <button type="button" className="button button-primary" disabled={working || callOutStaffIds.length === 0} onClick={() => void saveCallOuts()}>{working ? "Saving..." : "Save Call Outs"}</button>
        </section>
      )}

      <section className="schedule-status-bar" aria-live="polite">
        <strong>{locationName}</strong>
        <span>{selectedDate}</span>
        <span>{requiredClientSlots} client blocks required</span>
        <span>{manualMode ? "Manual override enabled" : "Auto-safe enabled"}</span>
        <span>{statusMessage}</span>
      </section>

      <div className="schedule-layout">
        <section className="schedule-card">
          {loading ? (
            <div className="empty-state">Loading schedule...</div>
          ) : staff.length === 0 ? (
            <div className="empty-state">No active staff are available for this date.</div>
          ) : (
            <ScheduleGridEnhanced
              key={`${locationId}-${selectedDate}-${gridVersion}`}
              staff={staff}
              initialGrid={initialGrid}
              manualMode={manualMode}
              placementCell={placementCell}
              onPlacementComplete={completePlacement}
              onConflict={handleConflict}
              onDisplacedAssignment={handleDisplacedAssignment}
              onMutations={persistGridMutations}
            />
          )}
        </section>

        <aside className={`unplaced-tray ${styles.tray}`}>
          <div className={styles.trayHeader}>
            <div>
              <h2>Unplaced Assignments</h2>
              <p>Drag a client block into the calendar, or click it for details.</p>
            </div>
            <span className={styles.countBadge}>{unplacedAssignments.length}</span>
          </div>

          {placementRecord && (
            <div className="notice warning-notice">
              <strong>Placement mode: {unplacedLabel(placementRecord)}</strong>
              <p>Drop the block onto a calendar cell or click a destination.</p>
              <button type="button" className="button button-secondary button-small" onClick={() => setPlacementRecord(null)}>Cancel Placement</button>
            </div>
          )}

          {unplacedAssignments.length === 0 ? (
            <div className="empty-state">No unplaced assignments.</div>
          ) : (
            <div className={styles.blockList}>
              {unplacedAssignments.map((assignment) => (
                <div key={assignment.id} className={styles.blockRow}>
                  <button
                    type="button"
                    draggable={!working}
                    className={styles.unplacedBlock}
                    style={{ backgroundColor: assignment.clientColor || "#D9F4EE" }}
                    onClick={() => setDetailsRecord(assignment)}
                    onDragStart={(event) => beginUnplacedDrag(event, assignment)}
                    title="Drag this block onto the schedule, or click for details"
                  >
                    <strong>{unplacedLabel(assignment)}</strong>
                    <span>Needs scheduling</span>
                    {assignment.originalStartTime && <small>{assignment.originalStartTime}</small>}
                  </button>
                  <button type="button" className={`button button-primary button-small ${styles.placeButton}`} disabled={working} onClick={() => beginPlacement(assignment)}>Place</button>
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>

      <ManagementModal
        open={Boolean(detailsRecord)}
        eyebrow="UNPLACED ASSIGNMENT"
        title={detailsRecord ? `${unplacedLabel(detailsRecord)} needs scheduling` : "Assignment details"}
        description="This block is not currently covered on the calendar."
        size="medium"
        onClose={() => setDetailsRecord(null)}
        footer={
          detailsRecord ? (
            <>
              <button type="button" className="button button-secondary" onClick={() => void resolveUnplaced(detailsRecord.id)}>Mark Covered</button>
              <button type="button" className="button button-primary" onClick={() => { beginPlacement(detailsRecord); setDetailsRecord(null); }}>Place on Calendar</button>
            </>
          ) : null
        }
      >
        {detailsRecord && (
          <div className={styles.detailsGrid}>
            <div><span>Client</span><strong>{detailsRecord.displayText}</strong></div>
            <div><span>Status</span><strong>Needs scheduling</strong></div>
            <div><span>Required time</span><strong>{detailsRecord.originalStartTime || "Flexible"}</strong></div>
            <div><span>Reason</span><strong>{detailsRecord.reason || "Coverage is currently missing."}</strong></div>
            <div><span>Source</span><strong>{detailsRecord.origin === "AUTO_UNCOVERED" ? "Automatic scheduler gap" : "Manager edit displacement"}</strong></div>
          </div>
        )}
      </ManagementModal>

      {confirmation.dialog}
    </div>
  );
}
