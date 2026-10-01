"use client";

import { useEffect, useState } from "react";

type LocationOption = {
  id: string;
  name: string;
};

type SupervisionRow = {
  staffId: string;
  staffName: string;
  role: string;
  serviceHours: number;
  supervisionHours: number;
  planningTargetPercent: number;
  targetHours: number;
  remainingHours: number;
  status: "NEEDS_SUPERVISION" | "ON_TARGET";
};

type LocationsResponse = {
  locations?: LocationOption[];
  error?: string;
};

type SupervisionResponse = {
  month?: string;
  planningTargetPercent?: number;
  bcbaCount?: number;
  hasSupervisionGap?: boolean;
  rows?: SupervisionRow[];
  error?: string;
};

function getCurrentMonth(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 7);
}

export function SupervisionDashboard() {
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [locationId, setLocationId] = useState("");
  const [month, setMonth] = useState(getCurrentMonth);
  const [data, setData] = useState<SupervisionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("Loading supervision planning data...");

  useEffect(() => {
    void loadLocations();
  }, []);

  useEffect(() => {
    if (locationId && month) {
      void loadSupervision(locationId, month);
    }
  }, [locationId, month]);

  async function loadLocations() {
    try {
      setLoading(true);
      const response = await fetch("/api/locations", { cache: "no-store" });
      const body = (await response.json()) as LocationsResponse;

      if (!response.ok) {
        throw new Error(body.error || "Locations could not be loaded.");
      }

      const nextLocations = body.locations ?? [];
      setLocations(nextLocations);

      if (nextLocations.length > 0) {
        setLocationId(nextLocations[0].id);
      } else {
        setMessage("No clinic locations are available yet.");
      }
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Locations could not be loaded."
      );
    } finally {
      setLoading(false);
    }
  }

  async function loadSupervision(
    requestedLocationId = locationId,
    requestedMonth = month
  ) {
    try {
      setLoading(true);
      const response = await fetch(
        `/api/supervision?locationId=${encodeURIComponent(
          requestedLocationId
        )}&month=${encodeURIComponent(requestedMonth)}`,
        { cache: "no-store" }
      );
      const body = (await response.json()) as SupervisionResponse;

      if (!response.ok) {
        throw new Error(body.error || "Supervision planning data could not be loaded.");
      }

      setData(body);
      setMessage("Supervision planning estimate loaded from the current clinic data.");
    } catch (error) {
      setData(null);
      setMessage(
        error instanceof Error
          ? error.message
          : "Supervision planning data could not be loaded."
      );
    } finally {
      setLoading(false);
    }
  }

  const rows = data?.rows ?? [];
  const staffNeedingSupervision = rows.filter(
    (row) => row.status === "NEEDS_SUPERVISION"
  );

  return (
    <div className="management-layout">
      <section className="section-card">
        <div className="panel-heading-row">
          <div>
            <h2>Planning Period</h2>
            <p>
              This is a scheduling estimate to help managers plan BCBA availability.
              It is not the official compliance record.
            </p>
          </div>

          <div className="toolbar-group">
            <label className="form-field compact-field">
              <span>Location</span>
              <select
                value={locationId}
                disabled={loading}
                onChange={(event) => setLocationId(event.target.value)}
              >
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="form-field compact-field">
              <span>Month</span>
              <input
                type="month"
                value={month}
                disabled={loading}
                onChange={(event) => setMonth(event.target.value)}
              />
            </label>
          </div>
        </div>
      </section>

      {data?.hasSupervisionGap && (
        <section className="section-card">
          <div className="notice warning-notice">
            <strong>No BCBAs to provide supervision</strong>
            <p>
              BTs or RBTs have remaining supervision planning needs, but there are no
              active BCBAs at this location. Add/activate a BCBA or adjust staffing.
            </p>
          </div>
        </section>
      )}

      <section className="metric-grid">
        <article className="metric-card">
          <span>Planning target</span>
          <strong>{(data?.planningTargetPercent ?? 5).toFixed(1)}%</strong>
        </article>
        <article className="metric-card">
          <span>Active BCBAs</span>
          <strong>{data?.bcbaCount ?? 0}</strong>
        </article>
        <article className="metric-card">
          <span>BT/RBT needing supervision</span>
          <strong>{staffNeedingSupervision.length}</strong>
        </article>
      </section>

      <section className="section-card">
        <h2>Monthly Planning Estimate</h2>
        <p className="helper-text">
          The planning target is configurable per clinic in Clinic Settings. Service
          hours are estimated from saved 1:1 schedule assignments for the selected
          month; recorded supervision hours can be layered into the supervision record
          collection.
        </p>

        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Staff</th>
                <th>Role</th>
                <th>Service hours</th>
                <th>Supervision hours</th>
                <th>Planning target</th>
                <th>Remaining</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={7}>No active BT/RBT records for this location.</td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.staffId}>
                    <td>{row.staffName}</td>
                    <td>{row.role}</td>
                    <td>{row.serviceHours.toFixed(1)} h</td>
                    <td>{row.supervisionHours.toFixed(1)} h</td>
                    <td>{row.targetHours.toFixed(1)} h</td>
                    <td>{row.remainingHours.toFixed(1)} h</td>
                    <td>
                      {row.status === "ON_TARGET" ? "On target" : "Needs supervision"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="inline-message">{message}</div>
      </section>
    </div>
  );
}
