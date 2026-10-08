"use client";

import { useEffect, useMemo, useState } from "react";

type LocationOption = {
  id: string;
  name: string;
};

type DailyMetric = {
  date: string;
  day: string;
  clientHoursNeeded: number;
  clientHoursCovered: number;
  staffHoursScheduled: number;
  additionalLaborHours: number;
  staffPresent: number;
  staffAbsent: number;
  uncoveredHours: number;
};

type StaffHourStatus = {
  id: string;
  name: string;
  employeeType: string;
  scheduledHours: number;
  minimumHours: number;
  targetHours: number;
  maximumHours: number;
  hoursShortOfTarget: number;
  hoursAboveMaximum: number;
};

type OverviewResponse = {
  weekStart?: string;
  dailyMetrics?: DailyMetric[];
  totals?: {
    clientHoursNeeded: number;
    clientHoursCovered: number;
    staffHoursScheduled: number;
    additionalLaborHours: number;
    uncoveredHours: number;
    coveragePercent: number;
  };
  staffHourStatus?: StaffHourStatus[];
  error?: string;
};

type LocationsResponse = {
  locations?: LocationOption[];
  error?: string;
};

function getCurrentMonday(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  const day = local.getDay();
  const distanceFromMonday = day === 0 ? -6 : 1 - day;
  local.setDate(local.getDate() + distanceFromMonday);
  return local.toISOString().slice(0, 10);
}

function quoteCsv(value: string | number): string {
  return `"${String(value).replaceAll('"', '""')}"`;
}

