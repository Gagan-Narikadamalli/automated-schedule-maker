"use client";

import { useEffect, useMemo, useState } from "react";

import { DAILY_TIME_SLOTS } from "./constants";
import type { DemoGridCell } from "./demoData";
import { ScheduleGrid } from "./ScheduleGrid";
import type { AssignmentType, StaffColumn } from "./types";

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

type GenerateMetrics = {
  requiredClientSlots?: number;
  coveredClientSlots?: number;
  uncoveredClientSlots?: number;
};

type GenerateResponse = {
  success?: boolean;
  metrics?: GenerateMetrics;
  warnings?: string[];
  uncoveredRequirements?: unknown[];
  affectedStaffIds?: string[];
  error?: string;
};

type SimpleApiResponse = {
  error?: string;
};

function getTodayForDateInput(): string {
  const now = new Date();
  const localTime = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return localTime.toISOString().slice(0, 10);
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
  return {
    text: "",
    assignmentType: "EMPTY",
  };
}

function createUnavailableCell(): DemoGridCell {
  return {
    text: "",
    assignmentType: "UNAVAILABLE",
    color: "#8D8D8D",
  };
}

function clientFromAssignment(
  assignment: ScheduleAssignment
): PopulatedClient | null {
  if (
    assignment.clientId &&
    typeof assignment.clientId === "object"
  ) {
    return assignment.clientId;
  }

  return null;
}

function assignmentToGridCell(
  assignment: ScheduleAssignment
): DemoGridCell {
  const client = clientFromAssignment(assignment);

  switch (assignment.assignmentType) {
    case "CLIENT_1_TO_1":
      return {
        text: client?.displayCode
          ? `${client.displayCode} 1:1`
          : "Client 1:1",
        assignmentType: "CLIENT_1_TO_1",
        color: client?.color || "#D9F4EE",
      };

    case "BREAK":
      return {
        text: "Break",
        assignmentType: "BREAK",
      };

    case "BREAK_NAP":
      return {
        text: "Break/Nap",
        assignmentType: "BREAK_NAP",
      };

    case "NAP":
      return {
        text: "Nap",
        assignmentType: "NAP",
        color: "#F4EFE3",
      };

    case "SPEECH":
      return {
        text: client?.displayCode
          ? `${client.displayCode} Speech`
          : "Speech",
        assignmentType: "SPEECH",
        color: "#DCE9F8",
      };

    case "UNAVAILABLE":
      return createUnavailableCell();

    case "OPEN":
    default:
      return createEmptyCell();
  }
}

function buildGrid(
  staff: ScheduleStaff[],
  assignments: ScheduleAssignment[]
): DemoGridCell[][] {
  const staffIndexById = new Map(
    staff.map((staffMember, index) => [staffMember.id, index])
  );
  const timeIndexByStartTime = new Map(
    DAILY_TIME_SLOTS.map((timeSlot, index) => [timeSlot.startTime, index])
  );

  const grid = DAILY_TIME_SLOTS.map((timeSlot) =>
    staff.map((staffMember) =>
      staffMember.availableSlots.includes(timeSlot.startTime)
        ? createEmptyCell()
        : createUnavailableCell()
    )
  );

  for (const assignment of assignments) {
    const rowIndex = timeIndexByStartTime.get(assignment.startTime);
    const columnIndex = staffIndexById.get(String(assignment.staffId));

    if (rowIndex === undefined || columnIndex === undefined) {
      continue;
    }

    grid[rowIndex][columnIndex] = assignmentToGridCell(assignment);
  }

  return grid;
}

function formatMetrics(metrics: GenerateMetrics | undefined): string {
  if (!metrics) {
    return "Schedule operation completed.";
  }

  const required = metrics.requiredClientSlots ?? 0;
  const covered = metrics.coveredClientSlots ?? 0;
  const uncovered = metrics.uncoveredClientSlots ?? Math.max(required - covered, 0);

  return `${covered}/${required} required client blocks covered; ${uncovered} uncovered.`;
}

