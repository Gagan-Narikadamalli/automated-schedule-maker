"use client";

import { useMemo, useState } from "react";

import { ScheduleGrid } from "./ScheduleGrid";
import { createDemoGrid, DEMO_STAFF } from "./demoData";

const LOCATIONS = [
  { id: "livingston", name: "Livingston" },
  { id: "parsippany", name: "Parsippany" },
];

export function ScheduleWorkspace() {
  const [locationId, setLocationId] = useState("livingston");
  const [selectedDate, setSelectedDate] = useState("2026-10-01");
  const [manualMode, setManualMode] = useState(false);
  const [statusMessage, setStatusMessage] = useState(
    "Auto-safe mode is on. Existing assignments are protected."
  );
  const [unplacedAssignments, setUnplacedAssignments] = useState<string[]>([]);
  const [showCallOutPanel, setShowCallOutPanel] = useState(false);
  const [callOutStaffIds, setCallOutStaffIds] = useState<string[]>([]);

  const initialGrid = useMemo(() => createDemoGrid(), []);

  const locationName =
    LOCATIONS.find((location) => location.id === locationId)?.name ??
    "Livingston";

  function toggleManualMode() {
    setManualMode((currentMode) => {
      const nextMode = !currentMode;

      setStatusMessage(
        nextMode
          ? "Manual Mode is on. You can drag, replace, clear, and force assignments. Replaced assignments will move to the Unplaced Assignments tray."
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

  function saveCallOuts() {
    if (callOutStaffIds.length === 0) {
      setStatusMessage("Select at least one staff member before saving call-outs.");
      return;
    }

    setStatusMessage(
      `${callOutStaffIds.length} call-out${
        callOutStaffIds.length === 1 ? "" : "s"
      } selected for ${selectedDate}. The database-backed version will mark those staff unavailable and offer Repair Schedule.`
    );
    setShowCallOutPanel(false);
  }

  function requestAutoGenerate() {
    setStatusMessage(
      "Auto Generate will preserve locked/manual cells, then fill remaining coverage using availability, client attendance, speech sessions, hard restrictions, hours, team preference, and continuity rules."
    );
  }

  function requestRepair() {
    setStatusMessage(
      "Repair Schedule will change only affected or uncovered blocks while preserving the rest of the approved schedule."
    );
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
              onChange={(event) => setLocationId(event.target.value)}
            >
              {LOCATIONS.map((location) => (
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
            onClick={() => setShowCallOutPanel((open) => !open)}
          >
            Call Outs
          </button>

          <button
            type="button"
            className="button button-secondary"
            onClick={requestRepair}
          >
            Repair Schedule
          </button>

          <button
            type="button"
            className="button button-secondary"
            onClick={() =>
              setStatusMessage(
                "Copy Day will let you choose a source date, copy it to the selected date, and then revalidate staff availability, attendance, speech sessions, call-outs, and hard restrictions."
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
            onClick={toggleManualMode}
          >
            Manual Mode: {manualMode ? "On" : "Off"}
          </button>

          <button
            type="button"
            className="button button-primary"
            onClick={requestAutoGenerate}
          >
            Auto Generate
          </button>
        </div>
      </section>

      {showCallOutPanel && (
        <section className="callout-panel">
          <div className="panel-heading-row">
            <div>
              <h2>Call Outs for {selectedDate}</h2>
              <p>
                Select staff who are unavailable. The completed version will save
                this to MongoDB and use it as a hard scheduling constraint.
              </p>
            </div>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setShowCallOutPanel(false)}
            >
              Close
            </button>
          </div>

          <div className="callout-staff-list">
            {DEMO_STAFF.map((staffMember) => (
              <label key={staffMember.id} className="checkbox-card">
                <input
                  type="checkbox"
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
            onClick={saveCallOuts}
          >
            Save Call Outs
          </button>
        </section>
      )}

      <section className="schedule-status-bar" aria-live="polite">
        <strong>{locationName}</strong>
        <span>{selectedDate}</span>
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

          <ScheduleGrid
            staff={DEMO_STAFF}
            initialGrid={initialGrid}
            manualMode={manualMode}
            onConflict={handleConflict}
            onDisplacedAssignment={handleDisplacedAssignment}
          />
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
