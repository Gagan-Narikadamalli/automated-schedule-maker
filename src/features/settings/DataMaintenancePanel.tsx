"use client";

import { useEffect, useState } from "react";

import styles from "./DataMaintenancePanel.module.css";

type LocationOption = {
  id: string;
  name: string;
};

type LocationsResponse = {
  locations?: LocationOption[];
  error?: string;
};

type DateRangeCounts = {
  scheduleAssignments: number;
  callOuts: number;
  speechAndFixedEvents: number;
  unplacedAssignments: number;
  historicalTrainingRows: number;
  totalRecords: number;
};

type PreviewResponse = {
  success?: boolean;
  location?: {
    id: string;
    name: string;
  };
  startDate?: string;
  endDate?: string;
  counts?: DateRangeCounts;
  permanentRecordsPreserved?: string[];
  confirmationTextRequired?: string;
  error?: string;
};

type DeleteResponse = {
  success?: boolean;
  deleted?: DateRangeCounts;
  error?: string;
};

const EMPTY_COUNTS: DateRangeCounts = {
  scheduleAssignments: 0,
  callOuts: 0,
  speechAndFixedEvents: 0,
  unplacedAssignments: 0,
  historicalTrainingRows: 0,
  totalRecords: 0,
};

function getToday(): string {
  const now = new Date();
  const localDate = new Date(
    now.getTime() - now.getTimezoneOffset() * 60_000
  );

  return localDate.toISOString().slice(0, 10);
}

