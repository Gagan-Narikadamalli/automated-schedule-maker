"use client";

import { useEffect, useState } from "react";

import styles from "./SchedulePreviewPanel.module.css";

type LocationOption = {
  id: string;
  name: string;
};

type SlotCapacity = {
  startTime: string;
  clientDemand: number;
  staffAvailable: number;
  difference: number;
};

type Readiness = {
  staffCount: number;
  clientCount: number;
  staffAvailableHours: number;
  requiredClientHours: number;
  breakEligibleStaffCount: number;
  plannedBreakHours: number;
  netStaffCoverageHours: number;
  additionalLaborHoursNeeded: number;
  surplusCoverageHours: number;
  peakConcurrentClients: number;
  peakAvailableStaff: number;
  shortageSlots: SlotCapacity[];
  warnings: string[];
};

type PreviewMetrics = {
  requiredClientSlots: number;
  coveredClientSlots: number;
  uncoveredClientSlots: number;
  coveragePercent: number;
  requiredClientHours: number;
  coveredClientHours: number;
  uncoveredClientHours: number;
  staffAvailableHours: number;
  breakHoursReserved: number;
  netStaffCoverageHours: number;
  additionalLaborHoursNeeded: number;
};

type UncoveredRequirement = {
  clientId: string;
  clientCode: string;
  startTime: string;
  reason: string;
};

type PreviewResponse = {
  success?: boolean;
  previewOnly?: boolean;
  completeCoverage?: boolean;
  partialBuild?: boolean;
  readiness?: Readiness;
  metrics?: PreviewMetrics;
  uncoveredRequirements?: UncoveredRequirement[];
  reservedBreakCount?: number;
  coverageByRole?: Record<string, number>;
  autoTemplateName?: string | null;
  previousReferenceDate?: string | null;
  workbookTrainingApplied?: boolean;
  workbookTrainingReferences?: number;
  workbookTrainingSourceWeek?: {
    start: string | null;
    end: string | null;
  } | null;
  importedTrainingScheduleDays?: number;
  importedTrainingRecords?: number;
  error?: string;
};

type LocationsResponse = {
  locations?: LocationOption[];
  error?: string;
};

function getToday(): string {
  const now = new Date();
  const localDate = new Date(
    now.getTime() - now.getTimezoneOffset() * 60_000
  );

  return localDate.toISOString().slice(0, 10);
}

function formatHours(value: number | undefined): string {
  return `${(value ?? 0).toFixed(1)} hrs`;
}

function formatPercent(value: number | undefined): string {
  return `${(value ?? 0).toFixed(1)}%`;
}