export function OverviewDashboard() {
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [locationId, setLocationId] = useState("");
  const [weekStart, setWeekStart] = useState(getCurrentMonday);
  const [viewMode, setViewMode] = useState<"weekly" | "daily">("weekly");
  const [selectedDate, setSelectedDate] = useState(getCurrentMonday);
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("Loading weekly schedule metrics...");

  const selectedLocationName = useMemo(
    () => locations.find((location) => location.id === locationId)?.name ?? "Clinic",
    [locations, locationId]
  );

  useEffect(() => {
    void loadLocations();
  }, []);

  useEffect(() => {
    if (locationId && weekStart) {
      void loadOverview(locationId, weekStart);
    }
  }, [locationId, weekStart]);

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

  async function loadOverview(
    requestedLocationId = locationId,
    requestedWeekStart = weekStart
  ) {
    if (!requestedLocationId || !requestedWeekStart) {
      return;
    }

    try {
      setLoading(true);
      setMessage("Calculating weekly clinic coverage from MongoDB...");

      const response = await fetch(
        `/api/overview?locationId=${encodeURIComponent(
          requestedLocationId
        )}&weekStart=${encodeURIComponent(requestedWeekStart)}`,
        { cache: "no-store" }
      );
      const body = (await response.json()) as OverviewResponse;

      if (!response.ok) {
        throw new Error(body.error || "Weekly overview could not be loaded.");
      }

      setData(body);
      if (body.dailyMetrics?.length && !body.dailyMetrics.some((metric) => metric.date === selectedDate)) {
        setSelectedDate(body.dailyMetrics[0].date);
      }
      setMessage("Weekly overview calculated from the current saved schedule.");
    } catch (error) {
      setData(null);
      setMessage(
        error instanceof Error
          ? error.message
          : "Weekly overview could not be loaded."
      );
    } finally {
      setLoading(false);
    }
  }

  function downloadCsv() {
    if (!data?.dailyMetrics) {
      return;
    }

    const header = [
      "Date",
      "Day",
      "Client Hours Needed",
      "Client Hours Covered",
      "Staff Client Hours Scheduled",
      "Uncovered Client Hours",
      "Staff Present",
      "Staff Absent",
      "Uncovered Client Hours",
    ];

    const rows = data.dailyMetrics.map((metric) => [
      metric.date,
      metric.day,
      metric.clientHoursNeeded,
      metric.clientHoursCovered,
      metric.staffHoursScheduled,
      metric.additionalLaborHours,
      metric.staffPresent,
      metric.staffAbsent,
      metric.uncoveredHours,
    ]);

    const csv = [header, ...rows]
      .map((row) => row.map(quoteCsv).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `${selectedLocationName.toLowerCase().replaceAll(" ", "-")}-${weekStart}-weekly-overview.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const totals = data?.totals ?? {
    clientHoursNeeded: 0,
    clientHoursCovered: 0,
    staffHoursScheduled: 0,
    additionalLaborHours: 0,
    uncoveredHours: 0,
    coveragePercent: 0,
  };

  const selectedDay = data?.dailyMetrics?.find((metric) => metric.date === selectedDate)
    ?? data?.dailyMetrics?.[0];
  const dailyCoveragePercent = selectedDay
    ? (selectedDay.clientHoursNeeded === 0 ? 100 : selectedDay.clientHoursCovered / selectedDay.clientHoursNeeded * 100)
    : 0;
  const overviewValues = viewMode === "daily" && selectedDay
    ? {
        clientHoursNeeded: selectedDay.clientHoursNeeded,
        clientHoursCovered: selectedDay.clientHoursCovered,
        staffHoursScheduled: selectedDay.staffHoursScheduled,
        additionalLaborHours: selectedDay.additionalLaborHours,
        uncoveredHours: selectedDay.uncoveredHours,
        coveragePercent: dailyCoveragePercent,
      }
    : totals;

  const staffNeedingHours =
    data?.staffHourStatus?.filter((staffMember) => staffMember.hoursShortOfTarget > 0) ?? [];
  const staffOverMaximum =
    data?.staffHourStatus?.filter((staffMember) => staffMember.hoursAboveMaximum > 0) ?? [];

  return (
    <div className="management-layout">
      <section className="section-card">
        <div className="panel-heading-row">
          <div>
            <h2>{viewMode === "daily" ? "Daily Overview" : "Weekly Overview"}</h2>
            <p>
              Switch between the full workweek and a single day without leaving this page.
            </p>
          </div>

          <div className="toolbar-group">
            <div role="tablist" aria-label="Overview period" style={{ display: "flex", gap: 8, alignItems: "end" }}>
              <button type="button" role="tab" aria-selected={viewMode === "weekly"}
                className={viewMode === "weekly" ? "button button-primary" : "button button-secondary"}
                onClick={() => setViewMode("weekly")}>Weekly Overview</button>
              <button type="button" role="tab" aria-selected={viewMode === "daily"}
                className={viewMode === "daily" ? "button button-primary" : "button button-secondary"}
                onClick={() => setViewMode("daily")}>Daily Overview</button>
            </div>
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
              <span>Week starts</span>
              <input
                type="date"
                value={weekStart}
                disabled={loading}
                onChange={(event) => setWeekStart(event.target.value)}
              />
            </label>
            {viewMode === "daily" && (
              <label className="form-field compact-field">
                <span>Day to review</span>
                <select value={selectedDay?.date ?? selectedDate} disabled={loading || !data?.dailyMetrics?.length}
                  onChange={(event) => setSelectedDate(event.target.value)}>
                  {(viewMode === "daily" ? (selectedDay ? [selectedDay] : []) : (data?.dailyMetrics ?? [])).map((metric) => (
                    <option key={metric.date} value={metric.date}>{metric.day} — {metric.date}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
        </div>
      </section>

      <section className="metric-grid">
        <article className="metric-card">
          <span>Client hours needed</span>
          <strong>{overviewValues.clientHoursNeeded.toFixed(1)}</strong>
        </article>
        <article className="metric-card">
          <span>Client hours covered</span>
          <strong>{overviewValues.clientHoursCovered.toFixed(1)}</strong>
        </article>
        <article className="metric-card">
          <span>Staff client hours scheduled</span>
          <strong>{overviewValues.staffHoursScheduled.toFixed(1)}</strong>
        </article>
        <article className="metric-card">
          <span>Uncovered client hours</span>
          <strong>{overviewValues.additionalLaborHours.toFixed(1)}</strong>
        </article>
        <article className="metric-card">
          <span>Scheduling coverage</span>
          <strong>{overviewValues.coveragePercent.toFixed(1)}%</strong>
        </article>
      </section>

      {viewMode === "daily" && selectedDay && (
        <section className="section-card">
          <h2>{selectedDay.day}, {selectedDay.date} — Attendance and Coverage</h2>
          <div className="metric-grid">
            <article className="metric-card"><span>Staff available</span><strong>{selectedDay.staffPresent}</strong></article>
            <article className="metric-card"><span>Staff absent</span><strong>{selectedDay.staffAbsent}</strong></article>
            <article className="metric-card"><span>Uncovered hours</span><strong>{selectedDay.uncoveredHours.toFixed(1)} h</strong></article>
            <article className="metric-card"><span>Coverage</span><strong>{dailyCoveragePercent.toFixed(1)}%</strong></article>
          </div>
          <p>Coverage counts each required client and time slot after nap, speech, and attendance adjustments. Uncovered client hours are coverage gaps, not necessarily additional staff hours needed. Open Daily Schedule to inspect unplaced assignments.</p>
        </section>
      )}

      <section className="section-card">
        <div className="panel-heading-row">
          <div>
            <h2>{viewMode === "weekly" ? "Daily Breakdown" : "Selected Day Breakdown"}</h2>
            <p>
              Required client coverage is compared with the current saved client
              assignments, actual staff client-assignment hours, and availability for each weekday.
            </p>
          </div>

          <div className="toolbar-group">
            <button
              type="button"
              className="button button-secondary"
              onClick={() => window.print()}
            >
              Print / Save PDF
            </button>
            <button
              type="button"
              className="button button-primary"
              disabled={!data?.dailyMetrics?.length}
              onClick={downloadCsv}
            >
              Export Excel/CSV
            </button>
          </div>
        </div>

        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Day</th>
                <th>Client needed</th>
                <th>Client covered</th>
                <th>Staff client hours</th>
                <th>Coverage gap</th>
                <th>Staff present</th>
                <th>Staff absent</th>
                <th>Uncovered</th>
              </tr>
            </thead>
            <tbody>
              {(data?.dailyMetrics ?? []).map((metric) => (
                <tr key={metric.date}>
                  <td>{metric.date}</td>
                  <td>{metric.day}</td>
                  <td>{metric.clientHoursNeeded.toFixed(1)} h</td>
                  <td>{metric.clientHoursCovered.toFixed(1)} h</td>
                  <td>{metric.staffHoursScheduled.toFixed(1)} h</td>
                  <td>{metric.additionalLaborHours.toFixed(1)} h</td>
                  <td>{metric.staffPresent}</td>
                  <td>{metric.staffAbsent}</td>
                  <td>{metric.uncoveredHours.toFixed(1)} h</td>
                </tr>
              ))}
              {!loading && !data?.dailyMetrics?.length && (
                <tr>
                  <td colSpan={9}>No metrics are available for this week.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {viewMode === "weekly" && <section className="section-card">
        <h2>Staff Hour Balance</h2>
        <div className="metric-grid">
          <article className="metric-card">
            <span>Staff below target</span>
            <strong>{staffNeedingHours.length}</strong>
          </article>
          <article className="metric-card">
            <span>Staff over maximum</span>
            <strong>{staffOverMaximum.length}</strong>
          </article>
          <article className="metric-card">
            <span>Uncovered client hours</span>
            <strong>{overviewValues.uncoveredHours.toFixed(1)}</strong>
          </article>
        </div>

        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Staff</th>
                <th>Type</th>
                <th>Scheduled</th>
                <th>Target</th>
                <th>Maximum</th>
                <th>Short of target</th>
                <th>Above maximum</th>
              </tr>
            </thead>
            <tbody>
              {(data?.staffHourStatus ?? []).map((staffMember) => (
                <tr key={staffMember.id}>
                  <td>{staffMember.name}</td>
                  <td>{staffMember.employeeType.replaceAll("_", " ")}</td>
                  <td>{staffMember.scheduledHours.toFixed(1)} h</td>
                  <td>{staffMember.targetHours.toFixed(1)} h</td>
                  <td>{staffMember.maximumHours.toFixed(1)} h</td>
                  <td>{staffMember.hoursShortOfTarget.toFixed(1)} h</td>
                  <td>{staffMember.hoursAboveMaximum.toFixed(1)} h</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="inline-message">{message}</div>
      </section>}
      {viewMode === "daily" && <div className="inline-message">{message}</div>}
    </div>
  );
}