export function DataMaintenancePanel() {
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [locationId, setLocationId] = useState("");
  const [startDate, setStartDate] = useState(getToday);
  const [endDate, setEndDate] = useState(getToday);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [confirmationText, setConfirmationText] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState(
    "Choose a date range to preview removable schedule data."
  );

  useEffect(() => {
    void loadLocations();
  }, []);

  useEffect(() => {
    setPreview(null);
    setConfirmationText("");
  }, [locationId, startDate, endDate]);

  async function loadLocations() {
    try {
      setLoading(true);

      const response = await fetch("/api/locations", {
        cache: "no-store",
      });
      const data = (await response.json()) as LocationsResponse;

      if (!response.ok) {
        throw new Error(data.error || "Locations could not be loaded.");
      }

      const nextLocations = data.locations ?? [];
      setLocations(nextLocations);

      if (nextLocations.length > 0) {
        setLocationId(nextLocations[0].id);
      } else {
        setMessage("No clinic locations are available.");
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Locations could not be loaded."
      );
    } finally {
      setLoading(false);
    }
  }

  async function previewCleanup() {
    if (!locationId || !startDate || !endDate) {
      setMessage("Choose a location and both dates first.");
      return;
    }

    try {
      setWorking(true);
      setMessage("Calculating the records that would be removed...");
      setPreview(null);
      setConfirmationText("");

      const response = await fetch("/api/data-maintenance/date-range", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          locationId,
          startDate,
          endDate,
        }),
      });
      const data = (await response.json()) as PreviewResponse;

      if (!response.ok || !data.counts) {
        throw new Error(
          data.error || "The cleanup preview could not be calculated."
        );
      }

      setPreview(data);
      setMessage(
        `${data.counts.totalRecords} date-scoped record(s) are eligible for deletion. Nothing has been deleted yet.`
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The cleanup preview could not be calculated."
      );
    } finally {
      setWorking(false);
    }
  }

  async function permanentlyDeleteDateRange() {
    if (!preview?.counts) {
      setMessage("Run the preview before deleting anything.");
      return;
    }

    const requiredText = preview.confirmationTextRequired ?? "DELETE";

    if (confirmationText.trim() !== requiredText) {
      setMessage(`Type ${requiredText} exactly before permanent deletion.`);
      return;
    }

    try {
      setWorking(true);
      setMessage("Permanently deleting the selected date-scoped records...");

      const response = await fetch("/api/data-maintenance/date-range", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          locationId,
          startDate,
          endDate,
          confirmationText,
        }),
      });
      const data = (await response.json()) as DeleteResponse;

      if (!response.ok || !data.success) {
        throw new Error(data.error || "The selected data could not be deleted.");
      }

      const deleted = data.deleted ?? EMPTY_COUNTS;

      setPreview(null);
      setConfirmationText("");
      setMessage(
        `${deleted.totalRecords} date-scoped record(s) were permanently deleted. Permanent staff, client, team, template, location, and scheduling-rule records were preserved.`
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The selected data could not be deleted."
      );
    } finally {
      setWorking(false);
    }
  }

  const counts = preview?.counts ?? EMPTY_COUNTS;
  const requiredConfirmation = preview?.confirmationTextRequired ?? "DELETE";
  const canDelete =
    Boolean(preview?.counts) &&
    confirmationText.trim() === requiredConfirmation &&
    !working;

  return (
    <section className={`section-card ${styles.dangerCard}`}>
      <div className="panel-heading-row">
        <div>
          <h2>Database Date-Range Cleanup</h2>
          <p>
            Permanently remove saved operational schedule data for a selected
            clinic and date range. Always preview the exact record counts first.
          </p>
        </div>
      </div>

      <div className={styles.warningBox}>
        This operation is permanent. It removes date-scoped schedule data from
        MongoDB, not just cells visible in the calendar. Permanent clinic setup
        records are intentionally preserved so the scheduler remains reusable.
      </div>

      <div className="form-grid">
        <label className="form-field">
          <span>Clinic location</span>
          <select
            value={locationId}
            disabled={loading || working}
            onChange={(event) => setLocationId(event.target.value)}
          >
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </label>

        <label className="form-field">
          <span>Delete from date</span>
          <input
            type="date"
            value={startDate}
            disabled={working}
            onChange={(event) => setStartDate(event.target.value)}
          />
        </label>

        <label className="form-field">
          <span>Delete through date</span>
          <input
            type="date"
            value={endDate}
            disabled={working}
            onChange={(event) => setEndDate(event.target.value)}
          />
        </label>
      </div>

      <button
        type="button"
        className="button button-secondary"
        disabled={loading || working || !locationId}
        onClick={() => void previewCleanup()}
      >
        {working ? "Working..." : "Preview Records to Delete"}
      </button>

      {preview?.counts ? (
        <>
          <h3 className={styles.previewHeading}>Deletion Preview</h3>

          <div className={styles.countGrid}>
            <div className={styles.countItem}>
              <span>Schedule assignments</span>
              <strong>{counts.scheduleAssignments}</strong>
            </div>
            <div className={styles.countItem}>
              <span>Call outs</span>
              <strong>{counts.callOuts}</strong>
            </div>
            <div className={styles.countItem}>
              <span>Speech / fixed events</span>
              <strong>{counts.speechAndFixedEvents}</strong>
            </div>
            <div className={styles.countItem}>
              <span>Unplaced assignments</span>
              <strong>{counts.unplacedAssignments}</strong>
            </div>
            <div className={styles.countItem}>
              <span>Historical training rows</span>
              <strong>{counts.historicalTrainingRows}</strong>
            </div>
            <div className={styles.countItem}>
              <span>Total records</span>
              <strong>{counts.totalRecords}</strong>
            </div>
          </div>

          <p>
            <strong>Preserved:</strong>
          </p>
          <ul className={styles.preservedList}>
            {(preview.permanentRecordsPreserved ?? []).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>

          <div className={styles.warningBox}>
            To continue, type <strong>{requiredConfirmation}</strong> exactly.
            The application keeps one audit record describing the cleanup.
          </div>

          <div className="form-grid">
            <label className="form-field">
              <span>Confirmation</span>
              <input
                value={confirmationText}
                disabled={working}
                autoComplete="off"
                placeholder={requiredConfirmation}
                onChange={(event) =>
                  setConfirmationText(event.target.value)
                }
              />
            </label>
          </div>

          <button
            type="button"
            className={`button ${styles.deleteButton}`}
            disabled={!canDelete}
            onClick={() => void permanentlyDeleteDateRange()}
          >
            Permanently Delete Date-Range Data
          </button>
        </>
      ) : null}

      <div className="inline-message">{message}</div>
    </section>
  );
}