export function SchedulePreviewPanel() {
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [locationId, setLocationId] = useState("");
  const [selectedDate, setSelectedDate] = useState(getToday);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState(
    "Choose a clinic date to calculate a non-destructive automatic schedule preview."
  );

  useEffect(() => {
    void loadLocations();
  }, []);

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

  async function calculatePreview() {
    if (!locationId || !selectedDate) {
      setMessage("Choose a clinic location and date first.");
      return;
    }

    try {
      setWorking(true);
      setPreview(null);
      setMessage(
        "Checking attendance, shifts, staff roles, call-outs, breaks, templates, fixed events, manual locks, weekly limits, and historical patterns..."
      );

      const response = await fetch("/api/schedule/preview", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          locationId,
          date: selectedDate,
        }),
      });
      const data = (await response.json()) as PreviewResponse;

      if (!response.ok) {
        throw new Error(
          data.error || "The automatic schedule preview could not be calculated."
        );
      }

      setPreview(data);
      setMessage(
        data.completeCoverage
          ? "A complete automatic build is currently possible with the configured constraints."
          : "A complete build is not currently possible. The scheduler can still create the safe partial schedule shown below and leave the remaining blocks for manager completion."
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "The automatic schedule preview could not be calculated."
      );
    } finally {
      setWorking(false);
    }
  }

  const readiness = preview?.readiness;
  const metrics = preview?.metrics;
  const uncoveredRequirements = preview?.uncoveredRequirements ?? [];
  const coverageByRole = preview?.coverageByRole ?? {};
  const shortageSlots = readiness?.shortageSlots ?? [];

  return (
    <div className={styles.panel}>
      <section className="section-card">
        <div className={styles.controls}>
          <label className="form-field">
            <span>Clinic location</span>
            <select
              value={locationId}
              disabled={loading || working}
              onChange={(event) => {
                setLocationId(event.target.value);
                setPreview(null);
              }}
            >
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </label>

          <label className="form-field">
            <span>Schedule date</span>
            <input
              type="date"
              value={selectedDate}
              disabled={working}
              onChange={(event) => {
                setSelectedDate(event.target.value);
                setPreview(null);
              }}
            />
          </label>

          <button
            type="button"
            className="button button-primary"
            disabled={loading || working || !locationId || !selectedDate}
            onClick={() => void calculatePreview()}
          >
            {working ? "Calculating..." : "Preview Auto Schedule"}
          </button>
        </div>

        <div className="inline-message">{message}</div>
      </section>

      {preview && readiness && metrics && (
        <>
          <section
            className={`${styles.statusCard} ${
              preview.completeCoverage
                ? styles.statusComplete
                : styles.statusPartial
            }`}
          >
            <strong>
              {preview.completeCoverage
                ? "Complete automatic build available"
                : "Partial automatic build recommended"}
            </strong>
            <span>
              The preview does not write or delete any calendar assignments. It
              uses the same scheduling engine that Auto Generate uses.
            </span>
          </section>

          <section className={styles.summaryGrid}>
            <article className={styles.metricCard}>
              <span className={styles.metricLabel}>Staff today</span>
              <span className={styles.metricValue}>{readiness.staffCount}</span>
            </article>

            <article className={styles.metricCard}>
              <span className={styles.metricLabel}>Clients today</span>
              <span className={styles.metricValue}>{readiness.clientCount}</span>
            </article>

            <article className={styles.metricCard}>
              <span className={styles.metricLabel}>Client hours needed</span>
              <span className={styles.metricValue}>
                {formatHours(readiness.requiredClientHours)}
              </span>
            </article>

            <article className={styles.metricCard}>
              <span className={styles.metricLabel}>Staff hours available</span>
              <span className={styles.metricValue}>
                {formatHours(readiness.staffAvailableHours)}
              </span>
            </article>

            <article className={styles.metricCard}>
              <span className={styles.metricLabel}>Planned break hours</span>
              <span className={styles.metricValue}>
                {formatHours(readiness.plannedBreakHours)}
              </span>
            </article>

            <article className={styles.metricCard}>
              <span className={styles.metricLabel}>Net coverage capacity</span>
              <span className={styles.metricValue}>
                {formatHours(readiness.netStaffCoverageHours)}
              </span>
            </article>

            <article className={styles.metricCard}>
              <span className={styles.metricLabel}>Predicted coverage</span>
              <span className={styles.metricValue}>
                {formatPercent(metrics.coveragePercent)}
              </span>
            </article>

            <article className={styles.metricCard}>
              <span className={styles.metricLabel}>Additional labor needed</span>
              <span className={styles.metricValue}>
                {formatHours(
                  Math.max(
                    readiness.additionalLaborHoursNeeded,
                    metrics.uncoveredClientHours
                  )
                )}
              </span>
            </article>
          </section>

          <section className={styles.twoColumn}>
            <article className={styles.listCard}>
              <h3>Time-slot capacity warnings</h3>

              {shortageSlots.length === 0 ? (
                <p className={styles.emptyMessage}>
                  No half-hour block has more configured client demand than
                  available staff before matching rules are applied.
                </p>
              ) : (
                <div className="table-scroll">
                  <table className={styles.shortageTable}>
                    <thead>
                      <tr>
                        <th>Time</th>
                        <th>Clients</th>
                        <th>Staff</th>
                        <th>Short</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shortageSlots.map((slot) => (
                        <tr key={slot.startTime}>
                          <td>{slot.startTime}</td>
                          <td>{slot.clientDemand}</td>
                          <td>{slot.staffAvailable}</td>
                          <td>{Math.abs(slot.difference)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </article>

            <article className={styles.listCard}>
              <h3>Manager completion gaps</h3>

              {uncoveredRequirements.length === 0 ? (
                <p className={styles.emptyMessage}>
                  The simulated build covered every required client block.
                </p>
              ) : (
                <ul>
                  {uncoveredRequirements.slice(0, 24).map((requirement) => (
                    <li
                      key={`${requirement.clientId}-${requirement.startTime}`}
                    >
                      <strong>{requirement.clientCode}</strong> at {requirement.startTime}
                    </li>
                  ))}
                </ul>
              )}

              {uncoveredRequirements.length > 24 && (
                <p>
                  Plus {uncoveredRequirements.length - 24} additional uncovered
                  blocks.
                </p>
              )}
            </article>
          </section>

          <section className={styles.twoColumn}>
            <article className={styles.listCard}>
              <h3>Predicted direct client coverage by role</h3>

              {Object.keys(coverageByRole).length === 0 ? (
                <p className={styles.emptyMessage}>No client coverage predicted.</p>
              ) : (
                <ul>
                  {Object.entries(coverageByRole)
                    .sort((left, right) => right[1] - left[1])
                    .map(([role, hours]) => (
                      <li key={role}>
                        <strong>{role.replaceAll("_", " ")}</strong>: {hours.toFixed(1)} hrs
                      </li>
                    ))}
                </ul>
              )}
            </article>

            <article className={styles.listCard}>
              <h3>Pattern guidance used</h3>
              <ul>
                <li>
                  Weekday template: {preview.autoTemplateName ?? "none available"}
                </li>
                <li>
                  Previous same-weekday reference: {preview.previousReferenceDate ?? "none"}
                </li>
                <li>
                  Imported history: {preview.importedTrainingScheduleDays ?? 0} day(s), {preview.importedTrainingRecords ?? 0} row(s)
                </li>
                <li>
                  Livingston workbook trial: {preview.workbookTrainingApplied
                    ? `${preview.workbookTrainingReferences ?? 0} matching reference observations`
                    : "not applied"}
                </li>
              </ul>
            </article>
          </section>

          <div className={styles.trainingNote}>
            <strong>Scheduling order:</strong> BT/RBT coverage is attempted first,
            followed by Intern, Office Manager relief, other configured roles, and
            BCBA as the last direct-coverage tier. Historical patterns only choose
            among otherwise valid options and cannot override hard constraints.
          </div>
        </>
      )}
    </div>
  );
}