export function ScheduleWorkspace() {
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
  const [statusMessage, setStatusMessage] = useState(
    "Loading the clinic schedule from MongoDB..."
  );
  const [unplacedAssignments, setUnplacedAssignments] = useState<string[]>([]);
  const [showCallOutPanel, setShowCallOutPanel] = useState(false);
  const [callOutStaffIds, setCallOutStaffIds] = useState<string[]>([]);

  const locationName = useMemo(
    () =>
      locations.find((location) => location.id === locationId)?.name ??
      "Clinic",
    [locations, locationId]
  );

  useEffect(() => {
    let cancelled = false;

    async function loadLocations() {
      try {
        const response = await fetch("/api/locations", {
          cache: "no-store",
        });
        const data = await readJson<LocationsResponse>(response);

        if (!response.ok) {
          throw new Error(data.error || "Locations could not be loaded.");
        }

        if (cancelled) {
          return;
        }

        const nextLocations = data.locations ?? [];
        setLocations(nextLocations);

        if (nextLocations.length > 0) {
          setLocationId((currentLocationId) =>
            currentLocationId || nextLocations[0].id
          );
        } else {
          setLoading(false);
          setStatusMessage("No clinic locations are available for this account.");
        }
      } catch (error) {
        if (!cancelled) {
          setLoading(false);
          setStatusMessage(
            error instanceof Error
              ? error.message
              : "Clinic locations could not be loaded."
          );
        }
      }
    }

    void loadLocations();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!locationId || !selectedDate) {
      return;
    }

    void loadSchedule(locationId, selectedDate);
  }, [locationId, selectedDate]);

  async function loadSchedule(
    requestedLocationId = locationId,
    requestedDate = selectedDate
  ) {
    if (!requestedLocationId || !requestedDate) {
      return;
    }

    try {
      setLoading(true);

      const response = await fetch(
        `/api/schedule?locationId=${encodeURIComponent(
          requestedLocationId
        )}&date=${encodeURIComponent(requestedDate)}`,
        { cache: "no-store" }
      );
      const data = await readJson<ScheduleResponse>(response);

      if (!response.ok) {
        throw new Error(data.error || "Schedule could not be loaded.");
      }

      const nextStaff = data.staff ?? [];
      const nextAssignments = data.assignments ?? [];

      setStaff(nextStaff);
      setInitialGrid(buildGrid(nextStaff, nextAssignments));
      setRequiredClientSlots(data.requiredClientSlots ?? 0);
      setGridVersion((currentVersion) => currentVersion + 1);
      setStatusMessage(
        `Loaded ${nextAssignments.length} saved assignment${
          nextAssignments.length === 1 ? "" : "s"
        }. ${data.requiredClientSlots ?? 0} client blocks require coverage.`
      );
    } catch (error) {
      setStaff([]);
      setInitialGrid([]);
      setRequiredClientSlots(0);
      setStatusMessage(
        error instanceof Error ? error.message : "Schedule could not be loaded."
      );
    } finally {
      setLoading(false);
    }
  }

  function toggleManualMode() {
    setManualMode((currentMode) => {
      const nextMode = !currentMode;

      setStatusMessage(
        nextMode
          ? "Manual Mode is on. Spreadsheet edits and drag replacement are enabled. Manual database persistence is being connected cell-by-cell; generated and saved schedule data remains protected in MongoDB."
          : "Auto-safe mode is on. Existing assignments are protected from accidental replacement."
      );

      return nextMode;
    });
  }

  function handleConflict(message: string) {
    setStatusMessage(message);
  }

  function handleDisplacedAssignment(assignment: string) {
    setUnplacedAssignments((currentAssignments) => [
      ...currentAssignments,
      assignment,
    ]);

    setStatusMessage(
      `${assignment} was displaced and moved to the Unplaced Assignments tray.`
    );
  }

  function toggleCallOutStaff(staffId: string) {
    setCallOutStaffIds((currentIds) => {
      if (currentIds.includes(staffId)) {
        return currentIds.filter((id) => id !== staffId);
      }

      return [...currentIds, staffId];
    });
  }

  async function saveCallOuts() {
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
          headers: {
            "Content-Type": "application/json",
          },
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

        if (!response.ok) {
          throw new Error(data.error || "A call-out could not be saved.");
        }
      }

      const savedCount = callOutStaffIds.length;
      setCallOutStaffIds([]);
      setShowCallOutPanel(false);
      await loadSchedule();
      setStatusMessage(
        `${savedCount} call-out${savedCount === 1 ? "" : "s"} saved for ${selectedDate}. Unavailable blocks are now shown in the calendar. Use Repair Schedule to refill affected coverage.`
      );
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "Call-outs could not be saved."
      );
    } finally {
      setWorking(false);
    }
  }

  async function requestAutoGenerate() {
    if (!locationId) {
      return;
    }

    try {
      setWorking(true);
      setStatusMessage(
        "Generating the schedule from staff shifts, client attendance, speech/nap blocks, call-outs, relationships, hours, teams, and clinic rules..."
      );

      const response = await fetch("/api/schedule/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          locationId,
          date: selectedDate,
        }),
      });
      const data = await readJson<GenerateResponse>(response);

      if (!response.ok) {
        throw new Error(data.error || "The schedule could not be generated.");
      }

      await loadSchedule();
      setStatusMessage(
        `Auto Generate finished. ${formatMetrics(data.metrics)}${
          data.warnings?.length
            ? ` ${data.warnings.length} scheduler warning(s) need review.`
            : ""
        }`
      );
    } catch (error) {
      setStatusMessage(
        error instanceof Error
          ? error.message
          : "The schedule could not be generated."
      );
    } finally {
      setWorking(false);
    }
  }

  async function requestRepair() {
    if (!locationId) {
      return;
    }

    try {
      setWorking(true);
      setStatusMessage(
        "Repairing only the schedule areas affected by recorded staff call-outs..."
      );

      const response = await fetch("/api/schedule/repair", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          locationId,
          date: selectedDate,
        }),
      });
      const data = await readJson<GenerateResponse>(response);

      if (!response.ok) {
        throw new Error(data.error || "The schedule could not be repaired.");
      }

      await loadSchedule();
      setStatusMessage(
        `Repair finished for ${data.affectedStaffIds?.length ?? 0} affected staff member(s). ${formatMetrics(data.metrics)}`
      );
    } catch (error) {
      setStatusMessage(
        error instanceof Error ? error.message : "The schedule could not be repaired."
      );
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
          <p className="page-subtitle">
            Excel-style 30-minute scheduling from 8:00 AM to 6:00 PM
          </p>
        </div>

        <div className="schedule-context-controls">
          <label className="field-label">
            Location
            <select
              value={locationId}
              disabled={working || loading}
              onChange={(event) => setLocationId(event.target.value)}
            >
              {locations.length === 0 && <option value="">No locations</option>}
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field-label">
            Date
            <input
              type="date"
              value={selectedDate}
              disabled={working}
              onChange={(event) => setSelectedDate(event.target.value)}
            />
          </label>
        </div>
      </header>

      <section className="toolbar-card" aria-label="Schedule actions">
        <div className="toolbar-group">
          <button
            type="button"
            className="button button-secondary"
            disabled={working || loading || staff.length === 0}
            onClick={() => setShowCallOutPanel((open) => !open)}
          >
            Call Outs
          </button>

          <button
            type="button"
            className="button button-secondary"
            disabled={working || loading || staff.length === 0}
            onClick={() => void requestRepair()}
          >
            Repair Schedule
          </button>

          <button
            type="button"
            className="button button-secondary"
            disabled={working || loading}
            onClick={() =>
              setStatusMessage(
                "Copy Day is the next calendar operation being connected. It will copy a selected source date and then revalidate the copied schedule against the target date."
              )
            }
          >
            Copy Day
          </button>
        </div>

        <div className="toolbar-group">
          <button
            type="button"
            className={`button ${
              manualMode ? "button-warning" : "button-secondary"
            }`}
            disabled={working || loading || staff.length === 0}
            onClick={toggleManualMode}
          >
            Manual Mode: {manualMode ? "On" : "Off"}
          </button>

          <button
            type="button"
            className="button button-primary"
            disabled={working || loading || staff.length === 0}
            onClick={() => void requestAutoGenerate()}
          >
            {working ? "Working..." : "Auto Generate"}
          </button>
        </div>
      </section>

      {showCallOutPanel && (
        <section className="callout-panel">
          <div className="panel-heading-row">
            <div>
              <h2>Call Outs for {selectedDate}</h2>
              <p>
                Select staff who are unavailable for the full clinic day. The
                call-out is saved to MongoDB and becomes a hard constraint.
              </p>
            </div>
            <button
              type="button"
              className="button button-secondary"
              disabled={working}
              onClick={() => setShowCallOutPanel(false)}
            >
              Close
            </button>
          </div>

          <div className="callout-staff-list">
            {staff.map((staffMember) => (
              <label key={staffMember.id} className="checkbox-card">
                <input
                  type="checkbox"
                  disabled={working}
                  checked={callOutStaffIds.includes(staffMember.id)}
                  onChange={() => toggleCallOutStaff(staffMember.id)}
                />
                <span>{staffMember.name}</span>
              </label>
            ))}
          </div>

          <button
            type="button"
            className="button button-primary"
            disabled={working || callOutStaffIds.length === 0}
            onClick={() => void saveCallOuts()}
          >
            {working ? "Saving..." : "Save Call Outs"}
          </button>
        </section>
      )}

      <section className="schedule-status-bar" aria-live="polite">
        <strong>{locationName}</strong>
        <span>{selectedDate}</span>
        <span>{requiredClientSlots} required client blocks</span>
        <span>{manualMode ? "Manual override enabled" : "Auto-safe enabled"}</span>
        <span>{statusMessage}</span>
      </section>

      <div className="schedule-layout">
        <section className="schedule-card">
          <div className="spreadsheet-help">
            <span>Arrow keys: move</span>
            <span>Shift + arrows/click: multi-select</span>
            <span>Ctrl/Cmd + C: copy</span>
            <span>Ctrl/Cmd + V: paste</span>
            <span>Enter/F2 or double-click: edit</span>
            <span>Manual Mode: drag and replace</span>
          </div>

          {loading ? (
            <div className="empty-state">Loading schedule...</div>
          ) : staff.length === 0 ? (
            <div className="empty-state">
              No active staff with a recurring shift are available for this date.
              Add staff and shift patterns first.
            </div>
          ) : (
            <ScheduleGrid
              key={`${locationId}-${selectedDate}-${gridVersion}`}
              staff={staff}
              initialGrid={initialGrid}
              manualMode={manualMode}
              onConflict={handleConflict}
              onDisplacedAssignment={handleDisplacedAssignment}
            />
          )}
        </section>

        <aside className="unplaced-tray">
          <h2>Unplaced Assignments</h2>
          <p>
            In Manual Mode, an assignment replaced by drag-and-drop is kept here
            instead of being silently deleted.
          </p>

          {unplacedAssignments.length === 0 ? (
            <div className="empty-state">No unplaced assignments.</div>
          ) : (
            <ul>
              {unplacedAssignments.map((assignment, index) => (
                <li key={`${assignment}-${index}`}>{assignment}</li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}
